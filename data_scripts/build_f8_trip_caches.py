import argparse
import math
import os
import time
from dataclasses import dataclass

from sqlalchemy import create_engine, text


DEFAULT_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://taxi_user:taxi_pass@postgis:5432/taxi_vis",
)
DEFAULT_GRID_STEP_DEGREES = 0.01
DEFAULT_VECTOR_MIN_EDGE_LENGTH_M = 20.0
DEFAULT_MAJOR_ROAD_MIN_LENGTH_M = 200.0


@dataclass
class BatchCursor:
    taxi_id: int
    trip_id: int


def format_duration(seconds: float | None) -> str:
    if seconds is None or math.isinf(seconds) or math.isnan(seconds):
        return "--:--:--"
    seconds = max(0, int(seconds))
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def progress_bar(done: int, total: int, width: int = 28) -> str:
    if total <= 0:
        return "[" + "-" * width + "]"
    ratio = min(1.0, max(0.0, done / total))
    filled = int(round(ratio * width))
    return "[" + "#" * filled + "-" * (width - filled) + "]"


def create_support_schema(engine, rebuild: bool = False) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS pipeline_build_status (
                    pipeline_name TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    details JSONB NOT NULL DEFAULT '{}'::jsonb
                )
                """
            )
        )
        if rebuild:
            conn.execute(text("DROP TABLE IF EXISTS trip_spatial_index"))
            conn.execute(text("DROP TABLE IF EXISTS trip_token_sequence"))
            conn.execute(text("DROP TABLE IF EXISTS trip_grid_points"))
            conn.execute(text("DROP TABLE IF EXISTS trip_edge_sequence_cache"))
            conn.execute(text("DROP TABLE IF EXISTS road_edge_feature_cache"))
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS trip_spatial_index (
                    taxi_id BIGINT NOT NULL,
                    trip_id BIGINT NOT NULL,
                    grid_x INTEGER NOT NULL,
                    grid_y INTEGER NOT NULL,
                    grid_key TEXT NOT NULL,
                    first_seen_time TIMESTAMP NOT NULL,
                    last_seen_time TIMESTAMP NOT NULL,
                    first_point_seq INTEGER NOT NULL,
                    point_count INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (taxi_id, trip_id, grid_x, grid_y)
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trip_spatial_index_grid ON trip_spatial_index (grid_key, first_seen_time)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trip_spatial_index_grid_trip_seq ON trip_spatial_index (grid_key, taxi_id, trip_id, first_point_seq, first_seen_time)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trip_spatial_index_trip ON trip_spatial_index (taxi_id, trip_id, first_point_seq)"))
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS trip_grid_points (
                    taxi_id BIGINT NOT NULL,
                    trip_id BIGINT NOT NULL,
                    point_seq INTEGER NOT NULL,
                    gps_time TIMESTAMP NOT NULL,
                    lon DOUBLE PRECISION NOT NULL,
                    lat DOUBLE PRECISION NOT NULL,
                    grid_x INTEGER NOT NULL,
                    grid_y INTEGER NOT NULL,
                    grid_key TEXT NOT NULL,
                    PRIMARY KEY (taxi_id, trip_id, point_seq)
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trip_grid_points_grid_time ON trip_grid_points (grid_key, gps_time)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trip_grid_points_trip_seq ON trip_grid_points (taxi_id, trip_id, point_seq)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trip_grid_points_trip_grid_time ON trip_grid_points (taxi_id, trip_id, grid_key, gps_time)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trip_grid_points_grid_trip_time ON trip_grid_points (grid_key, taxi_id, trip_id, gps_time)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trip_grid_points_grid_bbox_trip_seq ON trip_grid_points (grid_key, lon, lat, taxi_id, trip_id, point_seq, gps_time)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trip_grid_points_trip_grid_seq_time ON trip_grid_points (taxi_id, trip_id, grid_key, point_seq, gps_time)"))
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS trip_token_sequence (
                    taxi_id BIGINT NOT NULL,
                    trip_id BIGINT NOT NULL,
                    start_time TIMESTAMP NOT NULL,
                    end_time TIMESTAMP NOT NULL,
                    duration_seconds DOUBLE PRECISION,
                    route_length_m DOUBLE PRECISION NOT NULL DEFAULT 0,
                    raw_edge_count INTEGER NOT NULL DEFAULT 0,
                    vector_token_array TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
                    sequence_token_array TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
                    PRIMARY KEY (taxi_id, trip_id)
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trip_token_sequence_time ON trip_token_sequence (start_time, end_time)"))
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS trip_edge_sequence_cache (
                    taxi_id BIGINT NOT NULL,
                    trip_id BIGINT NOT NULL,
                    edge_count INTEGER NOT NULL DEFAULT 0,
                    road_uid_array BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
                    PRIMARY KEY (taxi_id, trip_id)
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trip_edge_sequence_cache_edge_count ON trip_edge_sequence_cache (edge_count)"))
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS road_edge_feature_cache (
                    road_uid BIGINT PRIMARY KEY,
                    highway_class TEXT NOT NULL DEFAULT '',
                    road_group_key TEXT,
                    segment_length_m DOUBLE PRECISION NOT NULL DEFAULT 0,
                    min_lon DOUBLE PRECISION,
                    min_lat DOUBLE PRECISION,
                    max_lon DOUBLE PRECISION,
                    max_lat DOUBLE PRECISION
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_taxi_points_trip_time ON taxi_points (trip_id, gps_time)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_matched_trip_edges_trip ON matched_trip_edges (taxi_id, trip_id)"))
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS idx_road_edges_edge_uid ON road_edges (edge_uid)"))


def set_build_status(engine, pipeline_name: str, status: str, details_json: str = "{}") -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO pipeline_build_status (pipeline_name, status, details)
                VALUES (:pipeline_name, :status, CAST(:details AS jsonb))
                ON CONFLICT (pipeline_name) DO UPDATE
                SET status = EXCLUDED.status,
                    updated_at = NOW(),
                    details = EXCLUDED.details
                """
            ),
            {"pipeline_name": pipeline_name, "status": status, "details": details_json},
        )


