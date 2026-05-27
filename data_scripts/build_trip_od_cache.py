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
            conn.execute(text("DROP TABLE IF EXISTS trip_od_cache"))

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
                CREATE TABLE IF NOT EXISTS trip_od_cache (
                    taxi_id BIGINT NOT NULL,
                    trip_id TEXT NOT NULL,
                    start_time TIMESTAMP NOT NULL,
                    end_time TIMESTAMP NOT NULL,
                    start_geom geometry(Point,4326) NOT NULL,
                    end_geom geometry(Point,4326) NOT NULL,
                    start_lon DOUBLE PRECISION NOT NULL,
                    start_lat DOUBLE PRECISION NOT NULL,
                    end_lon DOUBLE PRECISION NOT NULL,
                    end_lat DOUBLE PRECISION NOT NULL,
                    point_count INTEGER NOT NULL,
                    duration_seconds DOUBLE PRECISION,
                    PRIMARY KEY (taxi_id, trip_id)
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trip_od_cache_start_time ON trip_od_cache (start_time)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trip_od_cache_end_time ON trip_od_cache (end_time)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trip_od_cache_start_geom_gist ON trip_od_cache USING GIST (start_geom)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_trip_od_cache_end_geom_gist ON trip_od_cache USING GIST (end_geom)"))


def count_source_trips(engine, cursor: BatchCursor) -> int:
    sql = text(
        """
        SELECT COUNT(*) AS total
        FROM (
            SELECT DISTINCT taxi_id, trip_id::bigint AS trip_id
            FROM taxi_points
            WHERE trip_id ~ '^[0-9]+$'
              AND (taxi_id, trip_id::bigint) > (:last_taxi_id, :last_trip_id)
        ) t
        """
    )
    with engine.connect() as conn:
        row = conn.execute(sql, {"last_taxi_id": cursor.taxi_id, "last_trip_id": cursor.trip_id}).mappings().first()
    return int(row["total"] or 0) if row else 0


def build_batch(engine, cursor: BatchCursor, batch_size: int) -> tuple[int, int, BatchCursor | None]:
    sql = text(
        """
        WITH batch AS (
            SELECT DISTINCT taxi_id, trip_id, trip_id::bigint AS trip_id_num
            FROM taxi_points
            WHERE trip_id ~ '^[0-9]+$'
              AND (taxi_id, trip_id::bigint) > (:last_taxi_id, :last_trip_id)
            ORDER BY taxi_id ASC, trip_id_num ASC
            LIMIT :batch_size
        ),
        starts AS (
            SELECT DISTINCT ON (tp.taxi_id, tp.trip_id)
                tp.taxi_id,
                tp.trip_id,
                tp.gps_time AS start_time,
                tp.geom AS start_geom,
                tp.lon AS start_lon,
                tp.lat AS start_lat
            FROM taxi_points tp
            JOIN batch b
              ON b.taxi_id = tp.taxi_id
             AND b.trip_id = tp.trip_id
            ORDER BY tp.taxi_id, tp.trip_id, tp.gps_time ASC, tp.id ASC
        ),
        ends AS (
            SELECT DISTINCT ON (tp.taxi_id, tp.trip_id)
                tp.taxi_id,
                tp.trip_id,
                tp.gps_time AS end_time,
                tp.geom AS end_geom,
                tp.lon AS end_lon,
                tp.lat AS end_lat
            FROM taxi_points tp
            JOIN batch b
              ON b.taxi_id = tp.taxi_id
             AND b.trip_id = tp.trip_id
            ORDER BY tp.taxi_id, tp.trip_id, tp.gps_time DESC, tp.id DESC
        ),
        point_counts AS (
            SELECT tp.taxi_id, tp.trip_id, COUNT(*)::int AS point_count
            FROM taxi_points tp
            JOIN batch b
              ON b.taxi_id = tp.taxi_id
             AND b.trip_id = tp.trip_id
            GROUP BY tp.taxi_id, tp.trip_id
        ),
        inserted AS (
            INSERT INTO trip_od_cache (
                taxi_id,
                trip_id,
                start_time,
                end_time,
                start_geom,
                end_geom,
                start_lon,
                start_lat,
                end_lon,
                end_lat,
                point_count,
                duration_seconds
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
            ON CONFLICT (taxi_id, trip_id) DO UPDATE
            SET start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time,
                start_geom = EXCLUDED.start_geom,
                end_geom = EXCLUDED.end_geom,
                start_lon = EXCLUDED.start_lon,
                start_lat = EXCLUDED.start_lat,
                end_lon = EXCLUDED.end_lon,
                end_lat = EXCLUDED.end_lat,
                point_count = EXCLUDED.point_count,
                duration_seconds = EXCLUDED.duration_seconds
            RETURNING 1
        )
        SELECT
            (SELECT COUNT(*) FROM inserted) AS inserted_count,
            (SELECT taxi_id FROM batch ORDER BY taxi_id DESC, trip_id_num DESC LIMIT 1) AS last_taxi_id,
            (SELECT trip_id_num FROM batch ORDER BY taxi_id DESC, trip_id_num DESC LIMIT 1) AS last_trip_id,
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
    parser = argparse.ArgumentParser(description="Build trip_od_cache for F6/F7/F8/F9 derived caches.")
    parser.add_argument("--database-url", default=DEFAULT_DATABASE_URL)
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--max-batches", type=int, default=0, help="0 means run until all source trips are processed.")
    parser.add_argument("--start-taxi-id", type=int, default=0)
    parser.add_argument("--start-trip-id", type=int, default=0)
    parser.add_argument("--rebuild", action="store_true", help="Drop and rebuild trip_od_cache before processing.")
    args = parser.parse_args()

    engine = create_engine(args.database_url)
    create_support_schema(engine, rebuild=args.rebuild)

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
            f"inserted_od={inserted} total_inserted={total_inserted}",
            flush=True,
        )

        if args.max_batches and batch_index >= args.max_batches:
            break

    with engine.begin() as conn:
        conn.execute(text("ANALYZE trip_od_cache"))

    elapsed = time.monotonic() - started_at
    print(
        f"done batches={batch_index} trips={processed_trips}/{planned_trips} "
        f"total_inserted={total_inserted} elapsed={format_duration(elapsed)}",
        flush=True,
    )


if __name__ == "__main__":
    main()
