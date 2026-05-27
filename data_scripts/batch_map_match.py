import argparse
import csv
import os
import sys
import time
from collections import deque
from concurrent.futures import ProcessPoolExecutor, as_completed
from concurrent.futures.process import BrokenProcessPool
from dataclasses import dataclass
from multiprocessing import cpu_count
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy import text

from map_match_taxi_id1 import (
    build_route_graph,
    get_engine,
    haversine_dist,
    load_track_points,
    node_ids_to_lonlat,
    progress_bar,
    stitch_node_sequence,
    viterbi_match,
    linestring_wkt_from_lonlat,
)


EDGE_CACHE: List[Dict] = []
EDGE_GRID: Dict[Tuple[int, int], List[int]] = {}
GRID_SIZE_DEG = 0.02
NODE_GRID_SIZE_DEG = 0.002


@dataclass
class TripTask:
    taxi_id: int
    trip_id_text: str
    trip_id_int: int
    point_count: int = 0
    lon_span: float = 0.0
    lat_span: float = 0.0


@dataclass
class FailureRecord:
    taxi_id: int
    trip_id_text: str
    status: str
    reason: str
    point_count: int
    displacement_m: float
    detail: str


@dataclass
class AffectedTrip:
    taxi_id: int
    trip_id_text: str
    trip_id_int: int
    point_count: int
    inside_count: int
    outside_count: int


def setup_output_table_once() -> None:
    engine = get_engine()
    create_sql = text(
        """
        CREATE TABLE IF NOT EXISTS matched_trips (
            taxi_id BIGINT NOT NULL,
            trip_id BIGINT NOT NULL,
            matched_geom GEOMETRY(LineString, 4326),
            distance_km DOUBLE PRECISION,
            PRIMARY KEY (taxi_id, trip_id)
        )
        """
    )
    index_sql = text(
        """
        CREATE INDEX IF NOT EXISTS idx_matched_taxi_id
            ON matched_trips (taxi_id)
        """
    )
    status_sql = text(
        """
        CREATE TABLE IF NOT EXISTS map_match_trip_status (
            taxi_id BIGINT NOT NULL,
            trip_id BIGINT NOT NULL,
            status TEXT NOT NULL,
            reason TEXT,
            point_count INTEGER,
            displacement_m DOUBLE PRECISION,
            detail TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (taxi_id, trip_id)
        )
        """
    )
    status_index_sql = text(
        """
        CREATE INDEX IF NOT EXISTS idx_map_match_trip_status_status
            ON map_match_trip_status (status)
        """
    )
    with engine.begin() as conn:
        conn.execute(create_sql)
        conn.execute(index_sql)
        conn.execute(status_sql)
        conn.execute(status_index_sql)


def save_result_fast(taxi_id: int, trip_id: int, matched_lonlat) -> None:
    matched_wkt = linestring_wkt_from_lonlat(matched_lonlat)
    if matched_wkt is None:
        raise RuntimeError("Matched geometry is empty")

    upsert_sql = text(
        """
        INSERT INTO matched_trips (
            trip_id,
            taxi_id,
            matched_geom,
            distance_km
        )
        VALUES (
            :trip_id,
            :taxi_id,
            ST_GeomFromText(:matched_wkt, 4326),
            ST_Length(ST_GeomFromText(:matched_wkt, 4326)::geography) / 1000.0
        )
        ON CONFLICT (taxi_id, trip_id) DO UPDATE
        SET taxi_id = EXCLUDED.taxi_id,
            matched_geom = EXCLUDED.matched_geom,
            distance_km = EXCLUDED.distance_km
        """
    )

    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            upsert_sql,
            {
                "trip_id": trip_id,
                "taxi_id": taxi_id,
                "matched_wkt": matched_wkt,
            },
        )


def save_trip_status(
    taxi_id: int,
    trip_id: int,
    status: str,
    reason: str,
    point_count: int,
    displacement_m: float,
    detail: str,
) -> None:
    sql = text(
        """
        INSERT INTO map_match_trip_status (
            taxi_id,
            trip_id,
            status,
            reason,
            point_count,
            displacement_m,
            detail,
            updated_at
        )
        VALUES (
            :taxi_id,
            :trip_id,
            :status,
            :reason,
            :point_count,
            :displacement_m,
            :detail,
            now()
        )
        ON CONFLICT (taxi_id, trip_id) DO UPDATE
        SET status = EXCLUDED.status,
            reason = EXCLUDED.reason,
            point_count = EXCLUDED.point_count,
            displacement_m = EXCLUDED.displacement_m,
            detail = EXCLUDED.detail,
            updated_at = now()
        """
    )
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            sql,
            {
                "taxi_id": taxi_id,
                "trip_id": trip_id,
                "status": status,
                "reason": reason,
                "point_count": point_count,
                "displacement_m": displacement_m,
                "detail": detail,
            },
        )


def load_all_edges_once() -> List[Dict]:
    engine = get_engine()
    sql = text(
        """
        SELECT
            u,
            v,
            COALESCE(oneway, '') AS oneway,
            ST_X(ST_StartPoint(geometry)) AS start_lon,
            ST_Y(ST_StartPoint(geometry)) AS start_lat,
            ST_X(ST_EndPoint(geometry)) AS end_lon,
            ST_Y(ST_EndPoint(geometry)) AS end_lat
        FROM road_edges
        WHERE u IS NOT NULL AND v IS NOT NULL
        """
    )
    with engine.begin() as conn:
        rows = conn.execute(sql).mappings().all()

    cached: List[Dict] = []
    for r in rows:
        slon = float(r["start_lon"])
        slat = float(r["start_lat"])
        elon = float(r["end_lon"])
        elat = float(r["end_lat"])
        cached.append(
            {
                "u": int(r["u"]),
                "v": int(r["v"]),
                "oneway": r["oneway"],
                "start_lon": slon,
                "start_lat": slat,
                "end_lon": elon,
                "end_lat": elat,
                "min_lon": slon if slon < elon else elon,
                "max_lon": elon if slon < elon else slon,
                "min_lat": slat if slat < elat else elat,
                "max_lat": elat if slat < elat else slat,
            }
        )
    return cached


