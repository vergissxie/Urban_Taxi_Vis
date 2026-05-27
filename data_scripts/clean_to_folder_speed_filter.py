import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd


BEIJING_LON_MIN = 115.4
BEIJING_LON_MAX = 117.6
BEIJING_LAT_MIN = 39.4
BEIJING_LAT_MAX = 41.1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Clean taxi txt files, remove GPS jump outliers, and export final per-taxi CSVs"
    )
    parser.add_argument("--input-dir", default="data/raw/taxi_log_2008_by_id", help="Directory with raw txt files")
    parser.add_argument(
        "--output-dir",
        default="data/final/cleaned_data_speed130_r3",
        help="Final output directory under data/",
    )
    parser.add_argument("--trip-gap-minutes", type=int, default=30, help="Trip split threshold")
    parser.add_argument("--max-speed-kmh", type=float, default=130.0, help="Drop current point above this speed")
    parser.add_argument("--speed-filter-rounds", type=int, default=3, help="Recompute and filter speed this many rounds")
    parser.add_argument("--min-dt-seconds", type=float, default=1.0, help="Ignore non-positive or tiny time deltas")
    parser.add_argument("--bbox", action="store_true", help="Restrict points to a conservative Beijing bounding box")
    parser.add_argument("--stop-radius-m", type=float, default=200.0, help="Stop cluster radius in meters")
    parser.add_argument("--stop-minutes", type=int, default=20, help="Minimum stop duration")
    parser.add_argument("--taxi-ids", nargs="*", type=int, help="Optional taxi IDs to process")
    parser.add_argument("--limit", type=int, default=None, help="Optional file limit for benchmarking")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing output CSVs")
    return parser.parse_args()


def vector_distance_m(lng1: pd.Series, lat1: pd.Series, lng2: pd.Series, lat2: pd.Series) -> pd.Series:
    mean_lat = (lat1 + lat2) / 2.0
    m_per_deg_lat = 111320.0
    m_per_deg_lng = 111320.0 * np.maximum(0.1, np.abs(np.cos(np.radians(mean_lat))))
    dx = (lng2 - lng1) * m_per_deg_lng
    dy = (lat2 - lat1) * m_per_deg_lat
    return np.sqrt(dx * dx + dy * dy)