def count_source_trips(engine, cursor: BatchCursor) -> int:
    sql = text(
        """
        SELECT COUNT(*) AS total
        FROM trip_od_cache
        WHERE trip_id ~ '^[0-9]+$'
          AND (taxi_id, trip_id::bigint) > (:last_taxi_id, :last_trip_id)
        """
    )
    with engine.connect() as conn:
        row = conn.execute(sql, {"last_taxi_id": cursor.taxi_id, "last_trip_id": cursor.trip_id}).mappings().first()
    return int(row["total"] or 0) if row else 0


def build_spatial_batch(engine, cursor: BatchCursor, batch_size: int, grid_step_degrees: float) -> tuple[int, int, BatchCursor | None]:
    sql = text(
        """
        WITH batch AS (
            SELECT taxi_id, trip_id::bigint AS trip_id
            FROM trip_od_cache
            WHERE trip_id ~ '^[0-9]+$'
              AND (taxi_id, trip_id::bigint) > (:last_taxi_id, :last_trip_id)
            ORDER BY taxi_id ASC, trip_id::bigint ASC
            LIMIT :batch_size
        ),
        points AS (
            SELECT
                tp.taxi_id,
                tp.trip_id::bigint AS trip_id,
                tp.gps_time,
                ROW_NUMBER() OVER (
                    PARTITION BY tp.taxi_id, tp.trip_id
                    ORDER BY tp.gps_time ASC, tp.id ASC
                ) AS point_seq,
                FLOOR(tp.lon / :grid_step_degrees)::int AS grid_x,
                FLOOR(tp.lat / :grid_step_degrees)::int AS grid_y
            FROM taxi_points tp
            JOIN batch b
              ON b.taxi_id = tp.taxi_id
             AND b.trip_id = tp.trip_id::bigint
        ),
        grouped AS (
            SELECT
                taxi_id,
                trip_id,
                grid_x,
                grid_y,
                CONCAT(grid_x::text, ':', grid_y::text) AS grid_key,
                MIN(gps_time) AS first_seen_time,
                MAX(gps_time) AS last_seen_time,
                MIN(point_seq) AS first_point_seq,
                COUNT(*)::int AS point_count
            FROM points
            GROUP BY taxi_id, trip_id, grid_x, grid_y
        ),
        inserted AS (
            INSERT INTO trip_spatial_index (
                taxi_id,
                trip_id,
                grid_x,
                grid_y,
                grid_key,
                first_seen_time,
                last_seen_time,
                first_point_seq,
                point_count
            )
            SELECT
                taxi_id,
                trip_id,
                grid_x,
                grid_y,
                grid_key,
                first_seen_time,
                last_seen_time,
                first_point_seq,
                point_count
            FROM grouped
            ON CONFLICT (taxi_id, trip_id, grid_x, grid_y) DO UPDATE
            SET first_seen_time = LEAST(trip_spatial_index.first_seen_time, EXCLUDED.first_seen_time),
                last_seen_time = GREATEST(trip_spatial_index.last_seen_time, EXCLUDED.last_seen_time),
                first_point_seq = LEAST(trip_spatial_index.first_point_seq, EXCLUDED.first_point_seq),
                point_count = EXCLUDED.point_count
            RETURNING 1
        )
        SELECT
            (SELECT COUNT(*) FROM inserted) AS inserted_count,
            (SELECT taxi_id FROM batch ORDER BY taxi_id DESC, trip_id DESC LIMIT 1) AS last_taxi_id,
            (SELECT trip_id FROM batch ORDER BY taxi_id DESC, trip_id DESC LIMIT 1) AS last_trip_id,
            (SELECT COUNT(*) FROM batch) AS batch_count
        """
    )
    with engine.begin() as conn:
        row = conn.execute(
            sql,
            {
                "last_taxi_id": cursor.taxi_id,
                "last_trip_id": cursor.trip_id,
                "batch_size": batch_size,
                "grid_step_degrees": grid_step_degrees,
            },
        ).mappings().first()
    if not row or int(row["batch_count"] or 0) == 0:
        return 0, 0, None
    return int(row["inserted_count"] or 0), int(row["batch_count"] or 0), BatchCursor(int(row["last_taxi_id"]), int(row["last_trip_id"]))


