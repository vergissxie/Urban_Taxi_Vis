from datetime import datetime
from copy import deepcopy
from dataclasses import dataclass
import json
import logging
import math
import re
from bisect import bisect_left, insort
from collections import Counter, defaultdict
from importlib import import_module
from threading import Lock
from time import monotonic, perf_counter
from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import bindparam, text

from app.db.session import engine


router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])
logger = logging.getLogger("uvicorn.error")
F7_EXACT_WINDOW_LIMIT_HOURS = 6.0
F7_COMPONENT_CLUSTER_EPS_DEGREES = 0.00018
F7_STITCH_MAX_GAP_M = 120.0
F7_LONG_CORRIDOR_MIN_LENGTH_M = 1200.0
F7_LONG_CORRIDOR_MAX_GAP_M = 260.0
F7_LONG_CORRIDOR_MAX_ANGLE_PENALTY = 0.22
F7_FRAGMENT_PENALTY_PER_EXTRA_COMPONENT = 0.14
F7_MIN_DISPLAY_CONFIDENCE = 0.18
F7_BACKBONE_MAX_BRANCH_GEOMETRIES = 80
F7_RESPONSE_CACHE_TTL_SECONDS = 45.0
F8_RESPONSE_CACHE_TTL_SECONDS = 300.0
F8_RESPONSE_CACHE_MAX_ENTRIES = 24
F8_SAMPLED_TRIP_CACHE_TTL_SECONDS = 300.0
F8_SAMPLED_TRIP_CACHE_MAX_ENTRIES = 8
F4_RESPONSE_CACHE_TTL_SECONDS = 60.0
F6_RESPONSE_CACHE_TTL_SECONDS = 45.0
F6_TRIP_GRID_STEP_DEGREES = 0.01
F7_STAGE2_MAX_RAW_PAIRS_PER_FAMILY = 4
F7_GAP_INDEX_CELL_M = F7_LONG_CORRIDOR_MAX_GAP_M
DATASET_SUMMARY_CACHE_KEY = "tdriver-2008-beijing"
F4_RESPONSE_CACHE: dict[str, tuple[float, dict]] = {}
F4_RESPONSE_CACHE_LOCK = Lock()
F6_RESPONSE_CACHE: dict[str, tuple[float, dict]] = {}
F6_RESPONSE_CACHE_LOCK = Lock()
F7_RESPONSE_CACHE: dict[str, tuple[float, dict]] = {}
F8_RESPONSE_CACHE: dict[str, tuple[float, dict]] = {}
F8_RESPONSE_CACHE_LOCK = Lock()
F8_SAMPLED_TRIP_CACHE: dict[str, tuple[float, dict]] = {}
F8_SAMPLED_TRIP_CACHE_LOCK = Lock()


@dataclass(frozen=True)
class F7EndpointGridIndex:
    cells: dict[tuple[int, int], set[int]]
    origin_lon: float
    origin_lat: float
    lon_scale_m: float
    lat_scale_m: float
    cell_m: float


class BBoxPayload(BaseModel):
    min_lon: float = Field(ge=-180, le=180)
    min_lat: float = Field(ge=-90, le=90)
    max_lon: float = Field(ge=-180, le=180)
    max_lat: float = Field(ge=-90, le=90)


class ActiveVehiclesUnionRequest(BaseModel):
    start_time: datetime
    end_time: datetime
    taxi_id_min: int = Field(default=1, ge=1, le=10357)
    taxi_id_max: int = Field(default=10357, ge=1, le=10357)
    bboxes: list[BBoxPayload]


class ActiveVehiclesUnionDetailRequest(ActiveVehiclesUnionRequest):
    row_limit: int = Field(default=10357, ge=1, le=10357)


class F5ABFlowRequest(BaseModel):
    start_time: datetime
    end_time: datetime
    granularity: Literal["hour", "day"] = "hour"
    buffer_meters: float = Field(default=30, ge=0, le=200)
    max_transition_seconds: int = Field(default=1800, ge=60, le=21600)
    area_a: BBoxPayload
    area_b: BBoxPayload


class F5TransitionThresholdRecommendationRequest(BaseModel):
    area_a: BBoxPayload
    area_b: BBoxPayload
    pessimistic_mps: float = Field(default=2.8, ge=0.5, le=30)
    road_winding_factor: float = Field(default=1.6, ge=1.0, le=3.0)
    absolute_minimum_seconds: int = Field(default=600, ge=60, le=3600)
    absolute_maximum_seconds: int = Field(default=7200, ge=600, le=21600)


class F6RadiationFlowRequest(BaseModel):
    start_time: datetime
    end_time: datetime
    granularity: Literal["hour", "day"] = "hour"
    direction: Literal["outbound", "inbound", "both"] = "both"
    analysis_mode: Literal["strict_od", "through_flow"] = "strict_od"
    core_area: BBoxPayload
    analysis_bbox: BBoxPayload | None = None
    h3_resolution: int = Field(default=8, ge=6, le=10)
    grid_size_m: int = Field(default=1000, ge=500, le=5000)
    buffer_meters: float = Field(default=30, ge=0, le=200)
    max_transition_seconds: int = Field(default=3600, ge=60, le=21600)
    top_k: int = Field(default=30, ge=1, le=100)


class F7FrequentPathsRequest(BaseModel):
    start_time: datetime
    end_time: datetime
    analysis_bbox: BBoxPayload
    top_k: int = Field(default=50, ge=1, le=200)
    min_group_length_m: float = Field(default=300, ge=0, le=10000)
    max_trips: int = Field(default=500, ge=100, le=5000)
    scope: Literal["citywide", "bbox"] = "citywide"
    sort_mode: Literal["frequency", "length_weighted"] = "frequency"


class F7RoadDetailRequest(BaseModel):
    start_time: datetime
    end_time: datetime
    analysis_bbox: BBoxPayload
    road_group_key: str = Field(min_length=1, max_length=256)
    direction: int = Field(ge=-1, le=1)
    component_id: int | None = Field(default=None, ge=1)


class F8ABFrequentRoutesRequest(BaseModel):
    start_time: datetime
    end_time: datetime
    area_a: BBoxPayload
    area_b: BBoxPayload
    top_k: int = Field(default=5, ge=1, le=20)
    candidate_mode: Literal["strict_od", "pass_through"] = "pass_through"
    buffer_meters: float = Field(default=30, ge=0, le=200)
    min_support: int = Field(default=3, ge=1, le=1000)
    min_edge_length_m: float = Field(default=20, ge=0, le=500)
    min_route_length_m: float = Field(default=500, ge=0, le=20000)
    max_candidate_trips: int = Field(default=10000, ge=100, le=50000)
    include_debug_counts: bool = False
    start_hour_filter: list[int] | None = Field(default=None, min_length=1, max_length=24)
    start_minute_filter_start: int | None = Field(default=None, ge=0, le=1439)
    start_minute_filter_end: int | None = Field(default=None, ge=0, le=1439)



def expand_bbox_by_meters(bbox: BBoxPayload, meters: float) -> dict[str, float]:
    if meters <= 0:
        return {
            "min_lon": bbox.min_lon,
            "min_lat": bbox.min_lat,
            "max_lon": bbox.max_lon,
            "max_lat": bbox.max_lat,
        }

    mid_lat = (bbox.min_lat + bbox.max_lat) / 2.0
    lat_cos = math.cos(math.radians(mid_lat))
    safe_cos = max(0.01, abs(lat_cos))
    delta_lat = meters / 110540.0
    delta_lon = meters / (111320.0 * safe_cos)

    return {
        "min_lon": bbox.min_lon - delta_lon,
        "min_lat": bbox.min_lat - delta_lat,
        "max_lon": bbox.max_lon + delta_lon,
        "max_lat": bbox.max_lat + delta_lat,
    }


def ensure_trip_od_cache() -> None:
    """Build a compact trip endpoint cache used by F6 OD analysis."""
    with engine.begin() as conn:
        exists = conn.execute(text("SELECT to_regclass('public.trip_od_cache') AS regclass")).mappings().first()
        if exists and exists["regclass"]:
            return

        conn.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_taxi_points_taxi_trip_time_id
                    ON taxi_points (taxi_id, trip_id, gps_time, id)
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE trip_od_cache AS
                WITH starts AS (
                    SELECT DISTINCT ON (taxi_id, trip_id)
                        taxi_id,
                        trip_id,
                        gps_time AS start_time,
                        geom AS start_geom,
                        lon AS start_lon,
                        lat AS start_lat
                    FROM taxi_points
                    ORDER BY taxi_id, trip_id, gps_time ASC, id ASC
                ),
                ends AS (
                    SELECT DISTINCT ON (taxi_id, trip_id)
                        taxi_id,
                        trip_id,
                        gps_time AS end_time,
                        geom AS end_geom,
                        lon AS end_lon,
                        lat AS end_lat
                    FROM taxi_points
                    ORDER BY taxi_id, trip_id, gps_time DESC, id DESC
                ),
                point_counts AS (
                    SELECT taxi_id, trip_id, COUNT(*)::int AS point_count
                    FROM taxi_points
                    GROUP BY taxi_id, trip_id
                )
                SELECT
                    s.taxi_id,
                    s.trip_id,
                    s.start_time,
                    e.end_time,
                    s.start_geom,
                    e.end_geom,
                    s.start_lon,
                    s.start_lat,
                    e.end_lon,
                    e.end_lat,
                    pc.point_count,
                    EXTRACT(EPOCH FROM (e.end_time - s.start_time))::double precision AS duration_seconds
                FROM starts s
                JOIN ends e
                  ON e.taxi_id = s.taxi_id
                 AND e.trip_id = s.trip_id
                JOIN point_counts pc
                  ON pc.taxi_id = s.taxi_id
                 AND pc.trip_id = s.trip_id
                """
            )
        )
        conn.execute(text("ALTER TABLE trip_od_cache ADD PRIMARY KEY (taxi_id, trip_id)"))
        conn.execute(text("CREATE INDEX idx_trip_od_cache_start_time ON trip_od_cache (start_time)"))
        conn.execute(text("CREATE INDEX idx_trip_od_cache_end_time ON trip_od_cache (end_time)"))
        conn.execute(text("CREATE INDEX idx_trip_od_cache_start_geom_gist ON trip_od_cache USING GIST (start_geom)"))
        conn.execute(text("CREATE INDEX idx_trip_od_cache_end_geom_gist ON trip_od_cache USING GIST (end_geom)"))
        conn.execute(text("ANALYZE trip_od_cache"))


def ensure_dataset_summary_cache() -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS dataset_summary_cache (
                    cache_key text PRIMARY KEY,
                    payload jsonb NOT NULL,
                    refreshed_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
        )


def read_dataset_summary_cache() -> dict | None:
    ensure_dataset_summary_cache()
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT payload, refreshed_at
                FROM dataset_summary_cache
                WHERE cache_key = :cache_key
                """
            ),
            {"cache_key": DATASET_SUMMARY_CACHE_KEY},
        ).mappings().first()

    if not row:
        return None

    payload = row["payload"]
    if isinstance(payload, str):
        payload = json.loads(payload)
    payload["cache"] = {
        "key": DATASET_SUMMARY_CACHE_KEY,
        "refreshed_at": row["refreshed_at"].isoformat() if row["refreshed_at"] else None,
    }
    return payload


def refresh_dataset_summary_cache() -> dict:
    ensure_dataset_summary_cache()
    sql = text(
        """
        SELECT
            COUNT(*)::bigint AS point_count,
            COUNT(*) FILTER (
                WHERE lon NOT BETWEEN 115.7 AND 117.4
                   OR lat NOT BETWEEN 39.4 AND 41.1
            )::bigint AS outlier_point_count,
            COUNT(DISTINCT taxi_id)::bigint AS vehicle_count,
            MIN(taxi_id)::int AS min_taxi_id,
            MAX(taxi_id)::int AS max_taxi_id,
            MIN(gps_time) AS start_time,
            MAX(gps_time) AS end_time
        FROM taxi_points
        """
    )

    with engine.begin() as conn:
        row = conn.execute(sql).mappings().first()
        trip_cache_row = conn.execute(text("SELECT to_regclass('public.trip_od_cache') AS regclass")).mappings().first()
        if trip_cache_row and trip_cache_row["regclass"]:
            trip_count = conn.execute(text("SELECT COUNT(*)::bigint AS trip_count FROM trip_od_cache")).scalar_one()
        else:
            trip_count = conn.execute(
                text("SELECT COUNT(DISTINCT (taxi_id, trip_id))::bigint AS trip_count FROM taxi_points")
            ).scalar_one()

        vehicle_count = int(row["vehicle_count"] or 0) if row else 0
        min_taxi_id = int(row["min_taxi_id"] or 0) if row else 0
        max_taxi_id = int(row["max_taxi_id"] or 0) if row else 0
        expected_id_count = max(0, max_taxi_id - min_taxi_id + 1) if min_taxi_id and max_taxi_id else 0
        payload = {
            "point_count": int(row["point_count"] or 0) if row else 0,
            "outlier_point_count": int(row["outlier_point_count"] or 0) if row else 0,
            "vehicle_count": vehicle_count,
            "trip_count": int(trip_count or 0),
            "taxi_id_range": {
                "min": min_taxi_id,
                "max": max_taxi_id,
                "missing_id_count": max(0, expected_id_count - vehicle_count),
            },
            "time_range": {
                "start_time": row["start_time"].isoformat() if row and row["start_time"] else None,
                "end_time": row["end_time"].isoformat() if row and row["end_time"] else None,
            },
            "spatial_bound": {
                "label": "北京五环内核心区",
                "min_lon": 115.7,
                "min_lat": 39.4,
                "max_lon": 117.4,
                "max_lat": 41.1,
            },
            "coordinate_system": "WGS-84",
            "accuracy_note": "GPS 原始点精度受车载设备与城市峡谷影响；路网匹配结果用于道路级纠偏展示。",
            "vehicle_count_note": "车辆总数按 taxi_points 中实际存在 GPS 记录的 DISTINCT taxi_id 统计；原始 ID 上限不等于有效样本车辆数。",
        }
        refreshed_at = conn.execute(
            text(
                """
                INSERT INTO dataset_summary_cache (cache_key, payload, refreshed_at)
                VALUES (:cache_key, CAST(:payload AS jsonb), now())
                ON CONFLICT (cache_key) DO UPDATE
                SET payload = EXCLUDED.payload,
                    refreshed_at = now()
                RETURNING refreshed_at
                """
            ),
            {"cache_key": DATASET_SUMMARY_CACHE_KEY, "payload": json.dumps(payload, ensure_ascii=False)},
        ).scalar_one()

    payload["cache"] = {
        "key": DATASET_SUMMARY_CACHE_KEY,
        "refreshed_at": refreshed_at.isoformat() if refreshed_at else None,
    }
    return payload


def ensure_f7_support_indexes() -> None:
    """Indexes needed for online F7 edge reconstruction from matched geometry vertices."""
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE road_edges ADD COLUMN IF NOT EXISTS edge_uid BIGSERIAL"))
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS idx_road_edges_edge_uid ON road_edges (edge_uid)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_matched_trip_edges_road ON matched_trip_edges (road_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_matched_trip_edges_road_uid ON matched_trip_edges (road_uid)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_matched_trip_edges_trip ON matched_trip_edges (taxi_id, trip_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_road_edges_u_v ON road_edges (u, v)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_road_edges_v_u ON road_edges (v, u)"))


def matched_trip_edges_exists() -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                    to_regclass('public.matched_trip_edges') AS regclass,
                    EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_name = 'matched_trip_edges'
                          AND column_name = 'road_uid'
                    ) AS has_road_uid
                """
            )
        ).mappings().first()
    return bool(row and row["regclass"] and row["has_road_uid"])


def matched_trip_road_passes_exists() -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                    EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_name = 'matched_trip_road_passes'
                          AND column_name = 'road_uid'
                    ) AS has_table,
                    to_regclass('public.pipeline_build_status') IS NOT NULL AS has_status_table
                """
            )
        ).mappings().first()
        if not row or not row["has_table"] or not row["has_status_table"]:
            return False
        status_row = conn.execute(
            text(
                """
                SELECT status
                FROM pipeline_build_status
                WHERE pipeline_name = 'matched_trip_road_passes'
                """
            )
        ).mappings().first()
        if not status_row or status_row["status"] != "ready":
            return False
        count_row = conn.execute(text("SELECT EXISTS (SELECT 1 FROM matched_trip_road_passes LIMIT 1) AS has_rows")).mappings().first()
    return bool(count_row and count_row["has_rows"])


def trip_spatial_index_exists() -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                    to_regclass('public.trip_spatial_index') IS NOT NULL AS has_table,
                    to_regclass('public.pipeline_build_status') IS NOT NULL AS has_status_table
                """
            )
        ).mappings().first()
        if not row or not row["has_table"] or not row["has_status_table"]:
            return False
        status_row = conn.execute(
            text(
                """
                SELECT status
                FROM pipeline_build_status
                WHERE pipeline_name = 'trip_spatial_index'
                """
            )
        ).mappings().first()
        if not status_row or status_row["status"] != "ready":
            return False
        count_row = conn.execute(text("SELECT EXISTS (SELECT 1 FROM trip_spatial_index LIMIT 1) AS has_rows")).mappings().first()
    return bool(count_row and count_row["has_rows"])


def trip_token_sequence_exists() -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                    to_regclass('public.trip_token_sequence') IS NOT NULL AS has_table,
                    to_regclass('public.pipeline_build_status') IS NOT NULL AS has_status_table
                """
            )
        ).mappings().first()
        if not row or not row["has_table"] or not row["has_status_table"]:
            return False
        status_row = conn.execute(
            text(
                """
                SELECT status
                FROM pipeline_build_status
                WHERE pipeline_name = 'trip_token_sequence'
                """
            )
        ).mappings().first()
        if not status_row or status_row["status"] != "ready":
            return False
        count_row = conn.execute(text("SELECT EXISTS (SELECT 1 FROM trip_token_sequence LIMIT 1) AS has_rows")).mappings().first()
    return bool(count_row and count_row["has_rows"])


def trip_edge_sequence_cache_exists() -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                    to_regclass('public.trip_edge_sequence_cache') IS NOT NULL AS has_table,
                    to_regclass('public.pipeline_build_status') IS NOT NULL AS has_status_table
                """
            )
        ).mappings().first()
        if not row or not row["has_table"] or not row["has_status_table"]:
            return False
        status_row = conn.execute(
            text(
                """
                SELECT status
                FROM pipeline_build_status
                WHERE pipeline_name = 'trip_edge_sequence_cache'
                """
            )
        ).mappings().first()
        if not status_row or status_row["status"] != "ready":
            return False
        count_row = conn.execute(text("SELECT EXISTS (SELECT 1 FROM trip_edge_sequence_cache LIMIT 1) AS has_rows")).mappings().first()
    return bool(count_row and count_row["has_rows"])


def road_edge_feature_cache_exists() -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                    to_regclass('public.road_edge_feature_cache') IS NOT NULL AS has_table,
                    to_regclass('public.pipeline_build_status') IS NOT NULL AS has_status_table
                """
            )
        ).mappings().first()
        if not row or not row["has_table"] or not row["has_status_table"]:
            return False
        status_row = conn.execute(
            text(
                """
                SELECT status
                FROM pipeline_build_status
                WHERE pipeline_name = 'road_edge_feature_cache'
                """
            )
        ).mappings().first()
        if not status_row or status_row["status"] != "ready":
            return False
        count_row = conn.execute(text("SELECT EXISTS (SELECT 1 FROM road_edge_feature_cache LIMIT 1) AS has_rows")).mappings().first()
    return bool(count_row and count_row["has_rows"])


def trip_grid_points_exists() -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                    to_regclass('public.trip_grid_points') IS NOT NULL AS has_table,
                    to_regclass('public.pipeline_build_status') IS NOT NULL AS has_status_table
                """
            )
        ).mappings().first()
        if not row or not row["has_table"] or not row["has_status_table"]:
            return False
        status_row = conn.execute(
            text(
                """
                SELECT status
                FROM pipeline_build_status
                WHERE pipeline_name = 'trip_grid_points'
                """
            )
        ).mappings().first()
        if not status_row or status_row["status"] != "ready":
            return False
        count_row = conn.execute(text("SELECT EXISTS (SELECT 1 FROM trip_grid_points LIMIT 1) AS has_rows")).mappings().first()
    return bool(count_row and count_row["has_rows"])


def _bbox_to_grid_keys(bbox: dict[str, float], grid_step_degrees: float) -> list[str]:
    min_grid_x = math.floor(bbox["min_lon"] / grid_step_degrees)
    max_grid_x = math.floor(bbox["max_lon"] / grid_step_degrees)
    min_grid_y = math.floor(bbox["min_lat"] / grid_step_degrees)
    max_grid_y = math.floor(bbox["max_lat"] / grid_step_degrees)
    grid_keys: list[str] = []
    for grid_x in range(min_grid_x, max_grid_x + 1):
        for grid_y in range(min_grid_y, max_grid_y + 1):
            grid_keys.append(f"{grid_x}:{grid_y}")
    return grid_keys


def matched_road_hourly_counts_exists() -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                    to_regclass('public.matched_road_hourly_counts') IS NOT NULL AS has_table,
                    to_regclass('public.pipeline_build_status') IS NOT NULL AS has_status_table
                """
            )
        ).mappings().first()
        if not row or not row["has_table"] or not row["has_status_table"]:
            return False
        status_row = conn.execute(
            text(
                """
                SELECT status
                FROM pipeline_build_status
                WHERE pipeline_name = 'matched_road_hourly_counts'
                """
            )
        ).mappings().first()
        if not status_row or status_row["status"] != "ready":
            return False
        count_row = conn.execute(text("SELECT EXISTS (SELECT 1 FROM matched_road_hourly_counts LIMIT 1) AS has_rows")).mappings().first()
    return bool(count_row and count_row["has_rows"])


def matched_road_group_hourly_counts_exists() -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                    to_regclass('public.matched_road_group_hourly_counts') IS NOT NULL AS has_table,
                    to_regclass('public.pipeline_build_status') IS NOT NULL AS has_status_table
                """
            )
        ).mappings().first()
        if not row or not row["has_table"] or not row["has_status_table"]:
            return False
        status_row = conn.execute(
            text(
                """
                SELECT status
                FROM pipeline_build_status
                WHERE pipeline_name = 'matched_road_group_hourly_counts'
                """
            )
        ).mappings().first()
        if not status_row or status_row["status"] != "ready":
            return False
        count_row = conn.execute(text("SELECT EXISTS (SELECT 1 FROM matched_road_group_hourly_counts LIMIT 1) AS has_rows")).mappings().first()
    return bool(count_row and count_row["has_rows"])


def f7_order_by_clause(sort_mode: str, *, has_edge_pass_weight: bool = True) -> str:
    if sort_mode == "length_weighted":
        intensity_tiebreaker = "edge_pass_weight DESC, " if has_edge_pass_weight else ""
        return (
            "(trip_count * GREATEST(group_length_m, 1.0)) DESC, "
            "trip_count DESC, "
            f"{intensity_tiebreaker}"
            "group_length_m DESC, road_group_key ASC"
        )
    intensity_tiebreaker = "edge_pass_weight DESC, " if has_edge_pass_weight else "vehicle_count DESC, "
    return f"trip_count DESC, {intensity_tiebreaker}group_length_m DESC, road_group_key ASC"


def f7_scope_uses_bbox(payload: F7FrequentPathsRequest) -> bool:
    return payload.scope == "bbox"


def _f7_request_cache_key(payload: F7FrequentPathsRequest) -> str:
    normalized = payload.model_dump(mode="json")
    normalized["analysis_bbox"] = {
        "min_lon": round(float(payload.analysis_bbox.min_lon), 6),
        "min_lat": round(float(payload.analysis_bbox.min_lat), 6),
        "max_lon": round(float(payload.analysis_bbox.max_lon), 6),
        "max_lat": round(float(payload.analysis_bbox.max_lat), 6),
    }
    return json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _f7_read_cached_response(payload: F7FrequentPathsRequest) -> dict | None:
    cache_key = _f7_request_cache_key(payload)
    cached = F7_RESPONSE_CACHE.get(cache_key)
    if not cached:
        return None
    cached_at, response = cached
    if monotonic() - cached_at > F7_RESPONSE_CACHE_TTL_SECONDS:
        F7_RESPONSE_CACHE.pop(cache_key, None)
        return None
    cloned = deepcopy(response)
    cloned.setdefault("meta", {})
    cloned["meta"]["cache_hit"] = True
    cloned["meta"]["cache_ttl_seconds"] = F7_RESPONSE_CACHE_TTL_SECONDS
    return cloned


def _f7_write_cached_response(payload: F7FrequentPathsRequest, response: dict) -> dict:
    cache_key = _f7_request_cache_key(payload)
    F7_RESPONSE_CACHE[cache_key] = (monotonic(), deepcopy(response))
    response.setdefault("meta", {})
    response["meta"]["cache_hit"] = False
    response["meta"]["cache_ttl_seconds"] = F7_RESPONSE_CACHE_TTL_SECONDS
    return response


def _f8_request_cache_key(payload: F8ABFrequentRoutesRequest) -> str:
    normalized = payload.model_dump(mode="json")
    for area_key in ("area_a", "area_b"):
        area = normalized.get(area_key) or {}
        normalized[area_key] = {
            "min_lon": round(float(area.get("min_lon") or 0.0), 6),
            "min_lat": round(float(area.get("min_lat") or 0.0), 6),
            "max_lon": round(float(area.get("max_lon") or 0.0), 6),
            "max_lat": round(float(area.get("max_lat") or 0.0), 6),
        }
    return json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _f8_prune_cache(cache: dict[str, tuple[float, dict]], max_entries: int) -> None:
    if len(cache) <= max_entries:
        return
    for cache_key, _ in sorted(cache.items(), key=lambda item: item[1][0])[: len(cache) - max_entries]:
        cache.pop(cache_key, None)


def _f8_sampled_trip_cache_key(payload: F8ABFrequentRoutesRequest) -> str:
    normalized = payload.model_dump(mode="json")
    normalized.pop("top_k", None)
    normalized.pop("include_debug_counts", None)
    for area_key in ("area_a", "area_b"):
        area = normalized.get(area_key) or {}
        normalized[area_key] = {
            "min_lon": round(float(area.get("min_lon") or 0.0), 6),
            "min_lat": round(float(area.get("min_lat") or 0.0), 6),
            "max_lon": round(float(area.get("max_lon") or 0.0), 6),
            "max_lat": round(float(area.get("max_lat") or 0.0), 6),
        }
    return json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _f8_read_cached_sampled_trip_stage(payload: F8ABFrequentRoutesRequest) -> dict | None:
    if payload.include_debug_counts:
        return None
    cache_key = _f8_sampled_trip_cache_key(payload)
    with F8_SAMPLED_TRIP_CACHE_LOCK:
        cached = F8_SAMPLED_TRIP_CACHE.get(cache_key)
        if not cached:
            return None
        cached_at, stage = cached
        if monotonic() - cached_at > F8_SAMPLED_TRIP_CACHE_TTL_SECONDS:
            F8_SAMPLED_TRIP_CACHE.pop(cache_key, None)
            return None
        cloned = deepcopy(stage)
    cloned["cache_hit"] = True
    return cloned


def _f8_write_cached_sampled_trip_stage(payload: F8ABFrequentRoutesRequest, stage: dict) -> dict:
    if payload.include_debug_counts:
        stage["cache_hit"] = False
        return stage
    cache_key = _f8_sampled_trip_cache_key(payload)
    cached_stage = deepcopy(stage)
    cached_stage["cache_hit"] = False
    with F8_SAMPLED_TRIP_CACHE_LOCK:
        F8_SAMPLED_TRIP_CACHE[cache_key] = (monotonic(), cached_stage)
        _f8_prune_cache(F8_SAMPLED_TRIP_CACHE, F8_SAMPLED_TRIP_CACHE_MAX_ENTRIES)
    stage["cache_hit"] = False
    return stage


def _f8_read_cached_response(payload: F8ABFrequentRoutesRequest) -> dict | None:
    if payload.include_debug_counts:
        return None
    cache_key = _f8_request_cache_key(payload)
    with F8_RESPONSE_CACHE_LOCK:
        cached = F8_RESPONSE_CACHE.get(cache_key)
        if not cached:
            return None
        cached_at, response = cached
        if monotonic() - cached_at > F8_RESPONSE_CACHE_TTL_SECONDS:
            F8_RESPONSE_CACHE.pop(cache_key, None)
            return None
        cloned = deepcopy(response)
    cloned.setdefault("meta", {})
    cloned["meta"]["cache_hit"] = True
    cloned["meta"]["cache_ttl_seconds"] = F8_RESPONSE_CACHE_TTL_SECONDS
    return cloned


def _f8_write_cached_response(payload: F8ABFrequentRoutesRequest, response: dict) -> dict:
    if payload.include_debug_counts:
        return response
    cache_key = _f8_request_cache_key(payload)
    with F8_RESPONSE_CACHE_LOCK:
        F8_RESPONSE_CACHE[cache_key] = (monotonic(), deepcopy(response))
        _f8_prune_cache(F8_RESPONSE_CACHE, F8_RESPONSE_CACHE_MAX_ENTRIES)
    response.setdefault("meta", {})
    response["meta"]["cache_hit"] = False
    response["meta"]["cache_ttl_seconds"] = F8_RESPONSE_CACHE_TTL_SECONDS
    return response


def _f4_request_cache_key(
    *,
    start_time: datetime,
    end_time: datetime,
    grid_size_m: int,
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float,
    include_vehicle_count: bool,
    max_cells: int,
    response_format: str,
) -> str:
    return json.dumps(
        {
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "grid_size_m": grid_size_m,
            "bbox": [
                round(float(min_lon), 6),
                round(float(min_lat), 6),
                round(float(max_lon), 6),
                round(float(max_lat), 6),
            ],
            "include_vehicle_count": include_vehicle_count,
            "max_cells": max_cells,
            "format": response_format,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _f4_read_cached_response(cache_key: str) -> dict | None:
    with F4_RESPONSE_CACHE_LOCK:
        cached = F4_RESPONSE_CACHE.get(cache_key)
        if not cached:
            return None
        cached_at, response = cached
        if monotonic() - cached_at > F4_RESPONSE_CACHE_TTL_SECONDS:
            F4_RESPONSE_CACHE.pop(cache_key, None)
            return None
        cloned = deepcopy(response)
    cloned.setdefault("meta", {})
    cloned["meta"]["cache_hit"] = True
    cloned["meta"]["cache_ttl_seconds"] = F4_RESPONSE_CACHE_TTL_SECONDS
    return cloned


def _f4_write_cached_response(cache_key: str, response: dict) -> dict:
    with F4_RESPONSE_CACHE_LOCK:
        F4_RESPONSE_CACHE[cache_key] = (monotonic(), deepcopy(response))
    response.setdefault("meta", {})
    response["meta"]["cache_hit"] = False
    response["meta"]["cache_ttl_seconds"] = F4_RESPONSE_CACHE_TTL_SECONDS
    return response


def _f6_request_cache_key(payload: F6RadiationFlowRequest) -> str:
    normalized = payload.model_dump(mode="json")
    normalized.pop("analysis_bbox", None)
    for area_key in ("core_area",):
        area = normalized.get(area_key) or {}
        normalized[area_key] = {
            "min_lon": round(float(area.get("min_lon") or 0.0), 6),
            "min_lat": round(float(area.get("min_lat") or 0.0), 6),
            "max_lon": round(float(area.get("max_lon") or 0.0), 6),
            "max_lat": round(float(area.get("max_lat") or 0.0), 6),
        }
    return json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _f6_read_cached_response(payload: F6RadiationFlowRequest) -> dict | None:
    cache_key = _f6_request_cache_key(payload)
    with F6_RESPONSE_CACHE_LOCK:
        cached = F6_RESPONSE_CACHE.get(cache_key)
        if not cached:
            return None
        cached_at, response = cached
        if monotonic() - cached_at > F6_RESPONSE_CACHE_TTL_SECONDS:
            F6_RESPONSE_CACHE.pop(cache_key, None)
            return None
        cloned = deepcopy(response)
    cloned.setdefault("meta", {})
    original_elapsed_ms = cloned["meta"].get("elapsed_ms")
    if original_elapsed_ms is not None:
        cloned["meta"]["cached_compute_elapsed_ms"] = original_elapsed_ms
    cloned["meta"]["elapsed_ms"] = 0.0
    cloned["meta"]["cache_hit"] = True
    cloned["meta"]["cache_ttl_seconds"] = F6_RESPONSE_CACHE_TTL_SECONDS
    return cloned


def _f6_write_cached_response(payload: F6RadiationFlowRequest, response: dict) -> dict:
    cache_key = _f6_request_cache_key(payload)
    with F6_RESPONSE_CACHE_LOCK:
        F6_RESPONSE_CACHE[cache_key] = (monotonic(), deepcopy(response))
    response.setdefault("meta", {})
    response["meta"]["cache_hit"] = False
    response["meta"]["cache_ttl_seconds"] = F6_RESPONSE_CACHE_TTL_SECONDS
    return response


def _f7_stage2_candidate_limit(payload: F7FrequentPathsRequest) -> int:
    if payload.top_k <= 20:
        return max(payload.top_k * 3, payload.top_k + 12)
    if payload.top_k <= 40:
        return max(payload.top_k * 2, payload.top_k + 10)
    return max(int(math.ceil(payload.top_k * 1.5)), payload.top_k + 8)


def _f7_haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    radius_m = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2.0) ** 2
    return 2.0 * radius_m * math.asin(math.sqrt(max(0.0, min(1.0, a))))


def _f7_polyline_length_m(coords: list) -> float:
    total = 0.0
    prev: tuple[float, float] | None = None
    for point in coords:
        if not isinstance(point, list | tuple) or len(point) < 2:
            continue
        lng = float(point[0])
        lat = float(point[1])
        if prev is not None:
            total += _f7_haversine_m(prev[0], prev[1], lng, lat)
        prev = (lng, lat)
    return total


def _f7_primary_geometry(geometry: dict | None) -> dict | None:
    if not geometry or not isinstance(geometry, dict):
        return None
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "LineString":
        return geometry if isinstance(coordinates, list) and len(coordinates) >= 2 else None
    if geometry_type == "MultiLineString" and isinstance(coordinates, list):
        lines: list[list[list[float]]] = []
        for line in coordinates:
            if not isinstance(line, list) or len(line) < 2:
                continue
            normalized = []
            for point in line:
                if not isinstance(point, (list, tuple)) or len(point) < 2:
                    continue
                normalized.append([float(point[0]), float(point[1])])
            if len(normalized) >= 2:
                lines.append(normalized)
        if not lines:
            return None
        chain = max(lines, key=_f7_polyline_length_m)
        remaining = [line for line in lines if line is not chain]
        while remaining:
            best_idx = 0
            best_mode = "append_forward"
            best_distance = float("inf")
            for idx, line in enumerate(remaining):
                candidates = [
                    (_f7_haversine_m(chain[-1][0], chain[-1][1], line[0][0], line[0][1]), "append_forward"),
                    (_f7_haversine_m(chain[-1][0], chain[-1][1], line[-1][0], line[-1][1]), "append_reverse"),
                    (_f7_haversine_m(chain[0][0], chain[0][1], line[-1][0], line[-1][1]), "prepend_forward"),
                    (_f7_haversine_m(chain[0][0], chain[0][1], line[0][0], line[0][1]), "prepend_reverse"),
                ]
                distance, mode = min(candidates, key=lambda item: item[0])
                if distance < best_distance:
                    best_distance = distance
                    best_idx = idx
                    best_mode = mode
            if best_distance > F7_STITCH_MAX_GAP_M:
                break
            picked = remaining.pop(best_idx)
            if best_mode == "append_forward":
                chain = chain + picked[1:]
            elif best_mode == "append_reverse":
                chain = chain + list(reversed(picked[:-1]))
            elif best_mode == "prepend_forward":
                chain = picked[:-1] + chain
            else:
                chain = list(reversed(picked[1:])) + chain
        return {"type": "LineString", "coordinates": chain}
    return geometry


def _f7_preserve_line_geometry(geometry: dict | None) -> dict | None:
    if not geometry or not isinstance(geometry, dict):
        return None
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "LineString":
        return geometry if isinstance(coordinates, list) and len(coordinates) >= 2 else None
    if geometry_type == "MultiLineString" and isinstance(coordinates, list):
        lines = [line for line in coordinates if isinstance(line, list) and len(line) >= 2]
        if not lines:
            return None
        return {"type": "MultiLineString", "coordinates": lines} if len(lines) > 1 else {"type": "LineString", "coordinates": lines[0]}
    return _f7_primary_geometry(geometry)


def _f7_line_coords(geometry: dict | None) -> list[list[float]]:
    if not geometry or geometry.get("type") != "LineString":
        return []
    coords = []
    for point in geometry.get("coordinates") or []:
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            coords.append([float(point[0]), float(point[1])])
    return coords if len(coords) >= 2 else []


def _f7_oriented_edge(row: dict) -> dict | None:
    geometry = json.loads(row["geometry"]) if row.get("geometry") else None
    coords = _f7_line_coords(geometry)
    if not coords:
        return None
    direction = int(row.get("direction") or 0)
    u_node = row.get("u_node")
    v_node = row.get("v_node")
    if direction < 0:
        coords = list(reversed(coords))
        from_node = v_node
        to_node = u_node
    else:
        from_node = u_node
        to_node = v_node
    return {
        **row,
        "direction": direction,
        "from_node": from_node,
        "to_node": to_node,
        "coords": coords,
        "score": float(row.get("edge_pass_weight") or 0) + float(row.get("trip_count") or 0),
    }


def _f7_edge_endpoint_pairs(edge: dict) -> list[tuple[float, float]]:
    coords = edge.get("coords") or []
    if len(coords) < 2:
        return []
    return [
        (float(coords[0][0]), float(coords[0][1])),
        (float(coords[-1][0]), float(coords[-1][1])),
    ]


def _f7_endpoint_grid_key(lon: float, lat: float, endpoint_index: F7EndpointGridIndex) -> tuple[int, int]:
    x_m = (lon - endpoint_index.origin_lon) * endpoint_index.lon_scale_m
    y_m = (lat - endpoint_index.origin_lat) * endpoint_index.lat_scale_m
    return (math.floor(x_m / endpoint_index.cell_m), math.floor(y_m / endpoint_index.cell_m))


def _f7_nearby_endpoint_grid_keys(lon: float, lat: float, endpoint_index: F7EndpointGridIndex) -> list[tuple[int, int]]:
    x, y = _f7_endpoint_grid_key(lon, lat, endpoint_index)
    return [(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]


def _f7_build_endpoint_index(edges: list[dict], cell_m: float = F7_GAP_INDEX_CELL_M) -> F7EndpointGridIndex:
    endpoint_pairs = [
        point
        for edge in edges
        for point in _f7_edge_endpoint_pairs(edge)
    ]
    if not endpoint_pairs:
        return F7EndpointGridIndex(defaultdict(set), 0.0, 0.0, 1.0, 1.0, cell_m)
    origin_lon = min(lon for lon, _lat in endpoint_pairs)
    origin_lat = min(lat for _lon, lat in endpoint_pairs)
    center_lat = sum(lat for _lon, lat in endpoint_pairs) / len(endpoint_pairs)
    lon_scale_m = 111320.0 * max(0.01, abs(math.cos(math.radians(center_lat))))
    lat_scale_m = 110540.0
    endpoint_index: dict[tuple[int, int], set[int]] = defaultdict(set)
    grid_index = F7EndpointGridIndex(endpoint_index, origin_lon, origin_lat, lon_scale_m, lat_scale_m, cell_m)
    for idx, edge in enumerate(edges):
        for lon, lat in _f7_edge_endpoint_pairs(edge):
            endpoint_index[_f7_endpoint_grid_key(lon, lat, grid_index)].add(idx)
    return grid_index


def _f7_candidate_gap_edge_indexes(edge: dict, endpoint_index: F7EndpointGridIndex, *, exclude: set[int] | None = None) -> set[int]:
    candidates: set[int] = set()
    for lon, lat in _f7_edge_endpoint_pairs(edge):
        for grid_key in _f7_nearby_endpoint_grid_keys(lon, lat, endpoint_index):
            candidates.update(endpoint_index.cells.get(grid_key, set()))
    if exclude:
        candidates.difference_update(exclude)
    return candidates



def _f7_is_long_corridor_edge(edge: dict) -> bool:
    road_name = str(edge.get("road_name") or edge.get("road_group_key") or "").strip()
    highway_values = {value.strip().lower() for value in str(edge.get("highway") or "").split(",") if value.strip()}
    return (
        float(edge.get("matched_segment_length_m") or 0.0) >= F7_LONG_CORRIDOR_MIN_LENGTH_M
        or any(value in {"motorway", "trunk", "primary"} for value in highway_values)
        or bool(re.match(r"^[东南西北]?[一二三四五六七八九十]+环", road_name))
    )



def _f7_gap_connection_limit_m(edge_a: dict, edge_b: dict) -> float:
    if _f7_is_long_corridor_edge(edge_a) and _f7_is_long_corridor_edge(edge_b):
        return F7_LONG_CORRIDOR_MAX_GAP_M
    return F7_STITCH_MAX_GAP_M



def _f7_gap_connection_angle_penalty(edge_a: dict, edge_b: dict, *, forward: bool) -> float:
    return _f7_angle_penalty(edge_a.get("coords") or [], edge_b.get("coords") or [], forward=forward)



def _f7_edges_gap_connected(edge_a: dict, edge_b: dict, max_gap_m: float | None = None) -> bool:
    points_a = _f7_edge_endpoint_pairs(edge_a)
    points_b = _f7_edge_endpoint_pairs(edge_b)
    if not points_a or not points_b:
        return False
    gap_limit_m = float(max_gap_m) if max_gap_m is not None else _f7_gap_connection_limit_m(edge_a, edge_b)
    has_close_endpoint = False
    for lon_a, lat_a in points_a:
        for lon_b, lat_b in points_b:
            if _f7_haversine_m(lon_a, lat_a, lon_b, lat_b) <= gap_limit_m:
                has_close_endpoint = True
                break
        if has_close_endpoint:
            break
    if not has_close_endpoint:
        return False
    if gap_limit_m <= F7_STITCH_MAX_GAP_M:
        return True
    angle_penalty = min(
        _f7_gap_connection_angle_penalty(edge_a, edge_b, forward=True),
        _f7_gap_connection_angle_penalty(edge_a, edge_b, forward=False),
    )
    return angle_penalty <= F7_LONG_CORRIDOR_MAX_ANGLE_PENALTY



def _f7_componentize_directed_edges(edges: list[dict]) -> list[list[dict]]:
    node_to_edge_indexes: dict[object, list[int]] = defaultdict(list)
    for idx, edge in enumerate(edges):
        for node in (edge.get("from_node"), edge.get("to_node")):
            if node is not None:
                node_to_edge_indexes[node].append(idx)

    endpoint_index = _f7_build_endpoint_index(edges)
    nearby_edge_indexes: dict[int, list[int]] = defaultdict(list)
    for idx, edge in enumerate(edges):
        for next_idx in sorted(_f7_candidate_gap_edge_indexes(edge, endpoint_index, exclude={idx})):
            if next_idx <= idx:
                continue
            other = edges[next_idx]
            if _f7_edges_gap_connected(edge, other):
                nearby_edge_indexes[idx].append(next_idx)
                nearby_edge_indexes[next_idx].append(idx)

    components: list[list[dict]] = []
    visited: set[int] = set()
    for start_idx, edge in enumerate(edges):
        if start_idx in visited:
            continue
        stack = [start_idx]
        visited.add(start_idx)
        component: list[dict] = []
        while stack:
            idx = stack.pop()
            current = edges[idx]
            component.append(current)
            for node in (current.get("from_node"), current.get("to_node")):
                if node is None:
                    continue
                for next_idx in node_to_edge_indexes.get(node, []):
                    if next_idx not in visited:
                        visited.add(next_idx)
                        stack.append(next_idx)
            for next_idx in nearby_edge_indexes.get(idx, []):
                if next_idx not in visited:
                    visited.add(next_idx)
                    stack.append(next_idx)
        components.append(component)
    return components


def _f7_angle_penalty(previous_coords: list[list[float]], next_coords: list[list[float]], *, forward: bool) -> float:
    if len(previous_coords) < 2 or len(next_coords) < 2:
        return 0.0
    if forward:
        ax = previous_coords[-1][0] - previous_coords[-2][0]
        ay = previous_coords[-1][1] - previous_coords[-2][1]
        bx = next_coords[1][0] - next_coords[0][0]
        by = next_coords[1][1] - next_coords[0][1]
    else:
        ax = previous_coords[0][0] - previous_coords[1][0]
        ay = previous_coords[0][1] - previous_coords[1][1]
        bx = next_coords[-2][0] - next_coords[-1][0]
        by = next_coords[-2][1] - next_coords[-1][1]
    norm_a = math.hypot(ax, ay)
    norm_b = math.hypot(bx, by)
    if norm_a <= 0 or norm_b <= 0:
        return 0.0
    cosine = max(-1.0, min(1.0, (ax * bx + ay * by) / (norm_a * norm_b)))
    return (1.0 - cosine) * 0.35


def _f7_extract_backbone(component_edges: list[dict]) -> tuple[list[dict], list[dict]]:
    if not component_edges:
        return [], []
    outgoing: dict[object, list[dict]] = defaultdict(list)
    incoming: dict[object, list[dict]] = defaultdict(list)
    index_by_uid = {edge.get("road_uid"): idx for idx, edge in enumerate(component_edges)}
    endpoint_index = _f7_build_endpoint_index(component_edges)
    for edge in component_edges:
        outgoing[edge.get("from_node")].append(edge)
        incoming[edge.get("to_node")].append(edge)

    seed = max(component_edges, key=lambda edge: (edge.get("score") or 0, edge.get("matched_segment_length_m") or 0, -int(edge.get("road_uid") or 0)))
    chain = [seed]
    used = {seed["road_uid"]}
    used_indexes = {index_by_uid[seed["road_uid"]]} if seed["road_uid"] in index_by_uid else set()

    while True:
        end_node = chain[-1].get("to_node")
        candidates = [edge for edge in outgoing.get(end_node, []) if edge.get("road_uid") not in used]
        if not candidates:
            tail_edge = chain[-1]
            gap_candidate_indexes = _f7_candidate_gap_edge_indexes(
                tail_edge,
                endpoint_index,
                exclude=used_indexes,
            )
            candidates = [component_edges[idx] for idx in sorted(gap_candidate_indexes) if _f7_edges_gap_connected(tail_edge, component_edges[idx])]
        if not candidates:
            break
        picked = max(
            candidates,
            key=lambda edge: (
                (edge.get("score") or 0) * (1.0 - _f7_angle_penalty(chain[-1]["coords"], edge["coords"], forward=True)),
                edge.get("matched_segment_length_m") or 0,
                -int(edge.get("road_uid") or 0),
            ),
        )
        chain.append(picked)
        used.add(picked["road_uid"])
        if picked["road_uid"] in index_by_uid:
            used_indexes.add(index_by_uid[picked["road_uid"]])

    while True:
        start_node = chain[0].get("from_node")
        candidates = [edge for edge in incoming.get(start_node, []) if edge.get("road_uid") not in used]
        if not candidates:
            head_edge = chain[0]
            gap_candidate_indexes = _f7_candidate_gap_edge_indexes(
                head_edge,
                endpoint_index,
                exclude=used_indexes,
            )
            candidates = [component_edges[idx] for idx in sorted(gap_candidate_indexes) if _f7_edges_gap_connected(head_edge, component_edges[idx])]
        if not candidates:
            break
        picked = max(
            candidates,
            key=lambda edge: (
                (edge.get("score") or 0) * (1.0 - _f7_angle_penalty(chain[0]["coords"], edge["coords"], forward=False)),
                edge.get("matched_segment_length_m") or 0,
                -int(edge.get("road_uid") or 0),
            ),
        )
        chain.insert(0, picked)
        used.add(picked["road_uid"])
        if picked["road_uid"] in index_by_uid:
            used_indexes.add(index_by_uid[picked["road_uid"]])

    branches = [edge for edge in component_edges if edge.get("road_uid") not in used]
    return chain, branches


def _f7_chain_geometry(chain: list[dict]) -> dict | None:
    coords: list[list[float]] = []
    for edge in chain:
        edge_coords = edge.get("coords") or []
        if not edge_coords:
            continue
        if not coords:
            coords.extend(edge_coords)
        elif coords[-1] == edge_coords[0]:
            coords.extend(edge_coords[1:])
        else:
            coords.extend(edge_coords)
    return {"type": "LineString", "coordinates": coords} if len(coords) >= 2 else None


def _f7_branch_geometries(branches: list[dict]) -> dict | None:
    lines = [edge.get("coords") for edge in branches[:F7_BACKBONE_MAX_BRANCH_GEOMETRIES] if len(edge.get("coords") or []) >= 2]
    return {"type": "MultiLineString", "coordinates": lines} if lines else None


def _f7_continuity_priority_score(row: dict, *, sort_mode: str) -> float:
    trip_count = float(row.get("trip_count") or 0.0)
    edge_pass_weight = float(row.get("edge_pass_weight") or 0.0)
    group_length_m = float(row.get("group_length_m") or 0.0)
    confidence = max(float(row.get("corridor_confidence") or 0.0), F7_MIN_DISPLAY_CONFIDENCE)
    fragment_count = max(int(row.get("fragment_count") or 1), 1)
    branch_count = max(int(row.get("branch_count") or 0), 0)
    support_weight = trip_count * max(group_length_m, 1.0) if sort_mode == "length_weighted" else trip_count
    score = support_weight * confidence
    score += edge_pass_weight * 0.18
    score *= max(0.45, 1.0 - (fragment_count - 1) * F7_FRAGMENT_PENALTY_PER_EXTRA_COMPONENT)
    score *= max(0.72, 1.0 - min(branch_count, 6) * 0.035)
    return score



def _f7_rank_corridor_rows(rows: list[dict], payload: F7FrequentPathsRequest) -> list[dict]:
    return sorted(
        rows,
        key=lambda row: (
            -_f7_continuity_priority_score(row, sort_mode=payload.sort_mode),
            -(int(row.get("trip_count") or 0) * max(float(row.get("group_length_m") or 0.0), 1.0)) if payload.sort_mode == "length_weighted" else -int(row.get("trip_count") or 0),
            -int(row.get("edge_pass_weight") or 0),
            -float(row.get("corridor_confidence") or 0.0),
            -float(row.get("group_length_m") or 0.0),
            str(row.get("road_group_key") or ""),
            int(row.get("corridor_component_id") or 0),
        ),
    )


def _f7_macro_corridor_key(road_name: str | None) -> str | None:
    if not road_name:
        return None
    name = str(road_name).strip()
    if not name:
        return None
    ring_match = re.match(r"^([东南西北]?[一二三四五六七八九十]+环)(?:[东南西北中])?(?:路)?$", name)
    if ring_match:
        return ring_match.group(1)
    return name


def _f7_build_directed_corridor_rows(edge_rows: list[dict], payload: F7FrequentPathsRequest) -> list[dict]:
    grouped: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for raw_row in edge_rows:
        edge = _f7_oriented_edge(dict(raw_row))
        if edge is None:
            continue
        grouped[(edge["road_group_key"], int(edge["direction"] or 0))].append(edge)

    corridor_rows: list[dict] = []
    for (road_group_key, direction), edges in grouped.items():
        components = _f7_componentize_directed_edges(edges)
        components.sort(key=lambda component: -sum(float(edge.get("matched_segment_length_m") or 0.0) for edge in component))
        for component_index, component in enumerate(components, start=1):
            group_length_m = sum(float(edge.get("matched_segment_length_m") or 0.0) for edge in component)
            if group_length_m < payload.min_group_length_m:
                continue

            backbone, branches = _f7_extract_backbone(component)
            backbone_geometry = _f7_chain_geometry(backbone)
            branch_geometry = _f7_branch_geometries(branches)
            trip_keys = {trip_key for edge in component for trip_key in (edge.get("trip_keys") or []) if trip_key is not None}
            taxi_keys = {taxi_key for edge in component for taxi_key in (edge.get("taxi_keys") or []) if taxi_key is not None}
            trip_count = len(trip_keys) if trip_keys else sum(int(edge.get("trip_count") or 0) for edge in component)
            vehicle_count = len(taxi_keys) if taxi_keys else sum(int(edge.get("vehicle_count") or 0) for edge in component)
            edge_pass_weight = sum(int(edge.get("edge_pass_weight") or 0) for edge in component)
            backbone_weight = sum(int(edge.get("edge_pass_weight") or 0) for edge in backbone)
            confidence = (backbone_weight / edge_pass_weight) if edge_pass_weight > 0 else 0.0
            first = component[0]
            corridor_rows.append(
                {
                    "road_group_key": road_group_key,
                    "corridor_component_id": component_index,
                    "component_id": component_index,
                    "direction": direction,
                    "road_name": first.get("road_name"),
                    "highway": ", ".join(sorted({str(edge.get("highway")) for edge in component if edge.get("highway")})) or None,
                    "has_oneway_segment": any(bool(edge.get("has_oneway_segment")) for edge in component),
                    "segment_count": len({edge.get("road_uid") for edge in component}),
                    "trip_count": trip_count,
                    "vehicle_count": vehicle_count,
                    "edge_pass_weight": edge_pass_weight,
                    "matched_segment_length_m": group_length_m,
                    "group_length_m": group_length_m,
                    "geometry": json.dumps(backbone_geometry) if backbone_geometry else None,
                    "geometry_backbone": json.dumps(backbone_geometry) if backbone_geometry else None,
                    "geometry_branches": json.dumps(branch_geometry) if branch_geometry else None,
                    "is_fragmented": len(components) > 1,
                    "fragment_count": len(components),
                    "branch_count": len(branches),
                    "backbone_segment_count": len(backbone),
                    "corridor_confidence": confidence,
                    "_trip_keys": trip_keys,
                    "_taxi_keys": taxi_keys,
                }
            )
    return _f7_rank_corridor_rows(corridor_rows, payload)


def _f7_as_multiline_geometry(geometries: list[dict | None]) -> dict | None:
    lines: list[list[list[float]]] = []
    for geometry in geometries:
        if not geometry:
            continue
        if geometry.get("type") == "LineString":
            coords = geometry.get("coordinates") or []
            if isinstance(coords, list) and len(coords) >= 2:
                lines.append(coords)
        elif geometry.get("type") == "MultiLineString":
            for line in geometry.get("coordinates") or []:
                if isinstance(line, list) and len(line) >= 2:
                    lines.append(line)
    if not lines:
        return None
    if len(lines) == 1:
        return {"type": "LineString", "coordinates": lines[0]}
    return {"type": "MultiLineString", "coordinates": lines}


def _f7_merge_component_rows_to_road_groups(component_rows: list[dict], payload: F7FrequentPathsRequest) -> list[dict]:
    grouped: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for row in component_rows:
        grouped[(row["road_group_key"], int(row.get("direction") or 0))].append(row)

    merged_rows: list[dict] = []
    for (road_group_key, direction), rows in grouped.items():
        trip_keys = {trip_key for row in rows for trip_key in (row.get("_trip_keys") or set())}
        taxi_keys = {taxi_key for row in rows for taxi_key in (row.get("_taxi_keys") or set())}
        trip_count = len(trip_keys) if trip_keys else sum(int(row.get("trip_count") or 0) for row in rows)
        vehicle_count = len(taxi_keys) if taxi_keys else sum(int(row.get("vehicle_count") or 0) for row in rows)
        edge_pass_weight = sum(int(row.get("edge_pass_weight") or 0) for row in rows)
        backbone_weight = sum(int(row.get("edge_pass_weight") or 0) * float(row.get("corridor_confidence") or 0.0) for row in rows)
        backbone_geometries = [json.loads(row["geometry_backbone"]) for row in rows if row.get("geometry_backbone")]
        branch_geometries = [json.loads(row["geometry_branches"]) for row in rows if row.get("geometry_branches")]
        backbone_geometry = _f7_as_multiline_geometry(backbone_geometries)
        branch_geometry = _f7_as_multiline_geometry(branch_geometries)
        first = rows[0]
        highway_values = sorted({value.strip() for row in rows for value in str(row.get("highway") or "").split(",") if value.strip()})
        merged_rows.append(
            {
                "road_group_key": road_group_key,
                "corridor_component_id": None,
                "component_id": None,
                "component_ids": [int(row.get("corridor_component_id") or 0) for row in rows if row.get("corridor_component_id") is not None],
                "direction": direction,
                "road_name": first.get("road_name"),
                "highway": ", ".join(highway_values) or None,
                "has_oneway_segment": any(bool(row.get("has_oneway_segment")) for row in rows),
                "segment_count": sum(int(row.get("segment_count") or 0) for row in rows),
                "trip_count": trip_count,
                "vehicle_count": vehicle_count,
                "edge_pass_weight": edge_pass_weight,
                "matched_segment_length_m": sum(float(row.get("matched_segment_length_m") or 0.0) for row in rows),
                "group_length_m": sum(float(row.get("group_length_m") or 0.0) for row in rows),
                "geometry": json.dumps(backbone_geometry) if backbone_geometry else None,
                "geometry_backbone": json.dumps(backbone_geometry) if backbone_geometry else None,
                "geometry_branches": json.dumps(branch_geometry) if branch_geometry else None,
                "is_fragmented": len(rows) > 1 or any(bool(row.get("is_fragmented")) for row in rows),
                "fragment_count": len(rows),
                "branch_count": sum(int(row.get("branch_count") or 0) for row in rows),
                "backbone_segment_count": sum(int(row.get("backbone_segment_count") or 0) for row in rows),
                "corridor_confidence": (backbone_weight / edge_pass_weight) if edge_pass_weight > 0 else 0.0,
            }
        )
    return _f7_rank_corridor_rows(merged_rows, payload)


def load_h3_module():
    return import_module("h3")


def h3_cell_for_point(h3_module, lon: float, lat: float, resolution: int) -> str:
    if hasattr(h3_module, "latlng_to_cell"):
        return h3_module.latlng_to_cell(lat, lon, resolution)
    return h3_module.geo_to_h3(lat, lon, resolution)


def h3_cell_center(h3_module, cell: str) -> list[float]:
    if hasattr(h3_module, "cell_to_latlng"):
        lat, lon = h3_module.cell_to_latlng(cell)
    else:
        lat, lon = h3_module.h3_to_geo(cell)
    return [float(lon), float(lat)]


def h3_cell_boundary(h3_module, cell: str) -> list[list[float]]:
    if hasattr(h3_module, "cell_to_boundary"):
        boundary = h3_module.cell_to_boundary(cell)
    else:
        boundary = h3_module.h3_to_geo_boundary(cell)
    return [[float(lon), float(lat)] for lat, lon in boundary]



@router.get("/dataset-summary")
def get_dataset_summary() -> dict:
    cached = read_dataset_summary_cache()
    if cached:
        return cached
    return refresh_dataset_summary_cache()



@router.get("/active-vehicles")
def get_active_vehicles(
    start_time: datetime,
    end_time: datetime,
    min_lon: float | None = Query(default=None, ge=-180, le=180),
    min_lat: float | None = Query(default=None, ge=-90, le=90),
    max_lon: float | None = Query(default=None, ge=-180, le=180),
    max_lat: float | None = Query(default=None, ge=-90, le=90),
) -> dict:
    if start_time >= end_time:
        return {"active_vehicle_count": 0, "error": "start_time must be earlier than end_time"}

    bbox_values = [min_lon, min_lat, max_lon, max_lat]
    if any(value is None for value in bbox_values) and not all(value is None for value in bbox_values):
        return {"active_vehicle_count": 0, "error": "bbox requires min_lon,min_lat,max_lon,max_lat together"}

    if min_lon is not None and (min_lon >= max_lon or min_lat >= max_lat):
        return {"active_vehicle_count": 0, "error": "invalid bbox bounds"}

    sql = text(
        """
        SELECT COUNT(DISTINCT taxi_id) AS active_vehicle_count
        FROM taxi_points
        WHERE gps_time >= :start_time
          AND gps_time <= :end_time
          AND (
                :min_lon IS NULL
                OR ST_Intersects(
                    geom,
                    ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
                )
          )
        """
    )

    with engine.connect() as conn:
        row = conn.execute(
            sql,
            {
                "start_time": start_time,
                "end_time": end_time,
                "min_lon": min_lon,
                "min_lat": min_lat,
                "max_lon": max_lon,
                "max_lat": max_lat,
            },
        ).mappings().first()

    return {
        "active_vehicle_count": int(row["active_vehicle_count"]),
        "start_time": start_time.isoformat(),
        "end_time": end_time.isoformat(),
        "bbox": None
        if min_lon is None
        else {
            "min_lon": min_lon,
            "min_lat": min_lat,
            "max_lon": max_lon,
            "max_lat": max_lat,
        },
    }


@router.get("/f4-grid-density")
def get_f4_grid_density(
    start_time: datetime,
    end_time: datetime,
    grid_size_m: int = Query(default=500, ge=100, le=3000),
    min_lon: float = Query(ge=-180, le=180),
    min_lat: float = Query(ge=-90, le=90),
    max_lon: float = Query(ge=-180, le=180),
    max_lat: float = Query(ge=-90, le=90),
    include_vehicle_count: bool = False,
    max_cells: int = Query(default=3000, ge=1, le=12000),
    format: Literal["compact", "geojson"] = "compact",
) -> dict:
    started_at = perf_counter()
    if start_time >= end_time:
        return {
            "cells": [],
            "meta": {"error": "start_time must be earlier than end_time"},
        }

    if min_lon >= max_lon or min_lat >= max_lat:
        return {
            "cells": [],
            "meta": {"error": "invalid bbox bounds"},
        }

    lon_span = max_lon - min_lon
    lat_span = max_lat - min_lat
    if lon_span > 0.8 or lat_span > 0.6:
        return {
            "cells": [],
            "meta": {
                "error": "bbox is too large; zoom in before running F4",
                "bbox": {
                    "min_lon": min_lon,
                    "min_lat": min_lat,
                    "max_lon": max_lon,
                    "max_lat": max_lat,
                },
            },
        }

    cache_key = _f4_request_cache_key(
        start_time=start_time,
        end_time=end_time,
        grid_size_m=grid_size_m,
        min_lon=min_lon,
        min_lat=min_lat,
        max_lon=max_lon,
        max_lat=max_lat,
        include_vehicle_count=include_vehicle_count,
        max_cells=max_cells,
        response_format=format,
    )
    cached_response = _f4_read_cached_response(cache_key)
    if cached_response is not None:
        return cached_response

    vehicle_count_sql = (
        "COUNT(DISTINCT fp.taxi_id)::bigint AS vehicle_count"
        if include_vehicle_count
        else "NULL::bigint AS vehicle_count"
    )
    geometry_select_sql = "ST_AsGeoJSON(geom_4326) AS geometry" if format == "geojson" else "NULL::text AS geometry"
    sql = text(
        f"""
        WITH raw_bounds AS (
            SELECT
                ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326) AS geom_4326,
                ST_Transform(
                    ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326),
                    3857
                ) AS geom_3857
        ),
        snapped_bounds AS (
            SELECT
                ST_MakeEnvelope(
                    FLOOR(ST_XMin(geom_3857::box3d) / :grid_size_m) * :grid_size_m,
                    FLOOR(ST_YMin(geom_3857::box3d) / :grid_size_m) * :grid_size_m,
                    CEIL(ST_XMax(geom_3857::box3d) / :grid_size_m) * :grid_size_m,
                    CEIL(ST_YMax(geom_3857::box3d) / :grid_size_m) * :grid_size_m,
                    3857
                ) AS geom_3857
            FROM raw_bounds
        ),
        snapped_values AS (
            SELECT
                ST_Transform(geom_3857, 4326) AS geom_4326,
                ST_XMin(ST_Transform(geom_3857, 4326)::box3d) AS snapped_min_lon,
                ST_YMin(ST_Transform(geom_3857, 4326)::box3d) AS snapped_min_lat,
                ST_XMax(ST_Transform(geom_3857, 4326)::box3d) AS snapped_max_lon,
                ST_YMax(ST_Transform(geom_3857, 4326)::box3d) AS snapped_max_lat
            FROM snapped_bounds b
        ),
        filtered_points AS (
            SELECT
                tp.taxi_id,
                (tp.lon * 20037508.342789244 / 180.0) AS x_3857,
                (
                    LN(TAN((90.0 + tp.lat) * PI() / 360.0))
                    * 20037508.342789244 / PI()
                ) AS y_3857,
                (
                    tp.lon >= :min_lon
                    AND tp.lon <= :max_lon
                    AND tp.lat >= :min_lat
                    AND tp.lat <= :max_lat
                ) AS in_requested_bbox
            FROM taxi_points tp
            CROSS JOIN snapped_values s
            WHERE tp.gps_time >= :start_time
              AND tp.gps_time <= :end_time
              AND tp.lon >= s.snapped_min_lon
              AND tp.lon <= s.snapped_max_lon
              AND tp.lat >= s.snapped_min_lat
              AND tp.lat <= s.snapped_max_lat
        ),
        point_buckets AS (
            SELECT
                FLOOR(fp.x_3857 / :grid_size_m)::integer AS i,
                FLOOR(fp.y_3857 / :grid_size_m)::integer AS j,
                COUNT(*)::bigint AS point_count,
                {vehicle_count_sql},
                COUNT(*) FILTER (WHERE fp.in_requested_bbox)::bigint AS requested_point_count
            FROM filtered_points fp
            GROUP BY i, j
        ),
        cell_counts AS (
            SELECT
                pb.i,
                pb.j,
                pb.point_count,
                pb.vehicle_count,
                pb.requested_point_count,
                ST_Transform(
                    ST_MakeEnvelope(
                        pb.i * :grid_size_m,
                        pb.j * :grid_size_m,
                        (pb.i + 1) * :grid_size_m,
                        (pb.j + 1) * :grid_size_m,
                        3857
                    ),
                    4326
                ) AS geom_4326,
                s.snapped_min_lon,
                s.snapped_min_lat,
                s.snapped_max_lon,
                s.snapped_max_lat
            FROM point_buckets pb
            CROSS JOIN snapped_values s
        )
        SELECT
            i,
            j,
            point_count,
            vehicle_count,
            SUM(requested_point_count) OVER ()::bigint AS total_points,
            ST_XMin(geom_4326::box3d) AS min_lon,
            ST_YMin(geom_4326::box3d) AS min_lat,
            ST_XMax(geom_4326::box3d) AS max_lon,
            ST_YMax(geom_4326::box3d) AS max_lat,
            ST_X(ST_Centroid(geom_4326)) AS center_lon,
            ST_Y(ST_Centroid(geom_4326)) AS center_lat,
            {geometry_select_sql},
            snapped_min_lon,
            snapped_min_lat,
            snapped_max_lon,
            snapped_max_lat
        FROM cell_counts
        WHERE point_count > 0
        ORDER BY point_count DESC, i ASC, j ASC
        LIMIT :max_cells
        """
    )

    params = {
        "start_time": start_time,
        "end_time": end_time,
        "grid_size_m": grid_size_m,
        "min_lon": min_lon,
        "min_lat": min_lat,
        "max_lon": max_lon,
        "max_lat": max_lat,
        "max_cells": max_cells,
    }

    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()

    cells = []
    features = []
    max_density = 0
    max_vehicle_count = 0
    total_points = 0
    snapped_bbox = None

    for row in rows:
        point_count = int(row["point_count"] or 0)
        total_points = max(total_points, int(row["total_points"] or 0))
        vehicle_count = None if row["vehicle_count"] is None else int(row["vehicle_count"])
        density = point_count
        max_density = max(max_density, density)
        if vehicle_count is not None:
            max_vehicle_count = max(max_vehicle_count, vehicle_count)

        bounds = [
            float(row["min_lon"]),
            float(row["min_lat"]),
            float(row["max_lon"]),
            float(row["max_lat"]),
        ]
        center = [float(row["center_lon"]), float(row["center_lat"])]

        if snapped_bbox is None:
            snapped_bbox = {
                "min_lon": float(row["snapped_min_lon"]),
                "min_lat": float(row["snapped_min_lat"]),
                "max_lon": float(row["snapped_max_lon"]),
                "max_lat": float(row["snapped_max_lat"]),
            }

        cells.append(
            {
                "i": int(row["i"]),
                "j": int(row["j"]),
                "bounds": bounds,
                "center": center,
                "point_count": point_count,
                "vehicle_count": vehicle_count,
                "density": density,
            }
        )
        if format == "geojson":
            features.append(
                {
                    "type": "Feature",
                    "geometry": json.loads(row["geometry"]),
                    "properties": {
                        "grid_i": int(row["i"]),
                        "grid_j": int(row["j"]),
                        "point_count": point_count,
                        "vehicle_count": vehicle_count,
                        "density": density,
                        "center": center,
                        "bounds": bounds,
                    },
                }
            )

    meta = {
        "grid_size_m": grid_size_m,
        "cell_count": len(cells),
        "max_cells": max_cells,
        "max_density": max_density,
        "max_vehicle_count": max_vehicle_count if include_vehicle_count else None,
        "total_points": total_points,
        "include_vehicle_count": include_vehicle_count,
        "start_time": start_time.isoformat(),
        "end_time": end_time.isoformat(),
        "snapped_bbox": snapped_bbox
        if snapped_bbox is not None
        else {
            "min_lon": min_lon,
            "min_lat": min_lat,
            "max_lon": max_lon,
            "max_lat": max_lat,
        },
        "elapsed_ms": round((perf_counter() - started_at) * 1000, 2),
        "query_mode": "point_bucket_lonlat",
    }

    if format == "geojson":
        return _f4_write_cached_response(cache_key, {
            "type": "FeatureCollection",
            "features": features,
            "meta": meta,
        })

    return _f4_write_cached_response(cache_key, {
        "cells": cells,
        "meta": meta,
    })



@router.post("/f5-transition-threshold-recommendation")
def get_f5_transition_threshold_recommendation(payload: F5TransitionThresholdRecommendationRequest) -> dict:
    if payload.area_a.min_lon >= payload.area_a.max_lon or payload.area_a.min_lat >= payload.area_a.max_lat:
        return {"meta": {"error": "invalid area_a bounds"}}

    if payload.area_b.min_lon >= payload.area_b.max_lon or payload.area_b.min_lat >= payload.area_b.max_lat:
        return {"meta": {"error": "invalid area_b bounds"}}

    if payload.absolute_minimum_seconds > payload.absolute_maximum_seconds:
        return {"meta": {"error": "absolute_minimum_seconds must not exceed absolute_maximum_seconds"}}

    sql = text(
        """
        WITH areas AS (
            SELECT
                ST_MakeEnvelope(:a_min_lon, :a_min_lat, :a_max_lon, :a_max_lat, 4326) AS area_a_geom,
                ST_MakeEnvelope(:b_min_lon, :b_min_lat, :b_max_lon, :b_max_lat, 4326) AS area_b_geom
        )
        SELECT
            ST_Distance(
                ST_Centroid(area_a_geom)::geography,
                ST_Centroid(area_b_geom)::geography
            ) AS distance_meters
        FROM areas
        """
    )

    params = {
        "a_min_lon": payload.area_a.min_lon,
        "a_min_lat": payload.area_a.min_lat,
        "a_max_lon": payload.area_a.max_lon,
        "a_max_lat": payload.area_a.max_lat,
        "b_min_lon": payload.area_b.min_lon,
        "b_min_lat": payload.area_b.min_lat,
        "b_max_lon": payload.area_b.max_lon,
        "b_max_lat": payload.area_b.max_lat,
    }

    with engine.connect() as conn:
        row = conn.execute(sql, params).mappings().first()

    distance_meters = float(row["distance_meters"] or 0.0) if row else 0.0
    raw_seconds = (distance_meters / payload.pessimistic_mps) * payload.road_winding_factor
    clamped_seconds = max(payload.absolute_minimum_seconds, min(payload.absolute_maximum_seconds, raw_seconds))
    recommended_seconds = int(min(payload.absolute_maximum_seconds, math.ceil(clamped_seconds / 60.0) * 60))

    return {
        "recommended_seconds": recommended_seconds,
        "recommended_minutes": recommended_seconds // 60,
        "distance_meters": distance_meters,
        "raw_seconds": raw_seconds,
        "meta": {
            "pessimistic_mps": payload.pessimistic_mps,
            "pessimistic_kmh": payload.pessimistic_mps * 3.6,
            "road_winding_factor": payload.road_winding_factor,
            "absolute_minimum_seconds": payload.absolute_minimum_seconds,
            "absolute_maximum_seconds": payload.absolute_maximum_seconds,
            "logic_mode": "distance_based_recommendation",
        },
    }


@router.post("/f5-ab-flow")
def get_f5_ab_flow(payload: F5ABFlowRequest) -> dict:
    if payload.start_time >= payload.end_time:
        return {"items": [], "summary": {}, "meta": {"error": "start_time must be earlier than end_time"}}

    if payload.area_a.min_lon >= payload.area_a.max_lon or payload.area_a.min_lat >= payload.area_a.max_lat:
        return {"items": [], "summary": {}, "meta": {"error": "invalid area_a bounds"}}

    if payload.area_b.min_lon >= payload.area_b.max_lon or payload.area_b.min_lat >= payload.area_b.max_lat:
        return {"items": [], "summary": {}, "meta": {"error": "invalid area_b bounds"}}

    area_a_buffered = expand_bbox_by_meters(payload.area_a, payload.buffer_meters)
    area_b_buffered = expand_bbox_by_meters(payload.area_b, payload.buffer_meters)
    granularity = payload.granularity

    sql = text(
        """
        WITH areas AS (
            SELECT
                ST_MakeEnvelope(:a_min_lon, :a_min_lat, :a_max_lon, :a_max_lat, 4326) AS area_a_geom,
                ST_MakeEnvelope(:b_min_lon, :b_min_lat, :b_max_lon, :b_max_lat, 4326) AS area_b_geom,
                ST_MakeEnvelope(:a_buf_min_lon, :a_buf_min_lat, :a_buf_max_lon, :a_buf_max_lat, 4326) AS area_a_buffered_geom,
                ST_MakeEnvelope(:b_buf_min_lon, :b_buf_min_lat, :b_buf_max_lon, :b_buf_max_lat, 4326) AS area_b_buffered_geom
        ),
        tagged_points AS (
            SELECT
                tp.id AS point_id,
                tp.taxi_id,
                tp.trip_id,
                tp.gps_time,
                CASE
                    WHEN tp.geom && a.area_a_buffered_geom
                      AND ST_DWithin(tp.geom::geography, a.area_a_geom::geography, :buffer_meters) THEN 'A'
                    WHEN tp.geom && a.area_b_buffered_geom
                      AND ST_DWithin(tp.geom::geography, a.area_b_geom::geography, :buffer_meters) THEN 'B'
                    ELSE NULL
                END AS current_area
            FROM taxi_points tp
            CROSS JOIN areas a
            WHERE tp.gps_time >= :start_time
              AND tp.gps_time <= :end_time
              AND (
                    tp.geom && a.area_a_buffered_geom
                 OR tp.geom && a.area_b_buffered_geom
              )
        ),
        state_points AS (
            SELECT
                taxi_id,
                trip_id,
                gps_time,
                current_area
            FROM (
                SELECT
                    taxi_id,
                    trip_id,
                    gps_time,
                    point_id,
                    current_area,
                    LAG(current_area) OVER (
                        PARTITION BY taxi_id, trip_id
                        ORDER BY gps_time, point_id
                    ) AS prev_area
                FROM tagged_points
                WHERE current_area IS NOT NULL
            ) t
            WHERE prev_area IS NULL OR current_area <> prev_area
        ),
        sequence AS (
            SELECT
                taxi_id,
                trip_id,
                current_area AS area_1,
                gps_time AS time_1,
                LEAD(current_area) OVER (
                    PARTITION BY taxi_id, trip_id
                    ORDER BY gps_time
                ) AS area_2,
                LEAD(gps_time) OVER (
                    PARTITION BY taxi_id, trip_id
                    ORDER BY gps_time
                ) AS time_2
            FROM state_points
        ),
        directional AS (
            SELECT
                DATE_TRUNC(:granularity, time_1) AS time_bucket,
                CASE
                    WHEN area_1 = 'A' AND area_2 = 'B' THEN 'A_TO_B'
                    WHEN area_1 = 'B' AND area_2 = 'A' THEN 'B_TO_A'
                    ELSE NULL
                END AS direction,
                EXTRACT(EPOCH FROM (time_2 - time_1)) / 60.0 AS duration_min
            FROM sequence
            WHERE area_2 IS NOT NULL
              AND area_1 <> area_2
              AND EXTRACT(EPOCH FROM (time_2 - time_1)) BETWEEN 0 AND :max_transition_seconds
        )
        SELECT
            time_bucket,
            COUNT(*) FILTER (WHERE direction = 'A_TO_B')::bigint AS a_to_b,
            COUNT(*) FILTER (WHERE direction = 'B_TO_A')::bigint AS b_to_a,
            AVG(duration_min) FILTER (WHERE direction = 'A_TO_B') AS a_to_b_avg_duration_min,
            AVG(duration_min) FILTER (WHERE direction = 'B_TO_A') AS b_to_a_avg_duration_min
        FROM directional
        GROUP BY time_bucket
        ORDER BY time_bucket
        """
    )

    params = {
        "start_time": payload.start_time,
        "end_time": payload.end_time,
        "granularity": granularity,
        "buffer_meters": payload.buffer_meters,
        "max_transition_seconds": payload.max_transition_seconds,
        "a_min_lon": payload.area_a.min_lon,
        "a_min_lat": payload.area_a.min_lat,
        "a_max_lon": payload.area_a.max_lon,
        "a_max_lat": payload.area_a.max_lat,
        "b_min_lon": payload.area_b.min_lon,
        "b_min_lat": payload.area_b.min_lat,
        "b_max_lon": payload.area_b.max_lon,
        "b_max_lat": payload.area_b.max_lat,
        "a_buf_min_lon": area_a_buffered["min_lon"],
        "a_buf_min_lat": area_a_buffered["min_lat"],
        "a_buf_max_lon": area_a_buffered["max_lon"],
        "a_buf_max_lat": area_a_buffered["max_lat"],
        "b_buf_min_lon": area_b_buffered["min_lon"],
        "b_buf_min_lat": area_b_buffered["min_lat"],
        "b_buf_max_lon": area_b_buffered["max_lon"],
        "b_buf_max_lat": area_b_buffered["max_lat"],
    }

    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()

    items = []
    a_to_b_total = 0
    b_to_a_total = 0
    a_to_b_duration_sum = 0.0
    b_to_a_duration_sum = 0.0
    a_to_b_duration_count = 0
    b_to_a_duration_count = 0

    for row in rows:
        a_to_b = int(row["a_to_b"] or 0)
        b_to_a = int(row["b_to_a"] or 0)
        total = a_to_b + b_to_a
        net_flow = a_to_b - b_to_a
        a_to_b_avg = float(row["a_to_b_avg_duration_min"]) if row["a_to_b_avg_duration_min"] is not None else None
        b_to_a_avg = float(row["b_to_a_avg_duration_min"]) if row["b_to_a_avg_duration_min"] is not None else None

        items.append(
            {
                "time_bucket": row["time_bucket"].isoformat() if row["time_bucket"] else None,
                "a_to_b": a_to_b,
                "b_to_a": b_to_a,
                "total": total,
                "net_flow": net_flow,
                "a_to_b_avg_duration_min": a_to_b_avg,
                "b_to_a_avg_duration_min": b_to_a_avg,
            }
        )

        a_to_b_total += a_to_b
        b_to_a_total += b_to_a
        if a_to_b_avg is not None and a_to_b > 0:
            a_to_b_duration_sum += a_to_b_avg * a_to_b
            a_to_b_duration_count += a_to_b
        if b_to_a_avg is not None and b_to_a > 0:
            b_to_a_duration_sum += b_to_a_avg * b_to_a
            b_to_a_duration_count += b_to_a

    total = a_to_b_total + b_to_a_total
    net_flow = a_to_b_total - b_to_a_total
    if net_flow > 0:
        dominant_direction = "A_TO_B"
    elif net_flow < 0:
        dominant_direction = "B_TO_A"
    else:
        dominant_direction = "BALANCED"

    return {
        "items": items,
        "summary": {
            "a_to_b_total": a_to_b_total,
            "b_to_a_total": b_to_a_total,
            "total": total,
            "net_flow": net_flow,
            "dominant_direction": dominant_direction,
            "a_to_b_avg_duration_min": (a_to_b_duration_sum / a_to_b_duration_count) if a_to_b_duration_count > 0 else None,
            "b_to_a_avg_duration_min": (b_to_a_duration_sum / b_to_a_duration_count) if b_to_a_duration_count > 0 else None,
        },
        "meta": {
            "granularity": granularity,
            "buffer_meters": payload.buffer_meters,
            "area_a": {
                "input": payload.area_a.model_dump(),
                "buffered": area_a_buffered,
            },
            "area_b": {
                "input": payload.area_b.model_dump(),
                "buffered": area_b_buffered,
            },
            "start_time": payload.start_time.isoformat(),
            "end_time": payload.end_time.isoformat(),
            "logic_mode": "state_machine_window",
            "max_transition_seconds": payload.max_transition_seconds,
        },
    }


@router.post("/f6-radiation-flow")
def get_f6_radiation_flow(payload: F6RadiationFlowRequest) -> dict:
    started_at = perf_counter()
    if payload.start_time >= payload.end_time:
        return {"series": [], "regions": [], "summary": {}, "meta": {"error": "start_time must be earlier than end_time"}}

    if payload.core_area.min_lon >= payload.core_area.max_lon or payload.core_area.min_lat >= payload.core_area.max_lat:
        return {"series": [], "regions": [], "summary": {}, "meta": {"error": "invalid core_area bounds"}}

    try:
        h3_module = load_h3_module()
    except ModuleNotFoundError:
        return {
            "series": [],
            "regions": [],
            "summary": {},
            "meta": {"error": "Python package h3 is not installed in backend container; rebuild backend image first"},
        }

    cached_response = _f6_read_cached_response(payload)
    if cached_response is not None:
        return cached_response

    if payload.analysis_mode == "strict_od":
        ensure_trip_od_cache()
    core_buffered = expand_bbox_by_meters(payload.core_area, payload.buffer_meters)
    use_trip_grid_points_for_through_flow = payload.analysis_mode == "through_flow" and trip_grid_points_exists()
    core_grid_keys = _bbox_to_grid_keys(core_buffered, F6_TRIP_GRID_STEP_DEGREES) if use_trip_grid_points_for_through_flow else []

    strict_od_sql = """
        WITH core AS (
            SELECT
                ST_MakeEnvelope(:core_min_lon, :core_min_lat, :core_max_lon, :core_max_lat, 4326) AS core_geom,
                ST_MakeEnvelope(:core_buf_min_lon, :core_buf_min_lat, :core_buf_max_lon, :core_buf_max_lat, 4326) AS core_buffered_geom
        ),
        outbound AS (
            SELECT
                od.taxi_id,
                od.trip_id,
                DATE_TRUNC(:granularity, od.start_time) AS time_bucket,
                od.start_time AS event_time,
                od.end_time,
                'outbound'::text AS direction,
                od.end_lon AS external_lon,
                od.end_lat AS external_lat,
                od.duration_seconds / 60.0 AS duration_min
            FROM trip_od_cache od
            CROSS JOIN core c
            WHERE od.start_time >= :start_time
              AND od.start_time <= :end_time
              AND od.start_geom && c.core_buffered_geom
              AND ST_DWithin(od.start_geom::geography, c.core_geom::geography, :buffer_meters)
              AND NOT (
                    od.end_geom && c.core_buffered_geom
                AND ST_DWithin(od.end_geom::geography, c.core_geom::geography, :buffer_meters)
              )
        ),
        inbound AS (
            SELECT
                od.taxi_id,
                od.trip_id,
                DATE_TRUNC(:granularity, od.end_time) AS time_bucket,
                od.end_time AS event_time,
                od.end_time,
                'inbound'::text AS direction,
                od.start_lon AS external_lon,
                od.start_lat AS external_lat,
                od.duration_seconds / 60.0 AS duration_min
            FROM trip_od_cache od
            CROSS JOIN core c
            WHERE od.end_time >= :start_time
              AND od.end_time <= :end_time
              AND od.end_geom && c.core_buffered_geom
              AND ST_DWithin(od.end_geom::geography, c.core_geom::geography, :buffer_meters)
              AND NOT (
                    od.start_geom && c.core_buffered_geom
                AND ST_DWithin(od.start_geom::geography, c.core_geom::geography, :buffer_meters)
              )
        ),
        directional AS (
            SELECT * FROM outbound WHERE :direction IN ('outbound', 'both')
            UNION ALL
            SELECT * FROM inbound WHERE :direction IN ('inbound', 'both')
        )
        SELECT
            time_bucket,
            direction,
            external_lon,
            external_lat,
            duration_min
        FROM directional
        """

    through_flow_sql = """
        WITH core AS (
            SELECT
                CAST(:core_min_lon AS double precision) AS core_min_lon,
                CAST(:core_min_lat AS double precision) AS core_min_lat,
                CAST(:core_max_lon AS double precision) AS core_max_lon,
                CAST(:core_max_lat AS double precision) AS core_max_lat,
                ST_MakeEnvelope(:core_min_lon, :core_min_lat, :core_max_lon, :core_max_lat, 4326) AS core_geom,
                ST_MakeEnvelope(:core_buf_min_lon, :core_buf_min_lat, :core_buf_max_lon, :core_buf_max_lat, 4326) AS core_buffered_geom
        ),
        core_events AS (
            SELECT
                tp.taxi_id,
                tp.trip_id,
                MIN(tp.gps_time) AS first_core_time,
                MAX(tp.gps_time) AS last_core_time
            FROM taxi_points tp
            CROSS JOIN core c
            WHERE tp.gps_time >= :start_time
              AND tp.gps_time <= :end_time
              AND tp.geom && c.core_buffered_geom
              AND (
                    (
                        tp.lon >= c.core_min_lon
                    AND tp.lon <= c.core_max_lon
                    AND tp.lat >= c.core_min_lat
                    AND tp.lat <= c.core_max_lat
                    )
                 OR ST_DWithin(tp.geom::geography, c.core_geom::geography, :buffer_meters)
              )
            GROUP BY tp.taxi_id, tp.trip_id
        ),
        outbound AS (
            SELECT
                ce.taxi_id,
                ce.trip_id,
                DATE_TRUNC(:granularity, ce.last_core_time) AS time_bucket,
                ce.last_core_time AS event_time,
                'outbound'::text AS direction,
                p.lon AS external_lon,
                p.lat AS external_lat,
                EXTRACT(EPOCH FROM (p.gps_time - ce.last_core_time)) / 60.0 AS duration_min
            FROM core_events ce
            JOIN LATERAL (
                SELECT p.lon, p.lat, p.gps_time
                FROM taxi_points p
                CROSS JOIN core c
                WHERE p.taxi_id = ce.taxi_id
                  AND p.trip_id = ce.trip_id
                  AND p.gps_time > ce.last_core_time
                  AND p.gps_time <= :end_time
                  AND p.gps_time <= ce.last_core_time + (:max_transition_seconds * INTERVAL '1 second')
                  AND NOT (
                        p.geom && c.core_buffered_geom
                    AND (
                            (
                                p.lon >= c.core_min_lon
                            AND p.lon <= c.core_max_lon
                            AND p.lat >= c.core_min_lat
                            AND p.lat <= c.core_max_lat
                            )
                         OR ST_DWithin(p.geom::geography, c.core_geom::geography, :buffer_meters)
                    )
                  )
                ORDER BY p.gps_time ASC, p.id ASC
                LIMIT 1
            ) p ON TRUE
        ),
        inbound AS (
            SELECT
                ce.taxi_id,
                ce.trip_id,
                DATE_TRUNC(:granularity, ce.first_core_time) AS time_bucket,
                ce.first_core_time AS event_time,
                'inbound'::text AS direction,
                p.lon AS external_lon,
                p.lat AS external_lat,
                EXTRACT(EPOCH FROM (ce.first_core_time - p.gps_time)) / 60.0 AS duration_min
            FROM core_events ce
            JOIN LATERAL (
                SELECT p.lon, p.lat, p.gps_time
                FROM taxi_points p
                CROSS JOIN core c
                WHERE p.taxi_id = ce.taxi_id
                  AND p.trip_id = ce.trip_id
                  AND p.gps_time < ce.first_core_time
                  AND p.gps_time >= :start_time
                  AND p.gps_time >= ce.first_core_time - (:max_transition_seconds * INTERVAL '1 second')
                  AND NOT (
                        p.geom && c.core_buffered_geom
                    AND (
                            (
                                p.lon >= c.core_min_lon
                            AND p.lon <= c.core_max_lon
                            AND p.lat >= c.core_min_lat
                            AND p.lat <= c.core_max_lat
                            )
                         OR ST_DWithin(p.geom::geography, c.core_geom::geography, :buffer_meters)
                    )
                  )
                ORDER BY p.gps_time DESC, p.id DESC
                LIMIT 1
            ) p ON TRUE
        ),
        directional AS (
            SELECT * FROM outbound WHERE :direction IN ('outbound', 'both')
            UNION ALL
            SELECT * FROM inbound WHERE :direction IN ('inbound', 'both')
        )
        SELECT
            time_bucket,
            direction,
            external_lon,
            external_lat,
            duration_min
        FROM directional
        """

    through_flow_grid_sql = """
        WITH core AS (
            SELECT
                CAST(:core_min_lon AS double precision) AS core_min_lon,
                CAST(:core_min_lat AS double precision) AS core_min_lat,
                CAST(:core_max_lon AS double precision) AS core_max_lon,
                CAST(:core_max_lat AS double precision) AS core_max_lat,
                CAST(:core_buf_min_lon AS double precision) AS core_buf_min_lon,
                CAST(:core_buf_min_lat AS double precision) AS core_buf_min_lat,
                CAST(:core_buf_max_lon AS double precision) AS core_buf_max_lon,
                CAST(:core_buf_max_lat AS double precision) AS core_buf_max_lat,
                ST_MakeEnvelope(:core_min_lon, :core_min_lat, :core_max_lon, :core_max_lat, 4326) AS core_geom,
                ST_MakeEnvelope(:core_buf_min_lon, :core_buf_min_lat, :core_buf_max_lon, :core_buf_max_lat, 4326) AS core_buffered_geom
        ),
        core_events AS MATERIALIZED (
            SELECT
                gp.taxi_id,
                gp.trip_id,
                MIN(gp.gps_time) AS first_core_time,
                MAX(gp.gps_time) AS last_core_time,
                MIN(gp.point_seq) AS first_core_seq,
                MAX(gp.point_seq) AS last_core_seq
            FROM trip_grid_points gp
            CROSS JOIN core c
            WHERE gp.gps_time >= :start_time
              AND gp.gps_time <= :end_time
              AND gp.grid_key = ANY(CAST(:core_grid_keys AS text[]))
              AND gp.lon >= c.core_buf_min_lon
              AND gp.lon <= c.core_buf_max_lon
              AND gp.lat >= c.core_buf_min_lat
              AND gp.lat <= c.core_buf_max_lat
              AND (
                    (
                        gp.lon >= c.core_min_lon
                    AND gp.lon <= c.core_max_lon
                    AND gp.lat >= c.core_min_lat
                    AND gp.lat <= c.core_max_lat
                    )
                 OR ST_DWithin(ST_SetSRID(ST_MakePoint(gp.lon, gp.lat), 4326)::geography, c.core_geom::geography, :buffer_meters)
              )
            GROUP BY gp.taxi_id, gp.trip_id
        ),
        outbound AS (
            SELECT
                ce.taxi_id,
                ce.trip_id,
                DATE_TRUNC(:granularity, ce.last_core_time) AS time_bucket,
                ce.last_core_time AS event_time,
                'outbound'::text AS direction,
                p.lon AS external_lon,
                p.lat AS external_lat,
                EXTRACT(EPOCH FROM (p.gps_time - ce.last_core_time)) / 60.0 AS duration_min
            FROM core_events ce
            JOIN LATERAL (
                SELECT p.lon, p.lat, p.gps_time
                FROM trip_grid_points p
                CROSS JOIN core c
                WHERE p.taxi_id = ce.taxi_id
                  AND p.trip_id = ce.trip_id
                  AND p.point_seq > ce.last_core_seq
                  AND p.gps_time > ce.last_core_time
                  AND p.gps_time <= :end_time
                  AND p.gps_time <= ce.last_core_time + (:max_transition_seconds * INTERVAL '1 second')
                  AND NOT (
                        p.lon >= c.core_buf_min_lon
                    AND p.lon <= c.core_buf_max_lon
                    AND p.lat >= c.core_buf_min_lat
                    AND p.lat <= c.core_buf_max_lat
                    AND (
                            (
                                p.lon >= c.core_min_lon
                            AND p.lon <= c.core_max_lon
                            AND p.lat >= c.core_min_lat
                            AND p.lat <= c.core_max_lat
                            )
                         OR ST_DWithin(ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography, c.core_geom::geography, :buffer_meters)
                    )
                  )
                ORDER BY p.point_seq ASC
                LIMIT 1
            ) p ON TRUE
        ),
        inbound AS (
            SELECT
                ce.taxi_id,
                ce.trip_id,
                DATE_TRUNC(:granularity, ce.first_core_time) AS time_bucket,
                ce.first_core_time AS event_time,
                'inbound'::text AS direction,
                p.lon AS external_lon,
                p.lat AS external_lat,
                EXTRACT(EPOCH FROM (ce.first_core_time - p.gps_time)) / 60.0 AS duration_min
            FROM core_events ce
            JOIN LATERAL (
                SELECT p.lon, p.lat, p.gps_time
                FROM trip_grid_points p
                CROSS JOIN core c
                WHERE p.taxi_id = ce.taxi_id
                  AND p.trip_id = ce.trip_id
                  AND p.point_seq < ce.first_core_seq
                  AND p.gps_time < ce.first_core_time
                  AND p.gps_time >= :start_time
                  AND p.gps_time >= ce.first_core_time - (:max_transition_seconds * INTERVAL '1 second')
                  AND NOT (
                        p.lon >= c.core_buf_min_lon
                    AND p.lon <= c.core_buf_max_lon
                    AND p.lat >= c.core_buf_min_lat
                    AND p.lat <= c.core_buf_max_lat
                    AND (
                            (
                                p.lon >= c.core_min_lon
                            AND p.lon <= c.core_max_lon
                            AND p.lat >= c.core_min_lat
                            AND p.lat <= c.core_max_lat
                            )
                         OR ST_DWithin(ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography, c.core_geom::geography, :buffer_meters)
                    )
                  )
                ORDER BY p.point_seq DESC
                LIMIT 1
            ) p ON TRUE
        ),
        directional AS (
            SELECT * FROM outbound WHERE :direction IN ('outbound', 'both')
            UNION ALL
            SELECT * FROM inbound WHERE :direction IN ('inbound', 'both')
        )
        SELECT
            time_bucket,
            direction,
            external_lon,
            external_lat,
            duration_min
        FROM directional
        """

    if payload.analysis_mode == "strict_od":
        sql = text(strict_od_sql)
    elif use_trip_grid_points_for_through_flow:
        sql = text(through_flow_grid_sql)
    else:
        sql = text(through_flow_sql)

    params = {
        "start_time": payload.start_time,
        "end_time": payload.end_time,
        "granularity": payload.granularity,
        "direction": payload.direction,
        "buffer_meters": payload.buffer_meters,
        "max_transition_seconds": payload.max_transition_seconds,
        "core_min_lon": payload.core_area.min_lon,
        "core_min_lat": payload.core_area.min_lat,
        "core_max_lon": payload.core_area.max_lon,
        "core_max_lat": payload.core_area.max_lat,
        "core_buf_min_lon": core_buffered["min_lon"],
        "core_buf_min_lat": core_buffered["min_lat"],
        "core_buf_max_lon": core_buffered["max_lon"],
        "core_buf_max_lat": core_buffered["max_lat"],
        "core_grid_keys": core_grid_keys,
    }

    with engine.begin() as conn:
        if payload.analysis_mode == "through_flow":
            conn.execute(text("SET LOCAL work_mem = '256MB'"))
        rows = conn.execute(sql, params).mappings().all()

    region_totals: dict[str, dict[str, float]] = defaultdict(
        lambda: {
            "outbound_total": 0,
            "inbound_total": 0,
            "total": 0,
            "duration_sum": 0.0,
            "duration_count": 0,
        }
    )
    bucket_totals: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: {"outbound": 0, "inbound": 0, "total": 0})
    total_outbound = 0
    total_inbound = 0
    duration_sum = 0.0
    duration_count = 0

    for row in rows:
        h3_index = h3_cell_for_point(h3_module, float(row["external_lon"]), float(row["external_lat"]), payload.h3_resolution)
        direction = str(row["direction"])
        bucket = row["time_bucket"].isoformat() if row["time_bucket"] is not None else ""
        duration_min = float(row["duration_min"] or 0)

        region = region_totals[h3_index]
        if direction == "outbound":
            region["outbound_total"] += 1
            total_outbound += 1
        elif direction == "inbound":
            region["inbound_total"] += 1
            total_inbound += 1
        region["total"] += 1
        region["duration_sum"] += duration_min
        region["duration_count"] += 1
        duration_sum += duration_min
        duration_count += 1

        bucket_key = (bucket, h3_index)
        bucket_totals[bucket_key][direction] += 1
        bucket_totals[bucket_key]["total"] += 1

    total_flow = total_outbound + total_inbound
    net_flow = total_outbound - total_inbound
    if net_flow > 0:
        dominant_direction = "outbound"
    elif net_flow < 0:
        dominant_direction = "inbound"
    else:
        dominant_direction = "balanced"

    ranked_regions = sorted(region_totals.items(), key=lambda item: (-int(item[1]["total"]), item[0]))
    top_region_ids = {region_id for region_id, _ in ranked_regions[: payload.top_k]}
    regions = []
    for region_id, stats in ranked_regions[: payload.top_k]:
        boundary = h3_cell_boundary(h3_module, region_id)
        lon_values = [point[0] for point in boundary]
        lat_values = [point[1] for point in boundary]
        outbound_total = int(stats["outbound_total"])
        inbound_total = int(stats["inbound_total"])
        total = int(stats["total"])
        regions.append(
            {
                "region_id": region_id,
                "h3_index": region_id,
                "center": h3_cell_center(h3_module, region_id),
                "boundary": boundary,
                "bounds": [min(lon_values), min(lat_values), max(lon_values), max(lat_values)],
                "outbound_total": outbound_total,
                "inbound_total": inbound_total,
                "total": total,
                "net_flow": outbound_total - inbound_total,
                "avg_duration_min": (stats["duration_sum"] / stats["duration_count"]) if stats["duration_count"] else None,
            }
        )

    series = []
    for (bucket, region_id), stats in sorted(bucket_totals.items(), key=lambda item: (item[0][0], -item[1]["total"], item[0][1])):
        if region_id not in top_region_ids:
            continue
        outbound = int(stats["outbound"])
        inbound = int(stats["inbound"])
        series.append(
            {
                "time_bucket": bucket,
                "region_id": region_id,
                "outbound": outbound,
                "inbound": inbound,
                "total": int(stats["total"]),
                "net_flow": outbound - inbound,
            }
        )

    top_k_flow = sum(int(stats["total"]) for _, stats in ranked_regions[: payload.top_k])

    if not rows:
        return _f6_write_cached_response(payload, {
            "series": [],
            "regions": [],
            "summary": {
                "total_outbound": 0,
                "total_inbound": 0,
                "total_flow": 0,
                "net_flow": 0,
                "dominant_direction": "balanced",
                "top_k_flow": 0,
                "top_k_ratio": 0,
                "avg_duration_min": None,
                "external_region_count": 0,
            },
            "meta": {
                "granularity": payload.granularity,
                "direction": payload.direction,
                "h3_resolution": payload.h3_resolution,
                "buffer_meters": payload.buffer_meters,
                "max_transition_seconds": payload.max_transition_seconds,
                "analysis_mode": payload.analysis_mode,
                "analysis_scope": "full_dataset",
                "logic_mode": f"{payload.analysis_mode}_h3_radiation",
                "elapsed_ms": round((perf_counter() - started_at) * 1000, 2),
            },
        })

    return _f6_write_cached_response(payload, {
        "series": series,
        "regions": regions,
        "summary": {
            "total_outbound": total_outbound,
            "total_inbound": total_inbound,
            "total_flow": total_flow,
            "net_flow": net_flow,
            "dominant_direction": dominant_direction,
            "top_k_flow": top_k_flow,
            "top_k_ratio": (top_k_flow / total_flow) if total_flow > 0 else 0,
            "avg_duration_min": (duration_sum / duration_count) if duration_count > 0 else None,
            "external_region_count": len(region_totals),
        },
        "meta": {
            "granularity": payload.granularity,
            "direction": payload.direction,
            "analysis_mode": payload.analysis_mode,
            "h3_resolution": payload.h3_resolution,
            "buffer_meters": payload.buffer_meters,
            "max_transition_seconds": payload.max_transition_seconds,
            "top_k": payload.top_k,
            "analysis_scope": "full_dataset",
            "core_area": {
                "input": payload.core_area.model_dump(),
                "buffered": core_buffered,
            },
            "logic_mode": f"{payload.analysis_mode}_h3_radiation",
            "data_scope": "summary is global; regions and series are Top-K only",
            "trip_source": (
                "trip_od_cache start/end points"
                if payload.analysis_mode == "strict_od"
                else "candidate trips touching core area from trip_grid_points"
                if use_trip_grid_points_for_through_flow
                else "candidate trips touching core area from taxi_points"
            ),
            "start_time": payload.start_time.isoformat(),
            "end_time": payload.end_time.isoformat(),
            "elapsed_ms": round((perf_counter() - started_at) * 1000, 2),
        },
    })


@router.post("/f7-frequent-paths")
def get_f7_frequent_paths(payload: F7FrequentPathsRequest) -> dict:
    started_at = perf_counter()
    window_hours = (payload.end_time - payload.start_time).total_seconds() / 3600.0

    if payload.start_time >= payload.end_time:
        return {"paths": [], "summary": {}, "meta": {"error": "start_time must be earlier than end_time"}}

    if payload.analysis_bbox.min_lon >= payload.analysis_bbox.max_lon or payload.analysis_bbox.min_lat >= payload.analysis_bbox.max_lat:
        return {"paths": [], "summary": {}, "meta": {"error": "invalid analysis_bbox bounds"}}

    lon_span = payload.analysis_bbox.max_lon - payload.analysis_bbox.min_lon
    lat_span = payload.analysis_bbox.max_lat - payload.analysis_bbox.min_lat
    if f7_scope_uses_bbox(payload) and (lon_span > 0.7 or lat_span > 0.5):
        return {
            "paths": [],
            "summary": {},
            "meta": {
                "error": "analysis_bbox is too large; zoom in before running F7",
                "analysis_bbox": payload.analysis_bbox.model_dump(),
            },
        }

    cached_response = _f7_read_cached_response(payload)
    if cached_response is not None:
        return cached_response

    has_exact_passes = matched_trip_road_passes_exists()
    use_exact_passes = has_exact_passes and window_hours <= F7_EXACT_WINDOW_LIMIT_HOURS
    if use_exact_passes:
        return _f7_write_cached_response(payload, get_f7_frequent_paths_from_road_passes(payload, started_at))

    if matched_road_group_hourly_counts_exists():
        return _f7_write_cached_response(payload, get_f7_frequent_paths_from_group_hourly_counts(payload, started_at))

    if matched_road_hourly_counts_exists():
        return _f7_write_cached_response(payload, get_f7_frequent_paths_from_hourly_counts(payload, started_at))

    if has_exact_passes:
        return _f7_write_cached_response(payload, get_f7_frequent_paths_from_road_passes(payload, started_at))

    if not matched_trip_edges_exists():
        return {
            "paths": [],
            "summary": {
                "path_count": 0,
                "total_path_count_before_top_k": 0,
                "top_k_trip_count": 0,
                "total_ranked_trip_count": 0,
                "top_k_ratio": 0,
                "max_trip_count": 0,
                "max_vehicle_count": 0,
            },
            "meta": {
                "error": "matched_trip_edges table is missing or outdated; run data_scripts/build_matched_trip_edges.py --rebuild before using F7",
                "logic_mode": "precomputed_matched_trip_edges_required",
            },
        }

    ensure_trip_od_cache()

    order_by = f7_order_by_clause(payload.sort_mode, has_edge_pass_weight=False)
    sql = text(
        f"""
        WITH analysis AS (
            SELECT ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326) AS bbox_geom
        ),
        candidate_roads AS (
            SELECT
                r.id AS road_id,
                r.edge_uid AS road_uid,
                COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) AS road_name,
                COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) AS road_group_key,
                r.highway,
                r.oneway::text AS oneway_raw,
                r.geometry AS road_geom,
                CASE
                    WHEN r.length IS NOT NULL AND r.length > 0 THEN r.length
                    ELSE ST_Length(r.geometry::geography)
                END AS segment_length_m
            FROM road_edges r
            CROSS JOIN analysis a
            WHERE (:use_bbox = FALSE OR r.geometry && a.bbox_geom)
        ),
        road_group_lengths AS (
            SELECT
                road_group_key,
                SUM(segment_length_m) AS group_length_m
            FROM candidate_roads
            GROUP BY road_group_key
        ),
        eligible_roads AS (
            SELECT cr.*
            FROM candidate_roads cr
            JOIN road_group_lengths gl
              ON gl.road_group_key = cr.road_group_key
             AND gl.group_length_m >= :min_group_length_m
        ),
        candidate_trips AS (
            SELECT DISTINCT
                od.taxi_id,
                od.trip_id::bigint AS trip_id,
                od.start_time,
                od.end_time
            FROM trip_od_cache od
            JOIN matched_trip_edges e
              ON e.taxi_id = od.taxi_id
             AND e.trip_id = od.trip_id::bigint
            JOIN eligible_roads er
              ON er.road_uid = e.road_uid
            WHERE od.start_time <= :end_time
              AND od.end_time >= :start_time
              AND od.trip_id ~ '^[0-9]+$'
            ORDER BY od.start_time ASC, od.taxi_id ASC, od.trip_id ASC
            LIMIT :max_trips
        ),
        matched_segments AS (
            SELECT DISTINCT
                r.road_id,
                r.road_uid,
                r.road_name,
                r.road_group_key,
                r.highway,
                r.oneway_raw,
                r.segment_length_m,
                e.taxi_id,
                e.trip_id,
                e.direction
            FROM matched_trip_edges e
            JOIN candidate_trips t
              ON t.taxi_id = e.taxi_id
             AND t.trip_id = e.trip_id
            JOIN eligible_roads r
              ON r.road_uid = e.road_uid
        ),
        segment_stats AS (
            SELECT
                road_id,
                road_uid,
                road_name,
                road_group_key,
                direction,
                highway,
                oneway_raw,
                segment_length_m,
                COUNT(DISTINCT (taxi_id, trip_id))::bigint AS trip_count,
                COUNT(DISTINCT taxi_id)::bigint AS vehicle_count
            FROM matched_segments
            GROUP BY
                road_id,
                road_uid,
                road_name,
                road_group_key,
                direction,
                highway,
                oneway_raw,
                segment_length_m
        ),
        group_flow_stats AS (
            SELECT
                road_group_key,
                direction,
                COUNT(DISTINCT (taxi_id, trip_id))::bigint AS trip_count,
                COUNT(DISTINCT taxi_id)::bigint AS vehicle_count
            FROM matched_segments
            GROUP BY road_group_key, direction
        ),
        grouped_paths AS (
            SELECT
                ss.road_group_key,
                ss.direction,
                MIN(ss.road_name) AS road_name,
                STRING_AGG(DISTINCT ss.highway, ', ' ORDER BY ss.highway) FILTER (WHERE ss.highway IS NOT NULL AND ss.highway <> '') AS highway,
                BOOL_OR(LOWER(COALESCE(ss.oneway_raw, '')) IN ('yes', 'true', '1', 't', '-1', 'reverse', 'backward')) AS has_oneway_segment,
                COUNT(*)::bigint AS segment_count,
                MAX(gfs.trip_count)::bigint AS trip_count,
                MAX(gfs.vehicle_count)::bigint AS vehicle_count,
                SUM(ss.segment_length_m) AS matched_segment_length_m,
                MAX(gl.group_length_m) AS group_length_m
            FROM segment_stats ss
            JOIN road_group_lengths gl
              ON gl.road_group_key = ss.road_group_key
            JOIN group_flow_stats gfs
              ON gfs.road_group_key = ss.road_group_key
             AND gfs.direction = ss.direction
            GROUP BY ss.road_group_key, ss.direction
        ),
        ranked AS (
            SELECT
                *,
                SUM(trip_count) OVER ()::bigint AS total_ranked_trip_count,
                COUNT(*) OVER ()::bigint AS total_path_count
            FROM grouped_paths
            ORDER BY {order_by}
            LIMIT :top_k
        ),
        ranked_with_geometry AS (
            SELECT
                rnk.road_group_key,
                rnk.direction,
                rnk.road_name,
                rnk.highway,
                rnk.has_oneway_segment,
                rnk.segment_count,
                rnk.trip_count,
                rnk.vehicle_count,
                rnk.matched_segment_length_m,
                rnk.group_length_m,
                rnk.total_ranked_trip_count,
                rnk.total_path_count,
                ST_AsGeoJSON(ST_LineMerge(ST_UnaryUnion(ST_Collect(cr.road_geom)))) AS geometry
            FROM ranked rnk
            JOIN segment_stats ss
              ON ss.road_group_key = rnk.road_group_key
             AND ss.direction = rnk.direction
            JOIN candidate_roads cr
              ON cr.road_uid = ss.road_uid
            GROUP BY
                rnk.road_group_key,
                rnk.direction,
                rnk.road_name,
                rnk.highway,
                rnk.has_oneway_segment,
                rnk.segment_count,
                rnk.trip_count,
                rnk.vehicle_count,
                rnk.matched_segment_length_m,
                rnk.group_length_m,
                rnk.total_ranked_trip_count,
                rnk.total_path_count
        )
        SELECT *
        FROM ranked_with_geometry
        ORDER BY {order_by}
        """
    )

    params = {
        "start_time": payload.start_time,
        "end_time": payload.end_time,
        "min_lon": payload.analysis_bbox.min_lon,
        "min_lat": payload.analysis_bbox.min_lat,
        "max_lon": payload.analysis_bbox.max_lon,
        "max_lat": payload.analysis_bbox.max_lat,
        "top_k": payload.top_k,
        "min_group_length_m": payload.min_group_length_m,
        "max_trips": payload.max_trips,
        "use_bbox": f7_scope_uses_bbox(payload),
    }

    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()

    paths = []
    top_k_trip_count = 0
    max_trip_count = 0
    max_vehicle_count = 0
    total_ranked_trip_count = 0
    total_path_count = 0

    for index, row in enumerate(rows, start=1):
        trip_count = int(row["trip_count"] or 0)
        vehicle_count = int(row["vehicle_count"] or 0)
        geometry = _f7_primary_geometry(json.loads(row["geometry"])) if row["geometry"] else None
        top_k_trip_count += trip_count
        max_trip_count = max(max_trip_count, trip_count)
        max_vehicle_count = max(max_vehicle_count, vehicle_count)
        total_ranked_trip_count = int(row["total_ranked_trip_count"] or 0)
        total_path_count = int(row["total_path_count"] or 0)

        paths.append(
            {
                "rank": index,
                "road_group_key": row["road_group_key"],
                "normalized_road_group_key": _normalize_f8_road_group_key(row["road_group_key"]) or row["road_group_key"],
                "road_name": row["road_name"],
                "highway": row["highway"],
                "direction": "forward" if int(row["direction"] or 0) > 0 else "reverse" if int(row["direction"] or 0) < 0 else "unknown",
                "direction_value": int(row["direction"] or 0),
                "direction_supported": True,
                "component_id": int(row["component_id"]) if row["component_id"] is not None else None,
                "trip_count": trip_count,
                "vehicle_count": vehicle_count,
                "segment_count": int(row["segment_count"] or 0),
                "group_length_m": float(row["group_length_m"] or 0.0),
                "matched_segment_length_m": float(row["matched_segment_length_m"] or 0.0),
                "has_oneway_segment": bool(row["has_oneway_segment"]),
                "geometry": geometry,
            }
        )

    elapsed_ms = round((perf_counter() - started_at) * 1000, 2)

    return _f7_write_cached_response(payload, {
        "corridors": paths,
        "paths": paths,
        "summary": {
            "path_count": len(paths),
            "total_path_count_before_top_k": total_path_count,
            "top_k_trip_count": top_k_trip_count,
            "total_ranked_trip_count": total_ranked_trip_count,
            "top_k_ratio": (top_k_trip_count / total_ranked_trip_count) if total_ranked_trip_count > 0 else 0,
            "max_trip_count": max_trip_count,
            "max_vehicle_count": max_vehicle_count,
        },
        "meta": {
            "logic_mode": "precomputed_matched_trip_edges_road_group",
            "precision_level": "precomputed_edge_sequence",
            "direction_supported": True,
            "direction_note": "Direction comes from matched_trip_edges and is relative to each road edge geometry direction.",
            "length_filter_note": "min_group_length_m is applied to grouped road length, not individual OSM segments.",
            "analysis_bbox": payload.analysis_bbox.model_dump(),
            "start_time": payload.start_time.isoformat(),
            "end_time": payload.end_time.isoformat(),
            "top_k": payload.top_k,
            "min_group_length_m": payload.min_group_length_m,
            "max_trips": payload.max_trips,
            "scope": payload.scope,
            "sort_mode": payload.sort_mode,
            "exact_window_limit_hours": F7_EXACT_WINDOW_LIMIT_HOURS,
            "requested_window_hours": round(window_hours, 2),
            "elapsed_ms": elapsed_ms,
        },
    })


@router.post("/f7-road-detail")
def get_f7_road_detail(payload: F7RoadDetailRequest) -> dict:
    started_at = perf_counter()
    window_hours = (payload.end_time - payload.start_time).total_seconds() / 3600.0

    if payload.start_time >= payload.end_time:
        return {"segments": [], "summary": {}, "meta": {"error": "start_time must be earlier than end_time"}}

    if payload.analysis_bbox.min_lon >= payload.analysis_bbox.max_lon or payload.analysis_bbox.min_lat >= payload.analysis_bbox.max_lat:
        return {"segments": [], "summary": {}, "meta": {"error": "invalid analysis_bbox bounds"}}

    exact_window_limit_hours = 6.0
    use_exact_passes = matched_trip_road_passes_exists() and window_hours <= exact_window_limit_hours
    use_hourly_rollup = matched_road_hourly_counts_exists()

    if not use_exact_passes and not use_hourly_rollup:
        return {
            "segments": [],
            "summary": {},
            "meta": {
                "error": "matched_trip_road_passes / matched_road_hourly_counts are both missing; rebuild F7 support tables before using detail drill-down",
                "logic_mode": "matched_f7_detail_source_required",
            },
        }

    if use_exact_passes:
        sql = text(
            """
            WITH analysis AS (
                SELECT ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326) AS bbox_geom
            ),
            candidate_roads AS (
                SELECT
                    r.edge_uid AS road_uid,
                    r.id AS road_id,
                    COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) AS road_group_key,
                    r.highway,
                    r.geometry AS road_geom,
                    ST_Length(r.geometry::geography) AS length_m,
                    ST_X(ST_Centroid(r.geometry)) AS center_x,
                    ST_Y(ST_Centroid(r.geometry)) AS center_y,
                    ST_ClusterDBSCAN(r.geometry, eps := F7_COMPONENT_CLUSTER_EPS_DEGREES, minpoints := 1) OVER (
                        PARTITION BY COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text))
                    ) AS component_id
                FROM road_edges r
                CROSS JOIN analysis a
                WHERE r.geometry && a.bbox_geom
                  AND COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) = :road_group_key
            ),
            group_axis AS (
                SELECT
                    COALESCE((MAX(center_x) - MIN(center_x)) >= (MAX(center_y) - MIN(center_y)), true) AS order_by_lon
                FROM candidate_roads
            ),
            filtered_passes AS (
                SELECT
                    p.road_uid,
                    p.taxi_id
                FROM matched_trip_road_passes p
                JOIN candidate_roads cr
                  ON cr.road_uid = p.road_uid
                WHERE p.road_group_key = :road_group_key
                  AND p.direction = :direction
                  AND (:component_id IS NULL OR cr.component_id = :component_id)
                  AND p.start_time <= :end_time
                  AND p.end_time >= :start_time
            ),
            segment_stats AS (
                SELECT
                    cr.road_uid,
                    MIN(cr.road_id) AS road_id,
                    MIN(cr.highway) AS highway,
                    MAX(cr.length_m) AS length_m,
                    MAX(cr.center_x) AS center_x,
                    MAX(cr.center_y) AS center_y,
                    COUNT(fp.road_uid)::bigint AS trip_count,
                    COUNT(fp.road_uid)::bigint AS edge_pass_weight,
                    NULL::bigint AS vehicle_count,
                    ST_AsGeoJSON(ST_LineMerge(ST_UnaryUnion(ST_Collect(cr.road_geom)))) AS geometry
                FROM candidate_roads cr
                JOIN filtered_passes fp
                  ON fp.road_uid = cr.road_uid
                GROUP BY cr.road_uid
            ),
            ranked_segments AS (
                SELECT
                    ss.*,
                    ROW_NUMBER() OVER (
                        ORDER BY trip_count DESC, edge_pass_weight DESC, length_m DESC, road_uid ASC
                    )::int AS flow_rank,
                    ROW_NUMBER() OVER (
                        ORDER BY
                            CASE WHEN ga.order_by_lon AND :direction >= 0 THEN center_x END ASC NULLS LAST,
                            CASE WHEN ga.order_by_lon AND :direction < 0 THEN center_x END DESC NULLS LAST,
                            CASE WHEN NOT ga.order_by_lon AND :direction >= 0 THEN center_y END ASC NULLS LAST,
                            CASE WHEN NOT ga.order_by_lon AND :direction < 0 THEN center_y END DESC NULLS LAST,
                            road_uid ASC
                    )::int AS profile_order
                FROM segment_stats ss
                CROSS JOIN group_axis ga
            )
            SELECT
                *,
                COUNT(*) OVER ()::bigint AS total_segment_count,
                SUM(trip_count) OVER ()::bigint AS total_trip_count,
                SUM(edge_pass_weight) OVER ()::bigint AS total_edge_pass_weight,
                MAX(trip_count) OVER ()::bigint AS max_trip_count,
                MAX(edge_pass_weight) OVER ()::bigint AS max_edge_pass_weight
            FROM ranked_segments
            ORDER BY profile_order ASC
            """
        )
        detail_logic_mode = "f7_road_segment_detail_exact_trip_road_passes"
        detail_metric_mode = "exact_distinct_trip_count"
    else:
        sql = text(
            """
            WITH analysis AS (
                SELECT ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326) AS bbox_geom
            ),
            candidate_roads AS (
                SELECT
                    r.edge_uid AS road_uid,
                    r.id AS road_id,
                    COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) AS road_group_key,
                    r.highway,
                    r.geometry AS road_geom,
                    ST_Length(r.geometry::geography) AS length_m,
                    ST_X(ST_Centroid(r.geometry)) AS center_x,
                    ST_Y(ST_Centroid(r.geometry)) AS center_y
                FROM road_edges r
                CROSS JOIN analysis a
                WHERE r.geometry && a.bbox_geom
                  AND COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) = :road_group_key
            ),
            group_axis AS (
                SELECT
                    COALESCE((MAX(center_x) - MIN(center_x)) >= (MAX(center_y) - MIN(center_y)), true) AS order_by_lon
                FROM candidate_roads
            ),
            segment_stats AS (
                SELECT
                    cr.road_uid,
                    MIN(cr.road_id) AS road_id,
                    MIN(cr.highway) AS highway,
                    MAX(cr.length_m) AS length_m,
                    MAX(cr.center_x) AS center_x,
                    MAX(cr.center_y) AS center_y,
                    SUM(h.trip_count)::bigint AS trip_count,
                    SUM(h.trip_count)::bigint AS edge_pass_weight,
                    MAX(h.vehicle_count)::bigint AS vehicle_count,
                    ST_AsGeoJSON(ST_LineMerge(ST_UnaryUnion(ST_Collect(cr.road_geom)))) AS geometry
                FROM candidate_roads cr
                JOIN matched_road_hourly_counts h
                  ON h.road_uid = cr.road_uid
                 AND h.direction = :direction
                WHERE h.hour_bucket >= date_trunc('hour', CAST(:start_time AS timestamp))
                  AND h.hour_bucket <= date_trunc('hour', CAST(:end_time AS timestamp))
                GROUP BY cr.road_uid
            ),
            ranked_segments AS (
                SELECT
                    ss.*,
                    ROW_NUMBER() OVER (
                        ORDER BY trip_count DESC, edge_pass_weight DESC, length_m DESC, road_uid ASC
                    )::int AS flow_rank,
                    ROW_NUMBER() OVER (
                        ORDER BY
                            CASE WHEN ga.order_by_lon AND :direction >= 0 THEN center_x END ASC NULLS LAST,
                            CASE WHEN ga.order_by_lon AND :direction < 0 THEN center_x END DESC NULLS LAST,
                            CASE WHEN NOT ga.order_by_lon AND :direction >= 0 THEN center_y END ASC NULLS LAST,
                            CASE WHEN NOT ga.order_by_lon AND :direction < 0 THEN center_y END DESC NULLS LAST,
                            road_uid ASC
                    )::int AS profile_order
                FROM segment_stats ss
                CROSS JOIN group_axis ga
            )
            SELECT
                *,
                COUNT(*) OVER ()::bigint AS total_segment_count,
                SUM(trip_count) OVER ()::bigint AS total_trip_count,
                SUM(edge_pass_weight) OVER ()::bigint AS total_edge_pass_weight,
                MAX(trip_count) OVER ()::bigint AS max_trip_count,
                MAX(edge_pass_weight) OVER ()::bigint AS max_edge_pass_weight
            FROM ranked_segments
            ORDER BY profile_order ASC
            """
        )
        detail_logic_mode = "f7_road_segment_detail_hourly_rollup_fallback"
        detail_metric_mode = "hourly_rollup_trip_count"

    params = {
        "start_time": payload.start_time,
        "end_time": payload.end_time,
        "min_lon": payload.analysis_bbox.min_lon,
        "min_lat": payload.analysis_bbox.min_lat,
        "max_lon": payload.analysis_bbox.max_lon,
        "max_lat": payload.analysis_bbox.max_lat,
        "road_group_key": payload.road_group_key,
        "direction": payload.direction,
        "component_id": payload.component_id,
    }

    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()

    segments = []
    total_segment_count = 0
    total_trip_count = 0
    total_edge_pass_weight = 0
    max_trip_count = 0
    max_edge_pass_weight = 0

    for index, row in enumerate(rows, start=1):
        total_segment_count = int(row["total_segment_count"] or 0)
        total_trip_count = int(row["total_trip_count"] or 0)
        total_edge_pass_weight = int(row["total_edge_pass_weight"] or 0)
        max_trip_count = int(row["max_trip_count"] or 0)
        max_edge_pass_weight = int(row["max_edge_pass_weight"] or 0)
        segments.append(
            {
                "rank": int(row["flow_rank"] or index),
                "flow_rank": int(row["flow_rank"] or index),
                "profile_order": int(row["profile_order"] or index),
                "road_uid": int(row["road_uid"]),
                "road_id": int(row["road_id"]) if row["road_id"] is not None else None,
                "highway": row["highway"],
                "trip_count": int(row["trip_count"] or 0),
                "raw_trip_count": int(row["trip_count"] or 0),
                "edge_pass_weight": int(row["edge_pass_weight"] or 0),
                "vehicle_count": int(row["vehicle_count"] or 0),
                "length_m": float(row["length_m"] or 0.0),
                "geometry": _f7_primary_geometry(json.loads(row["geometry"])) if row["geometry"] else None,
            }
        )

    elapsed_ms = round((perf_counter() - started_at) * 1000, 2)
    return {
        "segments": segments,
        "summary": {
            "segment_count": total_segment_count,
            "total_trip_count": total_trip_count,
            "total_edge_pass_weight": total_edge_pass_weight,
            "max_trip_count": max_trip_count,
            "max_edge_pass_weight": max_edge_pass_weight,
        },
        "meta": {
            "logic_mode": detail_logic_mode,
            "metric_mode": detail_metric_mode,
            "exact_window_limit_hours": exact_window_limit_hours,
            "requested_window_hours": round(window_hours, 2),
            "detail_source_note": (
                "Exact trip-road passes are used only for shorter windows; longer windows automatically fall back to hourly rollup to keep drill-down responsive."
            ),
            "road_group_key": payload.road_group_key,
            "direction": payload.direction,
            "component_id": payload.component_id,
            "corridor_object": "road_group_key + direction + component_id",
            "analysis_bbox": payload.analysis_bbox.model_dump(),
            "start_time": payload.start_time.isoformat(),
            "end_time": payload.end_time.isoformat(),
            "elapsed_ms": elapsed_ms,
        },
    }


@router.post("/f8-ab-frequent-routes")
def get_f8_ab_frequent_routes(payload: F8ABFrequentRoutesRequest) -> dict:
    started_at = perf_counter()
    cached_response = _f8_read_cached_response(payload)
    if cached_response is not None:
        return cached_response
    return _f8_write_cached_response(payload, _get_f8_ab_frequent_routes_clustered(payload, started_at))


def _get_f8_ab_frequent_routes_clustered(
    payload: F8ABFrequentRoutesRequest, started_at: float | None = None
) -> dict:
    started_at = started_at if started_at is not None else perf_counter()

    if payload.start_time >= payload.end_time:
        return _f8_empty_response(payload, started_at, error="start_time must be earlier than end_time")

    for area_name, area in (("area_a", payload.area_a), ("area_b", payload.area_b)):
        if area.min_lon >= area.max_lon or area.min_lat >= area.max_lat:
            return _f8_empty_response(payload, started_at, error=f"invalid {area_name} bounds")

    if not matched_trip_edges_exists():
        return _f8_empty_response(
            payload,
            started_at,
            error="matched_trip_edges table is missing or outdated; run data_scripts/build_matched_trip_edges.py --rebuild before using F8",
            logic_mode="precomputed_matched_trip_edges_required",
        )

    ensure_trip_od_cache()

    area_a_buffered = expand_bbox_by_meters(payload.area_a, payload.buffer_meters)
    area_b_buffered = expand_bbox_by_meters(payload.area_b, payload.buffer_meters)
    selected_start_hours = (
        sorted({int(hour) for hour in payload.start_hour_filter if 0 <= int(hour) <= 23})
        if payload.start_hour_filter
        else []
    )
    if payload.start_hour_filter and not selected_start_hours:
        return _f8_empty_response(payload, started_at, error="start_hour_filter must contain hours between 0 and 23")
    prefilter_start_hours = (
        sorted(set(selected_start_hours) | {((hour - 1) % 24) for hour in selected_start_hours})
        if selected_start_hours
        else list(range(24))
    )
    minute_filter_enabled = (
        payload.start_minute_filter_start is not None
        and payload.start_minute_filter_end is not None
    )
    start_minute_filter_start = int(payload.start_minute_filter_start or 0)
    start_minute_filter_end = int(payload.start_minute_filter_end or 0)
    effective_min_support = max(int(payload.min_support), 1)
    vector_min_edge_length_m = max(float(payload.min_edge_length_m), 20.0)
    major_road_min_length_m = max(200.0, vector_min_edge_length_m)
    stop_token_ratio = 0.9
    similarity_thresholds = [0.78, 0.7, 0.62, 0.55, 0.48, 0.42]
    skeleton_support_ratio = 0.35
    grid_step_degrees = 0.01
    use_precomputed_spatial_index = (
        payload.candidate_mode == "pass_through"
        and trip_spatial_index_exists()
        and trip_grid_points_exists()
    )
    area_a_grid_keys = _bbox_to_grid_keys(area_a_buffered, grid_step_degrees) if use_precomputed_spatial_index else []
    area_b_grid_keys = _bbox_to_grid_keys(area_b_buffered, grid_step_degrees) if use_precomputed_spatial_index else []
    route_vector_sql_suffix = """
        raw_edges AS (
            SELECT
                ct.taxi_id,
                ct.trip_id,
                ct.a_enter_time AS start_time,
                ct.b_enter_time AS end_time,
                EXTRACT(EPOCH FROM (ct.b_enter_time - ct.a_enter_time))::double precision AS duration_seconds,
                e.edge_seq,
                e.road_uid,
                COALESCE(NULLIF(BTRIM(r.highway), ''), '') AS highway_class,
                ST_Length(r.geometry::geography) AS segment_length_m,
                CASE
                    WHEN NULLIF(BTRIM(r.name), '') IS NULL THEN NULL
                    WHEN LOWER(BTRIM(r.name)) IN ('unnamed', 'unknown', 'null') THEN NULL
                    ELSE LOWER(
                        NULLIF(
                            BTRIM(
                                REGEXP_REPLACE(
                                    REGEXP_REPLACE(BTRIM(r.name), '\s+', '', 'g'),
                                    '(辅路|联络线|连接线|匝道|出口|入口|引路|高架桥|立交桥|东段|西段|南段|北段)$',
                                    '',
                                    'g'
                                )
                            ),
                            ''
                        )
                    )
                END AS road_group_key,
                r.geometry AS edge_geometry
            FROM candidate_trips_limited ct
            JOIN matched_trip_edges e
              ON e.taxi_id = ct.taxi_id
             AND e.trip_id = ct.trip_id
            JOIN road_edges r
              ON r.edge_uid = e.road_uid
        ),
        edge_hits AS (
            SELECT
                re.*,
                ST_Intersects(
                    re.edge_geometry,
                    ST_MakeEnvelope(:a_min_lon, :a_min_lat, :a_max_lon, :a_max_lat, 4326)
                ) AS in_a,
                ST_Intersects(
                    re.edge_geometry,
                    ST_MakeEnvelope(:b_min_lon, :b_min_lat, :b_max_lon, :b_max_lat, 4326)
                ) AS in_b
            FROM raw_edges re
        ),
        first_a AS (
            SELECT taxi_id, trip_id, MIN(edge_seq) AS a_seq
            FROM edge_hits
            WHERE in_a
            GROUP BY taxi_id, trip_id
        ),
        first_b_after_a AS (
            SELECT eh.taxi_id, eh.trip_id, MIN(eh.edge_seq) AS b_seq
            FROM edge_hits eh
            JOIN first_a fa
              ON fa.taxi_id = eh.taxi_id
             AND fa.trip_id = eh.trip_id
            WHERE eh.in_b
              AND eh.edge_seq > fa.a_seq
            GROUP BY eh.taxi_id, eh.trip_id
        ),
        ab_edges AS (
            SELECT eh.*
            FROM edge_hits eh
            JOIN first_a fa
              ON fa.taxi_id = eh.taxi_id
             AND fa.trip_id = eh.trip_id
            JOIN first_b_after_a fb
              ON fb.taxi_id = eh.taxi_id
             AND fb.trip_id = eh.trip_id
            WHERE eh.edge_seq BETWEEN fa.a_seq AND fb.b_seq
        ),
        route_lengths AS (
            SELECT
                taxi_id,
                trip_id,
                MIN(start_time) AS start_time,
                MIN(end_time) AS end_time,
                MIN(duration_seconds) AS duration_seconds,
                COUNT(*)::int AS raw_edge_count,
                SUM(segment_length_m)::double precision AS route_length_m
            FROM ab_edges
            GROUP BY taxi_id, trip_id
            HAVING SUM(segment_length_m) >= :min_route_length_m
        ),
        token_edges AS (
            SELECT
                ae.taxi_id,
                ae.trip_id,
                ae.edge_seq,
                CASE
                    WHEN ae.road_group_key IS NOT NULL
                     AND (
                         LOWER(ae.highway_class) IN ('motorway', 'trunk', 'primary', 'secondary')
                         OR ae.segment_length_m >= :major_road_min_length_m
                     )
                     AND ae.segment_length_m >= :vector_min_edge_length_m
                    THEN CONCAT('road:', ae.road_group_key)
                    WHEN ae.road_group_key IS NULL
                     AND LOWER(ae.highway_class) IN ('motorway', 'trunk', 'primary')
                     AND ae.segment_length_m >= :major_road_min_length_m
                    THEN CONCAT('edge:', ae.road_uid::text)
                    ELSE NULL
                END AS token_key
            FROM ab_edges ae
            JOIN route_lengths rl
              ON rl.taxi_id = ae.taxi_id
             AND rl.trip_id = ae.trip_id
        ),
        token_edges_filtered AS (
            SELECT *
            FROM token_edges
            WHERE token_key IS NOT NULL
        ),
        token_edges_dedup AS (
            SELECT
                tef.*,
                LAG(tef.token_key) OVER (
                    PARTITION BY tef.taxi_id, tef.trip_id
                    ORDER BY tef.edge_seq
                ) AS prev_token_key
            FROM token_edges_filtered tef
        ),
        sequence_tokens AS (
            SELECT
                taxi_id,
                trip_id,
                ARRAY_AGG(token_key ORDER BY edge_seq) AS sequence_token_array
            FROM token_edges_dedup
            WHERE prev_token_key IS DISTINCT FROM token_key
            GROUP BY taxi_id, trip_id
        ),
        vector_tokens_ordered AS (
            SELECT
                taxi_id,
                trip_id,
                token_key,
                MIN(edge_seq) AS first_edge_seq
            FROM token_edges_filtered
            GROUP BY taxi_id, trip_id, token_key
        ),
        vector_tokens AS (
            SELECT
                taxi_id,
                trip_id,
                ARRAY_AGG(token_key ORDER BY first_edge_seq) AS vector_token_array
            FROM vector_tokens_ordered
            GROUP BY taxi_id, trip_id
        )
        SELECT
            rl.taxi_id,
            rl.trip_id,
            rl.start_time,
            rl.end_time,
            rl.duration_seconds,
            rl.route_length_m,
            rl.raw_edge_count,
            vt.vector_token_array,
            st.sequence_token_array
        FROM route_lengths rl
        JOIN vector_tokens vt
          ON vt.taxi_id = rl.taxi_id
         AND vt.trip_id = rl.trip_id
        JOIN sequence_tokens st
          ON st.taxi_id = rl.taxi_id
         AND st.trip_id = rl.trip_id
        WHERE COALESCE(array_length(vt.vector_token_array, 1), 0) > 0
        ORDER BY rl.start_time ASC, rl.taxi_id ASC, rl.trip_id ASC
    """

    if use_precomputed_spatial_index:
        candidate_trip_stage_sql = text(
            """
            WITH time_window_trips AS (
                SELECT
                    od.taxi_id,
                    od.trip_id::bigint AS trip_id,
                    od.start_time,
                    od.end_time
                FROM trip_od_cache od
                WHERE od.start_time >= :start_time
                  AND od.end_time <= :end_time
                  AND (:hour_filter_enabled = false OR EXTRACT(HOUR FROM od.start_time)::int IN :prefilter_start_hours)
                  AND od.duration_seconds IS NOT NULL
                  AND od.duration_seconds > 0
                  AND od.trip_id ~ '^[0-9]+$'
            ),
            a_grid_hits AS (
                SELECT
                    si.taxi_id,
                    si.trip_id,
                    MIN(si.first_point_seq) AS a_point_seq
                FROM trip_spatial_index si
                JOIN time_window_trips tw
                  ON tw.taxi_id = si.taxi_id
                 AND tw.trip_id = si.trip_id
                WHERE si.grid_key IN :a_grid_keys
                GROUP BY si.taxi_id, si.trip_id
            ),
            b_grid_hits AS (
                SELECT
                    si.taxi_id,
                    si.trip_id,
                    MIN(si.first_point_seq) AS b_point_seq
                FROM trip_spatial_index si
                JOIN a_grid_hits ah
                  ON ah.taxi_id = si.taxi_id
                 AND ah.trip_id = si.trip_id
                WHERE si.grid_key IN :b_grid_keys
                  AND si.first_point_seq > ah.a_point_seq
                GROUP BY si.taxi_id, si.trip_id
            ),
            ordered_grid_hits AS (
                SELECT
                    tw.taxi_id,
                    tw.trip_id,
                    tw.start_time
                FROM time_window_trips tw
                JOIN a_grid_hits ah
                  ON ah.taxi_id = tw.taxi_id
                 AND ah.trip_id = tw.trip_id
                JOIN b_grid_hits bh
                  ON bh.taxi_id = tw.taxi_id
                 AND bh.trip_id = tw.trip_id
                WHERE bh.b_point_seq > ah.a_point_seq
                ORDER BY tw.start_time ASC, tw.taxi_id ASC, tw.trip_id ASC
                LIMIT :candidate_prefilter_limit
            ),
            precise_a_hits AS (
                SELECT
                    ogh.taxi_id,
                    ogh.trip_id,
                    ogh.start_time,
                    MIN(tp.point_seq) AS a_point_seq,
                    MIN(tp.gps_time) AS a_enter_time
                FROM ordered_grid_hits ogh
                JOIN trip_grid_points tp
                  ON tp.taxi_id = ogh.taxi_id
                 AND tp.trip_id = ogh.trip_id
                 AND tp.grid_key IN :a_grid_keys
                WHERE tp.lon >= :a_min_lon
                  AND tp.lon <= :a_max_lon
                  AND tp.lat >= :a_min_lat
                  AND tp.lat <= :a_max_lat
                GROUP BY ogh.taxi_id, ogh.trip_id, ogh.start_time
            ),
            precise_b_hits AS (
                SELECT
                    pah.taxi_id,
                    pah.trip_id,
                    pah.start_time,
                    MIN(tp.point_seq) AS b_point_seq,
                    MIN(tp.gps_time) AS b_enter_time
                FROM precise_a_hits pah
                JOIN trip_grid_points tp
                  ON tp.taxi_id = pah.taxi_id
                 AND tp.trip_id = pah.trip_id
                 AND tp.grid_key IN :b_grid_keys
                WHERE tp.point_seq > pah.a_point_seq
                  AND tp.gps_time > pah.a_enter_time
                  AND tp.lon >= :b_min_lon
                  AND tp.lon <= :b_max_lon
                  AND tp.lat >= :b_min_lat
                  AND tp.lat <= :b_max_lat
                GROUP BY pah.taxi_id, pah.trip_id, pah.start_time
            ),
            final_a_hits AS (
                SELECT
                    pbh.taxi_id,
                    pbh.trip_id,
                    pbh.start_time,
                    MAX(tp.point_seq) AS a_point_seq,
                    MAX(tp.gps_time) AS a_enter_time,
                    pbh.b_point_seq,
                    pbh.b_enter_time
                FROM precise_b_hits pbh
                JOIN trip_grid_points tp
                  ON tp.taxi_id = pbh.taxi_id
                 AND tp.trip_id = pbh.trip_id
                 AND tp.grid_key IN :a_grid_keys
                WHERE tp.point_seq < pbh.b_point_seq
                  AND tp.gps_time < pbh.b_enter_time
                  AND tp.lon >= :a_min_lon
                  AND tp.lon <= :a_max_lon
                  AND tp.lat >= :a_min_lat
                  AND tp.lat <= :a_max_lat
                GROUP BY pbh.taxi_id, pbh.trip_id, pbh.start_time, pbh.b_point_seq, pbh.b_enter_time
            ),
            precise_ab_candidates AS (
                SELECT
                    fah.taxi_id,
                    fah.trip_id,
                    fah.start_time,
                    fah.a_enter_time,
                    fah.b_enter_time,
                    EXTRACT(EPOCH FROM (fah.b_enter_time - fah.a_enter_time))::double precision AS duration_seconds
                FROM final_a_hits fah
                WHERE fah.b_enter_time > fah.a_enter_time
                  AND (:hour_filter_enabled = false OR EXTRACT(HOUR FROM fah.a_enter_time)::int IN :start_hour_filter)
                  AND (
                        :minute_filter_enabled = false
                        OR (
                            :minute_filter_start <= :minute_filter_end
                            AND ((EXTRACT(HOUR FROM fah.a_enter_time)::int * 60) + EXTRACT(MINUTE FROM fah.a_enter_time)::int)
                                BETWEEN :minute_filter_start AND :minute_filter_end
                        )
                        OR (
                            :minute_filter_start > :minute_filter_end
                            AND (
                                ((EXTRACT(HOUR FROM fah.a_enter_time)::int * 60) + EXTRACT(MINUTE FROM fah.a_enter_time)::int) >= :minute_filter_start
                                OR ((EXTRACT(HOUR FROM fah.a_enter_time)::int * 60) + EXTRACT(MINUTE FROM fah.a_enter_time)::int) <= :minute_filter_end
                            )
                        )
                  )
                  AND EXISTS (
                        SELECT 1
                        FROM matched_trip_edges e
                        WHERE e.taxi_id = fah.taxi_id
                          AND e.trip_id = fah.trip_id
                        LIMIT 1
                  )
            )
            SELECT
                taxi_id,
                trip_id,
                start_time,
                a_enter_time,
                b_enter_time,
                duration_seconds
            FROM precise_ab_candidates
            ORDER BY start_time ASC, taxi_id ASC, trip_id ASC
            LIMIT :max_candidate_trips
            """
        ).bindparams(
            bindparam("a_grid_keys", expanding=True),
            bindparam("b_grid_keys", expanding=True),
            bindparam("start_hour_filter", expanding=True),
            bindparam("prefilter_start_hours", expanding=True),
        )
        sampled_trip_sql = text(
            """
            WITH candidate_trips_limited AS (
                SELECT *
                FROM jsonb_to_recordset(CAST(:candidate_rows_json AS jsonb)) AS ct(
                    taxi_id bigint,
                    trip_id bigint,
                    start_time timestamp,
                    a_enter_time timestamp,
                    b_enter_time timestamp,
                    duration_seconds double precision
                )
            ),
        """
            + route_vector_sql_suffix
        )
    else:
        sampled_trip_sql = text(
            """
            WITH candidate_trips_raw AS (
                SELECT
                    od.taxi_id,
                    od.trip_id::bigint AS trip_id,
                    od.start_time,
                    od.end_time,
                    od.duration_seconds
                FROM trip_od_cache od
                WHERE od.start_time >= :start_time
                  AND od.end_time <= :end_time
                  AND (:hour_filter_enabled = false OR EXTRACT(HOUR FROM od.start_time)::int IN :prefilter_start_hours)
                  AND od.duration_seconds IS NOT NULL
                  AND od.duration_seconds > 0
                  AND od.trip_id ~ '^[0-9]+$'
                  AND (
                        (
                            :candidate_mode = 'strict_od'
                            AND ST_Intersects(
                                od.start_geom,
                                ST_MakeEnvelope(:a_min_lon, :a_min_lat, :a_max_lon, :a_max_lat, 4326)
                            )
                            AND ST_Intersects(
                                od.end_geom,
                                ST_MakeEnvelope(:b_min_lon, :b_min_lat, :b_max_lon, :b_max_lat, 4326)
                            )
                        )
                        OR
                        (
                            :candidate_mode = 'pass_through'
                            AND EXISTS (
                                SELECT 1
                                FROM taxi_points tpa
                                WHERE tpa.taxi_id = od.taxi_id
                                  AND tpa.trip_id = od.trip_id
                                  AND tpa.gps_time >= :start_time
                                  AND tpa.gps_time <= :end_time
                                  AND ST_Intersects(
                                      tpa.geom,
                                      ST_MakeEnvelope(:a_min_lon, :a_min_lat, :a_max_lon, :a_max_lat, 4326)
                                  )
                            )
                            AND EXISTS (
                                SELECT 1
                                FROM taxi_points tpb
                                WHERE tpb.taxi_id = od.taxi_id
                                  AND tpb.trip_id = od.trip_id
                                  AND tpb.gps_time >= :start_time
                                  AND tpb.gps_time <= :end_time
                                  AND ST_Intersects(
                                      tpb.geom,
                                      ST_MakeEnvelope(:b_min_lon, :b_min_lat, :b_max_lon, :b_max_lat, 4326)
                                  )
                                  AND tpb.gps_time > (
                                      SELECT MIN(tpa2.gps_time)
                                      FROM taxi_points tpa2
                                      WHERE tpa2.taxi_id = od.taxi_id
                                        AND tpa2.trip_id = od.trip_id
                                        AND tpa2.gps_time >= :start_time
                                        AND tpa2.gps_time <= :end_time
                                        AND ST_Intersects(
                                            tpa2.geom,
                                            ST_MakeEnvelope(:a_min_lon, :a_min_lat, :a_max_lon, :a_max_lat, 4326)
                                        )
                                  )
                            )
                        )
                  )
                  AND EXISTS (
                        SELECT 1
                        FROM matched_trip_edges e
                        WHERE e.taxi_id = od.taxi_id
                          AND e.trip_id = od.trip_id::bigint
                        LIMIT 1
                  )
                ORDER BY od.start_time ASC, od.taxi_id ASC, od.trip_id ASC
                LIMIT :max_candidate_trips
            ),
            point_hits AS (
                SELECT
                    ct.taxi_id,
                    ct.trip_id,
                    MIN(CASE
                        WHEN tp.lon >= :a_min_lon
                         AND tp.lon <= :a_max_lon
                         AND tp.lat >= :a_min_lat
                         AND tp.lat <= :a_max_lat
                        THEN tp.gps_time
                    END) AS a_enter_time
                FROM candidate_trips_raw ct
                JOIN trip_grid_points tp
                  ON tp.taxi_id = ct.taxi_id
                 AND tp.trip_id = ct.trip_id
                 AND tp.grid_key IN :a_grid_keys
                GROUP BY ct.taxi_id, ct.trip_id
            ),
            point_hits_with_b AS (
                SELECT
                    ct.taxi_id,
                    ct.trip_id,
                    ph.a_enter_time,
                    MIN(tp.gps_time) AS b_enter_time
                FROM candidate_trips_raw ct
                JOIN point_hits ph
                  ON ph.taxi_id = ct.taxi_id
                 AND ph.trip_id = ct.trip_id
                JOIN trip_grid_points tp
                  ON tp.taxi_id = ct.taxi_id
                 AND tp.trip_id = ct.trip_id
                 AND tp.gps_time > ph.a_enter_time
                 AND tp.grid_key IN :b_grid_keys
                WHERE ph.a_enter_time IS NOT NULL
                  AND tp.lon >= :b_min_lon
                  AND tp.lon <= :b_max_lon
                  AND tp.lat >= :b_min_lat
                  AND tp.lat <= :b_max_lat
                GROUP BY ct.taxi_id, ct.trip_id, ph.a_enter_time
            ),
            candidate_trips_limited AS (
                SELECT
                    ct.taxi_id,
                    ct.trip_id,
                    ct.start_time,
                    phb.a_enter_time,
                    phb.b_enter_time,
                    EXTRACT(EPOCH FROM (phb.b_enter_time - phb.a_enter_time))::double precision AS duration_seconds
                FROM candidate_trips_raw ct
                JOIN point_hits_with_b phb
                  ON phb.taxi_id = ct.taxi_id
                 AND phb.trip_id = ct.trip_id
                WHERE phb.b_enter_time > phb.a_enter_time
                  AND (:hour_filter_enabled = false OR EXTRACT(HOUR FROM phb.a_enter_time)::int IN :start_hour_filter)
                  AND (
                        :minute_filter_enabled = false
                        OR (
                            :minute_filter_start <= :minute_filter_end
                            AND ((EXTRACT(HOUR FROM phb.a_enter_time)::int * 60) + EXTRACT(MINUTE FROM phb.a_enter_time)::int)
                                BETWEEN :minute_filter_start AND :minute_filter_end
                        )
                        OR (
                            :minute_filter_start > :minute_filter_end
                            AND (
                                ((EXTRACT(HOUR FROM phb.a_enter_time)::int * 60) + EXTRACT(MINUTE FROM phb.a_enter_time)::int) >= :minute_filter_start
                                OR ((EXTRACT(HOUR FROM phb.a_enter_time)::int * 60) + EXTRACT(MINUTE FROM phb.a_enter_time)::int) <= :minute_filter_end
                            )
                        )
                  )
                ORDER BY ct.start_time ASC, ct.taxi_id ASC, ct.trip_id ASC
                LIMIT :max_candidate_trips
            ),
        """
            + route_vector_sql_suffix
        ).bindparams(
            bindparam("a_grid_keys", expanding=True),
            bindparam("b_grid_keys", expanding=True),
            bindparam("start_hour_filter", expanding=True),
            bindparam("prefilter_start_hours", expanding=True),
        )

    params = {
        "start_time": payload.start_time,
        "end_time": payload.end_time,
        "a_min_lon": area_a_buffered["min_lon"],
        "a_min_lat": area_a_buffered["min_lat"],
        "a_max_lon": area_a_buffered["max_lon"],
        "a_max_lat": area_a_buffered["max_lat"],
        "b_min_lon": area_b_buffered["min_lon"],
        "b_min_lat": area_b_buffered["min_lat"],
        "b_max_lon": area_b_buffered["max_lon"],
        "b_max_lat": area_b_buffered["max_lat"],
        "candidate_mode": payload.candidate_mode,
        "max_candidate_trips": payload.max_candidate_trips,
        "candidate_prefilter_limit": min(max(payload.max_candidate_trips * 5, payload.max_candidate_trips + 1000), 50000),
        "min_route_length_m": payload.min_route_length_m,
        "vector_min_edge_length_m": vector_min_edge_length_m,
        "major_road_min_length_m": major_road_min_length_m,
        "hour_filter_enabled": bool(selected_start_hours),
        "start_hour_filter": selected_start_hours or list(range(24)),
        "prefilter_start_hours": prefilter_start_hours,
        "minute_filter_enabled": minute_filter_enabled,
        "minute_filter_start": start_minute_filter_start,
        "minute_filter_end": start_minute_filter_end,
    }
    params["a_grid_keys"] = area_a_grid_keys or _bbox_to_grid_keys(area_a_buffered, grid_step_degrees)
    params["b_grid_keys"] = area_b_grid_keys or _bbox_to_grid_keys(area_b_buffered, grid_step_degrees)

    debug_counts: dict[str, int | str | bool] = {
        "use_precomputed_spatial_index": use_precomputed_spatial_index,
        "debug_counts_enabled": payload.include_debug_counts,
    }
    if payload.include_debug_counts and payload.candidate_mode == "pass_through" and use_precomputed_spatial_index:
        debug_sql = text(
            """
            WITH time_window_trips AS (
                SELECT
                    od.taxi_id,
                    od.trip_id::bigint AS trip_id
                FROM trip_od_cache od
                WHERE od.start_time >= :start_time
                  AND od.end_time <= :end_time
                  AND od.duration_seconds IS NOT NULL
                  AND od.duration_seconds > 0
                  AND od.trip_id ~ '^[0-9]+$'
            ),
            a_grid_hits AS (
                SELECT
                    si.taxi_id,
                    si.trip_id,
                    MIN(si.first_point_seq) AS a_point_seq,
                    MIN(si.first_seen_time) AS a_enter_time
                FROM trip_spatial_index si
                JOIN time_window_trips tw
                  ON tw.taxi_id = si.taxi_id
                 AND tw.trip_id = si.trip_id
                WHERE si.grid_key IN :a_grid_keys
                GROUP BY si.taxi_id, si.trip_id
            ),
            b_grid_hits AS (
                SELECT
                    si.taxi_id,
                    si.trip_id,
                    MIN(si.first_point_seq) AS b_point_seq,
                    MIN(si.first_seen_time) AS b_enter_time
                FROM trip_spatial_index si
                JOIN time_window_trips tw
                  ON tw.taxi_id = si.taxi_id
                 AND tw.trip_id = si.trip_id
                WHERE si.grid_key IN :b_grid_keys
                GROUP BY si.taxi_id, si.trip_id
            ),
            ordered_grid_hits AS (
                SELECT
                    ah.taxi_id,
                    ah.trip_id
                FROM a_grid_hits ah
                JOIN b_grid_hits bh
                  ON bh.taxi_id = ah.taxi_id
                 AND bh.trip_id = ah.trip_id
                WHERE bh.b_enter_time > ah.a_enter_time
                  AND bh.b_point_seq > ah.a_point_seq
            ),
            matched_edge_trips AS (
                SELECT ogh.taxi_id, ogh.trip_id
                FROM ordered_grid_hits ogh
                WHERE EXISTS (
                    SELECT 1
                    FROM matched_trip_edges e
                    WHERE e.taxi_id = ogh.taxi_id
                      AND e.trip_id = ogh.trip_id
                    LIMIT 1
                )
            ),
            precise_ab_hits AS (
                SELECT
                    ct.taxi_id,
                    ct.trip_id
                FROM matched_edge_trips ct
                JOIN matched_trip_edges e
                  ON e.taxi_id = ct.taxi_id
                 AND e.trip_id = ct.trip_id
                JOIN road_edges r
                  ON r.edge_uid = e.road_uid
                GROUP BY ct.taxi_id, ct.trip_id
                HAVING MIN(CASE WHEN ST_Intersects(r.geometry, ST_MakeEnvelope(:a_min_lon, :a_min_lat, :a_max_lon, :a_max_lat, 4326)) THEN e.edge_seq END) IS NOT NULL
                   AND MIN(CASE WHEN ST_Intersects(r.geometry, ST_MakeEnvelope(:b_min_lon, :b_min_lat, :b_max_lon, :b_max_lat, 4326)) THEN e.edge_seq END) IS NOT NULL
                   AND MIN(CASE WHEN ST_Intersects(r.geometry, ST_MakeEnvelope(:b_min_lon, :b_min_lat, :b_max_lon, :b_max_lat, 4326)) THEN e.edge_seq END)
                       > MIN(CASE WHEN ST_Intersects(r.geometry, ST_MakeEnvelope(:a_min_lon, :a_min_lat, :a_max_lon, :a_max_lat, 4326)) THEN e.edge_seq END)
            )
            SELECT
                (SELECT COUNT(*) FROM time_window_trips) AS time_window_trip_count,
                (SELECT COUNT(*) FROM a_grid_hits) AS a_grid_hit_trip_count,
                (SELECT COUNT(*) FROM b_grid_hits) AS b_grid_hit_trip_count,
                (SELECT COUNT(*) FROM ordered_grid_hits) AS ordered_grid_trip_count,
                (SELECT COUNT(*) FROM matched_edge_trips) AS matched_edge_trip_count,
                (SELECT COUNT(*) FROM precise_ab_hits) AS precise_ab_trip_count
            """
        ).bindparams(bindparam("a_grid_keys", expanding=True), bindparam("b_grid_keys", expanding=True))
        try:
            with engine.connect() as conn:
                debug_row = conn.execute(debug_sql, params).mappings().first()
            if debug_row:
                debug_counts.update({key: int(value or 0) for key, value in debug_row.items()})
        except Exception as exc:
            debug_counts["debug_count_error"] = str(exc.__class__.__name__)

    phase_started_at = perf_counter()
    timing_ms: dict[str, float] = {}
    sampled_trip_rows: list = []
    cached_sampled_stage = _f8_read_cached_sampled_trip_stage(payload)
    if cached_sampled_stage is not None:
        sampled_trips = cached_sampled_stage["sampled_trips"]
        sampled_candidate_trip_count = int(cached_sampled_stage["sampled_candidate_trip_count"])
        sampled_trip_rows = [None] * sampled_candidate_trip_count
        candidate_trip_count = int(cached_sampled_stage["candidate_trip_count"])
        candidate_trip_count_is_limited = bool(cached_sampled_stage["candidate_trip_count_is_limited"])
        cached_timing_ms = cached_sampled_stage.get("timing_ms") or {}
        timing_ms.update(cached_timing_ms)
        skipped_timing_keys = [
            "candidate_trip_stage_sql",
            "sampled_trip_sql",
            "candidate_edge_sql",
            "road_metadata_sql",
            "python_subpath_tokenize",
            "python_row_normalize",
        ]
        timing_ms["sampled_trip_stage_cache_saved_ms"] = round(
            sum(float(cached_timing_ms.get(key) or 0.0) for key in skipped_timing_keys),
            2,
        )
        for timing_key in skipped_timing_keys:
            if timing_key in timing_ms:
                timing_ms[timing_key] = 0.0
        timing_ms["sampled_trip_stage_cache_hit"] = 1.0
    if cached_sampled_stage is None and use_precomputed_spatial_index:
        with engine.connect() as conn:
            phase_started_at = perf_counter()
            candidate_trip_rows = conn.execute(candidate_trip_stage_sql, params).mappings().all()
            timing_ms["candidate_trip_stage_sql"] = round((perf_counter() - phase_started_at) * 1000, 2)
        candidate_trip_count = (
            int(debug_counts.get("precise_ab_trip_count") or 0)
            if payload.include_debug_counts and debug_counts.get("precise_ab_trip_count") is not None
            else len(candidate_trip_rows)
        )
        candidate_trip_count_is_limited = not (
            payload.include_debug_counts and debug_counts.get("precise_ab_trip_count") is not None
        )
        sampled_trip_rows = list(candidate_trip_rows)
        sampled_trips, sampled_trip_build_timing_ms = _build_f8_sampled_trips_from_candidate_rows(
            candidate_rows=candidate_trip_rows,
            area_a_buffered=area_a_buffered,
            area_b_buffered=area_b_buffered,
            min_route_length_m=payload.min_route_length_m,
            vector_min_edge_length_m=vector_min_edge_length_m,
            major_road_min_length_m=major_road_min_length_m,
        )
        timing_ms.update(sampled_trip_build_timing_ms)
    elif cached_sampled_stage is None:
        with engine.connect() as conn:
            phase_started_at = perf_counter()
            sampled_trip_rows = conn.execute(sampled_trip_sql, params).mappings().all()
            timing_ms["sampled_trip_sql"] = round((perf_counter() - phase_started_at) * 1000, 2)
        candidate_trip_count = len(sampled_trip_rows)
        candidate_trip_count_is_limited = False
        phase_started_at = perf_counter()
        sampled_trips: list[dict] = []
        for row in sampled_trip_rows:
            sequence_tokens = _normalize_f8_token_sequence(
                [str(token) for token in list(row["sequence_token_array"] or []) if token]
            )
            vector_tokens = []
            seen_vector_tokens: set[str] = set()
            for token in _normalize_f8_token_sequence(
                [str(token) for token in list(row["vector_token_array"] or []) if token]
            ):
                if token not in seen_vector_tokens:
                    seen_vector_tokens.add(token)
                    vector_tokens.append(token)
            if not vector_tokens:
                continue
            sampled_trips.append(
                {
                    "taxi_id": int(row["taxi_id"]),
                    "trip_id": int(row["trip_id"]),
                    "start_time": row["start_time"],
                    "end_time": row["end_time"],
                    "duration_seconds": float(row["duration_seconds"] or 0.0),
                    "route_length_m": float(row["route_length_m"] or 0.0),
                    "raw_edge_count": int(row["raw_edge_count"] or 0),
                    "vector_tokens": vector_tokens,
                    "sequence_tokens": sequence_tokens or vector_tokens,
                }
            )
        timing_ms["python_row_normalize"] = round((perf_counter() - phase_started_at) * 1000, 2)

    if cached_sampled_stage is None:
        _f8_write_cached_sampled_trip_stage(
            payload,
            {
                "sampled_trips": sampled_trips,
                "sampled_candidate_trip_count": len(sampled_trip_rows),
                "candidate_trip_count": candidate_trip_count,
                "candidate_trip_count_is_limited": candidate_trip_count_is_limited,
                "timing_ms": dict(timing_ms),
            },
        )
        timing_ms["sampled_trip_stage_cache_hit"] = 0.0

    raw_valid_ab_trip_count = len(sampled_trips)
    duration_values_seconds = [
        float(trip["duration_seconds"])
        for trip in sampled_trips
        if float(trip.get("duration_seconds") or 0.0) > 0
    ]
    duration_p50_seconds = _percentile(duration_values_seconds, 0.5)
    duration_outlier_cutoff_seconds = (
        max(float(duration_p50_seconds) * 3.0, 1800.0)
        if duration_p50_seconds is not None
        else None
    )
    duration_filtered_out_count = 0
    duration_filter_applied = False
    if duration_outlier_cutoff_seconds is not None and len(sampled_trips) >= 20:
        duration_filtered_trips = [
            trip
            for trip in sampled_trips
            if 0 < float(trip.get("duration_seconds") or 0.0) <= duration_outlier_cutoff_seconds
        ]
        if len(duration_filtered_trips) >= max(1, effective_min_support):
            duration_filtered_out_count = len(sampled_trips) - len(duration_filtered_trips)
            duration_filter_applied = duration_filtered_out_count > 0
            sampled_trips = duration_filtered_trips
    valid_ab_trip_count = len(sampled_trips)
    timing_ms["duration_outlier_filtered_trip_count"] = float(duration_filtered_out_count)
    timing_ms["duration_outlier_cutoff_seconds"] = round(float(duration_outlier_cutoff_seconds or 0.0), 2)
    if valid_ab_trip_count == 0:
        return _f8_empty_response(
            payload,
            started_at,
            area_a_buffered=area_a_buffered,
            area_b_buffered=area_b_buffered,
            candidate_trip_count=candidate_trip_count,
            sampled_candidate_trip_count=0,
            valid_ab_trip_count=0,
            logic_mode="ab_subpath_vector_cluster",
            extra_meta={
                "empty_reason": "no_valid_ab_trip_after_vectorization",
                "timing_ms": timing_ms,
                "trip_duration_filter_applied": duration_filter_applied,
                "raw_valid_ab_trip_count": raw_valid_ab_trip_count,
                "duration_outlier_filtered_trip_count": duration_filtered_out_count,
                "duration_outlier_cutoff_seconds": duration_outlier_cutoff_seconds,
                "vector_min_edge_length_m": vector_min_edge_length_m,
                "major_road_min_length_m": major_road_min_length_m,
                "similarity_threshold_ladder": similarity_thresholds,
                "debug_counts": debug_counts,
            },
        )

    phase_started_at = perf_counter()
    doc_freq = Counter(token for trip in sampled_trips for token in set(trip["vector_tokens"]))
    max_df = max(2, int(math.ceil(valid_ab_trip_count * stop_token_ratio)))
    for trip in sampled_trips:
        filtered = [token for token in trip["vector_tokens"] if doc_freq[token] <= max_df]
        trip["vector_tokens_filtered"] = filtered or trip["vector_tokens"]
        trip["vector_token_set"] = set(trip["vector_tokens_filtered"])
    timing_ms["token_stopword_filter"] = round((perf_counter() - phase_started_at) * 1000, 2)

    phase_started_at = perf_counter()
    cluster_result = _build_f8_similarity_clusters(
        sampled_trips=sampled_trips,
        thresholds=similarity_thresholds,
        min_support=effective_min_support,
        top_k=payload.top_k,
    )
    timing_ms["jaccard_cluster"] = round((perf_counter() - phase_started_at) * 1000, 2)

    phase_started_at = perf_counter()
    macro_parent_clusters = list(cluster_result.get("clusters") or [])
    macro_cluster_covered_trip_count = sum(len(cluster["member_indices"]) for cluster in macro_parent_clusters)
    max_parent_cluster_trip_count = max((len(cluster["member_indices"]) for cluster in macro_parent_clusters), default=0)
    for parent_rank, cluster in enumerate(macro_parent_clusters, start=1):
        cluster["parent_cluster_id"] = f"c{parent_rank}"
        cluster["subcluster_id"] = None
        cluster["split_mode"] = "macro_recall_parent"
        cluster["share_of_parent_cluster"] = 1.0
    cluster_result["clusters"] = macro_parent_clusters
    cluster_result = _split_f8_clusters_by_ordered_features(
        cluster_result=cluster_result,
        sampled_trips=sampled_trips,
        min_support=effective_min_support,
        top_k=payload.top_k,
        total_trip_count=valid_ab_trip_count,
    )
    cluster_result.update(
        {
            "macro_recall_baseline_enabled": False,
            "non_destructive_micro_split_enabled": True,
            "macro_cluster_covered_trip_count": macro_cluster_covered_trip_count,
            "macro_cluster_coverage_ratio": (
                macro_cluster_covered_trip_count / valid_ab_trip_count if valid_ab_trip_count > 0 else 0
            ),
            "max_parent_cluster_trip_count": max_parent_cluster_trip_count,
            "max_parent_cluster_ratio": (
                max_parent_cluster_trip_count / valid_ab_trip_count if valid_ab_trip_count > 0 else 0
            ),
        }
    )
    timing_ms["ordered_subcluster_split"] = round((perf_counter() - phase_started_at) * 1000, 2)

    ranked_clusters = cluster_result["clusters"]
    selected_threshold = cluster_result["threshold"]
    total_ranked_trip_count = sum(len(cluster["member_indices"]) for cluster in ranked_clusters)
    geometry_cluster_scan_limit = min(
        len(ranked_clusters),
        max(payload.top_k * 40, payload.top_k + 160),
        360,
    )
    representative_trip_indices = sorted(
        {
            candidate["trip_index"]
            for cluster in ranked_clusters[:geometry_cluster_scan_limit]
            for candidate in cluster.get("representative_candidates", [])
        }
    )
    phase_started_at = perf_counter()
    geometry_by_trip = _fetch_f8_cluster_geometries(
        ranked_trips=[sampled_trips[idx] for idx in representative_trip_indices],
        area_a_buffered=area_a_buffered,
        area_b_buffered=area_b_buffered,
    )
    timing_ms["medoid_geometry_sql"] = round((perf_counter() - phase_started_at) * 1000, 2)
    timing_ms["representative_geometry_candidate_count"] = float(len(representative_trip_indices))

    phase_started_at = perf_counter()
    corridors: list[dict] = []
    fallback_corridors: list[dict] = []
    routes: list[dict] = []
    max_trip_count = 0
    scanned_corridor_trip_count = 0
    selected_corridor_signatures: set[str] = set()

    skipped_geometryless_clusters = 0
    skipped_duplicate_signature_clusters = 0
    geometry_merged_clusters = 0
    skipped_unhealthy_representative_clusters = 0
    for cluster in ranked_clusters[:geometry_cluster_scan_limit]:
        members = [sampled_trips[idx] for idx in cluster["member_indices"]]
        trip_count = len(members)
        vehicle_count = len({member["taxi_id"] for member in members})
        max_trip_count = max(max_trip_count, trip_count)

        token_counter: Counter[str] = Counter()
        position_sum: defaultdict[str, float] = defaultdict(float)
        position_count: defaultdict[str, int] = defaultdict(int)
        variant_groups: dict[str, list[dict]] = defaultdict(list)
        duration_values_min: list[float] = []
        route_lengths_m: list[float] = []
        hourly_duration_buckets: defaultdict[str, list[float]] = defaultdict(list)

        for member in members:
            seen: set[str] = set()
            ordered_unique_tokens: list[str] = []
            for token in member["sequence_tokens"]:
                if token not in seen:
                    seen.add(token)
                    ordered_unique_tokens.append(token)
            for position, token in enumerate(ordered_unique_tokens):
                token_counter[token] += 1
                position_sum[token] += position
                position_count[token] += 1

            variant_signature = " > ".join(_format_f8_token(token) for token in member["sequence_tokens"])
            variant_groups[variant_signature].append(member)
            duration_min = member["duration_seconds"] / 60.0 if member["duration_seconds"] else 0.0
            duration_values_min.append(duration_min)
            route_lengths_m.append(member["route_length_m"])
            if member["start_time"] is not None:
                hourly_duration_buckets[member["start_time"].strftime("%H")].append(duration_min)

        support_cutoff = max(1, math.ceil(trip_count * skeleton_support_ratio))
        skeleton_tokens = [
            token
            for token in sorted(
                token_counter.keys(),
                key=lambda token: (
                    position_sum[token] / max(position_count[token], 1),
                    -token_counter[token],
                    token,
                ),
            )
            if token_counter[token] >= support_cutoff
        ]
        if not skeleton_tokens:
            skeleton_tokens = [
                token
                for token, _ in sorted(
                    token_counter.items(),
                    key=lambda item: (-item[1], position_sum[item[0]] / max(position_count[item[0]], 1), item[0]),
                )[:8]
            ]

        representative_selection = _select_f8_quality_representative(
            cluster.get("representative_candidates", []),
            sampled_trips=sampled_trips,
            geometry_by_trip=geometry_by_trip,
            cluster_duration_p50_seconds=cluster.get("duration_p50_seconds"),
            cluster_route_p50_m=cluster.get("route_p50_m"),
        )
        if representative_selection is None:
            skipped_geometryless_clusters += 1
            continue
        medoid_trip = representative_selection["trip"]
        geometry = representative_selection["geometry"]
        representative_score = representative_selection["score"]
        representative_quality_score = representative_selection["quality_score"]
        representative_fallback_rank = representative_selection["fallback_rank"]
        quality_metrics = representative_selection["quality_metrics"]
        if not geometry:
            skipped_geometryless_clusters += 1
            continue
        representative_directness = quality_metrics.get("directness_ratio")
        representative_repeat_ratio = float(quality_metrics.get("repeat_point_ratio") or 0.0)
        duration_p20_min = _percentile(duration_values_min, 0.2)
        duration_p50_min = _percentile(duration_values_min, 0.5)
        duration_p90_min = _percentile(duration_values_min, 0.9)
        duration_tail_ratio = (
            float(duration_p90_min) / float(duration_p50_min)
            if duration_p50_min is not None and duration_p50_min > 1 and duration_p90_min is not None
            else None
        )
        drop_reasons = _f8_corridor_drop_reasons(
            representative_quality_score=representative_quality_score,
            representative_fallback_rank=representative_fallback_rank,
            directness_ratio=representative_directness,
            repeat_point_ratio=representative_repeat_ratio,
            duration_tail_ratio=duration_tail_ratio,
        )
        fatal_drop_reasons = _f8_corridor_fatal_drop_reasons(
            representative_quality_score=representative_quality_score,
            directness_ratio=representative_directness,
            repeat_point_ratio=representative_repeat_ratio,
            duration_tail_ratio=duration_tail_ratio,
        )
        if fatal_drop_reasons:
            skipped_unhealthy_representative_clusters += 1
            continue
        durations_by_hour = {
            hour_bucket: round(sum(values) / len(values), 2)
            for hour_bucket, values in sorted(hourly_duration_buckets.items())
            if values
        }
        duration_samples_by_hour = {
            hour_bucket: [round(float(value), 4) for value in values]
            for hour_bucket, values in sorted(hourly_duration_buckets.items())
            if values
        }
        trip_count_by_hour = {
            hour_bucket: len(values)
            for hour_bucket, values in sorted(hourly_duration_buckets.items())
            if values
        }

        normalized_variants = []
        for variant_signature, variant_members in sorted(
            variant_groups.items(),
            key=lambda item: (-len(item[1]), item[0]),
        )[:8]:
            variant_durations = [member["duration_seconds"] / 60.0 for member in variant_members]
            normalized_variants.append(
                {
                    "variant_signature": variant_signature,
                    "variant_signature_array": variant_signature.split(" > ") if variant_signature else [],
                    "trip_count": len(variant_members),
                    "vehicle_count": len({member["taxi_id"] for member in variant_members}),
                    "avg_duration_min": (
                        round(sum(variant_durations) / len(variant_durations), 2) if variant_durations else None
                    ),
                    "p50_duration_min": _percentile(variant_durations, 0.5),
                    "p90_duration_min": _percentile(variant_durations, 0.9),
                    "share_within_corridor": (len(variant_members) / trip_count) if trip_count > 0 else 0,
                    "_duration_values_min": variant_durations,
                    "geometry": geometry,
                }
            )

        corridor_signature = " > ".join(_format_f8_token(token) for token in skeleton_tokens)
        corridor_signature_array = [_format_f8_token(token) for token in skeleton_tokens]
        split_mode = str(cluster.get("split_mode") or "jaccard_parent")
        dedupe_signature = (
            f"{cluster.get('parent_cluster_id')}:{cluster.get('subcluster_id')}:{corridor_signature}"
            if split_mode.startswith(("dominant_", "anchor_"))
            else corridor_signature
        )
        if dedupe_signature in selected_corridor_signatures:
            skipped_duplicate_signature_clusters += 1
            continue
        merge_target = (
            None
            if split_mode.startswith(("dominant_", "anchor_"))
            else _find_f8_similar_corridor(corridors + fallback_corridors, corridor_signature_array, geometry)
        )
        if merge_target is not None:
            skipped_duplicate_signature_clusters += 1
            geometry_merged_clusters += 1
            scanned_corridor_trip_count += trip_count
            _merge_f8_corridor_cluster(
                merge_target,
                trip_count=trip_count,
                taxi_ids={member["taxi_id"] for member in members},
                duration_values_min=duration_values_min,
                duration_samples_by_hour=duration_samples_by_hour,
                route_lengths_m=route_lengths_m,
                variant_groups=variant_groups,
                valid_ab_trip_count=valid_ab_trip_count,
            )
            max_trip_count = max(max_trip_count, int(merge_target.get("trip_count") or 0))
            continue
        if len(corridors) + len(fallback_corridors) >= max(payload.top_k * 4, payload.top_k + 10):
            continue
        rank = len(corridors) + 1
        scanned_corridor_trip_count += trip_count
        avg_duration = round(sum(duration_values_min) / len(duration_values_min), 2) if duration_values_min else None
        avg_route_length = round(sum(route_lengths_m) / len(route_lengths_m), 2) if route_lengths_m else 0.0
        route_length_m = float(medoid_trip["route_length_m"] or 0.0)

        corridor = {
            "rank": rank,
            "corridor_signature": corridor_signature,
            "corridor_signature_array": corridor_signature_array,
            "_geometry_grid_signature": _f8_geometry_grid_signature(geometry),
            "_geometry_bbox": _f8_geometry_bbox(geometry),
            "_member_taxi_ids": {member["taxi_id"] for member in members},
            "_duration_values_min": duration_values_min,
            "_route_lengths_m": route_lengths_m,
            "trip_count": trip_count,
            "vehicle_count": vehicle_count,
            "share_of_candidates": (trip_count / valid_ab_trip_count) if valid_ab_trip_count > 0 else 0,
            "avg_duration_min": avg_duration,
            "p20_duration_min": duration_p20_min,
            "p50_duration_min": duration_p50_min,
            "p90_duration_min": duration_p90_min,
            "duration_tail_ratio": round(duration_tail_ratio, 3) if duration_tail_ratio is not None else None,
            "avg_route_length_m": avg_route_length,
            "route_length_m": route_length_m,
            "edge_count": len(skeleton_tokens),
            "durations_by_hour": durations_by_hour,
            "duration_samples_by_hour": duration_samples_by_hour,
            "trip_count_by_hour": trip_count_by_hour,
            "geometry": geometry,
            "representative_taxi_id": medoid_trip["taxi_id"],
            "representative_trip_id": medoid_trip["trip_id"],
            "representative_trip_score": round(representative_score, 4),
            "representative_quality_score": round(representative_quality_score, 4),
            "representative_fallback_rank": representative_fallback_rank,
            "cluster_similarity_threshold": selected_threshold,
            "parent_cluster_id": cluster.get("parent_cluster_id"),
            "subcluster_id": cluster.get("subcluster_id"),
            "split_mode": split_mode,
            "share_of_parent_cluster": cluster.get("share_of_parent_cluster", 1.0),
            "quality_metrics": quality_metrics,
            "quality_tier": "low_confidence" if drop_reasons else "high_confidence",
            "quality_warnings": drop_reasons,
            "variants": normalized_variants,
        }
        (fallback_corridors if drop_reasons else corridors).append(corridor)
        selected_corridor_signatures.add(dedupe_signature)
    high_confidence_count = len(corridors)
    candidate_corridors = corridors + fallback_corridors
    for corridor in candidate_corridors:
        corridor["_ranking_score"] = _f8_corridor_ranking_score(corridor)
    display_safe_corridors = [
        corridor
        for corridor in candidate_corridors
        if _f8_corridor_is_default_display_safe(corridor)
    ]
    if 0 < len(display_safe_corridors) < payload.top_k:
        safe_ids = {id(corridor) for corridor in display_safe_corridors}
        fill_corridors = [
            corridor
            for corridor in candidate_corridors
            if id(corridor) not in safe_ids and _f8_corridor_is_marginal_display_fill(corridor)
        ]
        fill_corridors.sort(
            key=lambda corridor: (
                -float(corridor.get("_ranking_score") or 0.0),
                -int(corridor.get("trip_count") or 0),
                int(corridor.get("rank") or 0),
            )
        )
        for corridor in fill_corridors[: max(0, payload.top_k - len(display_safe_corridors))]:
            corridor["quality_tier"] = "low_confidence_fill"
            warnings = list(corridor.get("quality_warnings") or [])
            if "marginal_display_fill" not in warnings:
                warnings.append("marginal_display_fill")
            corridor["quality_warnings"] = warnings
            display_safe_corridors.append(corridor)
    if 0 < len(display_safe_corridors) < payload.top_k:
        selected_ids = {id(corridor) for corridor in display_safe_corridors}
        diagnostic_fill_corridors = [
            corridor
            for corridor in candidate_corridors
            if id(corridor) not in selected_ids and _f8_corridor_is_diagnostic_display_fill(corridor)
        ]
        diagnostic_fill_corridors.sort(
            key=lambda corridor: (
                -float(corridor.get("_ranking_score") or 0.0),
                -int(corridor.get("trip_count") or 0),
                int(corridor.get("rank") or 0),
            )
        )
        for corridor in diagnostic_fill_corridors[: max(0, payload.top_k - len(display_safe_corridors))]:
            corridor["quality_tier"] = "low_confidence_fill"
            warnings = list(corridor.get("quality_warnings") or [])
            if "diagnostic_display_fill" not in warnings:
                warnings.append("diagnostic_display_fill")
            corridor["quality_warnings"] = warnings
            display_safe_corridors.append(corridor)
    if 0 < len(display_safe_corridors) < payload.top_k:
        selected_ids = {id(corridor) for corridor in display_safe_corridors}
        support_fill_corridors = [
            corridor
            for corridor in candidate_corridors
            if id(corridor) not in selected_ids
            and _f8_corridor_is_support_backfill_allowed(corridor)
        ]
        support_fill_corridors.sort(
            key=lambda corridor: (
                0 if str(corridor.get("split_mode") or "").startswith(("dominant_", "anchor_")) else 1,
                -float(corridor.get("_ranking_score") or 0.0),
                -int(corridor.get("trip_count") or 0),
                int(corridor.get("rank") or 0),
            )
        )
        for corridor in support_fill_corridors[: max(0, payload.top_k - len(display_safe_corridors))]:
            corridor["quality_tier"] = "low_support_fill"
            warnings = list(corridor.get("quality_warnings") or [])
            if "top_k_low_support_backfill" not in warnings:
                warnings.append("top_k_low_support_backfill")
            corridor["quality_warnings"] = warnings
            display_safe_corridors.append(corridor)
    suppressed_low_display_quality_count = len(candidate_corridors) - len(display_safe_corridors)
    if display_safe_corridors:
        candidate_corridors = display_safe_corridors
    if 0 < len(candidate_corridors) < payload.top_k:
        candidate_corridors.extend(
            _build_f8_single_trip_backfill_corridors(
                ranked_clusters=ranked_clusters[:geometry_cluster_scan_limit],
                sampled_trips=sampled_trips,
                geometry_by_trip=geometry_by_trip,
                existing_corridors=candidate_corridors,
                valid_ab_trip_count=valid_ab_trip_count,
                limit=payload.top_k - len(candidate_corridors),
            )
        )
    for corridor in candidate_corridors:
        corridor["_ranking_score"] = _f8_corridor_ranking_score(corridor)
    candidate_corridors.sort(
        key=lambda corridor: (
            -float(corridor.get("_ranking_score") or 0.0),
            -int(corridor.get("trip_count") or 0),
            int(corridor.get("rank") or 0),
        )
    )
    corridors = _select_f8_diverse_top_k_corridors(candidate_corridors, top_k=payload.top_k)
    top_k_trip_count = sum(int(corridor.get("trip_count") or 0) for corridor in corridors)
    max_trip_count = max((int(corridor.get("trip_count") or 0) for corridor in corridors), default=0)
    routes = []
    for rank, corridor in enumerate(corridors, start=1):
        corridor["rank"] = rank
        corridor["ranking_score"] = round(float(corridor.get("_ranking_score") or 0.0), 4)
        routes.append(_f8_route_from_corridor(corridor))
    for corridor in corridors:
        _strip_f8_internal_corridor_fields(corridor)
    timing_ms["response_assembly"] = round((perf_counter() - phase_started_at) * 1000, 2)
    timing_ms["geometry_cluster_scan_limit"] = float(geometry_cluster_scan_limit)
    timing_ms["scanned_corridor_trip_count"] = float(scanned_corridor_trip_count)
    timing_ms["suppressed_low_display_quality_count"] = float(suppressed_low_display_quality_count)
    timing_ms["skipped_geometryless_clusters"] = float(skipped_geometryless_clusters)
    timing_ms["skipped_duplicate_signature_clusters"] = float(skipped_duplicate_signature_clusters)
    timing_ms["geometry_merged_cluster_count"] = float(geometry_merged_clusters)
    timing_ms["skipped_unhealthy_representative_clusters"] = float(skipped_unhealthy_representative_clusters)
    timing_ms["high_confidence_corridor_count"] = float(high_confidence_count)
    timing_ms["low_confidence_fill_count"] = float(
        sum(1 for corridor in corridors if str(corridor.get("quality_tier") or "").startswith("low_confidence"))
    )
    timing_ms["low_support_fill_count"] = float(
        sum(1 for corridor in corridors if corridor.get("quality_tier") == "low_support_fill")
    )

    elapsed_ms = round((perf_counter() - started_at) * 1000, 2)
    logger.info(
        "F8 vector result candidate_trip_count=%s sampled_candidate_trip_count=%s valid_ab_trip_count=%s "
        "route_count=%s top_k_trip_count=%s threshold=%s macro_coverage=%.4f max_parent_ratio=%.4f "
        "max_parent_trip_count=%s elapsed_ms=%s timing_ms=%s unique_token_set_count=%s "
        "similarity_pair_count=%s debug_counts=%s",
        candidate_trip_count,
        len(sampled_trip_rows),
        valid_ab_trip_count,
        len(routes),
        top_k_trip_count,
        selected_threshold,
        float(cluster_result.get("macro_cluster_coverage_ratio") or 0.0),
        float(cluster_result.get("max_parent_cluster_ratio") or 0.0),
        int(cluster_result.get("max_parent_cluster_trip_count") or 0),
        elapsed_ms,
        timing_ms,
        cluster_result.get("unique_token_set_count"),
        cluster_result.get("similarity_pair_count"),
        debug_counts,
    )

    return {
        "corridors": corridors,
        "routes": routes,
        "summary": {
            "route_count": len(corridors),
            "candidate_trip_count": candidate_trip_count,
            "candidate_trip_count_is_limited": candidate_trip_count_is_limited,
            "sampled_candidate_trip_count": len(sampled_trip_rows),
            "raw_valid_ab_trip_count": raw_valid_ab_trip_count,
            "valid_ab_trip_count": valid_ab_trip_count,
            "duration_outlier_filtered_trip_count": duration_filtered_out_count,
            "total_route_count_before_top_k": len(ranked_clusters),
            "parent_cluster_count_before_ordered_split": cluster_result.get("parent_cluster_count_before_ordered_split"),
            "ordered_split_subcluster_count": cluster_result.get("ordered_split_subcluster_count"),
            "top_k_trip_count": top_k_trip_count,
            "corridor_covered_trip_count": top_k_trip_count,
            "total_ranked_trip_count": total_ranked_trip_count,
            "macro_cluster_covered_trip_count": cluster_result.get("macro_cluster_covered_trip_count"),
            "macro_cluster_coverage_ratio": cluster_result.get("macro_cluster_coverage_ratio"),
            "max_parent_cluster_trip_count": cluster_result.get("max_parent_cluster_trip_count"),
            "max_parent_cluster_ratio": cluster_result.get("max_parent_cluster_ratio"),
            "top_k_ratio": (top_k_trip_count / valid_ab_trip_count) if valid_ab_trip_count > 0 else 0,
            "top_k_ranked_ratio": (top_k_trip_count / total_ranked_trip_count) if total_ranked_trip_count > 0 else 0,
            "ranked_trip_ratio": (total_ranked_trip_count / valid_ab_trip_count) if valid_ab_trip_count > 0 else 0,
            "max_trip_count": max_trip_count,
        },
        "meta": {
            "logic_mode": "ab_subpath_vector_cluster",
            "signature_mode": "major_road_tokens_plus_coarse_grid_and_spatial_alias_features",
            "cluster_mode": "jaccard_similarity_graph_connected_components",
            "subcluster_mode": "non_destructive_entry_exit_anchor_split",
            "macro_recall_baseline_enabled": cluster_result.get("macro_recall_baseline_enabled"),
            "non_destructive_micro_split_enabled": cluster_result.get("non_destructive_micro_split_enabled"),
            "dedupe_mode": "skeleton_signature_and_geometry_similarity_merge",
            "representative_mode": "quality_scored_cluster_medoid_real_trip",
            "skeleton_mode": "high_support_tokens_sorted_by_average_position",
            "candidate_mode": payload.candidate_mode,
            "start_hour_filter": selected_start_hours or None,
            "prefilter_start_hours": prefilter_start_hours if selected_start_hours else None,
            "start_minute_filter": (
                {
                    "start": start_minute_filter_start,
                    "end": start_minute_filter_end,
                }
                if minute_filter_enabled
                else None
            ),
            "requested_min_support": payload.min_support,
            "effective_min_support": effective_min_support,
            "similarity_threshold_ladder": similarity_thresholds,
            "selected_similarity_threshold": selected_threshold,
            "skeleton_support_ratio": skeleton_support_ratio,
            "vector_min_edge_length_m": vector_min_edge_length_m,
            "major_road_min_length_m": major_road_min_length_m,
            "stop_token_ratio": stop_token_ratio,
            "trip_duration_filter_applied": duration_filter_applied,
            "raw_valid_ab_trip_count": raw_valid_ab_trip_count,
            "duration_outlier_filtered_trip_count": duration_filtered_out_count,
            "duration_outlier_p50_seconds": round(float(duration_p50_seconds or 0.0), 2),
            "duration_outlier_cutoff_seconds": round(float(duration_outlier_cutoff_seconds or 0.0), 2),
            "token_semantic_normalization": "macro_road_suffix_collapse_with_route_ring_expressway_and_spatial_alias_features",
            "timing_ms": timing_ms,
            "unique_token_set_count": cluster_result.get("unique_token_set_count"),
            "similarity_pair_count": cluster_result.get("similarity_pair_count"),
            "raw_shared_token_pair_count": cluster_result.get("raw_shared_token_pair_count"),
            "token_pair_length_bound_skip_count": cluster_result.get("token_pair_length_bound_skip_count"),
            "prefix_probe_count": cluster_result.get("prefix_probe_count"),
            "candidate_trip_group_compression_ratio": cluster_result.get("candidate_trip_group_compression_ratio"),
            "parent_cluster_count_before_ordered_split": cluster_result.get("parent_cluster_count_before_ordered_split"),
            "ordered_split_parent_count": cluster_result.get("ordered_split_parent_count"),
            "ordered_split_subcluster_count": cluster_result.get("ordered_split_subcluster_count"),
            "ordered_split_min_support": cluster_result.get("ordered_split_min_support"),
            "dominant_cluster_split_applied": cluster_result.get("dominant_cluster_split_applied"),
            "split_conservation_ok": cluster_result.get("split_conservation_ok"),
            "split_orphan_recovered_count": cluster_result.get("split_orphan_recovered_count"),
            "macro_cluster_covered_trip_count": cluster_result.get("macro_cluster_covered_trip_count"),
            "macro_cluster_coverage_ratio": cluster_result.get("macro_cluster_coverage_ratio"),
            "max_parent_cluster_trip_count": cluster_result.get("max_parent_cluster_trip_count"),
            "max_parent_cluster_ratio": cluster_result.get("max_parent_cluster_ratio"),
            "debug_counts": debug_counts,
            "response_version": "v6_ab_vector_cluster",
            "buffer_meters": payload.buffer_meters,
            "min_route_length_m": payload.min_route_length_m,
            "max_candidate_trips": payload.max_candidate_trips,
            "candidate_prefilter_limit": params["candidate_prefilter_limit"],
            "sampled_candidate_trip_count": len(sampled_trip_rows),
            "candidate_trip_count": candidate_trip_count,
            "candidate_trip_count_is_limited": candidate_trip_count_is_limited,
            "valid_ab_trip_count": valid_ab_trip_count,
            "empty_reason": (
                "no_cluster_above_similarity_threshold"
                if candidate_trip_count > 0 and valid_ab_trip_count > 0 and not routes
                else None
            ),
            "area_a": {"input": payload.area_a.model_dump(), "buffered": area_a_buffered},
            "area_b": {"input": payload.area_b.model_dump(), "buffered": area_b_buffered},
            "elapsed_ms": elapsed_ms,
        },
    }


def _f8_empty_response(
    payload: F8ABFrequentRoutesRequest,
    started_at: float,
    *,
    error: str | None = None,
    logic_mode: str = "ab_subpath_vector_cluster",
    area_a_buffered: dict | None = None,
    area_b_buffered: dict | None = None,
    candidate_trip_count: int = 0,
    sampled_candidate_trip_count: int = 0,
    valid_ab_trip_count: int = 0,
    extra_meta: dict | None = None,
) -> dict:
    elapsed_ms = round((perf_counter() - started_at) * 1000, 2)
    meta = {
        "logic_mode": logic_mode,
        "candidate_mode": payload.candidate_mode,
        "start_hour_filter": payload.start_hour_filter,
        "response_version": "v6_ab_vector_cluster",
        "buffer_meters": payload.buffer_meters,
        "min_support": payload.min_support,
        "min_route_length_m": payload.min_route_length_m,
        "max_candidate_trips": payload.max_candidate_trips,
        "candidate_trip_count": candidate_trip_count,
        "sampled_candidate_trip_count": sampled_candidate_trip_count,
        "valid_ab_trip_count": valid_ab_trip_count,
        "trip_duration_filter_applied": False,
        "area_a": {
            "input": payload.area_a.model_dump(),
            "buffered": area_a_buffered or payload.area_a.model_dump(),
        },
        "area_b": {
            "input": payload.area_b.model_dump(),
            "buffered": area_b_buffered or payload.area_b.model_dump(),
        },
        "elapsed_ms": elapsed_ms,
    }
    if error:
        meta["error"] = error
    if extra_meta:
        meta.update(extra_meta)

    return {
        "corridors": [],
        "routes": [],
        "summary": {
            "route_count": 0,
            "candidate_trip_count": candidate_trip_count,
            "sampled_candidate_trip_count": sampled_candidate_trip_count,
            "valid_ab_trip_count": valid_ab_trip_count,
            "total_route_count_before_top_k": 0,
            "top_k_trip_count": 0,
            "corridor_covered_trip_count": 0,
            "total_ranked_trip_count": 0,
            "top_k_ratio": 0,
            "max_trip_count": 0,
        },
        "meta": meta,
    }


def _f8_geometry_bbox(geometry: dict | None) -> tuple[float, float, float, float] | None:
    coords = [
        coord
        for coord in ((geometry or {}).get("coordinates") or [])
        if isinstance(coord, list) and len(coord) >= 2
    ]
    if not coords:
        return None
    lons = [float(coord[0]) for coord in coords]
    lats = [float(coord[1]) for coord in coords]
    return (min(lons), min(lats), max(lons), max(lats))


def _f8_corridor_drop_reasons(
    *,
    representative_quality_score: float,
    representative_fallback_rank: int,
    directness_ratio: float | None,
    repeat_point_ratio: float,
    duration_tail_ratio: float | None,
) -> list[str]:
    reasons: list[str] = []
    if representative_quality_score < 0.35:
        reasons.append("low_quality_score")
    if representative_fallback_rank >= 6 and representative_quality_score < 0.72:
        reasons.append("deep_fallback_low_quality")
    if directness_ratio is not None:
        if float(directness_ratio) > 3.0 and representative_quality_score < 0.82:
            reasons.append("high_detour_low_quality")
        elif float(directness_ratio) > 2.2 and representative_quality_score < 0.68:
            reasons.append("moderate_detour_low_quality")
    if repeat_point_ratio > 0.15 and representative_quality_score < 0.75:
        reasons.append("high_repeat_low_quality")
    if duration_tail_ratio is not None and duration_tail_ratio > 3.0 and representative_quality_score < 0.70:
        reasons.append("long_duration_tail_low_quality")
    return reasons


def _f8_corridor_fatal_drop_reasons(
    *,
    representative_quality_score: float,
    directness_ratio: float | None,
    repeat_point_ratio: float,
    duration_tail_ratio: float | None,
) -> list[str]:
    reasons: list[str] = []
    if representative_quality_score < 0.25:
        reasons.append("fatal_low_quality_score")
    if directness_ratio is not None and float(directness_ratio) > 5.0 and representative_quality_score < 0.65:
        reasons.append("fatal_extreme_detour")
    if repeat_point_ratio > 0.22 and representative_quality_score < 0.65:
        reasons.append("fatal_extreme_repeat")
    if duration_tail_ratio is not None and duration_tail_ratio > 5.0 and representative_quality_score < 0.55:
        reasons.append("fatal_extreme_duration_tail")
    return reasons


def _f8_corridor_ranking_score(corridor: dict) -> float:
    trip_count = float(corridor.get("trip_count") or 0.0)
    quality_score = float(corridor.get("representative_quality_score") or 0.0)
    directness_ratio = (corridor.get("quality_metrics") or {}).get("directness_ratio")
    repeat_point_ratio = float((corridor.get("quality_metrics") or {}).get("repeat_point_ratio") or 0.0)
    duration_tail_ratio = corridor.get("duration_tail_ratio")

    support_weight = math.log10(1.0 + max(0.0, trip_count))
    multiplier = 1.0
    if corridor.get("quality_tier") == "low_confidence_fill":
        multiplier *= 0.86
    if corridor.get("quality_tier") == "low_support_fill":
        multiplier *= 0.80
    if directness_ratio is not None and float(directness_ratio) > 2.2:
        multiplier *= max(0.58, 1.0 - min(0.35, (float(directness_ratio) - 2.2) * 0.12))
    if repeat_point_ratio > 0.10:
        multiplier *= max(0.72, 1.0 - min(0.22, (repeat_point_ratio - 0.10) * 1.2))
    if duration_tail_ratio is not None and float(duration_tail_ratio) > 3.0:
        multiplier *= 0.82
    return max(0.0, quality_score) * support_weight * multiplier


def _f8_corridor_is_default_display_safe(corridor: dict) -> bool:
    quality_score = float(corridor.get("representative_quality_score") or 0.0)
    metrics = corridor.get("quality_metrics") or {}
    directness_ratio = metrics.get("directness_ratio")
    repeat_point_ratio = float(metrics.get("repeat_point_ratio") or 0.0)
    fallback_rank = int(corridor.get("representative_fallback_rank") or 0)
    duration_tail_ratio = corridor.get("duration_tail_ratio")
    share_of_candidates = float(corridor.get("share_of_candidates") or 0.0)

    if (
        directness_ratio is not None
        and float(directness_ratio) <= 1.8
        and repeat_point_ratio <= 0.05
        and share_of_candidates >= 0.10
        and quality_score >= 0.42
    ):
        return True

    if quality_score < 0.58:
        return False
    if directness_ratio is not None:
        directness = float(directness_ratio)
        if directness > 3.2:
            return False
        if directness > 2.6 and quality_score < 0.72:
            return False
        if directness > 2.2 and quality_score < 0.68:
            return False
    if repeat_point_ratio > 0.12 and quality_score < 0.75:
        return False
    if fallback_rank >= 6 and quality_score < 0.72:
        return False
    if duration_tail_ratio is not None and float(duration_tail_ratio) > 4.0 and quality_score < 0.72:
        return False
    return True


def _f8_corridor_is_marginal_display_fill(corridor: dict) -> bool:
    quality_score = float(corridor.get("representative_quality_score") or 0.0)
    metrics = corridor.get("quality_metrics") or {}
    directness_ratio = metrics.get("directness_ratio")
    repeat_point_ratio = float(metrics.get("repeat_point_ratio") or 0.0)
    fallback_rank = int(corridor.get("representative_fallback_rank") or 0)
    duration_tail_ratio = corridor.get("duration_tail_ratio")
    share_of_candidates = float(corridor.get("share_of_candidates") or 0.0)

    if quality_score < 0.40:
        geometry_rescue = (
            directness_ratio is not None
            and float(directness_ratio) <= 2.0
            and repeat_point_ratio <= 0.06
            and share_of_candidates >= 0.03
            and quality_score >= 0.30
        )
        if not geometry_rescue:
            return False
    if directness_ratio is not None:
        directness = float(directness_ratio)
        if directness > 3.4:
            return False
        if directness > 3.0 and quality_score < 0.52:
            return False
    if repeat_point_ratio > 0.16:
        return False
    if fallback_rank >= 12 and quality_score < 0.58:
        return False
    if duration_tail_ratio is not None and float(duration_tail_ratio) > 4.8 and quality_score < 0.58:
        return False
    return True


def _f8_corridor_is_diagnostic_display_fill(corridor: dict) -> bool:
    quality_score = float(corridor.get("representative_quality_score") or 0.0)
    metrics = corridor.get("quality_metrics") or {}
    directness_ratio = metrics.get("directness_ratio")
    repeat_point_ratio = float(metrics.get("repeat_point_ratio") or 0.0)
    duration_tail_ratio = corridor.get("duration_tail_ratio")
    share_of_candidates = float(corridor.get("share_of_candidates") or 0.0)

    if (
        directness_ratio is not None
        and float(directness_ratio) <= 2.4
        and repeat_point_ratio <= 0.08
        and share_of_candidates >= 0.01
        and quality_score >= 0.25
    ):
        return True

    if quality_score < 0.30:
        return False
    if directness_ratio is not None and float(directness_ratio) > 4.2:
        return False
    if repeat_point_ratio > 0.20:
        return False
    if duration_tail_ratio is not None and float(duration_tail_ratio) > 6.0 and quality_score < 0.50:
        return False
    return True


def _f8_corridor_is_support_backfill_allowed(corridor: dict) -> bool:
    quality_score = float(corridor.get("representative_quality_score") or 0.0)
    metrics = corridor.get("quality_metrics") or {}
    directness_ratio = metrics.get("directness_ratio")
    repeat_point_ratio = float(metrics.get("repeat_point_ratio") or 0.0)
    duration_tail_ratio = corridor.get("duration_tail_ratio")

    if quality_score < 0.28:
        return False
    if directness_ratio is not None and float(directness_ratio) > 3.0:
        return False
    if repeat_point_ratio > 0.18:
        return False
    if duration_tail_ratio is not None and float(duration_tail_ratio) > 5.2 and quality_score < 0.52:
        return False
    return True


def _f8_bbox_overlap_ratio(
    left: tuple[float, float, float, float] | None,
    right: tuple[float, float, float, float] | None,
) -> float:
    if left is None or right is None:
        return 0.0
    left_min_lon, left_min_lat, left_max_lon, left_max_lat = left
    right_min_lon, right_min_lat, right_max_lon, right_max_lat = right
    inter_width = max(0.0, min(left_max_lon, right_max_lon) - max(left_min_lon, right_min_lon))
    inter_height = max(0.0, min(left_max_lat, right_max_lat) - max(left_min_lat, right_min_lat))
    if inter_width <= 0 or inter_height <= 0:
        return 0.0
    intersection = inter_width * inter_height
    left_area = max(0.0, (left_max_lon - left_min_lon) * (left_max_lat - left_min_lat))
    right_area = max(0.0, (right_max_lon - right_min_lon) * (right_max_lat - right_min_lat))
    min_area = min(left_area, right_area)
    return intersection / min_area if min_area > 0 else 0.0


def _f8_geometry_grid_signature(geometry: dict | None, precision: int = 3) -> set[tuple[float, float]]:
    coords = [
        coord
        for coord in ((geometry or {}).get("coordinates") or [])
        if isinstance(coord, list) and len(coord) >= 2
    ]
    return {(round(float(coord[0]), precision), round(float(coord[1]), precision)) for coord in coords}


def _f8_jaccard(left: set, right: set) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def _find_f8_similar_corridor(corridors: list[dict], signature_array: list[str], geometry: dict | None) -> dict | None:
    candidate_tokens = set(signature_array)
    candidate_grid = _f8_geometry_grid_signature(geometry)
    candidate_bbox = _f8_geometry_bbox(geometry)
    best_match = None
    best_score = 0.0
    for corridor in corridors:
        token_similarity = _f8_jaccard(set(corridor.get("corridor_signature_array") or []), candidate_tokens)
        grid_similarity = _f8_jaccard(corridor.get("_geometry_grid_signature") or set(), candidate_grid)
        bbox_overlap = _f8_bbox_overlap_ratio(corridor.get("_geometry_bbox"), candidate_bbox)
        is_similar = (
            (token_similarity >= 0.90 and (grid_similarity >= 0.08 or bbox_overlap >= 0.18))
            or (token_similarity >= 0.68 and (grid_similarity >= 0.12 or bbox_overlap >= 0.35))
            or (token_similarity >= 0.55 and grid_similarity >= 0.25 and bbox_overlap >= 0.18)
        )
        score = (token_similarity * 0.55) + (grid_similarity * 0.30) + (bbox_overlap * 0.15)
        if is_similar and score > best_score:
            best_score = score
            best_match = corridor
    return best_match


def _merge_f8_corridor_cluster(
    corridor: dict,
    *,
    trip_count: int,
    taxi_ids: set[int],
    duration_values_min: list[float],
    duration_samples_by_hour: dict[str, list[float]],
    route_lengths_m: list[float],
    variant_groups: dict[str, list[dict]],
    valid_ab_trip_count: int,
) -> None:
    corridor["trip_count"] = int(corridor.get("trip_count") or 0) + trip_count
    corridor.setdefault("_member_taxi_ids", set()).update(taxi_ids)
    corridor["vehicle_count"] = len(corridor.get("_member_taxi_ids") or set())
    corridor["share_of_candidates"] = (corridor["trip_count"] / valid_ab_trip_count) if valid_ab_trip_count > 0 else 0

    all_durations = list(corridor.get("_duration_values_min") or [])
    all_durations.extend(duration_values_min)
    corridor["_duration_values_min"] = all_durations
    corridor["avg_duration_min"] = round(sum(all_durations) / len(all_durations), 2) if all_durations else None
    corridor["p20_duration_min"] = _percentile(all_durations, 0.2)
    corridor["p50_duration_min"] = _percentile(all_durations, 0.5)
    corridor["p90_duration_min"] = _percentile(all_durations, 0.9)

    merged_hour_samples: dict[str, list[float]] = {
        str(hour): list(values or [])
        for hour, values in (corridor.get("duration_samples_by_hour") or {}).items()
    }
    for hour, values in duration_samples_by_hour.items():
        merged_hour_samples.setdefault(str(hour), []).extend(float(value) for value in values)
    corridor["duration_samples_by_hour"] = {
        hour: [round(float(value), 4) for value in values]
        for hour, values in sorted(merged_hour_samples.items())
        if values
    }
    corridor["durations_by_hour"] = {
        hour: round(sum(values) / len(values), 2)
        for hour, values in sorted(merged_hour_samples.items())
        if values
    }
    corridor["trip_count_by_hour"] = {
        hour: len(values)
        for hour, values in sorted(merged_hour_samples.items())
        if values
    }

    all_lengths = list(corridor.get("_route_lengths_m") or [])
    all_lengths.extend(route_lengths_m)
    corridor["_route_lengths_m"] = all_lengths
    corridor["avg_route_length_m"] = round(sum(all_lengths) / len(all_lengths), 2) if all_lengths else 0.0

    variant_by_signature = {variant["variant_signature"]: dict(variant) for variant in corridor.get("variants") or []}
    for variant_signature, variant_members in variant_groups.items():
        variant_durations = [member["duration_seconds"] / 60.0 for member in variant_members]
        existing = variant_by_signature.get(variant_signature)
        if existing:
            existing["_duration_values_min"] = list(existing.get("_duration_values_min") or []) + variant_durations
            existing["trip_count"] = int(existing.get("trip_count") or 0) + len(variant_members)
            existing["vehicle_count"] = int(existing.get("vehicle_count") or 0) + len({member["taxi_id"] for member in variant_members})
            existing["avg_duration_min"] = round(sum(existing["_duration_values_min"]) / len(existing["_duration_values_min"]), 2)
            existing["p20_duration_min"] = _percentile(existing["_duration_values_min"], 0.2)
            existing["p50_duration_min"] = _percentile(existing["_duration_values_min"], 0.5)
            existing["p90_duration_min"] = _percentile(existing["_duration_values_min"], 0.9)
        else:
            variant_by_signature[variant_signature] = {
                "variant_signature": variant_signature,
                "variant_signature_array": variant_signature.split(" > ") if variant_signature else [],
                "trip_count": len(variant_members),
                "vehicle_count": len({member["taxi_id"] for member in variant_members}),
                "avg_duration_min": round(sum(variant_durations) / len(variant_durations), 2) if variant_durations else None,
                "p20_duration_min": _percentile(variant_durations, 0.2),
                "p50_duration_min": _percentile(variant_durations, 0.5),
                "p90_duration_min": _percentile(variant_durations, 0.9),
                "share_within_corridor": 0,
                "_duration_values_min": variant_durations,
                "geometry": corridor.get("geometry"),
            }
    merged_variants = sorted(variant_by_signature.values(), key=lambda item: (-int(item.get("trip_count") or 0), item.get("variant_signature") or ""))[:8]
    for variant in merged_variants:
        variant["share_within_corridor"] = (int(variant.get("trip_count") or 0) / corridor["trip_count"]) if corridor["trip_count"] > 0 else 0
        variant.pop("_duration_values_min", None)
    corridor["variants"] = merged_variants


def _f8_route_from_corridor(corridor: dict) -> dict:
    return {
        "rank": corridor["rank"],
        "route_signature": corridor["corridor_signature"],
        "route_signature_array": corridor["corridor_signature_array"],
        "representative_taxi_id": corridor.get("representative_taxi_id"),
        "representative_trip_id": corridor.get("representative_trip_id"),
        "trip_count": corridor["trip_count"],
        "vehicle_count": corridor["vehicle_count"],
        "avg_duration_min": corridor.get("avg_duration_min"),
        "p20_duration_min": corridor.get("p20_duration_min"),
        "p50_duration_min": corridor.get("p50_duration_min"),
        "p90_duration_min": corridor.get("p90_duration_min"),
        "duration_tail_ratio": corridor.get("duration_tail_ratio"),
        "route_length_m": corridor.get("route_length_m"),
        "avg_route_length_m": corridor.get("avg_route_length_m"),
        "edge_count": corridor.get("edge_count"),
        "signature_level": "vector_cluster_skeleton_geometry_merged",
        "durations_by_hour": corridor.get("durations_by_hour"),
        "duration_samples_by_hour": corridor.get("duration_samples_by_hour"),
        "trip_count_by_hour": corridor.get("trip_count_by_hour"),
        "geometry": corridor.get("geometry"),
        "quality_metrics": corridor.get("quality_metrics"),
        "representative_quality_score": corridor.get("representative_quality_score"),
        "quality_tier": corridor.get("quality_tier"),
        "quality_warnings": corridor.get("quality_warnings"),
        "ranking_score": corridor.get("ranking_score"),
        "parent_cluster_id": corridor.get("parent_cluster_id"),
        "subcluster_id": corridor.get("subcluster_id"),
        "split_mode": corridor.get("split_mode"),
        "share_of_parent_cluster": corridor.get("share_of_parent_cluster"),
    }


def _strip_f8_internal_corridor_fields(corridor: dict) -> None:
    for key in [
        "_geometry_grid_signature",
        "_geometry_bbox",
        "_member_taxi_ids",
        "_duration_values_min",
        "_route_lengths_m",
        "_ranking_score",
        "_diversity_penalty",
    ]:
        corridor.pop(key, None)
    for variant in corridor.get("variants") or []:
        variant.pop("_duration_values_min", None)


def _build_f8_single_trip_backfill_corridors(
    *,
    ranked_clusters: list[dict],
    sampled_trips: list[dict],
    geometry_by_trip: dict[tuple[int, int], dict | None],
    existing_corridors: list[dict],
    valid_ab_trip_count: int,
    limit: int,
) -> list[dict]:
    if limit <= 0:
        return []

    used_trip_keys = {
        (corridor.get("representative_taxi_id"), corridor.get("representative_trip_id"))
        for corridor in existing_corridors
    }
    used_signatures = {str(corridor.get("corridor_signature") or "") for corridor in existing_corridors}
    backfill_corridors: list[dict] = []

    for cluster in ranked_clusters:
        cluster_duration_p50_seconds = cluster.get("duration_p50_seconds")
        cluster_route_p50_m = cluster.get("route_p50_m")
        for candidate in cluster.get("representative_candidates", [])[:80]:
            trip_idx = candidate.get("trip_index")
            if trip_idx is None or trip_idx < 0 or trip_idx >= len(sampled_trips):
                continue
            trip = sampled_trips[trip_idx]
            trip_key = (trip.get("taxi_id"), trip.get("trip_id"))
            if trip_key in used_trip_keys:
                continue
            selection = _select_f8_quality_representative(
                [candidate],
                sampled_trips=sampled_trips,
                geometry_by_trip=geometry_by_trip,
                cluster_duration_p50_seconds=cluster_duration_p50_seconds,
                cluster_route_p50_m=cluster_route_p50_m,
            )
            if selection is None:
                continue
            quality_score = float(selection.get("quality_score") or 0.0)
            metrics = selection.get("quality_metrics") or {}
            directness_ratio = metrics.get("directness_ratio")
            repeat_point_ratio = float(metrics.get("repeat_point_ratio") or 0.0)
            if quality_score < 0.20:
                continue
            if directness_ratio is not None and float(directness_ratio) > 5.0:
                continue
            if repeat_point_ratio > 0.22:
                continue

            signature_tokens = _f8_ordered_split_tokens(trip)
            signature_tokens = signature_tokens[:14] if len(signature_tokens) > 14 else signature_tokens
            corridor_signature = " > ".join(_format_f8_token(token) for token in signature_tokens)
            if not corridor_signature or corridor_signature in used_signatures:
                continue

            duration_min = float(trip.get("duration_seconds") or 0.0) / 60.0
            route_length_m = float(trip.get("route_length_m") or metrics.get("geometry_length_m") or 0.0)
            corridor = {
                "rank": 0,
                "corridor_signature": corridor_signature,
                "corridor_signature_array": [_format_f8_token(token) for token in signature_tokens],
                "_geometry_grid_signature": _f8_geometry_grid_signature(selection["geometry"]),
                "_geometry_bbox": _f8_geometry_bbox(selection["geometry"]),
                "_member_taxi_ids": {trip.get("taxi_id")},
                "_duration_values_min": [duration_min],
                "_route_lengths_m": [route_length_m],
                "trip_count": 1,
                "vehicle_count": 1,
                "share_of_candidates": (1 / valid_ab_trip_count) if valid_ab_trip_count > 0 else 0,
                "avg_duration_min": round(duration_min, 2),
                "p20_duration_min": round(duration_min, 2),
                "p50_duration_min": round(duration_min, 2),
                "p90_duration_min": round(duration_min, 2),
                "duration_tail_ratio": 1.0,
                "avg_route_length_m": round(route_length_m, 2),
                "route_length_m": route_length_m,
                "edge_count": len(signature_tokens),
                "durations_by_hour": {},
                "duration_samples_by_hour": (
                    {
                        trip["start_time"].strftime("%H"): [round(duration_min, 4)]
                    }
                    if trip.get("start_time") is not None
                    else {}
                ),
                "trip_count_by_hour": (
                    {trip["start_time"].strftime("%H"): 1}
                    if trip.get("start_time") is not None
                    else {}
                ),
                "geometry": selection["geometry"],
                "representative_taxi_id": trip.get("taxi_id"),
                "representative_trip_id": trip.get("trip_id"),
                "representative_trip_score": round(float(selection.get("score") or 0.0), 4),
                "representative_quality_score": round(quality_score, 4),
                "representative_fallback_rank": selection.get("fallback_rank"),
                "cluster_similarity_threshold": None,
                "parent_cluster_id": cluster.get("parent_cluster_id"),
                "subcluster_id": None,
                "split_mode": "single_trip_backfill",
                "share_of_parent_cluster": None,
                "quality_metrics": metrics,
                "quality_tier": "single_trip_backfill",
                "quality_warnings": ["single_trip_top_k_backfill"],
                "variants": [],
            }
            backfill_corridors.append(corridor)
            used_trip_keys.add(trip_key)
            used_signatures.add(corridor_signature)
            if len(backfill_corridors) >= limit:
                return backfill_corridors
    return backfill_corridors


def _select_f8_diverse_top_k_corridors(
    candidate_corridors: list[dict],
    *,
    top_k: int,
    parent_soft_cap: int = 3,
    override_ratio: float = 1.22,
) -> list[dict]:
    selected: list[dict] = []
    parent_counts: Counter[str] = Counter()
    deferred: list[dict] = []

    def parent_key(corridor: dict) -> str:
        parent_cluster_id = corridor.get("parent_cluster_id")
        if parent_cluster_id:
            return str(parent_cluster_id)
        split_mode = str(corridor.get("split_mode") or "")
        if split_mode == "single_trip_backfill":
            return f"single:{corridor.get('representative_taxi_id')}:{corridor.get('representative_trip_id')}"
        return f"corridor:{corridor.get('rank')}"

    remaining = list(candidate_corridors)
    while remaining and len(selected) < top_k:
        ranked_remaining = sorted(
            remaining,
            key=lambda corridor: (
                -_f8_diversified_corridor_score(corridor, selected),
                -float(corridor.get("_ranking_score") or 0.0),
                -int(corridor.get("trip_count") or 0),
                int(corridor.get("rank") or 0),
            ),
        )
        corridor = ranked_remaining[0]
        remaining.remove(corridor)
        if len(selected) >= top_k:
            break
        key = parent_key(corridor)
        if parent_counts[key] < parent_soft_cap:
            if float(corridor.get("_diversity_penalty") or 1.0) < 1.0:
                warnings = list(corridor.get("quality_warnings") or [])
                if "diversity_penalized_candidate" not in warnings:
                    warnings.append("diversity_penalized_candidate")
                corridor["quality_warnings"] = warnings
            selected.append(corridor)
            parent_counts[key] += 1
            continue

        best_open_parent_score = max(
            (
                _f8_diversified_corridor_score(other, selected)
                for other in remaining
                if other is not corridor
                and parent_counts[parent_key(other)] < parent_soft_cap
                and other not in selected
                and other not in deferred
            ),
            default=0.0,
        )
        score = float(corridor.get("_ranking_score") or 0.0)
        if best_open_parent_score <= 0.0 or score >= best_open_parent_score * override_ratio:
            warnings = list(corridor.get("quality_warnings") or [])
            if "same_parent_soft_cap_override" not in warnings:
                warnings.append("same_parent_soft_cap_override")
            corridor["quality_warnings"] = warnings
            selected.append(corridor)
            parent_counts[key] += 1
        else:
            deferred.append(corridor)

    if len(selected) < top_k:
        selected_ids = {id(corridor) for corridor in selected}
        for corridor in deferred:
            if len(selected) >= top_k:
                break
            if id(corridor) in selected_ids:
                continue
            warnings = list(corridor.get("quality_warnings") or [])
            if "same_parent_deferred_backfill" not in warnings:
                warnings.append("same_parent_deferred_backfill")
            corridor["quality_warnings"] = warnings
            selected.append(corridor)
            selected_ids.add(id(corridor))

    return selected[:top_k]


def _f8_diversified_corridor_score(corridor: dict, selected_corridors: list[dict]) -> float:
    base_score = float(corridor.get("_ranking_score") or 0.0)
    if not selected_corridors or base_score <= 0:
        corridor.pop("_diversity_penalty", None)
        return base_score
    max_similarity = max(_f8_corridor_similarity(corridor, selected) for selected in selected_corridors)
    if max_similarity >= 0.82:
        penalty = 0.48
    elif max_similarity >= 0.68:
        penalty = 0.68
    elif max_similarity >= 0.55:
        penalty = 0.82
    else:
        penalty = 1.0
    corridor["_diversity_penalty"] = penalty
    return base_score * penalty


def _f8_corridor_similarity(left: dict, right: dict) -> float:
    left_tokens = set(left.get("corridor_signature_array") or [])
    right_tokens = set(right.get("corridor_signature_array") or [])
    token_similarity = _f8_jaccard(left_tokens, right_tokens)
    grid_similarity = _f8_jaccard(
        left.get("_geometry_grid_signature") or set(),
        right.get("_geometry_grid_signature") or set(),
    )
    bbox_overlap = _f8_bbox_overlap_ratio(left.get("_geometry_bbox"), right.get("_geometry_bbox"))
    same_parent_bonus = (
        0.08
        if left.get("parent_cluster_id")
        and right.get("parent_cluster_id")
        and left.get("parent_cluster_id") == right.get("parent_cluster_id")
        else 0.0
    )
    return min(1.0, (0.55 * token_similarity) + (0.30 * grid_similarity) + (0.15 * bbox_overlap) + same_parent_bonus)


def _build_f8_similarity_clusters(
    *,
    sampled_trips: list[dict],
    thresholds: list[float],
    min_support: int,
    top_k: int,
) -> dict:
    token_set_to_trip_indices: dict[frozenset[str], list[int]] = defaultdict(list)
    for idx, trip in enumerate(sampled_trips):
        token_set_to_trip_indices[frozenset(trip["vector_token_set"])].append(idx)

    unique_token_sets = list(token_set_to_trip_indices.keys())
    unique_to_trip_indices = [token_set_to_trip_indices[token_set] for token_set in unique_token_sets]
    unique_count = len(unique_token_sets)
    min_similarity_threshold = min(thresholds) if thresholds else 0.0
    unique_token_lengths = [len(token_set) for token_set in unique_token_sets]

    token_doc_freq: Counter[str] = Counter()
    for unique_idx, token_set in enumerate(unique_token_sets):
        for token in token_set:
            token_doc_freq[token] += 1

    ordered_unique_tokens = [
        sorted(token_set, key=lambda token: (token_doc_freq[token], token))
        for token_set in unique_token_sets
    ]
    token_to_bit_index = {token: bit_idx for bit_idx, token in enumerate(sorted(token_doc_freq))}
    unique_token_bitmasks = [
        sum(1 << token_to_bit_index[token] for token in token_set)
        for token_set in unique_token_sets
    ]
    prefix_index: defaultdict[str, list[tuple[int, int]]] = defaultdict(list)
    similarity_pairs: list[tuple[int, int, float]] = []
    candidate_pair_count = 0
    token_pair_length_bound_skip_count = 0
    prefix_probe_count = 0
    for unique_idx, ordered_tokens in enumerate(ordered_unique_tokens):
        token_count = len(ordered_tokens)
        if token_count == 0:
            continue
        prefix_len = token_count
        if min_similarity_threshold > 0:
            prefix_len = token_count - int(math.ceil(min_similarity_threshold * token_count)) + 1
            min_candidate_len = int(math.ceil(min_similarity_threshold * token_count))
            max_candidate_len = int(math.floor(token_count / min_similarity_threshold))
        else:
            min_candidate_len = 0
            max_candidate_len = 10**9
        previous_candidate_indices: set[int] = set()
        for token in ordered_tokens[: max(1, prefix_len)]:
            previous_indices = prefix_index[token]
            lower_bound = bisect_left(previous_indices, (min_candidate_len, -1))
            upper_bound = bisect_left(previous_indices, (max_candidate_len + 1, -1))
            token_pair_length_bound_skip_count += len(previous_indices) - (upper_bound - lower_bound)
            prefix_probe_count += upper_bound - lower_bound
            for posting_idx in range(lower_bound, upper_bound):
                previous_candidate_indices.add(previous_indices[posting_idx][1])
        for token in ordered_tokens[: max(1, prefix_len)]:
            insort(prefix_index[token], (token_count, unique_idx))
        candidate_pair_count += len(previous_candidate_indices)
        for previous_idx in previous_candidate_indices:
            intersection_size = (unique_token_bitmasks[previous_idx] & unique_token_bitmasks[unique_idx]).bit_count()
            union_size = unique_token_lengths[previous_idx] + token_count - intersection_size
            if union_size <= 0:
                continue
            similarity = intersection_size / union_size
            if similarity >= min_similarity_threshold:
                similarity_pairs.append((previous_idx, unique_idx, similarity))

    best_result: dict | None = None
    for threshold_idx, threshold in enumerate(thresholds):
        adjacency: dict[int, set[int]] = {idx: set() for idx in range(unique_count)}
        for left_idx, right_idx, similarity in similarity_pairs:
            if similarity >= threshold:
                adjacency[left_idx].add(right_idx)
                adjacency[right_idx].add(left_idx)

        visited: set[int] = set()
        clusters: list[dict] = []
        for idx in range(unique_count):
            if idx in visited:
                continue
            stack = [idx]
            component_unique_indices: list[int] = []
            visited.add(idx)
            while stack:
                current = stack.pop()
                component_unique_indices.append(current)
                for neighbor in adjacency[current]:
                    if neighbor not in visited:
                        visited.add(neighbor)
                        stack.append(neighbor)

            member_indices = sorted(
                trip_idx
                for unique_idx in component_unique_indices
                for trip_idx in unique_to_trip_indices[unique_idx]
            )
            if len(member_indices) >= min_support:
                clusters.append(
                    _build_f8_cluster_record(
                        member_indices,
                        sampled_trips,
                        unique_token_set_count=len(component_unique_indices),
                    )
                )

        clusters.sort(
            key=lambda cluster: (
                -len(cluster["member_indices"]),
                -cluster["medoid_score"],
                cluster["medoid_index"],
            )
        )
        top_k_trip_count = sum(len(cluster["member_indices"]) for cluster in clusters[:top_k])
        score = top_k_trip_count - (threshold_idx * 0.5)
        result = {
            "threshold": threshold,
            "clusters": clusters,
            "score": score,
            "top_k_trip_count": top_k_trip_count,
        }
        if best_result is None or result["score"] > best_result["score"] or (
            math.isclose(result["score"], best_result["score"]) and len(clusters) > len(best_result["clusters"])
        ):
            best_result = result

    if best_result is None:
        best_result = {"threshold": thresholds[-1], "clusters": [], "score": -1, "top_k_trip_count": 0}

    best_result.update(
        {
            "unique_token_set_count": unique_count,
            "similarity_pair_count": len(similarity_pairs),
            "token_pair_length_bound_skip_count": token_pair_length_bound_skip_count,
            "raw_shared_token_pair_count": candidate_pair_count,
            "prefix_probe_count": prefix_probe_count,
            "candidate_trip_group_compression_ratio": (
                round(len(sampled_trips) / unique_count, 4) if unique_count > 0 else 0
            ),
        }
    )
    return best_result


def _build_f8_cluster_record(
    member_indices: list[int],
    sampled_trips: list[dict],
    *,
    unique_token_set_count: int | None = None,
    parent_cluster_id: str | None = None,
    subcluster_id: str | None = None,
    split_mode: str = "jaccard_parent",
    parent_trip_count: int | None = None,
) -> dict:
    cluster_duration_values = [
        float(sampled_trips[trip_idx].get("duration_seconds") or 0.0)
        for trip_idx in member_indices
        if float(sampled_trips[trip_idx].get("duration_seconds") or 0.0) > 0
    ]
    cluster_route_length_values = [
        float(sampled_trips[trip_idx].get("route_length_m") or 0.0)
        for trip_idx in member_indices
        if float(sampled_trips[trip_idx].get("route_length_m") or 0.0) > 0
    ]
    cluster_duration_p50_seconds = _percentile(cluster_duration_values, 0.5)
    cluster_route_p50_m = _percentile(cluster_route_length_values, 0.5)
    representative_candidates = _rank_f8_cluster_medoid_candidates(
        member_indices,
        sampled_trips,
        limit=min(800, max(220, int(math.ceil(len(member_indices) * 0.35)))),
        cluster_duration_p50_seconds=cluster_duration_p50_seconds,
        cluster_route_p50_m=cluster_route_p50_m,
    )
    medoid_index = representative_candidates[0]["trip_index"]
    medoid_score = representative_candidates[0]["score"]
    parent_count = max(1, int(parent_trip_count or len(member_indices)))
    return {
        "member_indices": member_indices,
        "medoid_index": medoid_index,
        "medoid_score": medoid_score,
        "representative_candidates": representative_candidates,
        "duration_p50_seconds": cluster_duration_p50_seconds,
        "route_p50_m": cluster_route_p50_m,
        "unique_token_set_count": unique_token_set_count,
        "parent_cluster_id": parent_cluster_id,
        "subcluster_id": subcluster_id,
        "split_mode": split_mode,
        "share_of_parent_cluster": round(len(member_indices) / parent_count, 6),
    }


def _split_f8_clusters_by_ordered_features(
    *,
    cluster_result: dict,
    sampled_trips: list[dict],
    min_support: int,
    top_k: int,
    total_trip_count: int,
) -> dict:
    parent_clusters = list(cluster_result.get("clusters") or [])
    if not parent_clusters:
        cluster_result.update(
            {
                "parent_cluster_count_before_ordered_split": 0,
                "ordered_split_parent_count": 0,
                "ordered_split_subcluster_count": 0,
                "ordered_split_min_support": min_support,
                "split_conservation_ok": True,
                "split_orphan_recovered_count": 0,
            }
        )
        return cluster_result

    split_min_support = max(int(min_support), min(30, max(2, math.ceil(max(total_trip_count, 1) * 0.006))))
    split_parent_count = 0
    split_subcluster_count = 0
    split_orphan_recovered_count = 0
    conservation_ok = True
    output_clusters: list[dict] = []

    for parent_rank, cluster in enumerate(parent_clusters, start=1):
        parent_cluster_id = f"c{parent_rank}"
        parent_members = list(cluster.get("member_indices") or [])
        parent_trip_count = len(parent_members)
        cluster["parent_cluster_id"] = parent_cluster_id
        cluster["subcluster_id"] = None
        cluster["split_mode"] = "jaccard_parent"
        cluster["share_of_parent_cluster"] = 1.0

        parent_split_min_support = max(
            int(min_support),
            min(split_min_support, max(2, math.ceil(parent_trip_count * 0.008))),
        )
        should_try_split = (
            parent_trip_count >= max(
                parent_split_min_support * 4,
                120,
                math.ceil(max(total_trip_count, 1) * 0.08),
            )
            and (
                parent_rank <= max(top_k, 3)
                or parent_trip_count >= max(50, math.ceil(max(total_trip_count, 1) * 0.20))
            )
        )
        if not should_try_split:
            output_clusters.append(cluster)
            continue

        partition = _build_f8_non_destructive_anchor_partition(
            parent_members,
            sampled_trips,
            min_support=parent_split_min_support,
            target_variant_count=max(2, min(4, top_k - 1)),
            assignment_threshold=0.85,
        )
        if len(partition) <= 1:
            output_clusters.append(cluster)
            continue

        covered_members = [trip_idx for _, component in partition for trip_idx in component]
        if len(covered_members) != parent_trip_count or set(covered_members) != set(parent_members):
            conservation_ok = False
            output_clusters.append(cluster)
            continue

        split_parent_count += 1
        for sub_rank, (subcluster_name, component) in enumerate(partition, start=1):
            split_subcluster_count += 1
            if subcluster_name == "Default_Mainline":
                split_orphan_recovered_count += len(component)
            output_clusters.append(
                _build_f8_cluster_record(
                    sorted(component),
                    sampled_trips,
                    unique_token_set_count=None,
                    parent_cluster_id=parent_cluster_id,
                    subcluster_id=f"{parent_cluster_id}.{subcluster_name}",
                    split_mode=(
                        "anchor_default_mainline"
                        if subcluster_name == "Default_Mainline"
                        else "anchor_branch_variant"
                    ),
                    parent_trip_count=parent_trip_count,
                )
            )

    output_clusters.sort(
        key=lambda item: (
            -len(item["member_indices"]),
            -float(item.get("medoid_score") or 0.0),
            int(item.get("medoid_index") or 0),
        )
    )
    cluster_result["clusters"] = output_clusters
    cluster_result["top_k_trip_count"] = sum(len(cluster["member_indices"]) for cluster in output_clusters[:top_k])
    cluster_result["parent_cluster_count_before_ordered_split"] = len(parent_clusters)
    cluster_result["ordered_split_parent_count"] = split_parent_count
    cluster_result["ordered_split_subcluster_count"] = split_subcluster_count
    cluster_result["ordered_split_min_support"] = split_min_support
    cluster_result["dominant_cluster_split_applied"] = any(
        str(cluster.get("split_mode") or "") == "anchor_default_mainline"
        for cluster in output_clusters
    )
    cluster_result["split_conservation_ok"] = conservation_ok
    cluster_result["split_orphan_recovered_count"] = split_orphan_recovered_count
    return cluster_result


def _build_f8_non_destructive_anchor_partition(
    member_indices: list[int],
    sampled_trips: list[dict],
    *,
    min_support: int,
    target_variant_count: int,
    assignment_threshold: float,
) -> list[tuple[str, list[int]]]:
    parent_members = sorted(set(member_indices))
    if len(parent_members) < max(min_support * 4, 40):
        return [("Default_Mainline", parent_members)]

    signature_to_trip_indices: dict[tuple[str, ...], list[int]] = defaultdict(list)
    for trip_idx in parent_members:
        signature = _f8_entry_exit_anchor_signature(sampled_trips[trip_idx])
        if signature:
            signature_to_trip_indices[signature].append(trip_idx)

    supported_signatures = [
        signature
        for signature, trip_indices in signature_to_trip_indices.items()
        if len(trip_indices) >= min_support
    ]
    if len(supported_signatures) <= 1:
        return [("Default_Mainline", parent_members)]

    signature_features = {
        signature: _f8_ordered_signature_features(signature)
        for signature in supported_signatures
    }
    ranked_signatures = sorted(
        supported_signatures,
        key=lambda signature: (-len(signature_to_trip_indices[signature]), len(signature), signature),
    )
    mainline_signature = ranked_signatures[0]
    branch_signatures: list[tuple[str, ...]] = []
    for signature in ranked_signatures[1:]:
        mainline_similarity = _f8_ordered_signature_similarity(
            signature,
            mainline_signature,
            signature_features[signature],
            signature_features[mainline_signature],
        )
        if mainline_similarity >= 0.55:
            continue
        if all(
            _f8_ordered_signature_similarity(
                signature,
                branch_signature,
                signature_features[signature],
                signature_features[branch_signature],
            )
            < 0.72
            for branch_signature in branch_signatures
        ):
            branch_signatures.append(signature)
        if len(branch_signatures) >= target_variant_count:
            break

    if not branch_signatures:
        return [("Default_Mainline", parent_members)]

    seed_signatures = [mainline_signature, *branch_signatures]
    seed_features = {signature: _f8_ordered_signature_features(signature) for signature in seed_signatures}
    branch_buckets: dict[tuple[str, ...], list[int]] = {signature: [] for signature in branch_signatures}
    mainline_members: list[int] = []
    low_quality_similarity_cutoff = 0.30
    branch_advantage_margin = 0.05

    for trip_idx in parent_members:
        signature = _f8_entry_exit_anchor_signature(sampled_trips[trip_idx])
        if not signature:
            mainline_members.append(trip_idx)
            continue
        features = _f8_ordered_signature_features(signature)
        best_seed = None
        best_similarity = 0.0
        mainline_similarity = 0.0
        for seed_signature in seed_signatures:
            similarity = _f8_ordered_signature_similarity(signature, seed_signature, features, seed_features[seed_signature])
            if seed_signature == mainline_signature:
                mainline_similarity = similarity
            if similarity > best_similarity:
                best_similarity = similarity
                best_seed = seed_signature
        # Competitive assignment: once robust seeds are selected, assign every trip
        # to its nearest seed, but keep weak or ambiguous trips on the mainline.
        if (
            best_seed in branch_buckets
            and best_similarity >= low_quality_similarity_cutoff
            and best_similarity >= mainline_similarity + branch_advantage_margin
        ):
            branch_buckets[best_seed].append(trip_idx)
        else:
            mainline_members.append(trip_idx)

    branches = [
        sorted(indices)
        for indices in branch_buckets.values()
        if len(indices) >= min_support
    ]
    if not branches:
        return [("Default_Mainline", parent_members)]

    mainline_members = sorted(set(mainline_members))
    assigned_branch_members = {trip_idx for branch in branches for trip_idx in branch}
    mainline_members = sorted(set(parent_members) - assigned_branch_members)
    if len(mainline_members) < min_support:
        return [("Default_Mainline", parent_members)]

    branches.sort(key=lambda component: (-len(component), component[0]))
    partition: list[tuple[str, list[int]]] = [("Default_Mainline", mainline_members)]
    for branch_rank, branch in enumerate(branches, start=1):
        partition.append((f"Branch_{branch_rank}", branch))
    return partition


def _f8_entry_exit_anchor_signature(trip: dict) -> tuple[str, ...]:
    tokens = _f8_ordered_split_tokens(trip)
    start_anchors = [token for token in tokens if token.startswith("anchor:start:")]
    end_anchors = [token for token in tokens if token.startswith("anchor:end:")]
    if start_anchors or end_anchors:
        return tuple(start_anchors[:3] + end_anchors[-3:])
    return tuple(tokens[:3] + tokens[-3:])


def _build_f8_ordered_subclusters(
    member_indices: list[int],
    sampled_trips: list[dict],
    *,
    min_support: int,
    similarity_threshold: float = 0.58,
) -> list[list[int]]:
    signature_to_trip_indices: dict[tuple[str, ...], list[int]] = defaultdict(list)
    for trip_idx in member_indices:
        signature = tuple(_f8_ordered_split_tokens(sampled_trips[trip_idx]))
        if signature:
            signature_to_trip_indices[signature].append(trip_idx)

    signatures = list(signature_to_trip_indices.keys())
    if len(signatures) <= 1:
        return [member_indices] if len(member_indices) >= min_support else []

    feature_sets = [_f8_ordered_signature_features(signature) for signature in signatures]
    feature_doc_freq: Counter[str] = Counter()
    for features in feature_sets:
        for feature in features:
            feature_doc_freq[feature] += 1

    ordered_features = [
        sorted(features, key=lambda feature: (feature_doc_freq[feature], feature))
        for features in feature_sets
    ]
    prefix_index: defaultdict[str, list[int]] = defaultdict(list)
    candidate_pairs: set[tuple[int, int]] = set()
    for signature_idx, features in enumerate(ordered_features):
        if not features:
            continue
        prefix_len = max(1, len(features) - int(math.ceil(similarity_threshold * len(features))) + 1)
        for feature in features[:prefix_len]:
            for previous_idx in prefix_index[feature]:
                left_len = len(feature_sets[previous_idx])
                right_len = len(feature_sets[signature_idx])
                if min(left_len, right_len) / max(left_len, right_len) < 0.35:
                    continue
                pair_key = (previous_idx, signature_idx) if previous_idx < signature_idx else (signature_idx, previous_idx)
                candidate_pairs.add(pair_key)
        for feature in features[:prefix_len]:
            prefix_index[feature].append(signature_idx)

    adjacency: dict[int, set[int]] = {idx: set() for idx in range(len(signatures))}
    for left_idx, right_idx in candidate_pairs:
        ordered_similarity = _f8_ordered_signature_similarity(
            signatures[left_idx],
            signatures[right_idx],
            feature_sets[left_idx],
            feature_sets[right_idx],
        )
        if ordered_similarity >= similarity_threshold:
            adjacency[left_idx].add(right_idx)
            adjacency[right_idx].add(left_idx)

    visited: set[int] = set()
    components: list[list[int]] = []
    for signature_idx in range(len(signatures)):
        if signature_idx in visited:
            continue
        stack = [signature_idx]
        visited.add(signature_idx)
        component_signature_indices: list[int] = []
        while stack:
            current = stack.pop()
            component_signature_indices.append(current)
            for neighbor in adjacency[current]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    stack.append(neighbor)
        trip_component = sorted(
            trip_idx
            for current_idx in component_signature_indices
            for trip_idx in signature_to_trip_indices[signatures[current_idx]]
        )
        if len(trip_component) >= min_support:
            components.append(trip_component)

    components.sort(key=lambda component: (-len(component), component[0]))
    return components


def _build_f8_anchor_subclusters(
    member_indices: list[int],
    sampled_trips: list[dict],
    *,
    min_support: int,
) -> list[list[int]]:
    anchor_groups: dict[tuple[str, ...], list[int]] = defaultdict(list)
    for trip_idx in member_indices:
        tokens = _f8_ordered_split_tokens(sampled_trips[trip_idx])
        anchor_tokens = [token for token in tokens if token.startswith("anchor:")]
        if len(anchor_tokens) >= 2:
            signature = tuple(anchor_tokens[:3] + anchor_tokens[-3:])
        else:
            signature = tuple(tokens[:3] + tokens[-3:])
        if signature:
            anchor_groups[signature].append(trip_idx)

    components = [
        sorted(indices)
        for indices in anchor_groups.values()
        if len(indices) >= min_support
    ]
    components.sort(key=lambda component: (-len(component), component[0]))
    return components


def _build_f8_dominant_hard_subclusters(
    member_indices: list[int],
    sampled_trips: list[dict],
    *,
    min_support: int,
    target_count: int,
) -> list[list[int]]:
    partition_candidates = [
        _build_f8_micro_seed_subclusters(
            member_indices,
            sampled_trips,
            min_support=min_support,
            target_count=target_count,
            assignment_threshold=0.85,
        ),
        _build_f8_ordered_subclusters(
            member_indices,
            sampled_trips,
            min_support=min_support,
            similarity_threshold=0.85,
        ),
    ]
    partition_candidates = [partition for partition in partition_candidates if len(partition) > 1]
    if not partition_candidates:
        return _build_f8_anchor_subclusters(member_indices, sampled_trips, min_support=min_support)

    parent_count = max(1, len(member_indices))

    def partition_score(partition: list[list[int]]) -> tuple[float, int, int]:
        largest_share = max((len(component) for component in partition), default=0) / parent_count
        coverage_share = sum(len(component) for component in partition) / parent_count
        useful_count = min(len(partition), target_count)
        diversity_bonus = 1.0 - min(0.95, largest_share)
        return (
            useful_count * 1000.0 + diversity_bonus * 280.0 + coverage_share * 120.0,
            len(partition),
            -max((len(component) for component in partition), default=0),
        )

    best_partition = max(partition_candidates, key=partition_score)
    best_partition.sort(key=lambda component: (-len(component), component[0]))
    return best_partition


def _build_f8_micro_seed_subclusters(
    member_indices: list[int],
    sampled_trips: list[dict],
    *,
    min_support: int,
    target_count: int,
    assignment_threshold: float,
) -> list[list[int]]:
    signature_to_trip_indices: dict[tuple[str, ...], list[int]] = defaultdict(list)
    for trip_idx in member_indices:
        signature = tuple(_f8_ordered_split_tokens(sampled_trips[trip_idx]))
        if signature:
            signature_to_trip_indices[signature].append(trip_idx)
    if len(signature_to_trip_indices) <= 1:
        return []

    signature_features = {
        signature: _f8_ordered_signature_features(signature)
        for signature in signature_to_trip_indices
    }
    ranked_signatures = sorted(
        signature_to_trip_indices,
        key=lambda signature: (-len(signature_to_trip_indices[signature]), len(signature), signature),
    )

    seed_signatures: list[tuple[str, ...]] = []
    for signature in ranked_signatures:
        if len(signature_to_trip_indices[signature]) < min_support:
            continue
        if all(
            _f8_ordered_signature_similarity(
                signature,
                seed,
                signature_features[signature],
                signature_features[seed],
            )
            < 0.78
            for seed in seed_signatures
        ):
            seed_signatures.append(signature)
        if len(seed_signatures) >= max(target_count * 2, target_count + 4):
            break
    if len(seed_signatures) <= 1:
        return []

    seed_buckets: dict[tuple[str, ...], list[int]] = {seed: [] for seed in seed_signatures}
    unassigned_signatures: list[tuple[str, ...]] = []
    for signature, trip_indices in signature_to_trip_indices.items():
        best_seed: tuple[str, ...] | None = None
        best_similarity = 0.0
        for seed in seed_signatures:
            similarity = _f8_ordered_signature_similarity(
                signature,
                seed,
                signature_features[signature],
                signature_features[seed],
            )
            if similarity > best_similarity:
                best_similarity = similarity
                best_seed = seed
        if best_seed is not None and best_similarity >= assignment_threshold:
            seed_buckets[best_seed].extend(trip_indices)
        else:
            unassigned_signatures.append(signature)

    components = [sorted(indices) for indices in seed_buckets.values() if len(indices) >= min_support]
    for signature in unassigned_signatures:
        trip_indices = signature_to_trip_indices[signature]
        if len(trip_indices) >= min_support:
            components.append(sorted(trip_indices))
    components.sort(key=lambda component: (-len(component), component[0]))
    return components


def _f8_ordered_split_tokens(trip: dict) -> list[str]:
    raw_tokens = list(trip.get("sequence_tokens") or trip.get("vector_tokens_filtered") or trip.get("vector_tokens") or [])
    if len(raw_tokens) < 2:
        raw_tokens = list(trip.get("vector_tokens_filtered") or trip.get("vector_tokens") or raw_tokens)
    tokens: list[str] = []
    previous_token: str | None = None
    for token in raw_tokens:
        token = str(token)
        if token.startswith("alias:corridor") or token.startswith("grid:"):
            continue
        if token.startswith("alias:") and not (
            token.startswith("alias:route:")
            or token.startswith("alias:ring:")
            or token.startswith("alias:express:")
        ):
            continue
        if token == previous_token:
            continue
        tokens.append(token)
        previous_token = token
    return tokens


def _f8_ordered_signature_features(signature: tuple[str, ...]) -> set[str]:
    if not signature:
        return set()
    features = {f"token:{token}" for token in signature}
    features.add(f"start:{signature[0]}")
    features.add(f"end:{signature[-1]}")
    for left, right in zip(signature, signature[1:]):
        features.add(f"bigram:{left}>{right}")
    for left, middle, right in zip(signature, signature[1:], signature[2:]):
        features.add(f"trigram:{left}>{middle}>{right}")
    return features


def _f8_ordered_signature_similarity(
    left_signature: tuple[str, ...],
    right_signature: tuple[str, ...],
    left_features: set[str],
    right_features: set[str],
) -> float:
    feature_similarity = _f8_jaccard(left_features, right_features)
    lcs_similarity = _f8_lcs_coverage(left_signature, right_signature)
    return max(feature_similarity, (feature_similarity * 0.45) + (lcs_similarity * 0.55))


def _f8_lcs_coverage(left: tuple[str, ...], right: tuple[str, ...]) -> float:
    if not left or not right:
        return 0.0
    if len(left) > len(right):
        left, right = right, left
    previous = [0] * (len(left) + 1)
    for right_token in right:
        current = [0]
        for idx, left_token in enumerate(left, start=1):
            if left_token == right_token:
                current.append(previous[idx - 1] + 1)
            else:
                current.append(max(previous[idx], current[-1]))
        previous = current
    return previous[-1] / max(1, min(len(left), len(right)))


def _select_f8_cluster_medoid(component: list[int], sampled_trips: list[dict]) -> tuple[int, float]:
    ranked = _rank_f8_cluster_medoid_candidates(component, sampled_trips, limit=1)
    return ranked[0]["trip_index"], ranked[0]["score"]


def _rank_f8_cluster_medoid_candidates(
    component: list[int],
    sampled_trips: list[dict],
    *,
    limit: int,
    cluster_duration_p50_seconds: float | None = None,
    cluster_route_p50_m: float | None = None,
) -> list[dict]:
    cluster_size = max(1, len(component))
    cluster_token_freq = Counter(
        token
        for idx in component
        for token in sampled_trips[idx]["vector_token_set"]
    )
    high_freq_cutoff = max(2, int(math.ceil(cluster_size * 0.18)))
    high_freq_token_weights = {
        token: math.log10(1.0 + freq)
        for token, freq in cluster_token_freq.items()
        if freq >= high_freq_cutoff
    }
    high_freq_weight_total = sum(high_freq_token_weights.values()) or 1.0

    ranked: list[dict] = []
    raw_ranked: list[dict] = []
    for idx in component:
        token_set = set(sampled_trips[idx]["vector_token_set"])
        raw_token_score = sum(cluster_token_freq[token] for token in token_set)
        weighted_token_score = sum(math.log10(1.0 + cluster_token_freq[token]) for token in token_set)
        high_freq_recall = sum(high_freq_token_weights.get(token, 0.0) for token in token_set) / high_freq_weight_total
        duration_penalty = 0.0
        if cluster_duration_p50_seconds is not None and cluster_duration_p50_seconds > 0:
            duration_seconds = float(sampled_trips[idx].get("duration_seconds") or 0.0)
            duration_penalty = min(0.35, abs(duration_seconds - cluster_duration_p50_seconds) / cluster_duration_p50_seconds * 0.18)
        route_length_penalty = 0.0
        if cluster_route_p50_m is not None and cluster_route_p50_m > 0:
            route_length_m = float(sampled_trips[idx].get("route_length_m") or 0.0)
            route_length_penalty = min(0.35, abs(route_length_m - cluster_route_p50_m) / cluster_route_p50_m * 0.22)
        raw_ranked.append(
            {
                "trip_index": idx,
                "raw_token_score": raw_token_score,
                "weighted_token_score": weighted_token_score,
                "high_freq_recall": max(0.0, min(1.0, high_freq_recall)),
                "duration_penalty": duration_penalty,
                "route_length_penalty": route_length_penalty,
            }
        )

    max_weighted_token_score = max((item["weighted_token_score"] for item in raw_ranked), default=1.0) or 1.0
    max_raw_token_score = max((item["raw_token_score"] for item in raw_ranked), default=1.0) or 1.0
    for item in raw_ranked:
        soft_center_score = float(item["weighted_token_score"]) / max_weighted_token_score
        token_centrality_ratio = float(item["raw_token_score"]) / max_raw_token_score
        score = (
            (0.62 * soft_center_score + 0.38 * float(item["high_freq_recall"]))
            * (1.0 - float(item["duration_penalty"]))
            * (1.0 - float(item["route_length_penalty"]))
        )
        ranked.append(
            {
                "trip_index": item["trip_index"],
                "score": score,
                "soft_center_score": soft_center_score,
                "high_freq_token_recall": item["high_freq_recall"],
                "token_centrality_ratio": token_centrality_ratio,
            }
        )
    ranked.sort(key=lambda item: (-item["score"], item["trip_index"]))
    return ranked[: max(1, limit)]


def _select_f8_quality_representative(
    representative_candidates: list[dict],
    *,
    sampled_trips: list[dict],
    geometry_by_trip: dict[tuple[int, int], dict | None],
    cluster_duration_p50_seconds: float | None = None,
    cluster_route_p50_m: float | None = None,
) -> dict | None:
    if not representative_candidates:
        return None

    max_centrality_score = max(float(candidate.get("score") or 0.0) for candidate in representative_candidates) or 1.0
    ranked: list[dict] = []
    for fallback_rank, candidate in enumerate(representative_candidates):
        candidate_trip = sampled_trips[candidate["trip_index"]]
        candidate_geometry = geometry_by_trip.get((candidate_trip["taxi_id"], candidate_trip["trip_id"]))
        if not candidate_geometry:
            continue

        quality_metrics = _f8_geometry_quality_metrics(candidate_geometry)
        directness_ratio = quality_metrics.get("directness_ratio")
        repeat_point_ratio = float(quality_metrics.get("repeat_point_ratio") or 0.0)
        repeated_edge_count = int(quality_metrics.get("repeated_edge_count") or 0)
        a_hit_edge_count = int(quality_metrics.get("a_hit_edge_count") or 0)
        b_hit_edge_count = int(quality_metrics.get("b_hit_edge_count") or 0)
        subpath_edge_count = max(1, int(quality_metrics.get("subpath_edge_count") or 1))
        centrality_ratio = float(candidate.get("score") or 0.0) / max_centrality_score
        soft_center_score = max(0.0, min(1.0, float(candidate.get("soft_center_score") or centrality_ratio)))
        high_freq_token_recall = max(0.0, min(1.0, float(candidate.get("high_freq_token_recall") or 0.0)))
        token_centrality_ratio = max(0.0, min(1.0, float(candidate.get("token_centrality_ratio") or centrality_ratio)))
        duration_penalty = 0.0
        if cluster_duration_p50_seconds is not None and cluster_duration_p50_seconds > 0:
            duration_seconds = float(candidate_trip.get("duration_seconds") or 0.0)
            duration_penalty = min(1.0, abs(duration_seconds - cluster_duration_p50_seconds) / cluster_duration_p50_seconds)
        route_length_penalty = 0.0
        if cluster_route_p50_m is not None and cluster_route_p50_m > 0:
            route_length_m = float(candidate_trip.get("route_length_m") or 0.0)
            route_length_penalty = min(1.0, abs(route_length_m - cluster_route_p50_m) / cluster_route_p50_m)

        # Decouple cluster messiness from representative quality: a noisy parent
        # cluster should still choose a clean, central, physically plausible trip.
        directness_score = 0.25
        if directness_ratio is None:
            directness_score = 0.25
        else:
            directness = float(directness_ratio)
            if directness <= 1.3:
                directness_score = 1.0
            elif directness <= 1.6:
                directness_score = 1.0 - ((directness - 1.3) / 0.3) * 0.18
            elif directness <= 2.2:
                directness_score = 0.82 - ((directness - 1.6) / 0.6) * 0.47
            elif directness <= 3.5:
                directness_score = 0.35 - ((directness - 2.2) / 1.3) * 0.25
            else:
                directness_score = 0.05
            directness_score = max(0.02, min(1.0, directness_score))
        repeat_score = max(0.0, min(1.0, 1.0 - repeat_point_ratio * 6.0))
        repeated_edge_score = max(0.0, min(1.0, 1.0 - (repeated_edge_count / subpath_edge_count) * 2.2))
        endpoint_revisit_score = max(
            0.0,
            min(1.0, 1.0 - ((max(a_hit_edge_count - 3, 0) + max(b_hit_edge_count - 3, 0)) / 7.0)),
        )
        fallback_penalty = min(0.08, fallback_rank * 0.003)
        center_score = (
            0.58 * soft_center_score
            + 0.28 * high_freq_token_recall
            + 0.14 * token_centrality_ratio
        )
        physical_score = (
            0.72 * directness_score
            + 0.16 * repeat_score
            + 0.08 * repeated_edge_score
            + 0.04 * endpoint_revisit_score
        )
        quality_score = max(
            0.0,
            min(
                1.0,
                (0.32 * center_score)
                + (0.68 * physical_score)
                - (0.08 * duration_penalty)
                - (0.10 * route_length_penalty)
                - fallback_penalty,
            ),
        )
        if directness_ratio is not None:
            directness = float(directness_ratio)
            if directness > 3.5:
                quality_score = min(quality_score, 0.32)
            elif directness > 2.2:
                quality_score = min(quality_score, 0.52)
            elif directness > 1.6:
                quality_score = min(quality_score, 0.72)
        if repeat_point_ratio > 0.18:
            quality_score = min(quality_score, 0.42)
        elif repeat_point_ratio > 0.12:
            quality_score = min(quality_score, 0.62)
        ranked.append(
            {
                "trip": candidate_trip,
                "geometry": candidate_geometry,
                "score": float(candidate.get("score") or 0.0),
                "quality_score": quality_score,
                "fallback_rank": fallback_rank,
                "quality_metrics": {
                    **quality_metrics,
                    "soft_center_score": round(soft_center_score, 4),
                    "high_freq_token_recall": round(high_freq_token_recall, 4),
                    "token_centrality_ratio": round(token_centrality_ratio, 4),
                    "directness_score": round(directness_score, 4),
                    "repeat_score": round(repeat_score, 4),
                    "physical_score": round(physical_score, 4),
                    "center_score": round(center_score, 4),
                },
            }
        )

    if not ranked:
        return None
    ranked.sort(
        key=lambda item: (
            -item["quality_score"],
            item["quality_metrics"].get("directness_ratio") if item["quality_metrics"].get("directness_ratio") is not None else 999.0,
            item["fallback_rank"],
            -item["score"],
        )
    )
    return ranked[0]


def _fetch_f8_cluster_geometries(
    *,
    ranked_trips: list[dict],
    area_a_buffered: dict,
    area_b_buffered: dict,
    batch_size: int = 250,
) -> dict[tuple[int, int], dict | None]:
    if not ranked_trips:
        return {}

    geometry_sql = text(
        """
        WITH ranked_trips AS (
            SELECT *
            FROM jsonb_to_recordset(CAST(:ranked_trips_json AS jsonb)) AS rt(
                taxi_id bigint,
                trip_id bigint,
                a_seq integer,
                b_seq integer
            )
        )
        SELECT
            e.taxi_id,
            e.trip_id,
            e.edge_seq,
            e.road_uid,
            e.direction,
            ST_AsGeoJSON(r.geometry) AS geometry,
            ST_Intersects(
                r.geometry,
                ST_MakeEnvelope(:a_min_lon, :a_min_lat, :a_max_lon, :a_max_lat, 4326)
            ) AS in_a,
            ST_Intersects(
                r.geometry,
                ST_MakeEnvelope(:b_min_lon, :b_min_lat, :b_max_lon, :b_max_lat, 4326)
            ) AS in_b
        FROM matched_trip_edges e
        JOIN ranked_trips rt
          ON rt.taxi_id = e.taxi_id
         AND rt.trip_id = e.trip_id
        JOIN road_edges r
          ON r.edge_uid = e.road_uid
        WHERE e.edge_seq BETWEEN rt.a_seq AND rt.b_seq
        ORDER BY e.taxi_id ASC, e.trip_id ASC, e.edge_seq ASC
        """
    )

    trip_specs: list[dict] = []
    seen_trip_keys: set[tuple[int, int]] = set()
    geometry_map: dict[tuple[int, int], dict | None] = {}
    for trip in ranked_trips:
        taxi_id = int(trip["taxi_id"])
        trip_id = int(trip["trip_id"])
        trip_key = (taxi_id, trip_id)
        if trip_key in seen_trip_keys:
            continue
        seen_trip_keys.add(trip_key)
        geometry_map[trip_key] = None
        trip_specs.append(
            {
                "taxi_id": taxi_id,
                "trip_id": trip_id,
                "a_seq": int(trip.get("a_seq") or 0),
                "b_seq": int(trip.get("b_seq") or 0),
            }
        )

    with engine.connect() as conn:
        for chunk_index in range(0, len(trip_specs), max(1, batch_size)):
            trip_chunk = trip_specs[chunk_index : chunk_index + max(1, batch_size)]
            rows = conn.execute(
                geometry_sql,
                {
                    "ranked_trips_json": json.dumps(trip_chunk),
                    "a_min_lon": area_a_buffered["min_lon"],
                    "a_min_lat": area_a_buffered["min_lat"],
                    "a_max_lon": area_a_buffered["max_lon"],
                    "a_max_lat": area_a_buffered["max_lat"],
                    "b_min_lon": area_b_buffered["min_lon"],
                    "b_min_lat": area_b_buffered["min_lat"],
                    "b_max_lon": area_b_buffered["max_lon"],
                    "b_max_lat": area_b_buffered["max_lat"],
                },
            ).mappings().all()
            rows_by_trip: defaultdict[tuple[int, int], list[dict]] = defaultdict(list)
            for row in rows:
                rows_by_trip[(int(row["taxi_id"]), int(row["trip_id"]))].append(row)
            for trip_key, trip_rows in rows_by_trip.items():
                geometry_map[trip_key] = _build_f8_validated_linestring(trip_rows)
    return geometry_map


def _build_f8_validated_linestring(rows: list[dict]) -> dict | None:
    if not rows:
        return None
    has_a = any(bool(row.get("in_a")) for row in rows)
    has_b = any(bool(row.get("in_b")) for row in rows)
    first_a_seq = next((int(row["edge_seq"]) for row in rows if row.get("in_a")), None)
    first_b_seq = next((int(row["edge_seq"]) for row in rows if row.get("in_b")), None)
    if not has_a or not has_b or first_a_seq is None or first_b_seq is None or first_b_seq <= first_a_seq:
        return None
    geometry = _build_linestring_from_edge_rows(rows)
    if not geometry:
        return None
    road_uids = [str(row.get("road_uid")) for row in rows if row.get("road_uid")]
    geometry["_f8_validation"] = {
        "a_hit_edge_count": sum(1 for row in rows if row.get("in_a")),
        "b_hit_edge_count": sum(1 for row in rows if row.get("in_b")),
        "repeated_edge_count": len(road_uids) - len(set(road_uids)),
        "subpath_edge_count": len(rows),
    }
    return geometry


def _haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    radius_m = 6371008.8
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius_m * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))


def _f8_geometry_quality_metrics(geometry: dict | None) -> dict:
    if not geometry or geometry.get("type") != "LineString":
        return {
            "geometry_point_count": 0,
            "geometry_length_m": 0.0,
            "direct_distance_m": 0.0,
            "directness_ratio": None,
            "repeat_point_ratio": 0.0,
            "a_hit_edge_count": 0,
            "b_hit_edge_count": 0,
            "repeated_edge_count": 0,
            "subpath_edge_count": 0,
        }
    coords = [
        coord
        for coord in (geometry.get("coordinates") or [])
        if isinstance(coord, list) and len(coord) >= 2
    ]
    validation = geometry.get("_f8_validation") or {}
    if len(coords) < 2:
        return {
            "geometry_point_count": len(coords),
            "geometry_length_m": 0.0,
            "direct_distance_m": 0.0,
            "directness_ratio": None,
            "repeat_point_ratio": 0.0,
            "a_hit_edge_count": int(validation.get("a_hit_edge_count") or 0),
            "b_hit_edge_count": int(validation.get("b_hit_edge_count") or 0),
            "repeated_edge_count": int(validation.get("repeated_edge_count") or 0),
            "subpath_edge_count": int(validation.get("subpath_edge_count") or 0),
        }
    length_m = 0.0
    for left, right in zip(coords, coords[1:]):
        length_m += _haversine_m(float(left[0]), float(left[1]), float(right[0]), float(right[1]))
    direct_distance_m = _haversine_m(float(coords[0][0]), float(coords[0][1]), float(coords[-1][0]), float(coords[-1][1]))
    rounded_points = {(round(float(coord[0]), 5), round(float(coord[1]), 5)) for coord in coords}
    repeat_point_ratio = 1 - (len(rounded_points) / len(coords))
    return {
        "geometry_point_count": len(coords),
        "geometry_length_m": round(length_m, 2),
        "direct_distance_m": round(direct_distance_m, 2),
        "directness_ratio": round(length_m / direct_distance_m, 3) if direct_distance_m > 1 else None,
        "repeat_point_ratio": round(max(0.0, min(1.0, repeat_point_ratio)), 4),
        "a_hit_edge_count": int(validation.get("a_hit_edge_count") or 0),
        "b_hit_edge_count": int(validation.get("b_hit_edge_count") or 0),
        "repeated_edge_count": int(validation.get("repeated_edge_count") or 0),
        "subpath_edge_count": int(validation.get("subpath_edge_count") or 0),
    }


def _build_linestring_from_edge_rows(rows: list[dict]) -> dict | None:
    if not rows:
        return None

    stitched: list[list[float]] = []
    for row in rows:
        geometry = json.loads(row["geometry"]) if row.get("geometry") else None
        if not geometry or geometry.get("type") != "LineString":
            continue
        coords = list(geometry.get("coordinates") or [])
        if len(coords) < 2:
            continue
        if int(row.get("direction") or 1) < 0:
            coords = list(reversed(coords))
        if not stitched:
            stitched.extend(coords)
            continue
        if stitched[-1] == coords[0]:
            stitched.extend(coords[1:])
        elif stitched[-1] == coords[-1]:
            rev = list(reversed(coords))
            stitched.extend(rev[1:])
        else:
            stitched.extend(coords)

    if len(stitched) < 2:
        return None
    return {"type": "LineString", "coordinates": stitched}


def _normalize_f8_road_group_key(road_name: str | None) -> str | None:
    if not road_name:
        return None
    normalized = "".join(road_name.strip().lower().split())
    if normalized in {"", "unnamed", "unknown", "null"}:
        return None
    if normalized.startswith("edge:"):
        return normalized
    # Collapse micro-topology fragments from map matching into macro road tokens.
    # Keep directional/section words such as 东/西/南/北/中 so distinct corridors do not merge too aggressively.
    suffix_pattern = (
        r"(?:"
        r"辅路|主路|主线|桥区|跨线桥|立交桥|高架桥|匝道|出口|入口|连接线|联络线|"
        r"引桥|掉头专用道|掉头车道|停车区|服务区|收费站|环岛|隧道|桥"
        r")+$"
    )
    previous = None
    while previous != normalized:
        previous = normalized
        normalized = re.sub(suffix_pattern, "", normalized)
    normalized = re.sub(r"(?:\(.*?\)|（.*?）)$", "", normalized)
    normalized = normalized.strip()
    if normalized in {"", "unnamed", "unknown", "null"}:
        return None
    return normalized


def _normalize_f8_token_key(token_key: str | None) -> str | None:
    if not token_key:
        return None
    token_key = str(token_key).strip()
    if token_key.startswith("anchor:"):
        return token_key
    if token_key.startswith("road:"):
        normalized = _normalize_f8_road_group_key(token_key.split(":", 1)[1])
        return f"road:{normalized}" if normalized else None
    if token_key.startswith("edge:"):
        return token_key
    if token_key.startswith("alias:"):
        return token_key
    normalized = _normalize_f8_road_group_key(token_key)
    return f"road:{normalized}" if normalized else None


def _normalize_f8_token_sequence(tokens: list[str]) -> list[str]:
    normalized_tokens: list[str] = []
    previous_token: str | None = None
    for token in tokens:
        normalized_token = _normalize_f8_token_key(token)
        if not normalized_token or normalized_token == previous_token:
            continue
        normalized_tokens.append(normalized_token)
        previous_token = normalized_token
    return normalized_tokens


def _f8_center_grid_token(min_lon: float, min_lat: float, max_lon: float, max_lat: float, step: float) -> str:
    center_lon = (float(min_lon) + float(max_lon)) / 2.0
    center_lat = (float(min_lat) + float(max_lat)) / 2.0
    snapped_lon = round(round(center_lon / step) * step, 3)
    snapped_lat = round(round(center_lat / step) * step, 3)
    return f"grid:{snapped_lon}:{snapped_lat}"


def _f8_road_alias_tokens(road_group_key: str | None, highway_class: str | None, coarse_grid_token: str | None) -> list[str]:
    if not road_group_key:
        return []
    aliases: list[str] = []
    road = str(road_group_key).lower()
    highway = str(highway_class or "").lower()

    route_match = re.search(r"\b(g\d+[a-z]?|s\d+[a-z]?|x\d+[a-z]?)\b", road)
    if route_match:
        aliases.append(f"alias:route:{route_match.group(1)}")

    known_expressway_aliases = {
        "京藏高速": "g6",
        "八达岭高速": "g6",
        "京新高速": "g7",
        "京承高速": "g45",
        "大广高速": "g45",
        "京港澳高速": "g4",
        "京昆高速": "g5",
        "京沪高速": "g2",
        "京哈高速": "g1",
        "京沈高速": "g1",
        "机场高速": "airport",
    }
    for keyword, alias in known_expressway_aliases.items():
        if keyword in road:
            aliases.append(f"alias:route:{alias}")
            break

    ring_match = re.search(r"([一二三四五六七八九十\d]+环)", road)
    if ring_match:
        aliases.append(f"alias:ring:{ring_match.group(1)}")

    if road.endswith(("高速", "快速路", "快速")) or highway in {"motorway", "trunk"}:
        base = re.sub(r"(高速公路|高速|快速路|快速)$", "", road)
        if len(base) >= 2:
            aliases.append(f"alias:express:{base}")

    if coarse_grid_token:
        aliases.append(f"alias:corridor:{coarse_grid_token}")

    deduped: list[str] = []
    seen: set[str] = set()
    for alias in aliases:
        if alias not in seen:
            seen.add(alias)
            deduped.append(alias)
    return deduped


def _build_f8_sampled_trips_from_candidate_rows(
    *,
    candidate_rows: list[dict],
    area_a_buffered: dict,
    area_b_buffered: dict,
    min_route_length_m: float,
    vector_min_edge_length_m: float,
    major_road_min_length_m: float,
    chunk_size: int = 2000,
    road_chunk_size: int = 12000,
) -> tuple[list[dict], dict[str, float]]:
    timing_ms: dict[str, float] = {}
    if not candidate_rows:
        return [], timing_ms

    use_edge_sequence_cache = trip_edge_sequence_cache_exists()
    use_road_feature_cache = road_edge_feature_cache_exists()
    edge_sql = text(
        """
        WITH candidate_trips_limited AS (
            SELECT *
            FROM jsonb_to_recordset(CAST(:candidate_rows_json AS jsonb)) AS ct(
                taxi_id bigint,
                trip_id bigint,
                start_time timestamp,
                a_enter_time timestamp,
                b_enter_time timestamp,
                duration_seconds double precision
            )
        )
        SELECT
            ct.taxi_id,
            ct.trip_id,
            ct.start_time,
            ct.a_enter_time,
            ct.b_enter_time,
            ct.duration_seconds,
            e.edge_seq,
            e.road_uid
        FROM candidate_trips_limited ct
        JOIN matched_trip_edges e
          ON e.taxi_id = ct.taxi_id
         AND e.trip_id = ct.trip_id
        ORDER BY ct.taxi_id ASC, ct.trip_id ASC, e.edge_seq ASC
        """
    )
    edge_cache_sql = text(
        """
        WITH candidate_trips_limited AS (
            SELECT *
            FROM jsonb_to_recordset(CAST(:candidate_rows_json AS jsonb)) AS ct(
                taxi_id bigint,
                trip_id bigint,
                start_time timestamp,
                a_enter_time timestamp,
                b_enter_time timestamp,
                duration_seconds double precision
            )
        )
        SELECT
            ct.taxi_id,
            ct.trip_id,
            ct.start_time,
            ct.a_enter_time,
            ct.b_enter_time,
            ct.duration_seconds,
            esc.road_uid_array
        FROM candidate_trips_limited ct
        JOIN trip_edge_sequence_cache esc
          ON esc.taxi_id = ct.taxi_id
         AND esc.trip_id = ct.trip_id
        """
    )
    road_sql = text(
        """
        SELECT
            r.edge_uid AS road_uid,
            COALESCE(NULLIF(BTRIM(r.highway), ''), '') AS highway_class,
            NULLIF(BTRIM(r.name), '') AS road_name,
            COALESCE(NULLIF(r.length, 0), ST_Length(r.geometry::geography)) AS segment_length_m,
            ST_Intersects(
                r.geometry,
                ST_MakeEnvelope(:a_min_lon, :a_min_lat, :a_max_lon, :a_max_lat, 4326)
            ) AS in_a,
            ST_Intersects(
                r.geometry,
                ST_MakeEnvelope(:b_min_lon, :b_min_lat, :b_max_lon, :b_max_lat, 4326)
            ) AS in_b
        FROM road_edges r
        WHERE r.edge_uid IN :road_uids
        """
    ).bindparams(bindparam("road_uids", expanding=True))
    road_feature_cache_sql = text(
        """
        SELECT
            road_uid,
            highway_class,
            road_group_key,
            segment_length_m,
            min_lon,
            min_lat,
            max_lon,
            max_lat
        FROM road_edge_feature_cache
        WHERE road_uid IN :road_uids
        """
    ).bindparams(bindparam("road_uids", expanding=True))
    exact_intersection_sql = text(
        """
        SELECT
            r.edge_uid AS road_uid,
            ST_Intersects(
                r.geometry,
                ST_MakeEnvelope(:a_min_lon, :a_min_lat, :a_max_lon, :a_max_lat, 4326)
            ) AS in_a,
            ST_Intersects(
                r.geometry,
                ST_MakeEnvelope(:b_min_lon, :b_min_lat, :b_max_lon, :b_max_lat, 4326)
            ) AS in_b
        FROM road_edges r
        WHERE r.edge_uid IN :road_uids
        """
    ).bindparams(bindparam("road_uids", expanding=True))

    total_edge_sql_ms = 0.0
    total_road_sql_ms = 0.0
    total_python_ms = 0.0
    sampled_trips: list[dict] = []
    trip_meta = {
        (int(row["taxi_id"]), int(row["trip_id"])): {
            "start_time": row["start_time"],
            "end_time": row["b_enter_time"],
            "duration_seconds": float(row["duration_seconds"] or 0.0),
        }
        for row in candidate_rows
    }
    chunk_count = max(1, math.ceil(len(candidate_rows) / max(1, chunk_size)))
    road_feature_meta_cache: dict[int, dict] = {}
    road_exact_intersection_cache: dict[int, tuple[bool, bool]] = {}
    road_token_cache: dict[int, tuple[str | None, tuple[str, ...]]] = {}

    for chunk_index in range(0, len(candidate_rows), max(1, chunk_size)):
        chunk_rows = candidate_rows[chunk_index : chunk_index + max(1, chunk_size)]
        candidate_rows_json = json.dumps(
            [
                {
                    "taxi_id": int(row["taxi_id"]),
                    "trip_id": int(row["trip_id"]),
                    "start_time": row["start_time"].isoformat() if row["start_time"] is not None else None,
                    "a_enter_time": row["a_enter_time"].isoformat() if row["a_enter_time"] is not None else None,
                    "b_enter_time": row["b_enter_time"].isoformat() if row["b_enter_time"] is not None else None,
                    "duration_seconds": float(row["duration_seconds"] or 0.0),
                }
                for row in chunk_rows
            ]
        )

        phase_started_at = perf_counter()
        with engine.connect() as conn:
            edge_rows = conn.execute(
                edge_cache_sql if use_edge_sequence_cache else edge_sql,
                {"candidate_rows_json": candidate_rows_json},
            ).mappings().all()
        total_edge_sql_ms += round((perf_counter() - phase_started_at) * 1000, 2)

        if use_edge_sequence_cache:
            road_uids = sorted(
                {
                    int(road_uid)
                    for row in edge_rows
                    for road_uid in list(row["road_uid_array"] or [])
                    if road_uid is not None
                }
            )
        else:
            road_uids = sorted({int(row["road_uid"]) for row in edge_rows if row["road_uid"] is not None})
        if not road_uids:
            continue

        phase_started_at = perf_counter()
        missing_road_uids = [road_uid for road_uid in road_uids if road_uid not in road_feature_meta_cache]
        road_rows = []
        if missing_road_uids:
            with engine.connect() as conn:
                for road_index in range(0, len(missing_road_uids), max(1, road_chunk_size)):
                    road_uid_chunk = missing_road_uids[road_index : road_index + max(1, road_chunk_size)]
                    road_rows.extend(
                        conn.execute(
                            road_feature_cache_sql if use_road_feature_cache else road_sql,
                            (
                                {"road_uids": road_uid_chunk}
                                if use_road_feature_cache
                                else {
                                    "road_uids": road_uid_chunk,
                                    "a_min_lon": area_a_buffered["min_lon"],
                                    "a_min_lat": area_a_buffered["min_lat"],
                                    "a_max_lon": area_a_buffered["max_lon"],
                                    "a_max_lat": area_a_buffered["max_lat"],
                                    "b_min_lon": area_b_buffered["min_lon"],
                                    "b_min_lat": area_b_buffered["min_lat"],
                                    "b_max_lon": area_b_buffered["max_lon"],
                                    "b_max_lat": area_b_buffered["max_lat"],
                                }
                            ),
                        ).mappings().all()
                    )
        total_road_sql_ms += round((perf_counter() - phase_started_at) * 1000, 2)

        for row in road_rows:
            min_lon = float(row["min_lon"]) if use_road_feature_cache and row["min_lon"] is not None else None
            min_lat = float(row["min_lat"]) if use_road_feature_cache and row["min_lat"] is not None else None
            max_lon = float(row["max_lon"]) if use_road_feature_cache and row["max_lon"] is not None else None
            max_lat = float(row["max_lat"]) if use_road_feature_cache and row["max_lat"] is not None else None
            grid_token = None
            coarse_grid_token = None
            if min_lon is not None and min_lat is not None and max_lon is not None and max_lat is not None:
                grid_token = _f8_center_grid_token(min_lon, min_lat, max_lon, max_lat, 0.01)
                coarse_grid_token = _f8_center_grid_token(min_lon, min_lat, max_lon, max_lat, 0.02)
            road_feature_meta_cache[int(row["road_uid"])] = {
                "highway_class": str(row["highway_class"] or "").lower(),
                "road_group_key": _normalize_f8_road_group_key(
                    row["road_group_key"] if use_road_feature_cache else row["road_name"]
                ),
                "grid_token": grid_token,
                "coarse_grid_token": coarse_grid_token,
                "segment_length_m": float(row["segment_length_m"] or 0.0),
                "in_a": (
                    not (
                        max_lon is None
                        or min_lon is None
                        or max_lat is None
                        or min_lat is None
                        or max_lon < area_a_buffered["min_lon"]
                        or min_lon > area_a_buffered["max_lon"]
                        or max_lat < area_a_buffered["min_lat"]
                        or min_lat > area_a_buffered["max_lat"]
                    )
                    if use_road_feature_cache
                    else bool(row["in_a"])
                ),
                "in_b": (
                    not (
                        max_lon is None
                        or min_lon is None
                        or max_lat is None
                        or min_lat is None
                        or max_lon < area_b_buffered["min_lon"]
                        or min_lon > area_b_buffered["max_lon"]
                        or max_lat < area_b_buffered["min_lat"]
                        or min_lat > area_b_buffered["max_lat"]
                    )
                    if use_road_feature_cache
                    else bool(row["in_b"])
                ),
            }
        road_meta = {road_uid: road_feature_meta_cache[road_uid] for road_uid in road_uids if road_uid in road_feature_meta_cache}

        if use_road_feature_cache:
            candidate_exact_road_uids = sorted(
                [
                    road_uid
                    for road_uid, meta in road_meta.items()
                    if meta["in_a"] or meta["in_b"]
                ]
            )
            missing_exact_road_uids = [
                road_uid for road_uid in candidate_exact_road_uids if road_uid not in road_exact_intersection_cache
            ]
            if missing_exact_road_uids:
                phase_started_at = perf_counter()
                exact_rows = []
                for road_uid in missing_exact_road_uids:
                    road_exact_intersection_cache[road_uid] = (False, False)
                with engine.connect() as conn:
                    for exact_index in range(0, len(missing_exact_road_uids), max(1, road_chunk_size)):
                        exact_chunk = missing_exact_road_uids[exact_index : exact_index + max(1, road_chunk_size)]
                        exact_rows.extend(
                            conn.execute(
                                exact_intersection_sql,
                                {
                                    "road_uids": exact_chunk,
                                    "a_min_lon": area_a_buffered["min_lon"],
                                    "a_min_lat": area_a_buffered["min_lat"],
                                    "a_max_lon": area_a_buffered["max_lon"],
                                    "a_max_lat": area_a_buffered["max_lat"],
                                    "b_min_lon": area_b_buffered["min_lon"],
                                    "b_min_lat": area_b_buffered["min_lat"],
                                    "b_max_lon": area_b_buffered["max_lon"],
                                    "b_max_lat": area_b_buffered["max_lat"],
                                },
                            ).mappings().all()
                        )
                total_road_sql_ms += round((perf_counter() - phase_started_at) * 1000, 2)
                for row in exact_rows:
                    road_uid = int(row["road_uid"])
                    road_exact_intersection_cache[road_uid] = (bool(row["in_a"]), bool(row["in_b"]))
            for road_uid in candidate_exact_road_uids:
                exact_hit = road_exact_intersection_cache.get(road_uid)
                if exact_hit and road_uid in road_meta:
                    road_meta[road_uid]["in_a"], road_meta[road_uid]["in_b"] = exact_hit

        for road_uid, meta in road_meta.items():
            if road_uid in road_token_cache:
                continue
            token_key: str | None = None
            if meta["road_group_key"] is not None and (
                meta["highway_class"] in {"motorway", "trunk", "primary", "secondary"}
                or meta["segment_length_m"] >= major_road_min_length_m
            ) and meta["segment_length_m"] >= vector_min_edge_length_m:
                token_key = f"road:{meta['road_group_key']}"
            elif (
                meta["road_group_key"] is None
                and meta["highway_class"] in {"motorway", "trunk", "primary"}
                and meta["segment_length_m"] >= major_road_min_length_m
            ):
                token_key = f"edge:{road_uid}"

            vector_candidate_tokens: list[str] = []
            if token_key is not None:
                vector_candidate_tokens.append(token_key)
                if meta.get("grid_token"):
                    vector_candidate_tokens.append(meta["grid_token"])
                    if token_key.startswith("road:"):
                        vector_candidate_tokens.append(f"alias:{meta['grid_token']}")
                if token_key.startswith("road:"):
                    vector_candidate_tokens.extend(
                        _f8_road_alias_tokens(
                            meta.get("road_group_key"),
                            meta.get("highway_class"),
                            meta.get("coarse_grid_token"),
                        )
                    )
            road_token_cache[road_uid] = (token_key, tuple(vector_candidate_tokens))

        phase_started_at = perf_counter()
        if use_edge_sequence_cache:
            for row in edge_rows:
                trip_key = (int(row["taxi_id"]), int(row["trip_id"]))
                road_uid_array = list(row["road_uid_array"] or [])
                b_seq = None
                a_seq = None
                last_a_seq = None
                for edge_index, raw_road_uid in enumerate(road_uid_array):
                    if raw_road_uid is None:
                        continue
                    edge_seq = edge_index + 1
                    road_uid = int(raw_road_uid)
                    meta = road_meta.get(road_uid)
                    if not meta:
                        continue
                    if meta.get("in_b") and last_a_seq is not None and last_a_seq < edge_seq:
                        a_seq = last_a_seq
                        b_seq = edge_seq
                        break
                    if meta.get("in_a"):
                        last_a_seq = edge_seq
                if a_seq is None or b_seq is None:
                    continue

                ab_road_uids: list[int] = []
                route_length_m = 0.0
                start_index = max(0, int(a_seq) - 1)
                stop_index = min(len(road_uid_array), int(b_seq))
                for edge_index in range(start_index, stop_index):
                    raw_road_uid = road_uid_array[edge_index]
                    if raw_road_uid is None:
                        continue
                    road_uid = int(raw_road_uid)
                    ab_road_uids.append(road_uid)
                    route_length_m += float(road_meta.get(road_uid, {}).get("segment_length_m", 0.0))
                if route_length_m < min_route_length_m:
                    continue

                vector_tokens: list[str] = []
                sequence_tokens: list[str] = []
                seen_vector_tokens: set[str] = set()
                prev_sequence_token: str | None = None
                ab_edge_count = len(ab_road_uids)
                for edge_offset, road_uid in enumerate(ab_road_uids):
                    meta = road_meta.get(road_uid)
                    anchor_tokens: list[str] = []
                    if edge_offset < 3:
                        anchor_tokens.append(f"anchor:start:{road_uid}")
                    if edge_offset >= max(0, ab_edge_count - 3):
                        anchor_tokens.append(f"anchor:end:{road_uid}")
                    for anchor_token in anchor_tokens:
                        if anchor_token != prev_sequence_token:
                            sequence_tokens.append(anchor_token)
                            prev_sequence_token = anchor_token
                    if not meta:
                        continue
                    token_key, vector_candidate_tokens = road_token_cache.get(road_uid, (None, ()))
                    if token_key is None:
                        continue
                    for vector_token in vector_candidate_tokens:
                        if vector_token not in seen_vector_tokens:
                            seen_vector_tokens.add(vector_token)
                            vector_tokens.append(vector_token)
                    if token_key != prev_sequence_token:
                        sequence_tokens.append(token_key)
                        prev_sequence_token = token_key

                if not vector_tokens:
                    continue

                meta = trip_meta[trip_key]
                sampled_trips.append(
                    {
                        "taxi_id": trip_key[0],
                        "trip_id": trip_key[1],
                        "start_time": meta["start_time"],
                        "end_time": meta["end_time"],
                        "duration_seconds": meta["duration_seconds"],
                        "route_length_m": float(route_length_m),
                        "raw_edge_count": ab_edge_count,
                        "a_seq": a_seq,
                        "b_seq": b_seq,
                        "vector_tokens": vector_tokens,
                        "sequence_tokens": sequence_tokens or vector_tokens,
                    }
                )
        else:
            grouped_edges: dict[tuple[int, int], list[tuple[int, int]]] = defaultdict(list)
            for row in edge_rows:
                grouped_edges[(int(row["taxi_id"]), int(row["trip_id"]))].append((int(row["edge_seq"]), int(row["road_uid"])))

            for trip_key, ordered_edges in grouped_edges.items():
                b_seq = None
                a_seq = None
                last_a_seq = None
                for edge_seq, road_uid in ordered_edges:
                    meta = road_meta.get(road_uid)
                    if not meta:
                        continue
                    if meta.get("in_b") and last_a_seq is not None and last_a_seq < edge_seq:
                        a_seq = last_a_seq
                        b_seq = edge_seq
                        break
                    if meta.get("in_a"):
                        last_a_seq = edge_seq
                if a_seq is None or b_seq is None:
                    continue

                ab_edges = [(edge_seq, road_uid) for edge_seq, road_uid in ordered_edges if a_seq <= edge_seq <= b_seq]
                route_length_m = sum(road_meta.get(road_uid, {}).get("segment_length_m", 0.0) for _, road_uid in ab_edges)
                if route_length_m < min_route_length_m:
                    continue

                vector_tokens: list[str] = []
                sequence_tokens: list[str] = []
                seen_vector_tokens: set[str] = set()
                prev_sequence_token: str | None = None
                ab_edge_count = len(ab_edges)
                for edge_offset, (_, road_uid) in enumerate(ab_edges):
                    meta = road_meta.get(road_uid)
                    anchor_tokens: list[str] = []
                    if edge_offset < 3:
                        anchor_tokens.append(f"anchor:start:{road_uid}")
                    if edge_offset >= max(0, ab_edge_count - 3):
                        anchor_tokens.append(f"anchor:end:{road_uid}")
                    for anchor_token in anchor_tokens:
                        if anchor_token != prev_sequence_token:
                            sequence_tokens.append(anchor_token)
                            prev_sequence_token = anchor_token
                    if not meta:
                        continue
                    token_key, vector_candidate_tokens = road_token_cache.get(road_uid, (None, ()))
                    if token_key is None:
                        continue
                    for vector_token in vector_candidate_tokens:
                        if vector_token not in seen_vector_tokens:
                            seen_vector_tokens.add(vector_token)
                            vector_tokens.append(vector_token)
                    if token_key != prev_sequence_token:
                        sequence_tokens.append(token_key)
                        prev_sequence_token = token_key

                if not vector_tokens:
                    continue

                meta = trip_meta[trip_key]
                sampled_trips.append(
                    {
                        "taxi_id": trip_key[0],
                        "trip_id": trip_key[1],
                        "start_time": meta["start_time"],
                        "end_time": meta["end_time"],
                        "duration_seconds": meta["duration_seconds"],
                        "route_length_m": float(route_length_m),
                        "raw_edge_count": len(ab_edges),
                        "a_seq": a_seq,
                        "b_seq": b_seq,
                        "vector_tokens": vector_tokens,
                        "sequence_tokens": sequence_tokens or vector_tokens,
                    }
                )
        total_python_ms += round((perf_counter() - phase_started_at) * 1000, 2)

    timing_ms["candidate_edge_sql"] = round(total_edge_sql_ms, 2)
    timing_ms["road_metadata_sql"] = round(total_road_sql_ms, 2)
    timing_ms["python_subpath_tokenize"] = round(total_python_ms, 2)
    timing_ms["candidate_edge_chunk_count"] = float(chunk_count)
    timing_ms["candidate_edge_chunk_size"] = float(max(1, chunk_size))
    timing_ms["road_metadata_chunk_size"] = float(max(1, road_chunk_size))
    timing_ms["road_metadata_cached_uid_count"] = float(len(road_feature_meta_cache))
    timing_ms["road_exact_cached_uid_count"] = float(len(road_exact_intersection_cache))
    timing_ms["road_token_cached_uid_count"] = float(len(road_token_cache))
    timing_ms["use_edge_sequence_cache"] = float(1 if use_edge_sequence_cache else 0)
    timing_ms["use_road_feature_cache"] = float(1 if use_road_feature_cache else 0)

    sampled_trips.sort(key=lambda trip: (trip["start_time"], trip["taxi_id"], trip["trip_id"]))
    return sampled_trips, timing_ms


def _format_f8_token(token: str) -> str:
    if token.startswith("road:"):
        return token.split(":", 1)[1]
    if token.startswith("edge:"):
        return f"edge#{token.split(':', 1)[1]}"
    if token.startswith("anchor:start:"):
        return f"start-anchor#{token.rsplit(':', 1)[-1]}"
    if token.startswith("anchor:end:"):
        return f"end-anchor#{token.rsplit(':', 1)[-1]}"
    return token


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    arr = sorted(values)
    if len(arr) == 1:
        return float(arr[0])
    pos = (len(arr) - 1) * max(0.0, min(1.0, q))
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return float(arr[lo])
    weight = pos - lo
    return float(arr[lo] * (1 - weight) + arr[hi] * weight)



def _f7_select_top_group_candidates(payload: F7FrequentPathsRequest) -> list[dict]:
    order_by = f7_order_by_clause(payload.sort_mode, has_edge_pass_weight=True)
    if f7_scope_uses_bbox(payload):
        sql = text(
            f"""
            WITH analysis AS (
                SELECT ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326) AS bbox_geom
            ),
            candidate_groups AS MATERIALIZED (
                SELECT
                    road_group_key,
                    MIN(road_name) AS road_name,
                    STRING_AGG(DISTINCT highway, ', ' ORDER BY highway) FILTER (WHERE highway IS NOT NULL AND highway <> '') AS highway,
                    BOOL_OR(LOWER(COALESCE(oneway_raw, '')) IN ('yes', 'true', '1', 't', '-1', 'reverse', 'backward')) AS has_oneway_segment,
                    COUNT(DISTINCT road_uid)::bigint AS segment_count,
                    SUM(DISTINCT segment_length_m) AS matched_segment_length_m,
                    SUM(segment_length_m) AS group_length_m
                FROM (
                    SELECT
                        r.edge_uid AS road_uid,
                        COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) AS road_group_key,
                        COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) AS road_name,
                        r.highway,
                        r.oneway::text AS oneway_raw,
                        CASE
                            WHEN r.length IS NOT NULL AND r.length > 0 THEN r.length
                            ELSE ST_Length(r.geometry::geography)
                        END AS segment_length_m
                    FROM road_edges r
                    CROSS JOIN analysis a
                    WHERE r.geometry && a.bbox_geom
                ) candidate_roads
                GROUP BY road_group_key
                HAVING SUM(segment_length_m) >= :min_group_length_m
            ),
            grouped_paths AS (
                SELECT
                    cg.road_group_key,
                    gp.direction,
                    cg.road_name,
                    cg.highway,
                    cg.has_oneway_segment,
                    cg.segment_count,
                    gp.trip_count,
                    gp.vehicle_count,
                    gp.edge_pass_weight,
                    cg.matched_segment_length_m,
                    cg.group_length_m
                FROM candidate_groups cg
                JOIN LATERAL (
                    SELECT
                        g.direction,
                        SUM(g.trip_count)::bigint AS trip_count,
                        SUM(g.vehicle_count)::bigint AS vehicle_count,
                        SUM(g.edge_pass_weight)::bigint AS edge_pass_weight
                    FROM matched_road_group_hourly_counts g
                    WHERE g.road_group_key = cg.road_group_key
                      AND g.hour_bucket >= date_trunc('hour', CAST(:start_time AS timestamp))
                      AND g.hour_bucket <= date_trunc('hour', CAST(:end_time AS timestamp))
                    GROUP BY g.direction
                ) gp ON TRUE
            )
            SELECT *
            FROM grouped_paths
            ORDER BY {order_by}
            LIMIT :candidate_limit
            """
        )
    else:
        sql = text(
            f"""
            WITH grouped_paths AS MATERIALIZED (
                SELECT
                    g.road_group_key,
                    g.direction,
                    SUM(g.trip_count)::bigint AS trip_count,
                    SUM(g.vehicle_count)::bigint AS vehicle_count,
                    SUM(g.edge_pass_weight)::bigint AS edge_pass_weight
                FROM matched_road_group_hourly_counts g
                WHERE g.hour_bucket >= date_trunc('hour', CAST(:start_time AS timestamp))
                  AND g.hour_bucket <= date_trunc('hour', CAST(:end_time AS timestamp))
                GROUP BY
                    g.road_group_key,
                    g.direction
            ),
            active_groups AS MATERIALIZED (
                SELECT road_group_key
                FROM grouped_paths
                GROUP BY road_group_key
            ),
            candidate_groups AS (
                SELECT
                    road_group_key,
                    MIN(road_name) AS road_name,
                    STRING_AGG(DISTINCT highway, ', ' ORDER BY highway) FILTER (WHERE highway IS NOT NULL AND highway <> '') AS highway,
                    BOOL_OR(LOWER(COALESCE(oneway_raw, '')) IN ('yes', 'true', '1', 't', '-1', 'reverse', 'backward')) AS has_oneway_segment,
                    COUNT(DISTINCT road_uid)::bigint AS segment_count,
                    SUM(DISTINCT segment_length_m) AS matched_segment_length_m,
                    SUM(segment_length_m) AS group_length_m
                FROM (
                    SELECT
                        r.edge_uid AS road_uid,
                        ag.road_group_key,
                        ag.road_group_key AS road_name,
                        r.highway,
                        r.oneway::text AS oneway_raw,
                        CASE
                            WHEN r.length IS NOT NULL AND r.length > 0 THEN r.length
                            ELSE ST_Length(r.geometry::geography)
                        END AS segment_length_m
                    FROM active_groups ag
                    JOIN road_edges r
                      ON COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) = ag.road_group_key
                ) candidate_roads
                GROUP BY road_group_key
                HAVING SUM(segment_length_m) >= :min_group_length_m
            )
            SELECT
                gp.road_group_key,
                gp.direction,
                cg.road_name,
                cg.highway,
                cg.has_oneway_segment,
                cg.segment_count,
                gp.trip_count,
                gp.vehicle_count,
                gp.edge_pass_weight,
                cg.matched_segment_length_m,
                cg.group_length_m
            FROM grouped_paths gp
            JOIN candidate_groups cg
              ON cg.road_group_key = gp.road_group_key
            ORDER BY {order_by}
            LIMIT :candidate_limit
            """
        )

    params = {
        "start_time": payload.start_time,
        "end_time": payload.end_time,
        "min_lon": payload.analysis_bbox.min_lon,
        "min_lat": payload.analysis_bbox.min_lat,
        "max_lon": payload.analysis_bbox.max_lon,
        "max_lat": payload.analysis_bbox.max_lat,
        "candidate_limit": _f7_stage2_candidate_limit(payload),
        "min_group_length_m": payload.min_group_length_m,
        "use_bbox": f7_scope_uses_bbox(payload),
    }

    with engine.connect() as conn:
        raw_rows = [dict(row) for row in conn.execute(sql, params).mappings().all()]

    family_rows: dict[tuple[str, int], dict] = {}
    for raw in raw_rows:
        family_key = _f7_macro_corridor_key(raw.get("road_name") or raw.get("road_group_key")) or str(raw["road_group_key"])
        direction = int(raw.get("direction") or 0)
        bucket = family_rows.setdefault(
            (family_key, direction),
            {
                "road_group_key": family_key,
                "road_name": family_key,
                "direction": direction,
                "highway_values": set(),
                "has_oneway_segment": False,
                "segment_count": 0,
                "trip_count": 0,
                "vehicle_count": 0,
                "edge_pass_weight": 0,
                "matched_segment_length_m": 0.0,
                "group_length_m": 0.0,
                "_candidate_pairs": [],
            },
        )
        if raw.get("highway"):
            bucket["highway_values"].update(value.strip() for value in str(raw["highway"]).split(",") if value.strip())
        bucket["has_oneway_segment"] = bucket["has_oneway_segment"] or bool(raw.get("has_oneway_segment"))
        bucket["segment_count"] += int(raw.get("segment_count") or 0)
        bucket["trip_count"] += int(raw.get("trip_count") or 0)
        bucket["vehicle_count"] += int(raw.get("vehicle_count") or 0)
        bucket["edge_pass_weight"] += int(raw.get("edge_pass_weight") or 0)
        bucket["matched_segment_length_m"] += float(raw.get("matched_segment_length_m") or 0.0)
        bucket["group_length_m"] += float(raw.get("group_length_m") or 0.0)
        candidate_pair = {
            "road_group_key": str(raw["road_group_key"]),
            "direction": direction,
        }
        if candidate_pair not in bucket["_candidate_pairs"] and len(bucket["_candidate_pairs"]) < F7_STAGE2_MAX_RAW_PAIRS_PER_FAMILY:
            bucket["_candidate_pairs"].append(candidate_pair)

    merged_rows = []
    for row in family_rows.values():
        merged_rows.append(
            {
                **row,
                "highway": ", ".join(sorted(row.pop("highway_values"))) or None,
            }
        )
    return _f7_rank_corridor_rows(merged_rows, payload)[: payload.top_k]



def _f7_fetch_hourly_edge_rows_for_candidate_pairs(
    payload: F7FrequentPathsRequest,
    candidate_pairs: list[dict],
) -> list[dict]:
    if not candidate_pairs:
        return []

    sql = text(
        """
        WITH analysis AS (
            SELECT ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326) AS bbox_geom
        ),
        candidate_pairs AS MATERIALIZED (
            SELECT
                item->>'road_group_key' AS road_group_key,
                (item->>'direction')::smallint AS direction
            FROM jsonb_array_elements(CAST(:candidate_pairs_json AS jsonb)) AS item
        ),
        candidate_roads AS MATERIALIZED (
            SELECT
                r.edge_uid AS road_uid,
                r.u AS u_node,
                r.v AS v_node,
                COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) AS road_group_key,
                cp.direction,
                COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) AS road_name,
                r.highway,
                r.oneway::text AS oneway_raw,
                r.geometry AS road_geom,
                CASE
                    WHEN r.length IS NOT NULL AND r.length > 0 THEN r.length
                    ELSE ST_Length(r.geometry::geography)
                END AS segment_length_m
            FROM road_edges r
            JOIN candidate_pairs cp
              ON cp.road_group_key = COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text))
            CROSS JOIN analysis a
            WHERE (:use_bbox = FALSE OR r.geometry && a.bbox_geom)
        ),
        edge_stats AS (
            SELECT
                cr.road_uid,
                cr.u_node,
                cr.v_node,
                cr.road_group_key,
                cr.direction,
                cr.road_name,
                cr.highway,
                LOWER(COALESCE(cr.oneway_raw, '')) IN ('yes', 'true', '1', 't', '-1', 'reverse', 'backward') AS has_oneway_segment,
                h.trip_count,
                h.vehicle_count,
                h.edge_pass_weight,
                cr.segment_length_m AS matched_segment_length_m,
                ST_AsGeoJSON(cr.road_geom) AS geometry
            FROM candidate_roads cr
            JOIN LATERAL (
                SELECT
                    SUM(h.trip_count)::bigint AS trip_count,
                    SUM(h.vehicle_count)::bigint AS vehicle_count,
                    SUM(h.trip_count)::bigint AS edge_pass_weight
                FROM matched_road_hourly_counts h
                WHERE h.road_uid = cr.road_uid
                  AND h.direction = cr.direction
                  AND h.hour_bucket >= date_trunc('hour', CAST(:start_time AS timestamp))
                  AND h.hour_bucket <= date_trunc('hour', CAST(:end_time AS timestamp))
            ) h ON h.trip_count IS NOT NULL
        )
        SELECT *
        FROM edge_stats
        """
    )

    params = {
        "start_time": payload.start_time,
        "end_time": payload.end_time,
        "min_lon": payload.analysis_bbox.min_lon,
        "min_lat": payload.analysis_bbox.min_lat,
        "max_lon": payload.analysis_bbox.max_lon,
        "max_lat": payload.analysis_bbox.max_lat,
        "use_bbox": f7_scope_uses_bbox(payload),
        "candidate_pairs_json": json.dumps(candidate_pairs, ensure_ascii=False),
    }

    with engine.connect() as conn:
        return [dict(row) for row in conn.execute(sql, params).mappings().all()]



def get_f7_frequent_paths_from_group_hourly_counts(payload: F7FrequentPathsRequest, started_at: float) -> dict:
    phase_started_at = perf_counter()
    candidate_rows = _f7_select_top_group_candidates(payload)
    candidate_stage_ms = round((perf_counter() - phase_started_at) * 1000, 2)

    phase_started_at = perf_counter()
    candidate_pairs = []
    raw_to_family: dict[tuple[str, int], tuple[str, str]] = {}
    for row in candidate_rows:
        for pair in row.get("_candidate_pairs") or []:
            raw_key = str(pair["road_group_key"])
            direction = int(pair.get("direction") or 0)
            raw_to_family[(raw_key, direction)] = (str(row["road_group_key"]), str(row.get("road_name") or row["road_group_key"]))
            if pair not in candidate_pairs:
                candidate_pairs.append(pair)
    if not candidate_pairs:
        response = build_f7_paths_response([], started_at, "two_stage_group_hourly_exact_components", "group_hourly_candidates_plus_exact_component_backbone", payload)
        response["meta"]["candidate_stage_count"] = 0
        response["meta"]["phase_timings_ms"] = {
            "candidate": candidate_stage_ms,
            "candidate_pair_build": round((perf_counter() - phase_started_at) * 1000, 2),
            "edge_fetch": 0.0,
            "component_build": 0.0,
            "merge": 0.0,
        }
        return response
    candidate_pair_build_ms = round((perf_counter() - phase_started_at) * 1000, 2)

    phase_started_at = perf_counter()
    edge_rows = _f7_fetch_hourly_edge_rows_for_candidate_pairs(payload, candidate_pairs)
    edge_fetch_ms = round((perf_counter() - phase_started_at) * 1000, 2)

    phase_started_at = perf_counter()
    normalized_edge_rows = []
    for row in edge_rows:
        normalized = dict(row)
        family = raw_to_family.get((str(normalized["road_group_key"]), int(normalized.get("direction") or 0)))
        if family:
            normalized["road_group_key"] = family[0]
            normalized["road_name"] = family[1]
        normalized_edge_rows.append(normalized)
    component_rows = _f7_build_directed_corridor_rows(normalized_edge_rows, payload)
    component_build_ms = round((perf_counter() - phase_started_at) * 1000, 2)

    phase_started_at = perf_counter()
    merged_rows = _f7_merge_component_rows_to_road_groups(component_rows, payload)
    merge_ms = round((perf_counter() - phase_started_at) * 1000, 2)
    merged_by_pair = {
        (str(row["road_group_key"]), int(row.get("direction") or 0)): row
        for row in merged_rows
    }
    total_ranked_trip_count = sum(int(row.get("trip_count") or 0) for row in candidate_rows)
    total_edge_pass_weight = sum(int(row.get("edge_pass_weight") or 0) for row in candidate_rows)
    total_path_count = len(candidate_rows)

    top_rows: list[dict] = []
    for candidate in candidate_rows:
        pair_key = (str(candidate["road_group_key"]), int(candidate.get("direction") or 0))
        merged = merged_by_pair.get(pair_key)
        if not merged:
            continue
        row = {**merged}
        row["trip_count"] = int(candidate.get("trip_count") or 0)
        row["vehicle_count"] = int(candidate.get("vehicle_count") or 0)
        row["edge_pass_weight"] = int(candidate.get("edge_pass_weight") or 0)
        row["segment_count"] = int(candidate.get("segment_count") or row.get("segment_count") or 0)
        row["group_length_m"] = float(candidate.get("group_length_m") or row.get("group_length_m") or 0.0)
        row["matched_segment_length_m"] = float(row.get("matched_segment_length_m") or 0.0)
        row["road_name"] = candidate.get("road_name") or row.get("road_name")
        row["highway"] = candidate.get("highway") or row.get("highway")
        row["has_oneway_segment"] = bool(candidate.get("has_oneway_segment"))
        row["total_ranked_trip_count"] = total_ranked_trip_count
        row["total_edge_pass_weight"] = total_edge_pass_weight
        row["total_path_count"] = total_path_count
        top_rows.append(row)

    response = build_f7_paths_response(
        top_rows,
        started_at,
        "two_stage_group_hourly_edge_backbone",
        "group_hourly_candidates_plus_hourly_edge_backbone",
        payload,
    )
    response["summary"]["candidate_trip_count"] = sum(int(row.get("trip_count") or 0) for row in candidate_rows)
    response["summary"]["sampled_trip_count"] = len(candidate_pairs)
    response["summary"]["sample_ratio"] = 1
    response["meta"]["sampling_mode"] = "full"
    response["meta"]["metric_mode"] = "hourly_rollup_trip_count"
    response["meta"]["vehicle_count_mode"] = "hourly_distinct_sum"
    response["meta"]["candidate_stage_count"] = len(candidate_pairs)
    response["meta"]["candidate_stage_mode"] = "road_group_hourly_rollup"
    response["meta"]["corridor_object"] = "road_group_key + direction + component_id"
    response["meta"]["phase_timings_ms"] = {
        "candidate": candidate_stage_ms,
        "candidate_pair_build": candidate_pair_build_ms,
        "edge_fetch": edge_fetch_ms,
        "component_build": component_build_ms,
        "merge": merge_ms,
    }
    response["meta"]["time_bucket_note"] = "Stage 1 ranks road_group_key + direction with hourly rollups; Stage 2 reconstructs directed topology from matched_road_hourly_counts only for Top-K candidates."
    response["meta"]["metric_note"] = "Final trip_count and vehicle_count stay on the hourly rollup metric. Stage 2 only refines geometry into topology-aware backbones and fragments."
    return response


def get_f7_frequent_paths_from_hourly_counts(payload: F7FrequentPathsRequest, started_at: float) -> dict:
    """Fallback fast path: road-edge hourly weights plus exact Top-K details.

    This is kept for deployments that have not built matched_road_group_hourly_counts yet.
    """
    sql = text(
        """
        WITH analysis AS (
            SELECT ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326) AS bbox_geom
        ),
        candidate_roads AS (
            SELECT
                r.edge_uid AS road_uid,
                r.u AS u_node,
                r.v AS v_node,
                COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) AS road_group_key,
                COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) AS road_name,
                r.highway,
                r.oneway::text AS oneway_raw,
                r.geometry AS road_geom,
                CASE
                    WHEN r.length IS NOT NULL AND r.length > 0 THEN r.length
                    ELSE ST_Length(r.geometry::geography)
                END AS segment_length_m
            FROM road_edges r
            CROSS JOIN analysis a
            WHERE (:use_bbox = FALSE OR r.geometry && a.bbox_geom)
        ),
        edge_stats AS (
            SELECT
                cr.road_uid,
                cr.u_node,
                cr.v_node,
                cr.road_group_key,
                h.direction,
                MIN(cr.road_name) AS road_name,
                STRING_AGG(DISTINCT cr.highway, ', ' ORDER BY cr.highway) FILTER (WHERE cr.highway IS NOT NULL AND cr.highway <> '') AS highway,
                BOOL_OR(LOWER(COALESCE(cr.oneway_raw, '')) IN ('yes', 'true', '1', 't', '-1', 'reverse', 'backward')) AS has_oneway_segment,
                SUM(h.trip_count)::bigint AS trip_count,
                SUM(h.vehicle_count)::bigint AS vehicle_count,
                SUM(h.trip_count)::bigint AS edge_pass_weight,
                MAX(cr.segment_length_m) AS matched_segment_length_m,
                ST_AsGeoJSON(cr.road_geom) AS geometry
            FROM matched_road_hourly_counts h
            JOIN candidate_roads cr
              ON cr.road_uid = h.road_uid
            WHERE h.hour_bucket >= date_trunc('hour', CAST(:start_time AS timestamp))
              AND h.hour_bucket <= date_trunc('hour', CAST(:end_time AS timestamp))
            GROUP BY
                cr.road_uid,
                cr.u_node,
                cr.v_node,
                cr.road_group_key,
                h.direction,
                cr.road_geom
        )
        SELECT *
        FROM edge_stats
        """
    )

    params = {
        "start_time": payload.start_time,
        "end_time": payload.end_time,
        "min_lon": payload.analysis_bbox.min_lon,
        "min_lat": payload.analysis_bbox.min_lat,
        "max_lon": payload.analysis_bbox.max_lon,
        "max_lat": payload.analysis_bbox.max_lat,
        "top_k": payload.top_k,
        "min_group_length_m": payload.min_group_length_m,
        "use_bbox": f7_scope_uses_bbox(payload),
    }

    with engine.connect() as conn:
        edge_rows = conn.execute(sql, params).mappings().all()

    component_rows = _f7_build_directed_corridor_rows([dict(row) for row in edge_rows], payload)
    merged_rows = _f7_merge_component_rows_to_road_groups(component_rows, payload)
    total_ranked_trip_count = sum(int(row.get("trip_count") or 0) for row in merged_rows)
    total_edge_pass_weight = sum(int(row.get("edge_pass_weight") or 0) for row in merged_rows)
    total_path_count = len(merged_rows)
    top_rows = merged_rows[: payload.top_k]
    for row in top_rows:
        row["total_ranked_trip_count"] = total_ranked_trip_count
        row["total_edge_pass_weight"] = total_edge_pass_weight
        row["total_path_count"] = total_path_count

    return build_f7_paths_response(top_rows, started_at, "full_hourly_road_counts", "full_data_hourly_component_backbone", payload)


def build_f7_paths_response(
    rows,
    started_at: float,
    logic_mode: str,
    precision_level: str,
    payload: F7FrequentPathsRequest | None = None,
) -> dict:
    uses_exact_passes = logic_mode == "full_matched_trip_road_passes"
    paths = []
    top_k_trip_count = 0
    max_trip_count = 0
    max_vehicle_count = 0
    total_ranked_trip_count = 0
    top_k_edge_pass_weight = 0
    total_edge_pass_weight = 0
    total_path_count = 0

    for index, row in enumerate(rows, start=1):
        trip_count = int(row["trip_count"] or 0)
        vehicle_count = int(row["vehicle_count"] or 0)
        edge_pass_weight = int(row["edge_pass_weight"] or 0)
        top_k_trip_count += trip_count
        top_k_edge_pass_weight += edge_pass_weight
        max_trip_count = max(max_trip_count, trip_count)
        max_vehicle_count = max(max_vehicle_count, vehicle_count)
        total_ranked_trip_count = int(row["total_ranked_trip_count"] or 0)
        total_edge_pass_weight = int(row["total_edge_pass_weight"] or 0)
        total_path_count = int(row["total_path_count"] or 0)
        geometry = _f7_preserve_line_geometry(json.loads(row["geometry"])) if row.get("geometry") else None
        geometry_backbone = _f7_preserve_line_geometry(json.loads(row["geometry_backbone"])) if row.get("geometry_backbone") else geometry
        geometry_branches = json.loads(row["geometry_branches"]) if row.get("geometry_branches") else None
        paths.append(
            {
                "rank": index,
                "road_group_key": row["road_group_key"],
                "corridor_component_id": int(row.get("corridor_component_id") or row.get("component_id") or 0),
                "corridor_component_ids": list(row.get("component_ids") or []),
                "normalized_road_group_key": _normalize_f8_road_group_key(row["road_group_key"]) or row["road_group_key"],
                "road_name": row["road_name"],
                "highway": row["highway"],
                "direction": "forward" if int(row["direction"] or 0) > 0 else "reverse" if int(row["direction"] or 0) < 0 else "unknown",
                "direction_value": int(row["direction"] or 0),
                "direction_supported": True,
                "trip_count": trip_count,
                "vehicle_count": vehicle_count,
                "edge_pass_weight": edge_pass_weight,
                "segment_count": int(row["segment_count"] or 0),
                "group_length_m": float(row["group_length_m"] or 0.0),
                "matched_segment_length_m": float(row["matched_segment_length_m"] or 0.0),
                "has_oneway_segment": bool(row["has_oneway_segment"]),
                "geometry": geometry_backbone,
                "geometry_backbone": geometry_backbone,
                "geometry_branches": geometry_branches,
                "is_fragmented": bool(row.get("is_fragmented", False)),
                "fragment_count": int(row.get("fragment_count") or 1),
                "branch_count": int(row.get("branch_count") or 0),
                "backbone_segment_count": int(row.get("backbone_segment_count") or row["segment_count"] or 0),
                "corridor_confidence": float(row.get("corridor_confidence") or 1.0),
            }
        )

    elapsed_ms = round((perf_counter() - started_at) * 1000, 2)
    return {
        "corridors": paths,
        "paths": paths,
        "summary": {
            "path_count": len(paths),
            "total_path_count_before_top_k": total_path_count,
            "top_k_trip_count": top_k_trip_count,
            "total_ranked_trip_count": total_ranked_trip_count,
            "top_k_ratio": (top_k_trip_count / total_ranked_trip_count) if total_ranked_trip_count > 0 else 0,
            "max_trip_count": max_trip_count,
            "max_vehicle_count": max_vehicle_count,
            "top_k_edge_pass_weight": top_k_edge_pass_weight,
            "total_edge_pass_weight": total_edge_pass_weight,
            "candidate_trip_count": None,
            "sampled_trip_count": None,
            "sample_ratio": 1,
        },
        "meta": {
            "logic_mode": logic_mode,
            "precision_level": precision_level,
            "sampling_mode": "full",
            "metric_mode": "exact_trip_count",
            "direction_supported": True,
            "direction_note": "Direction is relative to each road edge geometry direction.",
            "corridor_geometry_mode": "directed_topology_backbone",
            "corridor_geometry_note": "F7 now prioritizes continuous continuation for long corridors by merging topology fragments within the same road group and direction into one backbone-oriented result when possible.",
            "continuity_priority": True,
            "time_bucket_note": (
                "F7 exact mode filters trip-road passes by trip time overlap."
                if uses_exact_passes
                else "F7 fast mode uses full-data hourly rollups by trip start hour for interactive querying."
            ),
            "metric_note": (
                "trip_count is an exact distinct trip count over matched trip-road passes. edge_pass_weight is retained as the corridor intensity metric."
                if uses_exact_passes
                else "trip_count is a full-data hourly unique trip count. edge_pass_weight is retained as the corridor intensity metric."
            ),
            **(
                {
                    "scope": payload.scope,
                    "sort_mode": payload.sort_mode,
                    "analysis_bbox": payload.analysis_bbox.model_dump(),
                    "top_k": payload.top_k,
                    "min_group_length_m": payload.min_group_length_m,
                    "exact_window_limit_hours": F7_EXACT_WINDOW_LIMIT_HOURS,
                    "requested_window_hours": round((payload.end_time - payload.start_time).total_seconds() / 3600.0, 2),
                }
                if payload is not None
                else {}
            ),
            "elapsed_ms": elapsed_ms,
        },
    }


def get_f7_frequent_paths_from_road_passes(payload: F7FrequentPathsRequest, started_at: float) -> dict:
    sql = text(
        """
        WITH analysis AS (
            SELECT ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326) AS bbox_geom
        ),
        candidate_roads AS (
            SELECT
                r.edge_uid AS road_uid,
                r.u AS u_node,
                r.v AS v_node,
                COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) AS road_group_key,
                COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) AS road_name,
                r.highway,
                r.oneway::text AS oneway_raw,
                r.geometry AS road_geom,
                CASE
                    WHEN r.length IS NOT NULL AND r.length > 0 THEN r.length
                    ELSE ST_Length(r.geometry::geography)
                END AS segment_length_m
            FROM road_edges r
            CROSS JOIN analysis a
            WHERE (:use_bbox = FALSE OR r.geometry && a.bbox_geom)
        ),
        filtered_passes AS (
            SELECT p.*
            FROM matched_trip_road_passes p
            JOIN candidate_roads cr
              ON cr.road_uid = p.road_uid
            WHERE p.start_time <= :end_time
              AND p.end_time >= :start_time
        ),
        edge_stats AS (
            SELECT
                cr.road_uid,
                cr.u_node,
                cr.v_node,
                cr.road_group_key,
                p.direction,
                MIN(cr.road_name) AS road_name,
                STRING_AGG(DISTINCT cr.highway, ', ' ORDER BY cr.highway) FILTER (WHERE cr.highway IS NOT NULL AND cr.highway <> '') AS highway,
                BOOL_OR(LOWER(COALESCE(cr.oneway_raw, '')) IN ('yes', 'true', '1', 't', '-1', 'reverse', 'backward')) AS has_oneway_segment,
                COUNT(DISTINCT (p.taxi_id, p.trip_id))::bigint AS trip_count,
                COUNT(DISTINCT p.taxi_id)::bigint AS vehicle_count,
                ARRAY_AGG(DISTINCT CONCAT(p.taxi_id::text, ':', p.trip_id::text)) AS trip_keys,
                ARRAY_AGG(DISTINCT p.taxi_id::text) AS taxi_keys,
                COUNT(*)::bigint AS edge_pass_weight,
                MAX(cr.segment_length_m) AS matched_segment_length_m,
                ST_AsGeoJSON(cr.road_geom) AS geometry
            FROM filtered_passes p
            JOIN candidate_roads cr
              ON cr.road_uid = p.road_uid
            GROUP BY
                cr.road_uid,
                cr.u_node,
                cr.v_node,
                cr.road_group_key,
                p.direction,
                cr.road_geom
        )
        SELECT *
        FROM edge_stats
        """
    )

    params = {
        "start_time": payload.start_time,
        "end_time": payload.end_time,
        "min_lon": payload.analysis_bbox.min_lon,
        "min_lat": payload.analysis_bbox.min_lat,
        "max_lon": payload.analysis_bbox.max_lon,
        "max_lat": payload.analysis_bbox.max_lat,
        "top_k": payload.top_k,
        "min_group_length_m": payload.min_group_length_m,
        "use_bbox": f7_scope_uses_bbox(payload),
    }

    with engine.connect() as conn:
        edge_rows = conn.execute(sql, params).mappings().all()

    component_rows = _f7_build_directed_corridor_rows([dict(row) for row in edge_rows], payload)
    merged_rows = _f7_merge_component_rows_to_road_groups(component_rows, payload)
    total_ranked_trip_count = sum(int(row.get("trip_count") or 0) for row in merged_rows)
    total_edge_pass_weight = sum(int(row.get("edge_pass_weight") or 0) for row in merged_rows)
    total_path_count = len(merged_rows)
    top_rows = merged_rows[: payload.top_k]
    for row in top_rows:
        row["total_ranked_trip_count"] = total_ranked_trip_count
        row["total_edge_pass_weight"] = total_edge_pass_weight
        row["total_path_count"] = total_path_count

    return build_f7_paths_response(top_rows, started_at, "full_matched_trip_road_passes", "full_trip_road_component_backbone", payload)


@router.post("/active-vehicles-union")
def get_active_vehicles_union(payload: ActiveVehiclesUnionRequest) -> dict:
    if payload.start_time >= payload.end_time:
        return {"active_vehicle_count": 0, "error": "start_time must be earlier than end_time"}

    if payload.taxi_id_min > payload.taxi_id_max:
        return {"active_vehicle_count": 0, "error": "taxi_id_min must be <= taxi_id_max"}

    if not payload.bboxes:
        return {"active_vehicle_count": 0, "error": "bboxes must not be empty"}

    normalized_boxes: list[dict[str, float]] = []
    for b in payload.bboxes:
        if b.min_lon >= b.max_lon or b.min_lat >= b.max_lat:
            return {"active_vehicle_count": 0, "error": "invalid bbox bounds"}
        normalized_boxes.append(
            {
                "min_lon": b.min_lon,
                "min_lat": b.min_lat,
                "max_lon": b.max_lon,
                "max_lat": b.max_lat,
            }
        )

    sql = text(
        """
        WITH boxes AS (
            SELECT
                ord::int AS box_index,
                (b->>'min_lon')::double precision AS min_lon,
                (b->>'min_lat')::double precision AS min_lat,
                (b->>'max_lon')::double precision AS max_lon,
                (b->>'max_lat')::double precision AS max_lat
            FROM jsonb_array_elements(CAST(:bboxes_json AS jsonb)) WITH ORDINALITY AS t(b, ord)
        ),
        point_hits AS (
            SELECT DISTINCT tp.taxi_id
            FROM taxi_points tp
            JOIN boxes bx
              ON tp.geom && ST_MakeEnvelope(bx.min_lon, bx.min_lat, bx.max_lon, bx.max_lat, 4326)
             AND ST_Intersects(tp.geom, ST_MakeEnvelope(bx.min_lon, bx.min_lat, bx.max_lon, bx.max_lat, 4326))
            WHERE tp.gps_time >= :start_time
              AND tp.gps_time <= :end_time
              AND tp.taxi_id >= :taxi_id_min
              AND tp.taxi_id <= :taxi_id_max
        )
        SELECT COUNT(*) AS active_vehicle_count
        FROM point_hits
        """
    )

    params = {
        "start_time": payload.start_time,
        "end_time": payload.end_time,
        "taxi_id_min": payload.taxi_id_min,
        "taxi_id_max": payload.taxi_id_max,
        "bboxes_json": json.dumps(normalized_boxes),
    }

    with engine.connect() as conn:
        row = conn.execute(sql, params).mappings().first()

    return {
        "active_vehicle_count": int(row["active_vehicle_count"]) if row else 0,
        "start_time": payload.start_time.isoformat(),
        "end_time": payload.end_time.isoformat(),
        "taxi_id_range": {
            "min": payload.taxi_id_min,
            "max": payload.taxi_id_max,
        },
        "bbox_count": len(normalized_boxes),
    }


@router.post("/active-vehicles-union-detail")
def get_active_vehicles_union_detail(payload: ActiveVehiclesUnionDetailRequest) -> dict:
    if payload.start_time >= payload.end_time:
        return {"active_vehicle_count": 0, "rows": [], "error": "start_time must be earlier than end_time"}

    if payload.taxi_id_min > payload.taxi_id_max:
        return {"active_vehicle_count": 0, "rows": [], "error": "taxi_id_min must be <= taxi_id_max"}

    if not payload.bboxes:
        return {"active_vehicle_count": 0, "rows": [], "error": "bboxes must not be empty"}

    normalized_boxes: list[dict[str, float]] = []
    for b in payload.bboxes:
        if b.min_lon >= b.max_lon or b.min_lat >= b.max_lat:
            return {"active_vehicle_count": 0, "rows": [], "error": "invalid bbox bounds"}
        normalized_boxes.append(
            {
                "min_lon": b.min_lon,
                "min_lat": b.min_lat,
                "max_lon": b.max_lon,
                "max_lat": b.max_lat,
            }
        )

    base_cte = """
        WITH boxes AS (
            SELECT
                ord::int AS box_index,
                (b->>'min_lon')::double precision AS min_lon,
                (b->>'min_lat')::double precision AS min_lat,
                (b->>'max_lon')::double precision AS max_lon,
                (b->>'max_lat')::double precision AS max_lat
            FROM jsonb_array_elements(CAST(:bboxes_json AS jsonb)) WITH ORDINALITY AS t(b, ord)
        ),
        point_hits AS (
            SELECT DISTINCT
                tp.taxi_id,
                tp.trip_id,
                bx.box_index
            FROM taxi_points tp
            JOIN boxes bx
              ON tp.geom && ST_MakeEnvelope(bx.min_lon, bx.min_lat, bx.max_lon, bx.max_lat, 4326)
             AND ST_Intersects(tp.geom, ST_MakeEnvelope(bx.min_lon, bx.min_lat, bx.max_lon, bx.max_lat, 4326))
            WHERE tp.gps_time >= :start_time
              AND tp.gps_time <= :end_time
              AND tp.taxi_id >= :taxi_id_min
              AND tp.taxi_id <= :taxi_id_max
        ),
        taxi_boxes AS (
            SELECT
                taxi_id,
                ARRAY_AGG(DISTINCT box_index ORDER BY box_index) AS hit_boxes,
                ARRAY_AGG(DISTINCT trip_id ORDER BY trip_id) AS hit_trip_ids
            FROM point_hits
            GROUP BY taxi_id
        )
    """

    count_sql = text(
        base_cte
        + """
        SELECT COUNT(*) AS active_vehicle_count
        FROM taxi_boxes
        """
    )

    detail_sql = text(
        base_cte
        + """
        SELECT taxi_id, hit_boxes, hit_trip_ids
        FROM taxi_boxes
        ORDER BY taxi_id ASC
        LIMIT :row_limit
        """
    )

    box_count_sql = text(
        base_cte
        + """
        SELECT box_index, COUNT(DISTINCT taxi_id) AS vehicle_count
        FROM point_hits
        GROUP BY box_index
        ORDER BY box_index
        """
    )

    params = {
        "start_time": payload.start_time,
        "end_time": payload.end_time,
        "taxi_id_min": payload.taxi_id_min,
        "taxi_id_max": payload.taxi_id_max,
        "bboxes_json": json.dumps(normalized_boxes),
    }

    with engine.connect() as conn:
        count_row = conn.execute(count_sql, params).mappings().first()
        box_count_rows = conn.execute(box_count_sql, params).mappings().all()
        detail_rows_db = conn.execute(
            detail_sql,
            {
                **params,
                "row_limit": payload.row_limit,
            },
        ).mappings().all()

    rows = []
    for row in detail_rows_db:
        taxi_id = int(row["taxi_id"])
        hit_boxes = [int(v) for v in (row["hit_boxes"] or [])]
        hit_trip_ids = [str(v) for v in (row["hit_trip_ids"] or []) if v is not None]
        box_labels = ", ".join(f"#{v}" for v in hit_boxes)
        rows.append({
            "key": str(taxi_id),
            "taxi_id": taxi_id,
            "box_labels": box_labels,
            "trip_ids": hit_trip_ids,
        })

    box_vehicle_counts = [
        {
            "box_index": int(row["box_index"]),
            "vehicle_count": int(row["vehicle_count"]),
        }
        for row in box_count_rows
    ]

    return {
        "active_vehicle_count": int(count_row["active_vehicle_count"]) if count_row else 0,
        "rows": rows,
        "start_time": payload.start_time.isoformat(),
        "end_time": payload.end_time.isoformat(),
        "taxi_id_range": {
            "min": payload.taxi_id_min,
            "max": payload.taxi_id_max,
        },
        "bbox_count": len(normalized_boxes),
        "row_limit_applied": payload.row_limit,
        "box_vehicle_counts": box_vehicle_counts,
    }