def approx_distance_m(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    mean_lat = (lat1 + lat2) / 2.0
    m_per_deg_lat = 111320.0
    m_per_deg_lng = 111320.0 * max(0.1, abs(np.cos(np.radians(mean_lat))))
    dx = (lng2 - lng1) * m_per_deg_lng
    dy = (lat2 - lat1) * m_per_deg_lat
    return float((dx * dx + dy * dy) ** 0.5)


def assign_trip_ids(df: pd.DataFrame, trip_gap_minutes: int) -> pd.DataFrame:
    if df.empty:
        out = df.copy()
        out["trip_id"] = pd.Series(dtype="int64")
        return out
    prev_time = df["timestamp"].shift(1)
    gap_min = (df["timestamp"] - prev_time).dt.total_seconds().div(60)
    df = df.copy()
    df["new_trip"] = gap_min.isna() | (gap_min > trip_gap_minutes)
    df["trip_id"] = df["new_trip"].cumsum().astype(int)
    return df.drop(columns=["new_trip"])


def drop_speed_outliers(df: pd.DataFrame, max_speed_kmh: float, rounds: int, min_dt_seconds: float) -> tuple[pd.DataFrame, list[int]]:
    removed_by_round: list[int] = []
    filtered = df.copy()

    for _ in range(max(0, rounds)):
        if len(filtered) < 2:
            removed_by_round.append(0)
            continue

        prev_time = filtered["timestamp"].shift(1)
        prev_lng = filtered["lng"].shift(1)
        prev_lat = filtered["lat"].shift(1)
        dt_seconds = (filtered["timestamp"] - prev_time).dt.total_seconds()
        distance_m = vector_distance_m(prev_lng, prev_lat, filtered["lng"], filtered["lat"])
        speed_kmh = distance_m / 1000.0 / (dt_seconds / 3600.0)

        bad = (
            dt_seconds.notna()
            & (dt_seconds >= min_dt_seconds)
            & speed_kmh.replace([np.inf, -np.inf], np.nan).gt(max_speed_kmh)
        )
        removed = int(bad.sum())
        removed_by_round.append(removed)
        if removed == 0:
            break
        filtered = filtered.loc[~bad].reset_index(drop=True)

    while len(removed_by_round) < rounds:
        removed_by_round.append(0)

    return filtered, removed_by_round


def clean_single_file(
    file_path: Path,
    trip_gap_minutes: int,
    max_speed_kmh: float,
    speed_filter_rounds: int,
    min_dt_seconds: float,
    use_bbox: bool,
) -> tuple[pd.DataFrame, dict]:
    df = pd.read_csv(
        file_path,
        header=None,
        names=["taxi_id", "timestamp", "lng", "lat"],
        dtype={"taxi_id": "int64", "lng": "float64", "lat": "float64"},
    )
    raw_rows = len(df)

    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df = df.dropna(subset=["timestamp", "lng", "lat"])
    valid_rows = len(df)
    df = df[(df["lng"] >= 72.0) & (df["lng"] <= 137.9) & (df["lat"] >= 0.8) & (df["lat"] <= 55.9)]
    china_bbox_rows = len(df)

    if use_bbox:
        df = df[
            (df["lng"] >= BEIJING_LON_MIN)
            & (df["lng"] <= BEIJING_LON_MAX)
            & (df["lat"] >= BEIJING_LAT_MIN)
            & (df["lat"] <= BEIJING_LAT_MAX)
        ]
    local_bbox_rows = len(df)

    df = df.drop_duplicates(subset=["taxi_id", "timestamp", "lng", "lat"])
    dedup_rows = len(df)
    df = df.sort_values(["timestamp", "lng", "lat"]).reset_index(drop=True)

    df, removed_by_round = drop_speed_outliers(
        df,
        max_speed_kmh=max_speed_kmh,
        rounds=speed_filter_rounds,
        min_dt_seconds=min_dt_seconds,
    )
    df = assign_trip_ids(df, trip_gap_minutes)

    stats = {
        "file": file_path.name,
        "raw_rows": raw_rows,
        "valid_rows": valid_rows,
        "china_bbox_rows": china_bbox_rows,
        "local_bbox_rows": local_bbox_rows,
        "dedup_rows": dedup_rows,
        "speed_removed_by_round": removed_by_round,
        "speed_removed_total": int(sum(removed_by_round)),
        "final_rows": int(len(df)),
    }
    return df[["taxi_id", "timestamp", "lng", "lat", "trip_id"]], stats


def extract_stop_events(df: pd.DataFrame, stop_radius_m: float, stop_minutes: int) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=["taxi_id", "start_time", "end_time", "lng", "lat", "point_count"])

    lngs = df["lng"].to_numpy(dtype=float)
    lats = df["lat"].to_numpy(dtype=float)
    times = df["timestamp"].to_numpy(dtype="datetime64[ns]")
    taxi_id = int(df["taxi_id"].iat[0])

    records = []
    cluster_start = 0

    for i in range(1, len(df)):
        d = approx_distance_m(lngs[i - 1], lats[i - 1], lngs[i], lats[i])
        if d > stop_radius_m:
            segment_len = i - cluster_start
            duration_min = (times[i - 1] - times[cluster_start]) / np.timedelta64(1, "m")
            if segment_len >= 3 and float(duration_min) >= stop_minutes:
                records.append(
                    {
                        "taxi_id": taxi_id,
                        "start_time": pd.Timestamp(times[cluster_start]),
                        "end_time": pd.Timestamp(times[i - 1]),
                        "lng": float(lngs[cluster_start:i].mean()),
                        "lat": float(lats[cluster_start:i].mean()),
                        "point_count": int(segment_len),
                    }
                )
            cluster_start = i

    tail_len = len(df) - cluster_start
    if tail_len > 0:
        duration_min = (times[-1] - times[cluster_start]) / np.timedelta64(1, "m")
        if tail_len >= 3 and float(duration_min) >= stop_minutes:
            records.append(
                {
                    "taxi_id": taxi_id,
                    "start_time": pd.Timestamp(times[cluster_start]),
                    "end_time": pd.Timestamp(times[-1]),
                    "lng": float(lngs[cluster_start:].mean()),
                    "lat": float(lats[cluster_start:].mean()),
                    "point_count": int(tail_len),
                }
            )

    return pd.DataFrame(records, columns=["taxi_id", "start_time", "end_time", "lng", "lat", "point_count"])


def should_process(file_path: Path, taxi_ids: set[int] | None) -> bool:
    if not taxi_ids:
        return True
    try:
        taxi_id = int(file_path.stem)
    except ValueError:
        return False
    return taxi_id in taxi_ids