def build_grid_point_batch(
    engine,
    cursor: BatchCursor,
    batch_size: int,
    grid_step_degrees: float,
) -> tuple[int, int, BatchCursor | None]:
    sql = text(
        """
        WITH batch AS (
            SELECT taxi_id, trip_id::bigint AS trip_id
            FROM trip_od_cache
            WHERE trip_id ~ '^[0-9]+$'
              AND (taxi_id, trip_id::bigint) > (:last_taxi_id, :last_trip_id)
            ORDER BY taxi_id ASC, trip_id::bigint ASC
            LIMIT :batch_size
        ),
        points AS (
            SELECT
                tp.taxi_id,
                tp.trip_id::bigint AS trip_id,
                ROW_NUMBER() OVER (
                    PARTITION BY tp.taxi_id, tp.trip_id
                    ORDER BY tp.gps_time ASC, tp.id ASC
                ) AS point_seq,
                tp.gps_time,
                tp.lon,
                tp.lat,
                FLOOR(tp.lon / :grid_step_degrees)::int AS grid_x,
                FLOOR(tp.lat / :grid_step_degrees)::int AS grid_y,
                CONCAT(
                    FLOOR(tp.lon / :grid_step_degrees)::int::text,
                    ':',
                    FLOOR(tp.lat / :grid_step_degrees)::int::text
                ) AS grid_key
            FROM taxi_points tp
            JOIN batch b
              ON b.taxi_id = tp.taxi_id
             AND b.trip_id = tp.trip_id::bigint
        ),
        inserted AS (
            INSERT INTO trip_grid_points (
                taxi_id,
                trip_id,
                point_seq,
                gps_time,
                lon,
                lat,
                grid_x,
                grid_y,
                grid_key
            )
            SELECT
                taxi_id,
                trip_id,
                point_seq,
                gps_time,
                lon,
                lat,
                grid_x,
                grid_y,
                grid_key
            FROM points
            ON CONFLICT (taxi_id, trip_id, point_seq) DO UPDATE
            SET gps_time = EXCLUDED.gps_time,
                lon = EXCLUDED.lon,
                lat = EXCLUDED.lat,
                grid_x = EXCLUDED.grid_x,
                grid_y = EXCLUDED.grid_y,
                grid_key = EXCLUDED.grid_key
            RETURNING 1
        )
        SELECT
            (SELECT COUNT(*) FROM inserted) AS inserted_count,
            (SELECT taxi_id FROM batch ORDER BY taxi_id DESC, trip_id DESC LIMIT 1) AS last_taxi_id,
            (SELECT trip_id FROM batch ORDER BY taxi_id DESC, trip_id DESC LIMIT 1) AS last_trip_id,
            (SELECT COUNT(*) FROM batch) AS batch_count
        """
    )
    with engine.begin() as conn:
        row = conn.execute(
            sql,
            {
                "last_taxi_id": cursor.taxi_id,
                "last_trip_id": cursor.trip_id,
                "batch_size": batch_size,
                "grid_step_degrees": grid_step_degrees,
            },
        ).mappings().first()
    if not row or int(row["batch_count"] or 0) == 0:
        return 0, 0, None
    return int(row["inserted_count"] or 0), int(row["batch_count"] or 0), BatchCursor(int(row["last_taxi_id"]), int(row["last_trip_id"]))


