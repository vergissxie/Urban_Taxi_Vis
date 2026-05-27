import argparse
import importlib
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Load cleaned taxi points into PostGIS")
    parser.add_argument(
        "--input-dir",
        default="data/processed/cleaned_data",
        help="Directory containing *_cleaned.csv files",
    )
    parser.add_argument("--schema", default="data_scripts/schema.sql", help="Path to schema SQL")
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=5432)
    parser.add_argument("--db", default="taxi_vis")
    parser.add_argument("--user", default="taxi_user")
    parser.add_argument("--password", default="taxi_pass")
    parser.add_argument("--truncate", action="store_true", help="Truncate table before load")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_dir = Path(args.input_dir)
    schema_path = Path(args.schema)

    try:
        psycopg2 = importlib.import_module("psycopg2")
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "psycopg2 is required. Run this script in backend container or install psycopg2-binary."
        ) from exc

    if not input_dir.exists() or not input_dir.is_dir():
        raise FileNotFoundError(f"Input directory not found: {input_dir}")
    if not schema_path.exists():
        raise FileNotFoundError(f"Schema SQL not found: {schema_path}")

    cleaned_files = sorted(input_dir.glob("*_cleaned.csv"))
    if not cleaned_files:
        raise FileNotFoundError(f"No *_cleaned.csv files found in: {input_dir}")

    conn = psycopg2.connect(
        host=args.host,
        port=args.port,
        dbname=args.db,
        user=args.user,
        password=args.password,
    )

    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(schema_path.read_text(encoding="utf-8"))

                if args.truncate:
                    cur.execute("TRUNCATE TABLE taxi_points")

                cur.execute(
                    """
                    CREATE TEMP TABLE taxi_points_staging (
                        taxi_id BIGINT,
                        gps_time TIMESTAMP,
                        lon DOUBLE PRECISION,
                        lat DOUBLE PRECISION,
                        trip_id TEXT
                    )
                    """
                )

                copy_sql = (
                    "COPY taxi_points_staging (taxi_id, gps_time, lon, lat, trip_id) "
                    "FROM STDIN WITH (FORMAT csv, HEADER true)"
                )
                loaded_file_count = 0
                for file_path in cleaned_files:
                    with file_path.open("r", encoding="utf-8") as f:
                        cur.copy_expert(copy_sql, f)
                    loaded_file_count += 1

                cur.execute(
                    """
                    INSERT INTO taxi_points (taxi_id, trip_id, gps_time, lon, lat, geom)
                    SELECT
                        taxi_id,
                        trip_id,
                        gps_time,
                        lon,
                        lat,
                        ST_SetSRID(ST_MakePoint(lon, lat), 4326)
                    FROM taxi_points_staging
                    """
                )

                cur.execute("SELECT COUNT(*) FROM taxi_points")
                total = cur.fetchone()[0]

            print(f"Loaded files: {loaded_file_count:,}")
            print(f"Load complete. taxi_points rows: {total:,}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