def render_progress(current: int, total: int, processed: int, speed_removed: int, started: float, width: int = 32) -> None:
    elapsed = max(1e-6, time.time() - started)
    ratio = 0.0 if total <= 0 else min(1.0, max(0.0, current / total))
    done = int(width * ratio)
    bar = "#" * done + "-" * (width - done)
    rate = current / elapsed
    eta = (total - current) / max(1e-6, rate)
    print(
        f"[{bar}] {ratio * 100:5.1f}% "
        f"{current}/{total} files processed={processed} "
        f"speed_removed={speed_removed:,} rate={rate:.1f} files/s eta={eta/60:.1f}m",
        flush=True,
    )


def main() -> None:
    args = parse_args()
    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_dir.exists():
        raise FileNotFoundError(f"Input directory not found: {input_dir}")

    taxi_ids = set(args.taxi_ids) if args.taxi_ids else None
    files = sorted(input_dir.glob("*.txt"))
    files = [f for f in files if should_process(f, taxi_ids)]
    if args.limit is not None:
        files = files[: max(0, args.limit)]

    if not files:
        print("No matching txt files to process")
        return

    started = time.time()
    processed = 0
    total_raw_rows = 0
    total_final_rows = 0
    total_speed_removed = 0
    per_file_stats = []

    for idx, file_path in enumerate(files, start=1):
        try:
            taxi_id_from_name = int(file_path.stem)
        except ValueError:
            taxi_id_from_name = None

        if taxi_id_from_name is not None and not args.overwrite:
            cleaned_out = output_dir / f"{taxi_id_from_name}_cleaned.csv"
            stops_out = output_dir / f"{taxi_id_from_name}_stop_events.csv"
            if cleaned_out.exists() and stops_out.exists():
                continue

        cleaned, stats = clean_single_file(
            file_path=file_path,
            trip_gap_minutes=args.trip_gap_minutes,
            max_speed_kmh=args.max_speed_kmh,
            speed_filter_rounds=args.speed_filter_rounds,
            min_dt_seconds=args.min_dt_seconds,
            use_bbox=args.bbox,
        )
        if cleaned.empty:
            per_file_stats.append(stats)
            continue

        taxi_id = int(cleaned.iloc[0]["taxi_id"])
        cleaned_out = output_dir / f"{taxi_id}_cleaned.csv"
        stops_out = output_dir / f"{taxi_id}_stop_events.csv"

        cleaned = cleaned.rename(columns={"timestamp": "gps_time", "lng": "lon"})
        cleaned.to_csv(cleaned_out, index=False)
        stops = extract_stop_events(cleaned.rename(columns={"gps_time": "timestamp", "lon": "lng"}), args.stop_radius_m, args.stop_minutes)
        stops.to_csv(stops_out, index=False)

        processed += 1
        total_raw_rows += stats["raw_rows"]
        total_final_rows += stats["final_rows"]
        total_speed_removed += stats["speed_removed_total"]
        per_file_stats.append(stats)

        if idx == 1 or idx % 250 == 0 or idx == len(files):
            render_progress(
                current=idx,
                total=len(files),
                processed=processed,
                speed_removed=total_speed_removed,
                started=started,
            )

    summary = {
        "input_dir": str(input_dir),
        "output_dir": str(output_dir),
        "file_count": len(files),
        "processed_files": processed,
        "total_raw_rows": total_raw_rows,
        "total_final_rows": total_final_rows,
        "total_speed_removed": total_speed_removed,
        "max_speed_kmh": args.max_speed_kmh,
        "speed_filter_rounds": args.speed_filter_rounds,
        "trip_gap_minutes": args.trip_gap_minutes,
        "bbox_enabled": bool(args.bbox),
        "elapsed_seconds": round(time.time() - started, 3),
    }
    (output_dir / "_cleaning_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    pd.DataFrame(per_file_stats).to_csv(output_dir / "_per_file_cleaning_stats.csv", index=False)

    print(f"Processed files: {processed}")
    print(f"Raw rows total: {total_raw_rows:,}")
    print(f"Final rows total: {total_final_rows:,}")
    print(f"Speed outliers removed: {total_speed_removed:,}")
    print(f"Summary: {output_dir / '_cleaning_summary.json'}")
    print(f"Per-file stats: {output_dir / '_per_file_cleaning_stats.csv'}")
    print(f"Output dir: {output_dir}")


if __name__ == "__main__":
    main()