def build_token_batch(
    engine,
    cursor: BatchCursor,
    batch_size: int,
    vector_min_edge_length_m: float,
    major_road_min_length_m: float,
) -> tuple[int, int, BatchCursor | None]:
    sql = text(
        """
        WITH batch AS (
            SELECT taxi_id, trip_id::bigint AS trip_id
            FROM trip_od_cache
            WHERE trip_id ~ '^[0-9]+$'
              AND (taxi_id, trip_id::bigint) > (:last_taxi_id, :last_trip_id)
            ORDER BY taxi_id ASC, trip_id::bigint ASC
            LIMIT :batch_size
        ),
        raw_edges AS (
            SELECT
                b.taxi_id,
                b.trip_id,
                od.start_time,
                od.end_time,
                od.duration_seconds,
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
                END AS road_group_key
            FROM batch b
            JOIN trip_od_cache od
              ON od.taxi_id = b.taxi_id
             AND od.trip_id ~ '^[0-9]+$'
             AND od.trip_id::bigint = b.trip_id
            JOIN matched_trip_edges e
              ON e.taxi_id = b.taxi_id
             AND e.trip_id = b.trip_id
            JOIN road_edges r
              ON r.edge_uid = e.road_uid
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
            FROM raw_edges
            GROUP BY taxi_id, trip_id
        ),
        token_edges AS (
            SELECT
                re.taxi_id,
                re.trip_id,
                re.edge_seq,
                CASE
                    WHEN re.road_group_key IS NOT NULL
                     AND (
                         LOWER(re.highway_class) IN ('motorway', 'trunk', 'primary', 'secondary')
                         OR re.segment_length_m >= :major_road_min_length_m
                     )
                     AND re.segment_length_m >= :vector_min_edge_length_m
                    THEN CONCAT('road:', re.road_group_key)
                    WHEN re.road_group_key IS NULL
                     AND LOWER(re.highway_class) IN ('motorway', 'trunk', 'primary')
                     AND re.segment_length_m >= :major_road_min_length_m
                    THEN CONCAT('edge:', re.road_uid::text)
                    ELSE NULL
                END AS token_key
            FROM raw_edges re
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
        ),
        merged AS (
            SELECT
                rl.taxi_id,
                rl.trip_id,
                rl.start_time,
                rl.end_time,
                rl.duration_seconds,
                rl.route_length_m,
                rl.raw_edge_count,
                COALESCE(vt.vector_token_array, ARRAY[]::TEXT[]) AS vector_token_array,
                COALESCE(st.sequence_token_array, ARRAY[]::TEXT[]) AS sequence_token_array
            FROM route_lengths rl
            LEFT JOIN vector_tokens vt
              ON vt.taxi_id = rl.taxi_id
             AND vt.trip_id = rl.trip_id
            LEFT JOIN sequence_tokens st
              ON st.taxi_id = rl.taxi_id
             AND st.trip_id = rl.trip_id
        ),
        inserted AS (
            INSERT INTO trip_token_sequence (
                taxi_id,
                trip_id,
                start_time,
                end_time,
                duration_seconds,
                route_length_m,
                raw_edge_count,
                vector_token_array,
                sequence_token_array
            )
            SELECT
                taxi_id,
                trip_id,
                start_time,
                end_time,
                duration_seconds,
                route_length_m,
                raw_edge_count,
                vector_token_array,
                sequence_token_array
            FROM merged
            ON CONFLICT (taxi_id, trip_id) DO UPDATE
            SET start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time,
                duration_seconds = EXCLUDED.duration_seconds,
                route_length_m = EXCLUDED.route_length_m,
                raw_edge_count = EXCLUDED.raw_edge_count,
                vector_token_array = EXCLUDED.vector_token_array,
                sequence_token_array = EXCLUDED.sequence_token_array
            RETURNING 1
        )
        SELECT
            (SELECT COUNT(*) FROM inserted) AS inserted_count,
            (SELECT taxi_id FROM batch ORDER BY taxi_id DESC, trip_id DESC LIMIT 1) AS last_taxi_id,
            (SELECT trip_id FROM batch ORDER BY taxi_id DESC, trip_id DESC LIMIT 1) AS last_trip_id,
            (SELECT COUNT(*) FROM batch) AS batch_count
        """
    )
    with engine.begin() as conn:
        row = conn.execute(
            sql,
            {
                "last_taxi_id": cursor.taxi_id,
                "last_trip_id": cursor.trip_id,
                "batch_size": batch_size,
                "vector_min_edge_length_m": vector_min_edge_length_m,
                "major_road_min_length_m": major_road_min_length_m,
            },
        ).mappings().first()
    if not row or int(row["batch_count"] or 0) == 0:
        return 0, 0, None
    return int(row["inserted_count"] or 0), int(row["batch_count"] or 0), BatchCursor(int(row["last_taxi_id"]), int(row["last_trip_id"]))


