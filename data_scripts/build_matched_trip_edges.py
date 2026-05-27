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


def create_support_schema(engine, rebuild: bool = False) -> None:
    with engine.begin() as conn:
        if rebuild:
            conn.execute(text("DROP TABLE IF EXISTS matched_trip_edges"))

        conn.execute(text("ALTER TABLE road_edges ADD COLUMN IF NOT EXISTS edge_uid BIGSERIAL"))
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS idx_road_edges_edge_uid ON road_edges (edge_uid)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_road_nodes_lon_lat ON road_nodes (lon, lat)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_road_edges_u_v ON road_edges (u, v)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_road_edges_v_u ON road_edges (v, u)"))
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS matched_trip_edges (
                    taxi_id BIGINT NOT NULL,
                    trip_id BIGINT NOT NULL,
                    edge_seq INTEGER NOT NULL,
                    road_uid BIGINT NOT NULL,
                    road_id BIGINT NOT NULL,
                    direction SMALLINT NOT NULL,
                    PRIMARY KEY (taxi_id, trip_id, edge_seq, road_uid)
                )
                """
            )
        )
        conn.execute(text("ALTER TABLE matched_trip_edges ADD COLUMN IF NOT EXISTS road_uid BIGINT"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_matched_trip_edges_road ON matched_trip_edges (road_uid)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_matched_trip_edges_trip ON matched_trip_edges (taxi_id, trip_id)"))


def count_remaining_trips(engine, cursor: BatchCursor) -> int:
    sql = text(
        """
        SELECT COUNT(*) AS total
        FROM matched_trips
        WHERE (taxi_id, trip_id) > (:last_taxi_id, :last_trip_id)
        """
    )
    with engine.connect() as conn:
        row = conn.execute(
            sql,
            {"last_taxi_id": cursor.taxi_id, "last_trip_id": cursor.trip_id},
        ).mappings().first()
    return int(row["total"] or 0) if row else 0


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


def build_batch(engine, cursor: BatchCursor, batch_size: int) -> tuple[int, int, BatchCursor | None]:
    sql = text(
        """
        WITH batch AS (
            SELECT taxi_id, trip_id, matched_geom
            FROM matched_trips
            WHERE (taxi_id, trip_id) > (:last_taxi_id, :last_trip_id)
            ORDER BY taxi_id ASC, trip_id ASC
            LIMIT :batch_size
        ),
        points AS (
            SELECT
                b.taxi_id,
                b.trip_id,
                (dp).path[1] AS point_index,
                ST_X((dp).geom) AS lon,
                ST_Y((dp).geom) AS lat
            FROM batch b
            CROSS JOIN LATERAL ST_DumpPoints(b.matched_geom) AS dp
        ),
        nodes AS (
            SELECT
                p.taxi_id,
                p.trip_id,
                p.point_index,
                rn.id AS node_id
            FROM points p
            JOIN road_nodes rn
              ON rn.lon = p.lon
             AND rn.lat = p.lat
        ),
        steps AS (
            SELECT
                taxi_id,
                trip_id,
                point_index AS edge_seq,
                LAG(node_id) OVER (
                    PARTITION BY taxi_id, trip_id
                    ORDER BY point_index
                ) AS from_node_id,
                node_id AS to_node_id
            FROM nodes
        ),
        edge_matches AS (
            SELECT
                s.taxi_id,
                s.trip_id,
                s.edge_seq,
                r.edge_uid AS road_uid,
                r.id AS road_id,
                CASE
                    WHEN r.u = s.from_node_id AND r.v = s.to_node_id THEN 1
                    WHEN r.u = s.to_node_id AND r.v = s.from_node_id THEN -1
                    ELSE 0
                END::smallint AS direction
            FROM steps s
            JOIN road_edges r
              ON (
                    (r.u = s.from_node_id AND r.v = s.to_node_id)
                 OR (r.u = s.to_node_id AND r.v = s.from_node_id)
              )
            WHERE s.from_node_id IS NOT NULL
              AND s.from_node_id <> s.to_node_id
        ),
        inserted AS (
            INSERT INTO matched_trip_edges (
                taxi_id,
                trip_id,
                edge_seq,
                road_uid,
                road_id,
                direction
            )
            SELECT DISTINCT
                taxi_id,
                trip_id,
                edge_seq,
                road_uid,
                road_id,
                direction
            FROM edge_matches
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
    parser = argparse.ArgumentParser(description="Build matched_trip_edges for F7 frequent path mining.")
    parser.add_argument("--database-url", default=DEFAULT_DATABASE_URL)
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--max-batches", type=int, default=0, help="0 means run until all matched_trips are processed.")
    parser.add_argument("--start-taxi-id", type=int, default=0)
    parser.add_argument("--start-trip-id", type=int, default=0)
    parser.add_argument("--rebuild", action="store_true", help="Drop and rebuild matched_trip_edges before processing.")
    args = parser.parse_args()

    engine = create_engine(args.database_url)
    create_support_schema(engine, rebuild=args.rebuild)

    cursor = BatchCursor(taxi_id=args.start_taxi_id, trip_id=args.start_trip_id)
    total_trips = count_remaining_trips(engine, cursor)
    total_inserted = 0
    processed_trips = 0
    batch_index = 0
    started_at = time.monotonic()

    planned_batches = math.ceil(total_trips / args.batch_size) if args.batch_size > 0 else 0
    if args.max_batches:
        planned_batches = min(planned_batches, args.max_batches)
    planned_trips = min(total_trips, planned_batches * args.batch_size) if planned_batches else total_trips

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
            f"inserted_edges={inserted} total_inserted={total_inserted}",
            flush=True,
        )

        if args.max_batches and batch_index >= args.max_batches:
            break

    elapsed = time.monotonic() - started_at
    print(
        f"done batches={batch_index} trips={processed_trips}/{planned_trips} "
        f"total_inserted={total_inserted} elapsed={format_duration(elapsed)}",
        flush=True,
    )


if __name__ == "__main__":
    main()
