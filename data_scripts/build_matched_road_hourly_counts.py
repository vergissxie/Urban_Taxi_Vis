import argparse
import os
import time

from sqlalchemy import create_engine, text


DEFAULT_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://taxi_user:taxi_pass@postgis:5432/taxi_vis",
)


def set_build_status(engine, status: str, details_json: str = "{}") -> None:
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
        conn.execute(
            text(
                """
                INSERT INTO pipeline_build_status (pipeline_name, status, details)
                VALUES ('matched_road_hourly_counts', :status, CAST(:details AS jsonb))
                ON CONFLICT (pipeline_name) DO UPDATE
                SET status = EXCLUDED.status,
                    updated_at = NOW(),
                    details = EXCLUDED.details
                """
            ),
            {"status": status, "details": details_json},
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build hourly full-data road counts for fast F7 queries.")
    parser.add_argument("--database-url", default=DEFAULT_DATABASE_URL)
    parser.add_argument("--rebuild", action="store_true")
    args = parser.parse_args()

    engine = create_engine(args.database_url)
    started_at = time.monotonic()
    set_build_status(engine, "building", '{"stage":"started"}')

    with engine.begin() as conn:
        if args.rebuild:
            conn.execute(text("DROP TABLE IF EXISTS matched_road_hourly_counts"))
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS matched_road_hourly_counts (
                    road_uid BIGINT NOT NULL,
                    direction SMALLINT NOT NULL,
                    hour_bucket TIMESTAMP NOT NULL,
                    trip_count BIGINT NOT NULL,
                    vehicle_count BIGINT NOT NULL,
                    PRIMARY KEY (road_uid, direction, hour_bucket)
                )
                """
            )
        )
        conn.execute(text("TRUNCATE matched_road_hourly_counts"))

    print("building matched_road_hourly_counts from matched_trip_road_passes...", flush=True)
    with engine.begin() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO matched_road_hourly_counts (
                    road_uid,
                    direction,
                    hour_bucket,
                    trip_count,
                    vehicle_count
                )
                SELECT
                    road_uid,
                    direction,
                    date_trunc('hour', start_time) AS hour_bucket,
                    COUNT(*)::bigint AS trip_count,
                    COUNT(DISTINCT taxi_id)::bigint AS vehicle_count
                FROM matched_trip_road_passes
                GROUP BY road_uid, direction, date_trunc('hour', start_time)
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_matched_road_hourly_counts_time_road ON matched_road_hourly_counts (hour_bucket, road_uid)"))
        conn.execute(text("ANALYZE matched_road_hourly_counts"))

    elapsed = int(time.monotonic() - started_at)
    inserted = int(result.rowcount or 0)
    set_build_status(
        engine,
        "ready",
        f'{{"inserted_rows":{inserted},"elapsed_seconds":{elapsed}}}',
    )
    print(f"done inserted_rows={inserted} elapsed_seconds={elapsed}", flush=True)


if __name__ == "__main__":
    main()