def build_edge_sequence_batch(
    engine,
    cursor: BatchCursor,
    batch_size: int,
) -> tuple[int, int, BatchCursor | None]:
    sql = text(
        """
        WITH batch AS (
            SELECT taxi_id, trip_id::bigint AS trip_id
            FROM trip_od_cache
            WHERE trip_id ~ '^[0-9]+$'
              AND (taxi_id, trip_id::bigint) > (:last_taxi_id, :last_trip_id)
            ORDER BY taxi_id ASC, trip_id::bigint ASC
            LIMIT :batch_size
        ),
        edge_sequences AS (
            SELECT
                b.taxi_id,
                b.trip_id,
                COUNT(*)::int AS edge_count,
                ARRAY_AGG(mte.road_uid ORDER BY mte.edge_seq) AS road_uid_array
            FROM batch b
            JOIN matched_trip_edges mte
              ON mte.taxi_id = b.taxi_id
             AND mte.trip_id = b.trip_id
            GROUP BY b.taxi_id, b.trip_id
        ),
        inserted AS (
            INSERT INTO trip_edge_sequence_cache (
                taxi_id,
                trip_id,
                edge_count,
                road_uid_array
            )
            SELECT
                taxi_id,
                trip_id,
                edge_count,
                road_uid_array
            FROM edge_sequences
            ON CONFLICT (taxi_id, trip_id) DO UPDATE
            SET edge_count = EXCLUDED.edge_count,
                road_uid_array = EXCLUDED.road_uid_array
            RETURNING 1
        )
        SELECT
            (SELECT COUNT(*) FROM inserted) AS inserted_count,
            (SELECT taxi_id FROM batch ORDER BY taxi_id DESC, trip_id DESC LIMIT 1) AS last_taxi_id,
            (SELECT trip_id FROM batch ORDER BY taxi_id DESC, trip_id DESC LIMIT 1) AS last_trip_id,
            (SELECT COUNT(*) FROM batch) AS batch_count
        """
    )
    with engine.begin() as conn:
        row = conn.execute(
            sql,
            {
                "last_taxi_id": cursor.taxi_id,
                "last_trip_id": cursor.trip_id,
                "batch_size": batch_size,
            },
        ).mappings().first()
    if not row or int(row["batch_count"] or 0) == 0:
        return 0, 0, None
    return int(row["inserted_count"] or 0), int(row["batch_count"] or 0), BatchCursor(int(row["last_taxi_id"]), int(row["last_trip_id"]))