def init_worker() -> None:
    global EDGE_CACHE, EDGE_GRID
    EDGE_CACHE = load_all_edges_once()
    EDGE_GRID = build_edge_grid(EDGE_CACHE)


def grid_key(lon: float, lat: float) -> Tuple[int, int]:
    return (int(lon // GRID_SIZE_DEG), int(lat // GRID_SIZE_DEG))


def build_edge_grid(edges: List[Dict]) -> Dict[Tuple[int, int], List[int]]:
    grid: Dict[Tuple[int, int], List[int]] = {}
    for idx, edge in enumerate(edges):
        min_x, min_y = grid_key(edge["min_lon"], edge["min_lat"])
        max_x, max_y = grid_key(edge["max_lon"], edge["max_lat"])
        for gx in range(min_x, max_x + 1):
            for gy in range(min_y, max_y + 1):
                grid.setdefault((gx, gy), []).append(idx)
    return grid


def select_local_edges_from_cache(min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> List[Dict]:
    if EDGE_GRID:
        min_x, min_y = grid_key(min_lon, min_lat)
        max_x, max_y = grid_key(max_lon, max_lat)
        candidate_indexes: Set[int] = set()
        for gx in range(min_x, max_x + 1):
            for gy in range(min_y, max_y + 1):
                candidate_indexes.update(EDGE_GRID.get((gx, gy), []))
        candidates = (EDGE_CACHE[i] for i in candidate_indexes)
    else:
        candidates = EDGE_CACHE

    selected = []
    for e in candidates:
        if e["max_lon"] < min_lon:
            continue
        if e["min_lon"] > max_lon:
            continue
        if e["max_lat"] < min_lat:
            continue
        if e["min_lat"] > max_lat:
            continue
        selected.append(e)
    return selected


def build_node_grid(node_coords: Dict[int, Tuple[float, float]]) -> Dict[Tuple[int, int], List[int]]:
    grid: Dict[Tuple[int, int], List[int]] = {}
    for nid, (lon, lat) in node_coords.items():
        gx = int(lon // NODE_GRID_SIZE_DEG)
        gy = int(lat // NODE_GRID_SIZE_DEG)
        grid.setdefault((gx, gy), []).append(nid)
    return grid


def candidate_nodes_for_point_grid(
    lon: float,
    lat: float,
    node_coords: Dict[int, Tuple[float, float]],
    node_grid: Dict[Tuple[int, int], List[int]],
    search_radius_m: float,
    max_candidates: int,
) -> List[Tuple[int, float]]:
    gx = int(lon // NODE_GRID_SIZE_DEG)
    gy = int(lat // NODE_GRID_SIZE_DEG)
    radius_deg = search_radius_m / 111000.0
    span = max(1, int(radius_deg / NODE_GRID_SIZE_DEG) + 2)

    candidate_ids: Set[int] = set()
    for ix in range(gx - span, gx + span + 1):
        for iy in range(gy - span, gy + span + 1):
            candidate_ids.update(node_grid.get((ix, iy), []))

    cands: List[Tuple[int, float]] = []
    nearest_node = None
    nearest_dist = float("inf")

    for nid in candidate_ids:
        nlon, nlat = node_coords[nid]
        d = haversine_dist(lon, lat, nlon, nlat)
        if d < nearest_dist:
            nearest_dist = d
            nearest_node = nid
        if d <= search_radius_m:
            cands.append((nid, d))

    if not cands:
        # Rare fallback when a sparse local graph has no nearby grid hit.
        for nid, (nlon, nlat) in node_coords.items():
            d = haversine_dist(lon, lat, nlon, nlat)
            if d < nearest_dist:
                nearest_dist = d
                nearest_node = nid
            if d <= search_radius_m:
                cands.append((nid, d))

    cands.sort(key=lambda x: x[1])
    if not cands and nearest_node is not None:
        cands = [(nearest_node, nearest_dist)]
    return cands[:max_candidates]


def list_pending_tasks(
    limit: Optional[int],
    start_taxi_id: Optional[int],
    max_task_point_count: Optional[int],
    max_task_span_deg: Optional[float],
) -> List[TripTask]:
    engine = get_engine()
    if max_task_point_count is None and max_task_span_deg is None:
        sql_text = """
            SELECT p.taxi_id, p.trip_id, 0 AS point_count, 0.0 AS lon_span, 0.0 AS lat_span
            FROM (
                SELECT DISTINCT taxi_id, trip_id
                FROM taxi_points
                WHERE trip_id ~ '^[0-9]+$'
            ) p
            WHERE NOT EXISTS (
                SELECT 1
                FROM matched_trips m
                WHERE m.taxi_id = p.taxi_id
                  AND m.trip_id = CAST(p.trip_id AS BIGINT)
            )
            AND NOT EXISTS (
                SELECT 1
                FROM map_match_trip_status s
                WHERE s.taxi_id = p.taxi_id
                  AND s.trip_id = CAST(p.trip_id AS BIGINT)
                  AND s.status IN ('matched', 'stationary', 'failed')
            )
            AND (:start_taxi_id IS NULL OR p.taxi_id >= :start_taxi_id)
            ORDER BY p.taxi_id, CAST(p.trip_id AS BIGINT)
        """
    else:
        sql_text = """
            SELECT p.taxi_id, p.trip_id, p.point_count, p.lon_span, p.lat_span
            FROM (
                SELECT
                    taxi_id,
                    trip_id,
                    COUNT(*) AS point_count,
                    MAX(lon) - MIN(lon) AS lon_span,
                    MAX(lat) - MIN(lat) AS lat_span
                FROM taxi_points
                WHERE trip_id ~ '^[0-9]+$'
                GROUP BY taxi_id, trip_id
            ) p
            WHERE NOT EXISTS (
                SELECT 1
                FROM matched_trips m
                WHERE m.taxi_id = p.taxi_id
                  AND m.trip_id = CAST(p.trip_id AS BIGINT)
            )
            AND NOT EXISTS (
                SELECT 1
                FROM map_match_trip_status s
                WHERE s.taxi_id = p.taxi_id
                  AND s.trip_id = CAST(p.trip_id AS BIGINT)
                  AND s.status IN ('matched', 'stationary', 'failed')
            )
            AND (:start_taxi_id IS NULL OR p.taxi_id >= :start_taxi_id)
            AND (:max_task_point_count IS NULL OR p.point_count <= :max_task_point_count)
            AND (:max_task_span_deg IS NULL OR GREATEST(p.lon_span, p.lat_span) <= :max_task_span_deg)
            ORDER BY p.taxi_id, CAST(p.trip_id AS BIGINT)
        """

    params = {
        "start_taxi_id": start_taxi_id,
        "max_task_point_count": max_task_point_count,
        "max_task_span_deg": max_task_span_deg,
    }
    if limit is not None:
        sql_text += " LIMIT :limit"
        params["limit"] = limit

    sql = text(sql_text)

    with engine.begin() as conn:
        rows = conn.execute(sql, params).all()

    tasks: List[TripTask] = []
    for row in rows:
        taxi_id = int(row[0])
        trip_id_text = str(row[1])
        tasks.append(
            TripTask(
                taxi_id=taxi_id,
                trip_id_text=trip_id_text,
                trip_id_int=int(trip_id_text),
                point_count=int(row[2] or 0),
                lon_span=float(row[3] or 0.0),
                lat_span=float(row[4] or 0.0),
            )
        )
    return tasks


def process_one_trip(
    task: TripTask,
    max_points: int,
    search_padding_deg: float,
    search_radius_m: float,
    max_candidates: int,
    stationary_threshold_m: float,
):
    engine = get_engine()

    points = load_track_points(engine, task.taxi_id, task.trip_id_text, max_points=max_points)
    point_count = len(points)
    if len(points) <= 2:
        msg = f"skip: taxi_id={task.taxi_id}, trip_id={task.trip_id_text}, reason=not-enough-points, point_count={point_count}"
        save_trip_status(task.taxi_id, task.trip_id_int, "failed", "not-enough-points", point_count, 0.0, msg)
        return "failed", msg, point_count, 0.0, None, None

    track_lonlat = [(lon, lat) for lon, lat, _, _ in points]
    displacement_m = cumulative_displacement_m(track_lonlat)
    if displacement_m < stationary_threshold_m:
        msg = (
            f"stationary: taxi_id={task.taxi_id}, trip_id={task.trip_id_text}, "
            f"reason=stationary-trip, displacement_m={displacement_m:.2f}, point_count={point_count}"
        )
        save_trip_status(
            task.taxi_id,
            task.trip_id_int,
            "stationary",
            "stationary-trip",
            point_count,
            displacement_m,
            msg,
        )
        return "stationary", msg, point_count, displacement_m, None, None

    lons = [p[0] for p in track_lonlat]
    lats = [p[1] for p in track_lonlat]
    min_lon = min(lons) - search_padding_deg
    max_lon = max(lons) + search_padding_deg
    min_lat = min(lats) - search_padding_deg
    max_lat = max(lats) + search_padding_deg

    edge_rows = select_local_edges_from_cache(min_lon, min_lat, max_lon, max_lat)
    if not edge_rows:
        msg = f"fail: taxi_id={task.taxi_id}, trip_id={task.trip_id_text}, reason=no-road-edges"
        save_trip_status(task.taxi_id, task.trip_id_int, "failed", "no-road-edges", point_count, displacement_m, msg)
        return "failed", msg, point_count, displacement_m, None, None

    graph, node_coords = build_route_graph(edge_rows)
    if not graph or not node_coords:
        msg = f"fail: taxi_id={task.taxi_id}, trip_id={task.trip_id_text}, reason=empty-graph"
        save_trip_status(task.taxi_id, task.trip_id_int, "failed", "empty-graph", point_count, displacement_m, msg)
        return "failed", msg, point_count, displacement_m, None, None

    node_grid = build_node_grid(node_coords)
    candidates = [
        candidate_nodes_for_point_grid(
            lon,
            lat,
            node_coords,
            node_grid,
            search_radius_m=search_radius_m,
            max_candidates=max_candidates,
        )
        for lon, lat in track_lonlat
    ]

    best_node_seq = viterbi_match(
        gps_lonlat=track_lonlat,
        candidates=candidates,
        graph=graph,
        sigma_z=80.0,
        beta=350.0,
    )
    if not best_node_seq:
        msg = f"fail: taxi_id={task.taxi_id}, trip_id={task.trip_id_text}, reason=empty-viterbi"
        save_trip_status(task.taxi_id, task.trip_id_int, "failed", "empty-viterbi", point_count, displacement_m, msg)
        return "failed", msg, point_count, displacement_m, None, None

    matched_node_ids = stitch_node_sequence(best_node_seq, graph)
    matched_lonlat = node_ids_to_lonlat(matched_node_ids, node_coords)

    if len(matched_lonlat) < 2:
        reason = "stationary-trip" if displacement_m < stationary_threshold_m else "short-path"
        status = "stationary" if reason == "stationary-trip" else "failed"
        prefix = "stationary" if status == "stationary" else "fail"
        msg = (
            f"{prefix}: taxi_id={task.taxi_id}, trip_id={task.trip_id_text}, "
            f"reason={reason}, displacement_m={displacement_m:.2f}, point_count={point_count}"
        )
        save_trip_status(task.taxi_id, task.trip_id_int, status, reason, point_count, displacement_m, msg)
        return status, msg, point_count, displacement_m, None, None

    matched_wkt = linestring_wkt_from_lonlat(matched_lonlat)
    distance_km = path_distance_km(matched_lonlat)
    save_result_fast(task.taxi_id, task.trip_id_int, matched_lonlat)
    msg = f"ok: taxi_id={task.taxi_id}, trip_id={task.trip_id_text}, matched_points={len(matched_lonlat)}"
    save_trip_status(task.taxi_id, task.trip_id_int, "matched", "matched", point_count, displacement_m, msg)
    return "matched", msg, point_count, displacement_m, matched_wkt, distance_km


def cumulative_displacement_m(track_lonlat: List[Tuple[float, float]]) -> float:
    total = 0.0
    for idx in range(1, len(track_lonlat)):
        prev_lon, prev_lat = track_lonlat[idx - 1]
        lon, lat = track_lonlat[idx]
        total += haversine_dist(prev_lon, prev_lat, lon, lat)
    return total


def path_distance_km(points: List[Tuple[float, float]]) -> float:
    return cumulative_displacement_m(points) / 1000.0


def render_live_progress(done: int, total: int, ok: int, stationary: int, fail: int, started: float) -> None:
    elapsed = max(1e-6, time.time() - started)
    speed = done / elapsed
    eta_sec = (total - done) / max(1e-6, speed)
    line = (
        f"\r{progress_bar(done, total, width=40)} "
        f"{done}/{total} ok={ok} stationary={stationary} fail={fail} "
        f"speed={speed:.2f} trip/s eta={eta_sec/60:.1f}m"
    )
    sys.stdout.write(line)
    sys.stdout.flush()
    if done == total:
        sys.stdout.write("\n")
        sys.stdout.flush()


def process_with_pool(
    tasks: List[TripTask],
    workers: int,
    max_points: int,
    padding_deg: float,
    search_radius_m: float,
    max_candidates: int,
    stationary_threshold_m: float,
    total: int,
    done: int,
    ok: int,
    stationary: int,
    fail: int,
    started: float,
    output_csv: Optional[str],
    status_csv: Optional[str],
):
    pending = deque(tasks)
    in_flight = {}
    failures: List[FailureRecord] = []
    max_in_flight = max(16, workers * 4)

    with ProcessPoolExecutor(max_workers=workers, initializer=init_worker) as pool:
        def submit_next() -> bool:
            if not pending:
                return False
            task = pending.popleft()
            try:
                fut = pool.submit(
                    process_one_trip,
                    task,
                    max_points,
                    padding_deg,
                    search_radius_m,
                    max_candidates,
                    stationary_threshold_m,
                )
            except BrokenProcessPool:
                pending.appendleft(task)
                raise
            in_flight[fut] = task
            return True

        for _ in range(min(max_in_flight, len(tasks))):
            if not submit_next():
                break

        while in_flight:
            try:
                fut = next(as_completed(in_flight))
            except BrokenProcessPool:
                remaining = list(pending) + list(in_flight.values())
                return done, ok, stationary, fail, remaining, True, failures

            task = in_flight.pop(fut)
            done += 1

            try:
                status, msg, point_count, displacement_m, matched_wkt, distance_km = fut.result()
            except BrokenProcessPool:
                remaining = [task] + list(pending) + list(in_flight.values())
                return done - 1, ok, stationary, fail, remaining, True, failures
            except Exception as exc:
                status = "failed"
                msg = f"error: taxi_id={task.taxi_id}, trip_id={task.trip_id_text}, detail={exc}"
                point_count = 0
                displacement_m = 0.0
                matched_wkt = None
                distance_km = None

            if status == "matched":
                ok += 1
                append_matched_result(output_csv, task, distance_km, matched_wkt)
            elif status == "stationary":
                stationary += 1
                failures.append(parse_failure_record(task, msg, status=status))
            else:
                fail += 1
                failures.append(parse_failure_record(task, msg, status=status))

            append_status_result(status_csv, task, status, msg, point_count, displacement_m)
            render_live_progress(done, total, ok, stationary, fail, started)

            if (status != "matched") and (done % 200 == 0):
                print(msg)

            try:
                submit_next()
            except BrokenProcessPool:
                remaining = list(pending) + list(in_flight.values())
                return done, ok, stationary, fail, remaining, True, failures

    return done, ok, stationary, fail, [], False, failures


def parse_failure_record(task: TripTask, msg: str, status: str) -> FailureRecord:
    reason = "unknown"
    displacement_m = 0.0
    point_count = 0
    marker = "reason="
    if marker in msg:
        reason = msg.split(marker, 1)[1].split(",", 1)[0].strip()
    elif msg.startswith("error:"):
        reason = "exception"
    if "displacement_m=" in msg:
        try:
            displacement_m = float(msg.split("displacement_m=", 1)[1].split(",", 1)[0].strip())
        except ValueError:
            displacement_m = 0.0
    if "point_count=" in msg:
        try:
            point_count = int(msg.split("point_count=", 1)[1].split(",", 1)[0].strip())
        except ValueError:
            point_count = 0

    return FailureRecord(
        taxi_id=task.taxi_id,
        trip_id_text=task.trip_id_text,
        status=status,
        reason=reason,
        point_count=point_count,
        displacement_m=displacement_m,
        detail=msg,
    )


def ensure_incremental_csv(path: Optional[str], header: List[str]) -> None:
    if not path:
        return
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists() and output_path.stat().st_size > 0:
        return
    with output_path.open("w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerow(header)


def append_matched_result(
    output_csv: Optional[str],
    task: TripTask,
    distance_km: Optional[float],
    matched_wkt: Optional[str],
) -> None:
    if not output_csv or not matched_wkt:
        return
    with Path(output_csv).open("a", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                task.taxi_id,
                task.trip_id_int,
                f"{distance_km:.6f}" if distance_km is not None else "",
                matched_wkt,
            ]
        )
        f.flush()


def append_status_result(
    status_csv: Optional[str],
    task: TripTask,
    status: str,
    msg: str,
    point_count: int,
    displacement_m: float,
) -> None:
    if not status_csv:
        return
    reason = parse_reason(msg, status)
    with Path(status_csv).open("a", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                task.taxi_id,
                task.trip_id_text,
                status,
                reason,
                point_count,
                f"{displacement_m:.2f}",
                msg,
            ]
        )
        f.flush()


def parse_reason(msg: str, status: str) -> str:
    if "reason=" in msg:
        return msg.split("reason=", 1)[1].split(",", 1)[0].strip()
    if status == "matched":
        return "matched"
    if msg.startswith("error:"):
        return "exception"
    return "unknown"


def run(
    limit: Optional[int],
    workers: int,
    max_points: int,
    padding_deg: float,
    start_taxi_id: Optional[int],
    auto_downgrade: bool,
    min_workers: int,
    output_csv: Optional[str],
    failure_csv: Optional[str],
    search_radius_m: float,
    max_candidates: int,
    stationary_threshold_m: float,
    max_task_point_count: Optional[int],
    max_task_span_deg: Optional[float],
):
    setup_output_table_once()
    tasks = list_pending_tasks(
        limit=limit,
        start_taxi_id=start_taxi_id,
        max_task_point_count=max_task_point_count,
        max_task_span_deg=max_task_span_deg,
    )

    if not tasks:
        print("No pending numeric trips to process.")
        return

    total = len(tasks)
    print(f"Pending tasks: {total}")
    print(f"Workers: {workers}")
    print(f"HMM params: search_radius_m={search_radius_m}, max_candidates={max_candidates}, max_points={max_points}, padding_deg={padding_deg}")
    if start_taxi_id is not None:
        print(f"Start taxi_id filter: >= {start_taxi_id}")
    if max_task_point_count is not None:
        print(f"Task filter: point_count <= {max_task_point_count}")
    if max_task_span_deg is not None:
        print(f"Task filter: max(lon_span, lat_span) <= {max_task_span_deg}")
    print("Each worker will load full road network once and reuse it for all assigned trips.")
    ensure_incremental_csv(output_csv, ["taxi_id", "trip_id", "distance_km", "matched_wkt"])
    ensure_incremental_csv(failure_csv, ["taxi_id", "trip_id", "status", "reason", "point_count", "displacement_m", "detail"])
    if output_csv:
        print(f"Incremental matched CSV: {output_csv}")
    if failure_csv:
        print(f"Incremental status CSV: {failure_csv}")

    done = 0
    ok = 0
    stationary = 0
    fail = 0
    failures: List[FailureRecord] = []
    started = time.time()

    current_workers = max(1, workers)
    remaining = tasks
    attempt = 1
    while remaining:
        print(f"Attempt {attempt}: workers={current_workers}, remaining={len(remaining)}")
        done, ok, stationary, fail, remaining, crashed, attempt_failures = process_with_pool(
            tasks=remaining,
            workers=current_workers,
            max_points=max_points,
            padding_deg=padding_deg,
            search_radius_m=search_radius_m,
            max_candidates=max_candidates,
            stationary_threshold_m=stationary_threshold_m,
            total=total,
            done=done,
            ok=ok,
            stationary=stationary,
            fail=fail,
            started=started,
            output_csv=output_csv,
            status_csv=failure_csv,
        )
        failures.extend(attempt_failures)

        if not crashed:
            break

        if auto_downgrade and current_workers > max(1, min_workers):
            next_workers = max(1, current_workers - 1)
            print(
                f"\nBrokenProcessPool detected at workers={current_workers}. "
                f"Auto downgrade to workers={next_workers} and continue."
            )
            current_workers = next_workers
            attempt += 1
            continue

        raise RuntimeError(
            f"BrokenProcessPool at workers={current_workers}; "
            f"auto_downgrade={auto_downgrade}, min_workers={min_workers}"
        )

    elapsed = time.time() - started
    print("Batch finished.")
    print(f"Elapsed: {elapsed/60:.2f} min")
    print(f"Result: total={total}, ok={ok}, stationary={stationary}, fail={fail}")

    if output_csv:
        print(f"Matched CSV was written incrementally: {output_csv}")

    if failure_csv:
        print(f"Status CSV was written incrementally: {failure_csv}")


def export_matched_results(tasks: List[TripTask], output_csv: str) -> None:
    output_path = Path(output_csv)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    keys = sorted({(task.taxi_id, task.trip_id_int) for task in tasks})
    if not keys:
        print(f"No task keys to export: {output_path}")
        return

    engine = get_engine()
    rows_written = 0
    with output_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["taxi_id", "trip_id", "distance_km", "matched_wkt"])

        with engine.begin() as conn:
            for start in range(0, len(keys), 1000):
                chunk = keys[start : start + 1000]
                params = {
                    f"taxi_{idx}": taxi_id
                    for idx, (taxi_id, _) in enumerate(chunk)
                }
                params.update(
                    {
                        f"trip_{idx}": trip_id
                        for idx, (_, trip_id) in enumerate(chunk)
                    }
                )
                values_sql = ", ".join(
                    f"(:taxi_{idx}, :trip_{idx})"
                    for idx in range(len(chunk))
                )
                sql = text(
                    f"""
                    WITH requested(taxi_id, trip_id) AS (
                        VALUES {values_sql}
                    )
                    SELECT
                        m.taxi_id,
                        m.trip_id,
                        m.distance_km,
                        ST_AsText(m.matched_geom) AS matched_wkt
                    FROM matched_trips m
                    JOIN requested r
                      ON m.taxi_id = r.taxi_id
                     AND m.trip_id = r.trip_id
                    ORDER BY m.taxi_id, m.trip_id
                    """
                )
                for row in conn.execute(sql, params):
                    writer.writerow(row)
                    rows_written += 1

    print(f"Exported matched results: {rows_written:,} rows -> {output_path}")


def export_failures(failures: List[FailureRecord], failure_csv: str) -> None:
    output_path = Path(failure_csv)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["taxi_id", "trip_id", "status", "reason", "point_count", "displacement_m", "detail"])
        for failure in failures:
            writer.writerow(
                [
                    failure.taxi_id,
                    failure.trip_id_text,
                    failure.status,
                    failure.reason,
                    failure.point_count,
                    f"{failure.displacement_m:.2f}",
                    failure.detail,
                ]
            )

    print(f"Exported failed tasks: {len(failures):,} rows -> {output_path}")


def load_road_bounds() -> Tuple[float, float, float, float]:
    sql = text(
        """
        WITH road_bbox AS (
            SELECT ST_Extent(geometry)::box2d AS b FROM road_edges
        )
        SELECT ST_XMin(b), ST_YMin(b), ST_XMax(b), ST_YMax(b)
        FROM road_bbox
        """
    )
    engine = get_engine()
    with engine.begin() as conn:
        row = conn.execute(sql).one()
    return float(row[0]), float(row[1]), float(row[2]), float(row[3])


def list_out_of_road_bbox_matched_tasks(limit: Optional[int]) -> List[AffectedTrip]:
    sql_text = """
        WITH road_bbox AS (
            SELECT ST_Extent(geometry)::box2d AS b FROM road_edges
        ),
        bounds AS (
            SELECT ST_XMin(b) min_lon, ST_YMin(b) min_lat, ST_XMax(b) max_lon, ST_YMax(b) max_lat
            FROM road_bbox
        ),
        trip_stats AS (
            SELECT
                tp.taxi_id,
                tp.trip_id,
                COUNT(*) AS point_count,
                COUNT(*) FILTER (
                    WHERE tp.lon BETWEEN b.min_lon AND b.max_lon
                      AND tp.lat BETWEEN b.min_lat AND b.max_lat
                ) AS inside_count,
                COUNT(*) FILTER (
                    WHERE NOT (
                        tp.lon BETWEEN b.min_lon AND b.max_lon
                        AND tp.lat BETWEEN b.min_lat AND b.max_lat
                    )
                ) AS outside_count
            FROM taxi_points tp
            CROSS JOIN bounds b
            GROUP BY tp.taxi_id, tp.trip_id
        )
        SELECT ts.taxi_id, ts.trip_id, ts.point_count, ts.inside_count, ts.outside_count
        FROM trip_stats ts
        JOIN matched_trips m
          ON m.taxi_id = ts.taxi_id
         AND m.trip_id = ts.trip_id::bigint
        WHERE ts.outside_count > 0
        ORDER BY ts.taxi_id, ts.trip_id::bigint
    """
    params = {}
    if limit is not None:
        sql_text += " LIMIT :limit"
        params["limit"] = limit
    engine = get_engine()
    with engine.begin() as conn:
        rows = conn.execute(text(sql_text), params).all()
    return [
        AffectedTrip(
            taxi_id=int(row[0]),
            trip_id_text=str(row[1]),
            trip_id_int=int(row[1]),
            point_count=int(row[2]),
            inside_count=int(row[3]),
            outside_count=int(row[4]),
        )
        for row in rows
    ]


def backup_out_of_road_bbox_matches(backup_table: str) -> int:
    if not backup_table.replace("_", "").isalnum():
        raise ValueError(f"Unsafe backup table name: {backup_table}")
    sql = text(
        f"""
        CREATE TABLE IF NOT EXISTS {backup_table} AS
        WITH road_bbox AS (
            SELECT ST_Extent(geometry)::box2d AS b FROM road_edges
        ),
        bounds AS (
            SELECT ST_XMin(b) min_lon, ST_YMin(b) min_lat, ST_XMax(b) max_lon, ST_YMax(b) max_lat
            FROM road_bbox
        ),
        trip_stats AS (
            SELECT
                tp.taxi_id,
                tp.trip_id,
                COUNT(*) FILTER (
                    WHERE NOT (
                        tp.lon BETWEEN b.min_lon AND b.max_lon
                        AND tp.lat BETWEEN b.min_lat AND b.max_lat
                    )
                ) AS outside_count
            FROM taxi_points tp
            CROSS JOIN bounds b
            GROUP BY tp.taxi_id, tp.trip_id
        )
        SELECT m.*, now() AS backed_up_at
        FROM matched_trips m
        JOIN trip_stats ts
          ON ts.taxi_id = m.taxi_id
         AND ts.trip_id::bigint = m.trip_id
        WHERE ts.outside_count > 0
        """
    )
    count_sql = text(f"SELECT COUNT(*) FROM {backup_table}")
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(sql)
        return int(conn.execute(count_sql).scalar() or 0)


def load_inside_track_points(
    task: AffectedTrip,
    bounds: Tuple[float, float, float, float],
    max_points: int,
) -> List[Tuple[float, float, object, float]]:
    min_lon, min_lat, max_lon, max_lat = bounds
    sql = text(
        """
        SELECT lon, lat, gps_time, id
        FROM taxi_points
        WHERE taxi_id = :taxi_id
          AND trip_id = :trip_id
          AND lon BETWEEN :min_lon AND :max_lon
          AND lat BETWEEN :min_lat AND :max_lat
        ORDER BY gps_time
        """
    )
    engine = get_engine()
    with engine.begin() as conn:
        rows = conn.execute(
            sql,
            {
                "taxi_id": task.taxi_id,
                "trip_id": task.trip_id_text,
                "min_lon": min_lon,
                "min_lat": min_lat,
                "max_lon": max_lon,
                "max_lat": max_lat,
            },
        ).all()
    points = [(float(r[0]), float(r[1]), r[2], float(r[3])) for r in rows]
    if len(points) > max_points:
        step = max(1, len(points) // max_points)
        points = points[::step]
        last = rows[-1]
        last_point = (float(last[0]), float(last[1]), last[2], float(last[3]))
        if points[-1] != last_point:
            points.append(last_point)
    return points


def delete_matched_trip(task: AffectedTrip) -> None:
    sql = text("DELETE FROM matched_trips WHERE taxi_id = :taxi_id AND trip_id = :trip_id")
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(sql, {"taxi_id": task.taxi_id, "trip_id": task.trip_id_int})


def covered_spans_from_candidates(candidates: List[List[Tuple[int, float]]], search_radius_m: float) -> List[Tuple[int, int]]:
    spans: List[Tuple[int, int]] = []
    span_start: Optional[int] = None
    for idx, cands in enumerate(candidates):
        covered = bool(cands) and cands[0][1] <= search_radius_m
        if covered and span_start is None:
            span_start = idx
        elif not covered and span_start is not None:
            if idx - span_start >= 2:
                spans.append((span_start, idx))
            span_start = None
    if span_start is not None and len(candidates) - span_start >= 2:
        spans.append((span_start, len(candidates)))
    return spans


def rerun_one_out_of_road_bbox_trip(
    task: AffectedTrip,
    bounds: Tuple[float, float, float, float],
    max_points: int,
    padding_deg: float,
    search_radius_m: float,
    max_candidates: int,
    min_inside_points: int,
) -> Tuple[str, str]:
    points = load_inside_track_points(task, bounds, max_points=max_points)
    inside_point_count = len(points)
    if inside_point_count < max(2, min_inside_points):
        delete_matched_trip(task)
        msg = (
            f"failed-partial: taxi_id={task.taxi_id}, trip_id={task.trip_id_text}, "
            f"reason=not-enough-inside-points, inside_points={inside_point_count}, "
            f"original_points={task.point_count}, outside_points={task.outside_count}"
        )
        save_trip_status(task.taxi_id, task.trip_id_int, "failed", "not-enough-inside-points", task.point_count, 0.0, msg)
        return "failed", msg

    track_lonlat = [(lon, lat) for lon, lat, _, _ in points]
    displacement_m = cumulative_displacement_m(track_lonlat)
    lons = [p[0] for p in track_lonlat]
    lats = [p[1] for p in track_lonlat]
    edge_rows = select_local_edges_from_cache(
        min(lons) - padding_deg,
        min(lats) - padding_deg,
        max(lons) + padding_deg,
        max(lats) + padding_deg,
    )
    if not edge_rows:
        delete_matched_trip(task)
        msg = f"failed-partial: taxi_id={task.taxi_id}, trip_id={task.trip_id_text}, reason=no-road-edges-after-bbox-filter"
        save_trip_status(task.taxi_id, task.trip_id_int, "failed", "no-road-edges-after-bbox-filter", task.point_count, displacement_m, msg)
        return "failed", msg

    graph, node_coords = build_route_graph(edge_rows)
    node_grid = build_node_grid(node_coords)
    candidates = [
        candidate_nodes_for_point_grid(
            lon,
            lat,
            node_coords,
            node_grid,
            search_radius_m=search_radius_m,
            max_candidates=max_candidates,
        )
        for lon, lat in track_lonlat
    ]
    spans = covered_spans_from_candidates(candidates, search_radius_m)
    if not spans:
        delete_matched_trip(task)
        nearest = min((c[0][1] for c in candidates if c), default=float("inf"))
        msg = (
            f"failed-partial: taxi_id={task.taxi_id}, trip_id={task.trip_id_text}, "
            f"reason=no-covered-road-candidates-after-bbox-filter, nearest_candidate_m={nearest:.2f}, "
            f"inside_points={inside_point_count}, original_points={task.point_count}"
        )
        save_trip_status(task.taxi_id, task.trip_id_int, "failed", "no-covered-road-candidates-after-bbox-filter", task.point_count, displacement_m, msg)
        return "failed", msg

    start, end = max(spans, key=lambda span: span[1] - span[0])
    best_node_seq = viterbi_match(
        gps_lonlat=track_lonlat[start:end],
        candidates=candidates[start:end],
        graph=graph,
        sigma_z=80.0,
        beta=350.0,
    )
    if not best_node_seq:
        delete_matched_trip(task)
        msg = f"failed-partial: taxi_id={task.taxi_id}, trip_id={task.trip_id_text}, reason=empty-viterbi-after-bbox-filter"
        save_trip_status(task.taxi_id, task.trip_id_int, "failed", "empty-viterbi-after-bbox-filter", task.point_count, displacement_m, msg)
        return "failed", msg

    matched_node_ids = stitch_node_sequence(best_node_seq, graph)
    matched_lonlat = node_ids_to_lonlat(matched_node_ids, node_coords)
    if len(matched_lonlat) < 2:
        delete_matched_trip(task)
        msg = f"failed-partial: taxi_id={task.taxi_id}, trip_id={task.trip_id_text}, reason=short-path-after-bbox-filter"
        save_trip_status(task.taxi_id, task.trip_id_int, "failed", "short-path-after-bbox-filter", task.point_count, displacement_m, msg)
        return "failed", msg

    save_result_fast(task.taxi_id, task.trip_id_int, matched_lonlat)
    matched_raw_points = end - start
    coverage_ratio = matched_raw_points / max(1, task.point_count)
    distance_km = path_distance_km(matched_lonlat)
    msg = (
        f"ok-partial: taxi_id={task.taxi_id}, trip_id={task.trip_id_text}, "
        f"matched_points={len(matched_lonlat)}, matched_raw_points={matched_raw_points}/{task.point_count}, "
        f"inside_points={inside_point_count}, outside_points={task.outside_count}, "
        f"coverage_ratio={coverage_ratio:.3f}, inside_source_index_range={start}-{end - 1}, "
        f"distance_km={distance_km:.3f}"
    )
    save_trip_status(task.taxi_id, task.trip_id_int, "matched", "matched-partial-road-bbox", task.point_count, displacement_m, msg)
    return "matched", msg


def run_out_of_road_bbox_rerun(
    limit: Optional[int],
    workers: int,
    max_points: int,
    padding_deg: float,
    search_radius_m: float,
    max_candidates: int,
    min_inside_points: int,
    backup_table: str,
    no_backup: bool,
) -> None:
    tasks = list_out_of_road_bbox_matched_tasks(limit)
    if not tasks:
        print("No matched trips with points outside road bbox found.")
        return

    if not no_backup:
        backup_count = backup_out_of_road_bbox_matches(backup_table)
        print(f"Backup table {backup_table}: {backup_count} rows")

    bounds = load_road_bounds()
    print(f"Road bbox: {bounds}")
    print(f"Rerun out-of-road-bbox matched trips: tasks={len(tasks)}, workers={workers}, min_inside_points={min_inside_points}")
    started = time.time()
    done = 0
    ok = 0
    failed = 0

    with ProcessPoolExecutor(max_workers=max(1, workers), initializer=init_worker) as pool:
        futures = [
            pool.submit(
                rerun_one_out_of_road_bbox_trip,
                task,
                bounds,
                max_points,
                padding_deg,
                search_radius_m,
                max_candidates,
                min_inside_points,
            )
            for task in tasks
        ]
        for future in as_completed(futures):
            done += 1
            try:
                status, msg = future.result()
            except Exception as exc:
                status = "failed"
                msg = f"error: {exc}"
            if status == "matched":
                ok += 1
            else:
                failed += 1
            elapsed = max(1e-6, time.time() - started)
            eta = (len(tasks) - done) / max(1e-6, done / elapsed)
            sys.stdout.write(
                f"\r{progress_bar(done, len(tasks), width=40)} {done}/{len(tasks)} "
                f"ok={ok} failed={failed} elapsed={elapsed/60:.1f}m eta={eta/60:.1f}m"
            )
            sys.stdout.flush()
            if done % 25 == 0 or done == len(tasks):
                sys.stdout.write(f"\n{msg}\n")
                sys.stdout.flush()
    print(f"Finished out-of-road-bbox rerun: total={len(tasks)} ok={ok} failed={failed} elapsed={(time.time() - started)/60:.2f}m")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Batch map match: same routing logic as map_match_taxi_id1.py, optimized I/O pipeline"
    )
    parser.add_argument("--limit", type=int, default=None, help="Optional task limit for smoke test")
    parser.add_argument("--workers", type=int, default=max(1, cpu_count() - 2))
    parser.add_argument("--max-points", type=int, default=200)
    parser.add_argument("--padding-deg", type=float, default=0.01)
    parser.add_argument("--search-radius-m", type=float, default=250.0)
    parser.add_argument("--max-candidates", type=int, default=6)
    parser.add_argument("--start-taxi-id", type=int, default=None)
    parser.add_argument("--auto-downgrade-workers", action="store_true")
    parser.add_argument("--min-workers", type=int, default=1)
    parser.add_argument("--output-csv", type=str, default=None, help="Export matched rows for this run to CSV")
    parser.add_argument("--failure-csv", type=str, default=None, help="Export failed tasks for this run to CSV")
    parser.add_argument("--stationary-threshold-m", type=float, default=30.0, help="Treat trips below this cumulative displacement as stationary")
    parser.add_argument("--max-task-point-count", type=int, default=None, help="Only process tasks with raw point_count at or below this value")
    parser.add_argument("--max-task-span-deg", type=float, default=None, help="Only process tasks whose max lon/lat span is at or below this value")
    args = parser.parse_args()

    run(
        limit=args.limit,
        workers=max(1, args.workers),
        max_points=args.max_points,
        padding_deg=args.padding_deg,
        start_taxi_id=args.start_taxi_id,
        auto_downgrade=args.auto_downgrade_workers,
        min_workers=max(1, args.min_workers),
        output_csv=args.output_csv,
        failure_csv=args.failure_csv,
        search_radius_m=max(1.0, args.search_radius_m),
        max_candidates=max(1, args.max_candidates),
        stationary_threshold_m=max(0.0, args.stationary_threshold_m),
        max_task_point_count=args.max_task_point_count,
        max_task_span_deg=args.max_task_span_deg,
    )
