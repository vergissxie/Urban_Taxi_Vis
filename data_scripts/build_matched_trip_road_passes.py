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
        if rebuild:
            conn.execute(text("DROP TABLE IF EXISTS matched_trip_road_passes"))

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
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS matched_trip_road_passes (
                    taxi_id BIGINT NOT NULL,
                    trip_id BIGINT NOT NULL,
                    road_uid BIGINT NOT NULL,
                    road_id BIGINT NOT NULL,
                    road_group_key TEXT NOT NULL,
                    direction SMALLINT NOT NULL,
                    road_name TEXT NOT NULL,
                    highway TEXT,
                    has_oneway_segment BOOLEAN NOT NULL DEFAULT FALSE,
                    segment_count INTEGER NOT NULL DEFAULT 0,
                    group_length_m DOUBLE PRECISION NOT NULL DEFAULT 0,
                    matched_segment_length_m DOUBLE PRECISION NOT NULL DEFAULT 0,
                    start_time TIMESTAMP NOT NULL,
                    end_time TIMESTAMP NOT NULL,
                    PRIMARY KEY (taxi_id, trip_id, road_uid, direction)
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_matched_trip_edges_trip ON matched_trip_edges (taxi_id, trip_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_matched_trip_edges_road ON matched_trip_edges (road_uid)"))
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS idx_road_edges_edge_uid ON road_edges (edge_uid)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_matched_trip_road_passes_time ON matched_trip_road_passes (start_time, end_time)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_matched_trip_road_passes_group ON matched_trip_road_passes (road_group_key, direction)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_matched_trip_road_passes_road ON matched_trip_road_passes (road_uid)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_matched_trip_road_passes_road_time ON matched_trip_road_passes (road_uid, start_time, end_time)"))


def set_build_status(engine, status: str, details_json: str = "{}") -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO pipeline_build_status (pipeline_name, status, details)
                VALUES ('matched_trip_road_passes', :status, CAST(:details AS jsonb))
                ON CONFLICT (pipeline_name) DO UPDATE
                SET status = EXCLUDED.status,
                    updated_at = NOW(),
                    details = EXCLUDED.details
                """
            ),
            {"status": status, "details": details_json},
        )


def count_source_trips(engine, cursor: BatchCursor) -> int:
    sql = text(
        """
        SELECT COUNT(*) AS total
        FROM (
            SELECT DISTINCT taxi_id, trip_id
            FROM matched_trip_edges
            WHERE (taxi_id, trip_id) > (:last_taxi_id, :last_trip_id)
        ) t
        """
    )
    with engine.connect() as conn:
        row = conn.execute(
            sql,
            {"last_taxi_id": cursor.taxi_id, "last_trip_id": cursor.trip_id},
        ).mappings().first()
    return int(row["total"] or 0) if row else 0


def build_batch(engine, cursor: BatchCursor, batch_size: int) -> tuple[int, int, BatchCursor | None]:
    sql = text(
        """
        WITH batch AS (
            SELECT DISTINCT taxi_id, trip_id
            FROM matched_trip_edges
            WHERE (taxi_id, trip_id) > (:last_taxi_id, :last_trip_id)
            ORDER BY taxi_id ASC, trip_id ASC
            LIMIT :batch_size
        ),
        edge_rows AS (
            SELECT
                e.taxi_id,
                e.trip_id,
                e.road_uid,
                r.id AS road_id,
                e.direction,
                COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) AS road_name,
                COALESCE(NULLIF(BTRIM(r.name), ''), CONCAT('edge:', r.id::text)) AS road_group_key,
                r.highway,
                r.oneway::text AS oneway_raw,
                ST_Length(r.geometry::geography) AS segment_length_m
            FROM matched_trip_edges e
            JOIN batch b
              ON b.taxi_id = e.taxi_id
             AND b.trip_id = e.trip_id
            JOIN road_edges r
              ON r.edge_uid = e.road_uid
        ),
        road_group_lengths AS (
            SELECT
                road_group_key,
                SUM(DISTINCT segment_length_m) AS group_length_m
            FROM edge_rows
            GROUP BY road_group_key
        ),
        pass_rows AS (
            SELECT
                er.taxi_id,
                er.trip_id,
                er.road_uid,
                MIN(er.road_id) AS road_id,
                er.road_group_key,
                er.direction,
                MIN(er.road_name) AS road_name,
                STRING_AGG(DISTINCT er.highway, ', ' ORDER BY er.highway) FILTER (WHERE er.highway IS NOT NULL AND er.highway <> '') AS highway,
                BOOL_OR(LOWER(COALESCE(er.oneway_raw, '')) IN ('yes', 'true', '1', 't', '-1', 'reverse', 'backward')) AS has_oneway_segment,
                1::int AS segment_count,
                MAX(rgl.group_length_m) AS group_length_m,
                MAX(er.segment_length_m) AS matched_segment_length_m
            FROM edge_rows er
            JOIN road_group_lengths rgl
              ON rgl.road_group_key = er.road_group_key
            GROUP BY er.taxi_id, er.trip_id, er.road_uid, er.road_group_key, er.direction
        ),
        inserted AS (
            INSERT INTO matched_trip_road_passes (
                taxi_id,
                trip_id,
                road_uid,
                road_id,
                road_group_key,
                direction,
                road_name,
                highway,
                has_oneway_segment,
                segment_count,
                group_length_m,
                matched_segment_length_m,
                start_time,
                end_time
            )
            SELECT
                pr.taxi_id,
                pr.trip_id,
                pr.road_uid,
                pr.road_id,
                pr.road_group_key,
                pr.direction,
                pr.road_name,
                pr.highway,
                pr.has_oneway_segment,
                pr.segment_count,
                pr.group_length_m,
                pr.matched_segment_length_m,
                od.start_time,
                od.end_time
            FROM pass_rows pr
            JOIN trip_od_cache od
              ON od.taxi_id = pr.taxi_id
             AND od.trip_id ~ '^[0-9]+$'
             AND od.trip_id::bigint = pr.trip_id
            ON CONFLICT DO NOTHING
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

    next_cursor = BatchCursor(taxi_id=int(row["last_taxi_id"]), trip_id=int(row["last_trip_id"]))
    return int(row["inserted_count"] or 0), int(row["batch_count"] or 0), next_cursor


def main() -> None:
    parser = argparse.ArgumentParser(description="Build matched_trip_road_passes for full-data F7 frequent path mining.")
    parser.add_argument("--database-url", default=DEFAULT_DATABASE_URL)
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--max-batches", type=int, default=0, help="0 means run until all source trips are processed.")
    parser.add_argument("--start-taxi-id", type=int, default=0)
    parser.add_argument("--start-trip-id", type=int, default=0)
    parser.add_argument("--rebuild", action="store_true", help="Drop and rebuild matched_trip_road_passes before processing.")
    args = parser.parse_args()

    engine = create_engine(args.database_url)
    create_support_schema(engine, rebuild=args.rebuild)
    set_build_status(engine, "building", '{"stage":"started"}')

    cursor = BatchCursor(taxi_id=args.start_taxi_id, trip_id=args.start_trip_id)
    total_trips = count_source_trips(engine, cursor)
    planned_batches = math.ceil(total_trips / args.batch_size) if args.batch_size > 0 else 0
    if args.max_batches:
        planned_batches = min(planned_batches, args.max_batches)
    planned_trips = min(total_trips, planned_batches * args.batch_size) if planned_batches else total_trips

    total_inserted = 0
    processed_trips = 0
    batch_index = 0
    started_at = time.monotonic()

    print(
        f"start total_trips={total_trips} planned_trips={planned_trips} "
        f"batch_size={args.batch_size} planned_batches={planned_batches} rebuild={args.rebuild}",
        flush=True,
    )

    while True:
        inserted, batch_count, next_cursor = build_batch(engine, cursor, args.batch_size)
        if next_cursor is None:
            break

        batch_index += 1
        total_inserted += inserted
        processed_trips += batch_count
        cursor = next_cursor

        elapsed = time.monotonic() - started_at
        rate = processed_trips / elapsed if elapsed > 0 else 0.0
        remaining = max(0, planned_trips - processed_trips)
        eta_seconds = remaining / rate if rate > 0 else None
        percent = (processed_trips / planned_trips * 100.0) if planned_trips > 0 else 100.0
        print(
            f"{progress_bar(processed_trips, planned_trips)} "
            f"{percent:6.2f}% batch={batch_index}/{planned_batches or '?'} "
            f"trips={processed_trips}/{planned_trips} "
            f"rate={rate:.2f} trips/s eta={format_duration(eta_seconds)} "
            f"elapsed={format_duration(elapsed)} "
            f"cursor=({cursor.taxi_id},{cursor.trip_id}) "
            f"inserted_passes={inserted} total_inserted={total_inserted}",
            flush=True,
        )

        if args.max_batches and batch_index >= args.max_batches:
            break

    elapsed = time.monotonic() - started_at
    final_status = "ready" if (not args.max_batches and processed_trips >= planned_trips) else "partial"
    set_build_status(
        engine,
        final_status,
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
        f"done batches={batch_index} trips={processed_trips}/{planned_trips} "
        f"total_inserted={total_inserted} elapsed={format_duration(elapsed)}",
        flush=True,
    )


if __name__ == "__main__":
    main()