def build_road_feature_cache(engine) -> tuple[int, float]:
    started_at = time.time()
    sql = text(
        """
        INSERT INTO road_edge_feature_cache (
            road_uid,
            highway_class,
            road_group_key,
            segment_length_m,
            min_lon,
            min_lat,
            max_lon,
            max_lat
        )
        SELECT
            r.edge_uid AS road_uid,
            COALESCE(NULLIF(BTRIM(r.highway), ''), '') AS highway_class,
            CASE
                WHEN NULLIF(BTRIM(r.name), '') IS NULL THEN NULL
                WHEN LOWER(BTRIM(r.name)) IN ('unnamed', 'unknown', 'null') THEN NULL
                ELSE LOWER(NULLIF(BTRIM(REGEXP_REPLACE(BTRIM(r.name), '\s+', '', 'g')), ''))
            END AS road_group_key,
            COALESCE(NULLIF(r.length, 0), ST_Length(r.geometry::geography)) AS segment_length_m,
            ST_XMin(r.geometry) AS min_lon,
            ST_YMin(r.geometry) AS min_lat,
            ST_XMax(r.geometry) AS max_lon,
            ST_YMax(r.geometry) AS max_lat
        FROM road_edges r
        ON CONFLICT (road_uid) DO UPDATE
        SET highway_class = EXCLUDED.highway_class,
            road_group_key = EXCLUDED.road_group_key,
            segment_length_m = EXCLUDED.segment_length_m,
            min_lon = EXCLUDED.min_lon,
            min_lat = EXCLUDED.min_lat,
            max_lon = EXCLUDED.max_lon,
            max_lat = EXCLUDED.max_lat
        """
    )
    with engine.begin() as conn:
        conn.execute(sql)
        count_row = conn.execute(text("SELECT COUNT(*) AS total FROM road_edge_feature_cache")).mappings().first()
    return int(count_row["total"] or 0), time.time() - started_at


def run_pipeline(
    *,
    engine,
    pipeline_name: str,
    batch_builder,
    total_trips: int,
    batch_size: int,
    start_cursor: BatchCursor,
    max_batches: int,
) -> tuple[int, int, float]:
    planned_batches = math.ceil(total_trips / batch_size) if batch_size > 0 else 0
    if max_batches:
        planned_batches = min(planned_batches, max_batches)
    planned_trips = min(total_trips, planned_batches * batch_size) if planned_batches else total_trips

    processed_trips = 0
    total_inserted = 0
    batch_index = 0
    cursor = start_cursor
    started_at = time.monotonic()

    print(
        f"{pipeline_name}: start total_trips={total_trips} planned_trips={planned_trips} "
        f"batch_size={batch_size} planned_batches={planned_batches}",
        flush=True,
    )

    while True:
        inserted, batch_count, next_cursor = batch_builder(cursor)
        if next_cursor is None:
            break
        batch_index += 1
        processed_trips += batch_count
        total_inserted += inserted
        cursor = next_cursor

        elapsed = time.monotonic() - started_at
        rate = processed_trips / elapsed if elapsed > 0 else 0.0
        remaining = max(0, planned_trips - processed_trips)
        eta_seconds = remaining / rate if rate > 0 else None
        percent = (processed_trips / planned_trips * 100.0) if planned_trips > 0 else 100.0
        print(
            f"{pipeline_name}: {progress_bar(processed_trips, planned_trips)} "
            f"{percent:6.2f}% batch={batch_index}/{planned_batches or '?'} "
            f"trips={processed_trips}/{planned_trips} rate={rate:.2f} trips/s "
            f"eta={format_duration(eta_seconds)} elapsed={format_duration(elapsed)} "
            f"cursor=({cursor.taxi_id},{cursor.trip_id}) inserted={inserted} total_inserted={total_inserted}",
            flush=True,
        )

        if max_batches and batch_index >= max_batches:
            break

    elapsed = time.monotonic() - started_at
    status = "ready" if (not max_batches and processed_trips >= planned_trips) else "partial"
    set_build_status(
        engine,
        pipeline_name,
        status,
        (
            "{"
            f"\"processed_trips\":{processed_trips},"
            f"\"planned_trips\":{planned_trips},"
            f"\"total_inserted\":{total_inserted},"
            f"\"elapsed_seconds\":{int(elapsed)}"
            "}"
        ),
    )
    print(
        f"{pipeline_name}: done trips={processed_trips}/{planned_trips} total_inserted={total_inserted} "
        f"elapsed={format_duration(elapsed)}",
        flush=True,
    )
    return processed_trips, total_inserted, elapsed


