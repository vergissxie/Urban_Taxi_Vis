import json
from datetime import datetime
from typing import List

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.db.session import engine


router = APIRouter(prefix="/api", tags=["matched"])


@router.get("/trajectory/matched/spatial")
def get_matched_spatial_query(
    start_time: datetime,
    end_time: datetime,
    taxi_id: int | None = Query(default=None, ge=1),
    taxi_id_min: int = Query(default=1, ge=1, le=10357),
    taxi_id_max: int = Query(default=10357, ge=1, le=10357),
    detail_limit: int = Query(default=1200, ge=1, le=10357),
    min_lon: float | None = Query(default=None, ge=-180, le=180),
    min_lat: float | None = Query(default=None, ge=-90, le=90),
    max_lon: float | None = Query(default=None, ge=-180, le=180),
    max_lat: float | None = Query(default=None, ge=-90, le=90),
) -> dict:
    effective_detail_limit = min(detail_limit, 1200)

    if start_time >= end_time:
        return {
            "type": "FeatureCollection",
            "features": [],
            "meta": {"error": "start_time must be earlier than end_time", "active_vehicle_count": 0, "trip_count": 0},
        }

    if taxi_id_min > taxi_id_max:
        return {
            "type": "FeatureCollection",
            "features": [],
            "meta": {"error": "taxi_id_min must be <= taxi_id_max", "active_vehicle_count": 0, "trip_count": 0},
        }

    bbox_values = [min_lon, min_lat, max_lon, max_lat]
    if any(value is None for value in bbox_values) and not all(value is None for value in bbox_values):
        return {
            "type": "FeatureCollection",
            "features": [],
            "meta": {"error": "bbox requires min_lon,min_lat,max_lon,max_lat together", "active_vehicle_count": 0, "trip_count": 0},
        }

    if min_lon is not None and (min_lon >= max_lon or min_lat >= max_lat):
        return {
            "type": "FeatureCollection",
            "features": [],
            "meta": {"error": "invalid bbox bounds", "active_vehicle_count": 0, "trip_count": 0},
        }

    params = {
        "start_time": start_time,
        "end_time": end_time,
        "taxi_id": taxi_id,
        "taxi_id_min": taxi_id_min,
        "taxi_id_max": taxi_id_max,
    }

    trip_where = [
        "tp.gps_time >= :start_time",
        "tp.gps_time <= :end_time",
        "tp.taxi_id >= :taxi_id_min",
        "tp.taxi_id <= :taxi_id_max",
    ]
    if taxi_id is not None:
        trip_where.append("tp.taxi_id = :taxi_id")

    if min_lon is not None:
        trip_where.append(
            "tp.geom && ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)"
        )
        trip_where.append(
            "ST_Intersects(tp.geom, ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326))"
        )
        params.update(
            {
                "min_lon": min_lon,
                "min_lat": min_lat,
                "max_lon": max_lon,
                "max_lat": max_lat,
            }
        )

    trip_where_sql = "\n              AND ".join(trip_where)

    filtered_cte = f"""
        WITH bbox_trips AS (
            SELECT
                tp.taxi_id,
                tp.trip_id,
                MIN(tp.gps_time) AS start_time,
                MAX(tp.gps_time) AS end_time
            FROM taxi_points tp
            WHERE {trip_where_sql}
            GROUP BY tp.taxi_id, tp.trip_id
        ),
        matched_filtered AS (
            SELECT
                m.taxi_id,
                m.trip_id,
                bt.start_time,
                bt.end_time,
                m.distance_km,
                m.matched_geom
            FROM matched_trips m
            JOIN bbox_trips bt
              ON bt.taxi_id = m.taxi_id
             AND bt.trip_id = m.trip_id::text
        )
    """

    count_sql = text(
        filtered_cte
        + """
        SELECT
            COUNT(DISTINCT taxi_id) AS active_vehicle_count,
            COUNT(*) AS trip_count
        FROM matched_filtered
        """
    )

    detail_sql = text(
        filtered_cte
        + """
        SELECT
            taxi_id,
            trip_id,
            start_time,
            end_time,
            distance_km,
            ST_AsGeoJSON(matched_geom) AS geometry
        FROM matched_filtered
        ORDER BY start_time DESC, taxi_id ASC, trip_id ASC
        LIMIT :detail_limit
        """
    )

    with engine.connect() as conn:
        count_row = conn.execute(count_sql, params).mappings().first()
        rows = conn.execute(
            detail_sql,
            {
                **params,
                "detail_limit": effective_detail_limit,
            },
        ).mappings().all()

    active_vehicle_count = int(count_row["active_vehicle_count"]) if count_row else 0
    trip_count = int(count_row["trip_count"]) if count_row else 0
    features = []

    for row in rows:
        if row["taxi_id"] is None or row["trip_id"] is None or not row["geometry"]:
            continue

        features.append(
            {
                "type": "Feature",
                "geometry": json.loads(row["geometry"]),
                "properties": {
                    "taxi_id": int(row["taxi_id"]),
                    "trip_id": int(row["trip_id"]),
                    "start_time": row["start_time"].isoformat() if row["start_time"] else None,
                    "end_time": row["end_time"].isoformat() if row["end_time"] else None,
                    "distance_km": float(row["distance_km"]) if row["distance_km"] is not None else None,
                },
            }
        )

    return {
        "type": "FeatureCollection",
        "features": features,
        "meta": {
            "active_vehicle_count": active_vehicle_count,
            "trip_count": trip_count,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "taxi_id_range": {"min": taxi_id_min, "max": taxi_id_max},
            "bbox": None
            if min_lon is None
            else {
                "min_lon": min_lon,
                "min_lat": min_lat,
                "max_lon": max_lon,
                "max_lat": max_lat,
            },
            "is_matched_spatial": True,
            "counts_are_limited": False,
            "detail_limit_applied": effective_detail_limit,
        },
    }


