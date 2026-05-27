from datetime import datetime
import json

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.db.session import engine


router = APIRouter(prefix="/api/v1/trajectories", tags=["trajectories"])


def zoom_to_tolerance(zoom: int) -> float:
    # Lower zoom uses stronger simplification; higher zoom keeps detail.
    clamped_zoom = max(3, min(20, zoom))
    return max(0.00002, 0.2 / (2 ** clamped_zoom))


@router.get("/polylines")
def get_trajectory_polylines(
    start_time: datetime,
    end_time: datetime,
    taxi_id: int | None = None,
    min_lon: float | None = Query(default=None, ge=-180, le=180),
    min_lat: float | None = Query(default=None, ge=-90, le=90),
    max_lon: float | None = Query(default=None, ge=-180, le=180),
    max_lat: float | None = Query(default=None, ge=-90, le=90),
    zoom: int = Query(default=12, ge=3, le=20),
    use_zoom_simplify: bool = True,
    simplify_tolerance: float | None = Query(default=None, ge=0),
    max_trips: int = Query(default=300, ge=1, le=5000),
    max_gap_minutes: int = Query(default=40, ge=1, le=240),
    max_jump_km: float = Query(default=30.0, ge=0.1, le=500.0),
    max_speed_kmh: float = Query(default=140.0, ge=10.0, le=400.0),
) -> dict:
    if start_time >= end_time:
        return {"type": "FeatureCollection", "features": [], "meta": {"error": "start_time must be earlier than end_time"}}

    bbox_values = [min_lon, min_lat, max_lon, max_lat]
    if any(value is None for value in bbox_values) and not all(value is None for value in bbox_values):
        return {"type": "FeatureCollection", "features": [], "meta": {"error": "bbox requires min_lon,min_lat,max_lon,max_lat together"}}

    if min_lon is not None and (min_lon >= max_lon or min_lat >= max_lat):
        return {"type": "FeatureCollection", "features": [], "meta": {"error": "invalid bbox bounds"}}

    tolerance = 0.0
    if simplify_tolerance is not None:
        tolerance = simplify_tolerance
    elif use_zoom_simplify:
        tolerance = zoom_to_tolerance(zoom)

    sql = text(
        """
        WITH candidate_trips AS (
            SELECT
                taxi_id,
                trip_id,
                MIN(gps_time) AS first_time
            FROM taxi_points
            WHERE gps_time >= :start_time
              AND gps_time <= :end_time
              AND (:taxi_id IS NULL OR taxi_id = :taxi_id)
              AND (
                    :min_lon IS NULL
                    OR (
                        geom && ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
                        AND ST_Intersects(
                            geom,
                            ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
                        )
                    )
              )
            GROUP BY taxi_id, trip_id
            ORDER BY first_time ASC
            LIMIT :candidate_trip_limit
        ),
        base AS (
            SELECT tp.taxi_id, tp.trip_id, tp.gps_time, tp.geom
            FROM taxi_points tp
            JOIN candidate_trips ct
              ON ct.taxi_id = tp.taxi_id
             AND ct.trip_id = tp.trip_id
            WHERE tp.gps_time >= :start_time
              AND tp.gps_time <= :end_time
              AND (
                    :min_lon IS NULL
                    OR (
                        tp.geom && ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
                        AND ST_Intersects(
                            tp.geom,
                            ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
                        )
                    )
              )
        ),
        ordered AS (
            SELECT
                taxi_id,
                trip_id,
                gps_time,
                geom,
                LAG(gps_time) OVER (PARTITION BY taxi_id, trip_id ORDER BY gps_time) AS prev_time,
                LAG(geom) OVER (PARTITION BY taxi_id, trip_id ORDER BY gps_time) AS prev_geom
            FROM base
        ),
        segmented AS (
            SELECT
                taxi_id,
                trip_id,
                gps_time,
                geom,
                CASE
                    WHEN prev_time IS NULL OR prev_geom IS NULL THEN 1
                    WHEN EXTRACT(EPOCH FROM (gps_time - prev_time)) <= 0 THEN 1
                    WHEN EXTRACT(EPOCH FROM (gps_time - prev_time)) > :max_gap_seconds THEN 1
                    WHEN ST_DistanceSphere(prev_geom, geom) > :max_jump_meters THEN 1
                    WHEN (
                        ST_DistanceSphere(prev_geom, geom)
                        / EXTRACT(EPOCH FROM (gps_time - prev_time))
                    ) > :max_speed_mps THEN 1
                    ELSE 0
                END AS is_new_segment
            FROM ordered
        ),
        grouped AS (
            SELECT
                taxi_id,
                trip_id,
                gps_time,
                geom,
                SUM(is_new_segment) OVER (
                    PARTITION BY taxi_id, trip_id
                    ORDER BY gps_time
                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) AS segment_id
            FROM segmented
        ),
        lines AS (
            SELECT
                taxi_id,
                trip_id,
                segment_id,
                COUNT(*) AS point_count,
                MIN(gps_time) AS start_time,
                MAX(gps_time) AS end_time,
                ST_MakeLine(geom ORDER BY gps_time) AS line_geom
            FROM grouped
            GROUP BY taxi_id, trip_id, segment_id
            HAVING COUNT(*) >= 2
        ),
        line_count AS (
            SELECT COUNT(*) AS total_segment_count FROM lines
        )
        SELECT
            taxi_id,
            CONCAT(trip_id, '_s', segment_id) AS trip_id,
            point_count,
            start_time,
            end_time,
            line_count.total_segment_count,
            ST_AsGeoJSON(
                CASE
                    WHEN :tolerance > 0 THEN ST_Simplify(line_geom, :tolerance)
                    ELSE line_geom
                END
            ) AS geometry
        FROM lines
        CROSS JOIN line_count
        ORDER BY start_time ASC
        LIMIT :max_trips
        """
    )

    params = {
        "start_time": start_time,
        "end_time": end_time,
        "taxi_id": taxi_id,
        "min_lon": min_lon,
        "min_lat": min_lat,
        "max_lon": max_lon,
        "max_lat": max_lat,
        "tolerance": tolerance,
        "max_trips": max_trips,
        "candidate_trip_limit": max_trips,
        "max_gap_seconds": max_gap_minutes * 60,
        "max_jump_meters": max_jump_km * 1000,
        "max_speed_mps": max_speed_kmh / 3.6,
    }

    features = []
    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()

    total_segment_count = int(rows[0]["total_segment_count"]) if rows else 0

    for row in rows:
        if not row["geometry"]:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": json.loads(row["geometry"]),
                "properties": {
                    "taxi_id": row["taxi_id"],
                    "trip_id": row["trip_id"],
                    "point_count": row["point_count"],
                    "start_time": row["start_time"].isoformat() if row["start_time"] else None,
                    "end_time": row["end_time"].isoformat() if row["end_time"] else None,
                },
            }
        )

    return {
        "type": "FeatureCollection",
        "features": features,
        "meta": {
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "zoom": zoom,
            "tolerance": tolerance,
            "trip_count": len(features),
            "total_segment_count": total_segment_count,
            "is_limited": total_segment_count > len(features),
            "use_zoom_simplify": use_zoom_simplify,
            "segment_rules": {
                "max_gap_minutes": max_gap_minutes,
                "max_jump_km": max_jump_km,
                "max_speed_kmh": max_speed_kmh,
            },
        },
    }