def main() -> None:
    parser = argparse.ArgumentParser(description="Build F8 trip spatial and token caches.")
    parser.add_argument("--database-url", default=DEFAULT_DATABASE_URL)
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--max-batches", type=int, default=0, help="0 means run until all trips are processed.")
    parser.add_argument("--start-taxi-id", type=int, default=0)
    parser.add_argument("--start-trip-id", type=int, default=0)
    parser.add_argument("--rebuild", action="store_true")
    parser.add_argument("--grid-step-degrees", type=float, default=DEFAULT_GRID_STEP_DEGREES)
    parser.add_argument("--vector-min-edge-length-m", type=float, default=DEFAULT_VECTOR_MIN_EDGE_LENGTH_M)
    parser.add_argument("--major-road-min-length-m", type=float, default=DEFAULT_MAJOR_ROAD_MIN_LENGTH_M)
    parser.add_argument(
        "--pipelines",
        nargs="+",
        choices=["trip_spatial_index", "trip_grid_points", "trip_token_sequence", "trip_edge_sequence_cache", "road_edge_feature_cache"],
        default=["trip_spatial_index", "trip_grid_points", "trip_token_sequence", "trip_edge_sequence_cache", "road_edge_feature_cache"],
    )
    args = parser.parse_args()

    engine = create_engine(args.database_url)
    create_support_schema(engine, rebuild=args.rebuild)
    cursor = BatchCursor(taxi_id=args.start_taxi_id, trip_id=args.start_trip_id)
    total_trips = count_source_trips(engine, cursor)

    if args.rebuild:
        with engine.begin() as conn:
            conn.execute(text("TRUNCATE trip_spatial_index"))
            conn.execute(text("TRUNCATE trip_token_sequence"))
            conn.execute(text("TRUNCATE trip_grid_points"))
            conn.execute(text("TRUNCATE trip_edge_sequence_cache"))
            conn.execute(text("TRUNCATE road_edge_feature_cache"))

    if "trip_spatial_index" in args.pipelines:
        set_build_status(engine, "trip_spatial_index", "building", '{"stage":"started"}')
        run_pipeline(
            engine=engine,
            pipeline_name="trip_spatial_index",
            batch_builder=lambda current_cursor: build_spatial_batch(
                engine,
                current_cursor,
                args.batch_size,
                args.grid_step_degrees,
            ),
            total_trips=total_trips,
            batch_size=args.batch_size,
            start_cursor=cursor,
            max_batches=args.max_batches,
        )

    if "trip_grid_points" in args.pipelines:
        set_build_status(engine, "trip_grid_points", "building", '{"stage":"started"}')
        run_pipeline(
            engine=engine,
            pipeline_name="trip_grid_points",
            batch_builder=lambda current_cursor: build_grid_point_batch(
                engine,
                current_cursor,
                args.batch_size,
                args.grid_step_degrees,
            ),
            total_trips=total_trips,
            batch_size=args.batch_size,
            start_cursor=cursor,
            max_batches=args.max_batches,
        )

    if "trip_token_sequence" in args.pipelines:
        set_build_status(engine, "trip_token_sequence", "building", '{"stage":"started"}')
        run_pipeline(
            engine=engine,
            pipeline_name="trip_token_sequence",
            batch_builder=lambda current_cursor: build_token_batch(
                engine,
                current_cursor,
                args.batch_size,
                args.vector_min_edge_length_m,
                args.major_road_min_length_m,
            ),
            total_trips=total_trips,
            batch_size=args.batch_size,
            start_cursor=cursor,
            max_batches=args.max_batches,
        )

    if "trip_edge_sequence_cache" in args.pipelines:
        set_build_status(engine, "trip_edge_sequence_cache", "building", '{"stage":"started"}')
        run_pipeline(
            engine=engine,
            pipeline_name="trip_edge_sequence_cache",
            batch_builder=lambda current_cursor: build_edge_sequence_batch(
                engine,
                current_cursor,
                args.batch_size,
            ),
            total_trips=total_trips,
            batch_size=args.batch_size,
            start_cursor=cursor,
            max_batches=args.max_batches,
        )

    if "road_edge_feature_cache" in args.pipelines:
        set_build_status(engine, "road_edge_feature_cache", "building", '{"stage":"started"}')
        print("road_edge_feature_cache: start full rebuild", flush=True)
        total_rows, elapsed = build_road_feature_cache(engine)
        set_build_status(
            engine,
            "road_edge_feature_cache",
            "ready",
            "{"
            f"\"total_inserted\":{total_rows},"
            f"\"elapsed_seconds\":{elapsed:.2f}"
            "}",
        )
        print(
            f"road_edge_feature_cache: done total_inserted={total_rows} elapsed={format_duration(elapsed)}",
            flush=True,
        )


if __name__ == "__main__":
    main()