@router.get("/trajectory/matched")
def get_matched_trajectories(
    taxi_id: int = Query(..., ge=1),
    trip_ids: str | None = None,
) -> dict:
    parsed_trip_ids: List[int] = []
    if trip_ids:
        for item in trip_ids.split(","):
            txt = item.strip()
            if not txt:
                continue
            if txt.isdigit():
                parsed_trip_ids.append(int(txt))

    sql = text(
        """
        SELECT
            trip_id,
            taxi_id,
            distance_km,
            ST_AsGeoJSON(matched_geom) AS matched_geom
        FROM matched_trips
        WHERE taxi_id = :taxi_id
          AND (
            :trip_count = 0
            OR trip_id = ANY(:trip_ids)
          )
        ORDER BY trip_id
        """
    )

    with engine.connect() as conn:
        rows = conn.execute(
            sql,
            {
                "taxi_id": taxi_id,
                "trip_count": len(parsed_trip_ids),
                "trip_ids": parsed_trip_ids,
            },
        ).mappings().all()

    features = []
    for row in rows:
        if not row["matched_geom"]:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": json.loads(row["matched_geom"]),
                "properties": {
                    "trip_id": int(row["trip_id"]),
                    "taxi_id": int(row["taxi_id"]),
                    "distance_km": float(row["distance_km"]) if row["distance_km"] is not None else None,
                },
            }
        )

    return {
        "type": "FeatureCollection",
        "features": features,
        "meta": {
            "taxi_id": taxi_id,
            "trip_count": len(features),
        },
    }


@router.get("/trajectory/{trip_id}")
def get_trajectory_with_matched(
    trip_id: int,
    taxi_id: int | None = Query(default=None, ge=1),
) -> dict:
    raw_sql = text(
        """
        SELECT lon, lat
        FROM taxi_points
        WHERE trip_id = :trip_id_text
          AND (:taxi_id IS NULL OR taxi_id = :taxi_id)
        ORDER BY gps_time
        """
    )

    matched_sql = text(
        """
        SELECT
            trip_id,
            taxi_id,
            distance_km,
            ST_AsGeoJSON(matched_geom) AS matched_geom
        FROM matched_trips
        WHERE trip_id = :trip_id
          AND (:taxi_id IS NULL OR taxi_id = :taxi_id)
        LIMIT 1
        """
    )

    with engine.connect() as conn:
        raw_rows = conn.execute(
            raw_sql,
            {"trip_id_text": str(trip_id), "taxi_id": taxi_id},
        ).all()
        matched_row = conn.execute(
            matched_sql,
            {"trip_id": trip_id, "taxi_id": taxi_id},
        ).mappings().first()

    raw_points = [[float(r[0]), float(r[1])] for r in raw_rows]

    return {
        "trip_id": trip_id,
        "taxi_id": matched_row["taxi_id"] if matched_row else taxi_id,
        "raw_points": raw_points,
        "matched_route": json.loads(matched_row["matched_geom"]) if matched_row and matched_row["matched_geom"] else None,
        "distance_km": float(matched_row["distance_km"]) if matched_row and matched_row["distance_km"] is not None else None,
        "meta": {
            "raw_point_count": len(raw_points),
            "has_matched": bool(matched_row and matched_row["matched_geom"]),
        },
    }
