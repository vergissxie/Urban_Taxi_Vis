
import argparse
import heapq
import math
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import create_engine, text


@dataclass
class TripInfo:
    trip_id: str
    taxi_id: int
    start_time: datetime
    end_time: datetime
    point_count: int


def progress_bar(current: int, total: int, width: int = 30) -> str:
    if total <= 0:
        return "[" + "-" * width + "] 0.0%"
    ratio = min(1.0, max(0.0, current / total))
    done = int(width * ratio)
    return f"[{('#' * done) + ('-' * (width - done))}] {ratio * 100:5.1f}%"


def get_engine():
    db_url = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://taxi_user:taxi_pass@postgis:5432/taxi_vis",
    )
    return create_engine(db_url)


def list_trips(engine, taxi_id: int, trip_id: Optional[int]) -> List[TripInfo]:
    sql = text(
        """
        SELECT
            trip_id,
            taxi_id,
            MIN(gps_time) AS start_time,
            MAX(gps_time) AS end_time,
            COUNT(*) AS point_count
        FROM taxi_points
        WHERE taxi_id = :taxi_id
          AND (:trip_id_text IS NULL OR trip_id = :trip_id_text)
                GROUP BY taxi_id, trip_id
        ORDER BY MIN(gps_time)
        """
    )
    with engine.begin() as conn:
        rows = conn.execute(
            sql,
            {
                "taxi_id": taxi_id,
                "trip_id_text": str(trip_id) if trip_id is not None else None,
            },
        ).mappings().all()

    trips: List[TripInfo] = []
    for row in rows:
        trips.append(
            TripInfo(
                trip_id=row["trip_id"],
                taxi_id=int(row["taxi_id"]),
                start_time=row["start_time"],
                end_time=row["end_time"],
                point_count=row["point_count"],
            )
        )
    return trips


def list_taxi_ids(engine) -> List[int]:
    sql = text(
        """
        SELECT DISTINCT taxi_id
        FROM taxi_points
        WHERE taxi_id IS NOT NULL
        ORDER BY taxi_id
        """
    )
    with engine.begin() as conn:
        rows = conn.execute(sql).all()
    return [int(r[0]) for r in rows]


def load_track_points(
    engine, taxi_id: int, trip_id: str, max_points: int
) -> List[Tuple[float, float, float, float]]:
    sql = text(
        """
        SELECT lon, lat, gps_time, id
        FROM taxi_points
        WHERE taxi_id = :taxi_id AND trip_id = :trip_id
        ORDER BY gps_time
        """
    )

    with engine.begin() as conn:
        rows = conn.execute(sql, {"taxi_id": taxi_id, "trip_id": trip_id}).all()

    if not rows:
        return []

    points = [(float(r[0]), float(r[1]), r[2], float(r[3])) for r in rows]

    # Downsample to keep Viterbi tractable on long trajectories.
    if len(points) > max_points:
        step = max(1, len(points) // max_points)
        points = points[::step]
        if points[-1] != rows[-1]:
            last = rows[-1]
            points.append((float(last[0]), float(last[1]), last[2], float(last[3])))

    return points


def load_local_road_graph(
    engine, min_lon: float, min_lat: float, max_lon: float, max_lat: float
):
    sql = text(
        """
        SELECT
            id,
            u,
            v,
            COALESCE(oneway, '') AS oneway,
            ST_X(ST_StartPoint(geometry)) AS start_lon,
            ST_Y(ST_StartPoint(geometry)) AS start_lat,
            ST_X(ST_EndPoint(geometry)) AS end_lon,
            ST_Y(ST_EndPoint(geometry)) AS end_lat
        FROM road_edges
        WHERE u IS NOT NULL
          AND v IS NOT NULL
          AND geometry && ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
        """
    )

    with engine.begin() as conn:
        rows = conn.execute(
            sql,
            {
                "min_lon": min_lon,
                "min_lat": min_lat,
                "max_lon": max_lon,
                "max_lat": max_lat,
            },
        ).mappings().all()

    return rows


def oneway_mode(value: str) -> str:
    v = (value or "").strip().lower()
    if v in {"yes", "1", "true", "t"}:
        return "forward"
    if v in {"-1", "reverse", "backward"}:
        return "reverse"
    return "both"


def haversine_dist(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def build_route_graph(edge_rows) -> Tuple[Dict[int, List[Tuple[int, float]]], Dict[int, Tuple[float, float]]]:
    graph: Dict[int, List[Tuple[int, float]]] = {}
    node_coords: Dict[int, Tuple[float, float]] = {}

    for r in edge_rows:
        u = int(r["u"])
        v = int(r["v"])
        start_lon = float(r["start_lon"])
        start_lat = float(r["start_lat"])
        end_lon = float(r["end_lon"])
        end_lat = float(r["end_lat"])

        node_coords[u] = (start_lon, start_lat)
        node_coords[v] = (end_lon, end_lat)

        dist = haversine_dist(start_lon, start_lat, end_lon, end_lat)
        mode = oneway_mode(r["oneway"])
        if mode in {"forward", "both"}:
            graph.setdefault(u, []).append((v, dist))
        if mode in {"reverse", "both"}:
            graph.setdefault(v, []).append((u, dist))

    return graph, node_coords


def get_shortest_path_cached(
    graph: Dict[int, List[Tuple[int, float]]],
    start_node: int,
    end_node: int,
    cache: Dict[Tuple[int, int], Tuple[float, Optional[List[int]]]],
) -> Tuple[float, Optional[List[int]]]:
    key = (start_node, end_node)
    if key in cache:
        return cache[key]

    path = shortest_path_dijkstra(graph, start_node, end_node)
    if path is None:
        cache[key] = (float("inf"), None)
        return cache[key]

    dist = 0.0
    for i in range(len(path) - 1):
        u = path[i]
        v = path[i + 1]
        w = None
        for nxt, weight in graph.get(u, []):
            if nxt == v:
                w = weight
                break
        if w is None:
            dist = float("inf")
            break
        dist += w

    if math.isinf(dist):
        cache[key] = (float("inf"), None)
    else:
        cache[key] = (dist, path)
    return cache[key]


def candidate_nodes_for_point(
    lon: float,
    lat: float,
    node_coords: Dict[int, Tuple[float, float]],
    search_radius_m: float,
    max_candidates: int,
) -> List[Tuple[int, float]]:
    cands: List[Tuple[int, float]] = []
    nearest_node = None
    nearest_dist = float("inf")

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


def emission_log_prob(distance_m: float, sigma_z: float) -> float:
    return -0.5 * (distance_m / max(1e-6, sigma_z)) ** 2


def transition_log_prob(network_dist_m: float, straight_dist_m: float, beta: float) -> float:
    if math.isinf(network_dist_m):
        return float("-inf")
    delta = abs(network_dist_m - straight_dist_m)
    return -(delta / max(1e-6, beta))


def viterbi_match(
    gps_lonlat: List[Tuple[float, float]],
    candidates: List[List[Tuple[int, float]]],
    graph: Dict[int, List[Tuple[int, float]]],
    sigma_z: float,
    beta: float,
) -> Optional[List[int]]:
    if not gps_lonlat or not candidates:
        return None

    path_cache: Dict[Tuple[int, int], Tuple[float, Optional[List[int]]]] = {}
    dp: List[Dict[int, float]] = []
    prev_choice: List[Dict[int, Optional[int]]] = []

    init_scores: Dict[int, float] = {}
    init_prev: Dict[int, Optional[int]] = {}
    for nid, d in candidates[0]:
        init_scores[nid] = emission_log_prob(d, sigma_z)
        init_prev[nid] = None
    dp.append(init_scores)
    prev_choice.append(init_prev)

    for t in range(1, len(candidates)):
        cur_scores: Dict[int, float] = {}
        cur_prev: Dict[int, Optional[int]] = {}

        lon_prev, lat_prev = gps_lonlat[t - 1]
        lon_cur, lat_cur = gps_lonlat[t]
        straight_dist = haversine_dist(lon_prev, lat_prev, lon_cur, lat_cur)

        for cur_nid, cur_d in candidates[t]:
            emit = emission_log_prob(cur_d, sigma_z)
            best_score = float("-inf")
            best_prev_node: Optional[int] = None

            for prev_nid in dp[t - 1].keys():
                network_dist, _ = get_shortest_path_cached(graph, prev_nid, cur_nid, path_cache)
                trans = transition_log_prob(network_dist, straight_dist, beta)
                if math.isinf(trans):
                    continue
                score = dp[t - 1][prev_nid] + trans + emit
                if score > best_score:
                    best_score = score
                    best_prev_node = prev_nid

            if best_prev_node is not None:
                cur_scores[cur_nid] = best_score
                cur_prev[cur_nid] = best_prev_node

        if not cur_scores:
            # Hard fallback for sparse/abnormal points: nearest-candidate chain.
            fallback_nid = candidates[t][0][0]
            prev_nid = max(dp[t - 1], key=lambda x: dp[t - 1][x])
            cur_scores[fallback_nid] = dp[t - 1][prev_nid] - 10.0
            cur_prev[fallback_nid] = prev_nid

        dp.append(cur_scores)
        prev_choice.append(cur_prev)

    if not dp[-1]:
        return None

    last_node = max(dp[-1], key=lambda x: dp[-1][x])
    seq = [last_node]
    for t in range(len(dp) - 1, 0, -1):
        p = prev_choice[t].get(seq[-1])
        if p is None:
            break
        seq.append(p)
    seq.reverse()
    return seq


def stitch_node_sequence(
    node_seq: List[int],
    graph: Dict[int, List[Tuple[int, float]]],
) -> List[int]:
    if not node_seq:
        return []

    cache: Dict[Tuple[int, int], Tuple[float, Optional[List[int]]]] = {}
    merged: List[int] = [node_seq[0]]
    for i in range(len(node_seq) - 1):
        s = node_seq[i]
        e = node_seq[i + 1]
        if s == e:
            continue

        _, part = get_shortest_path_cached(graph, s, e, cache)
        if part is None:
            if merged[-1] != e:
                merged.append(e)
            continue

        if merged[-1] == part[0]:
            merged.extend(part[1:])
        else:
            merged.extend(part)

    return merged


def linestring_wkt_from_lonlat(points: List[Tuple[float, float]]) -> Optional[str]:
    if len(points) < 2:
        return None
    coords = ", ".join([f"{lon} {lat}" for lon, lat in points])
    return f"LINESTRING({coords})"


def snap_points_to_nodes(
    track_lonlat: List[Tuple[float, float]],
    node_coords: Dict[int, Tuple[float, float]],
) -> List[int]:
    snapped_nodes: List[int] = []
    node_items = list(node_coords.items())

    for lon, lat in track_lonlat:
        best_node = None
        best_dist = float("inf")
        for nid, (nlon, nlat) in node_items:
            # For nearest snap candidate, local planar approximation is sufficient.
            d = (lon - nlon) * (lon - nlon) + (lat - nlat) * (lat - nlat)
            if d < best_dist:
                best_dist = d
                best_node = nid

        if best_node is not None:
            snapped_nodes.append(best_node)

    return snapped_nodes


def shortest_path_dijkstra(
    graph: Dict[int, List[Tuple[int, float]]],
    start_node: int,
    end_node: int,
) -> Optional[List[int]]:
    if start_node == end_node:
        return [start_node]

    heap: List[Tuple[float, int]] = [(0.0, start_node)]
    dist: Dict[int, float] = {start_node: 0.0}
    prev: Dict[int, int] = {}
    visited = set()

    while heap:
        cur_dist, u = heapq.heappop(heap)
        if u in visited:
            continue
        visited.add(u)

        if u == end_node:
            break

        for v, w in graph.get(u, []):
            if v in visited:
                continue
            new_dist = cur_dist + w
            if new_dist < dist.get(v, float("inf")):
                dist[v] = new_dist
                prev[v] = u
                heapq.heappush(heap, (new_dist, v))

    if end_node not in dist:
        return None

    path = [end_node]
    cur = end_node
    while cur != start_node:
        cur = prev[cur]
        path.append(cur)
    path.reverse()
    return path


def route_between_waypoints(
    graph: Dict[int, List[Tuple[int, float]]],
    waypoint_nodes: List[int],
) -> List[int]:
    if not waypoint_nodes:
        return []

    path_nodes: List[int] = [waypoint_nodes[0]]
    for i in range(len(waypoint_nodes) - 1):
        start_node = waypoint_nodes[i]
        end_node = waypoint_nodes[i + 1]
        if start_node == end_node:
            continue

        try:
            part = shortest_path_dijkstra(graph, start_node, end_node)
            if part is None:
                raise RuntimeError("no-path")
            if path_nodes[-1] == part[0]:
                path_nodes.extend(part[1:])
            else:
                path_nodes.extend(part)
        except Exception:
            # Hard fallback: keep trajectory connected even if graph has topology gaps.
            if path_nodes[-1] != end_node:
                path_nodes.append(end_node)

    return path_nodes


def node_ids_to_lonlat(
    node_ids: List[int],
    node_coords: Dict[int, Tuple[float, float]],
) -> List[Tuple[float, float]]:
    lonlat: List[Tuple[float, float]] = []
    prev = None
    for nid in node_ids:
        if nid not in node_coords:
            continue
        pt = node_coords[nid]
        if pt != prev:
            lonlat.append(pt)
            prev = pt
    return lonlat


def save_result(
    engine,
    taxi_id: int,
    trip_id: int,
    matched_lonlat: List[Tuple[float, float]],
):
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
    insert_sql = text(
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

    matched_wkt = linestring_wkt_from_lonlat(matched_lonlat)
    if matched_wkt is None:
        raise RuntimeError("Matched geometry is empty")

    with engine.begin() as conn:
        conn.execute(create_sql)
        conn.execute(index_sql)
        conn.execute(
            insert_sql,
            {
                "trip_id": trip_id,
                "taxi_id": taxi_id,
                "matched_wkt": matched_wkt,
            },
        )


def match_single_trip(
    engine,
    taxi_id: int,
    trip_id_text: str,
    max_points: int,
    search_padding_deg: float,
    search_radius_m: float = 250.0,
    max_candidates: int = 6,
    sigma_z: float = 80.0,
    beta: float = 350.0,
    verbose: bool = False,
) -> Dict[str, Any]:
    points = load_track_points(engine, taxi_id, trip_id_text, max_points=max_points)
    if len(points) < 2:
        return {"ok": False, "reason": "not-enough-points", "point_count": len(points)}

    track_lonlat = [(lon, lat) for lon, lat, _, _ in points]
    lons = [p[0] for p in track_lonlat]
    lats = [p[1] for p in track_lonlat]
    min_lon = min(lons) - search_padding_deg
    max_lon = max(lons) + search_padding_deg
    min_lat = min(lats) - search_padding_deg
    max_lat = max(lats) + search_padding_deg

    edge_rows = load_local_road_graph(engine, min_lon, min_lat, max_lon, max_lat)
    if not edge_rows:
        return {"ok": False, "reason": "no-road-edges", "point_count": len(points)}

    graph, node_coords = build_route_graph(edge_rows)
    if not graph or not node_coords:
        return {"ok": False, "reason": "empty-graph", "point_count": len(points)}

    candidates = [
        candidate_nodes_for_point(
            lon,
            lat,
            node_coords,
            search_radius_m=search_radius_m,
            max_candidates=max_candidates,
        )
        for lon, lat in track_lonlat
    ]

    best_node_seq = viterbi_match(
        gps_lonlat=track_lonlat,
        candidates=candidates,
        graph=graph,
        sigma_z=sigma_z,
        beta=beta,
    )
    if not best_node_seq:
        return {"ok": False, "reason": "empty-viterbi", "point_count": len(points)}

    matched_node_ids = stitch_node_sequence(best_node_seq, graph)
    matched_lonlat = node_ids_to_lonlat(matched_node_ids, node_coords)
    if len(matched_lonlat) < 2:
        return {"ok": False, "reason": "short-path", "point_count": len(points)}

    try:
        save_result(engine, taxi_id, int(trip_id_text), matched_lonlat)
    except Exception as exc:
        return {
            "ok": False,
            "reason": "save-error",
            "error": str(exc),
            "point_count": len(points),
        }

    if verbose:
        print(f"Track points used: {len(track_lonlat)}")
        print(f"Matched node path length: {len(matched_node_ids)}")
        print(f"Matched node coords resolved: {len(matched_lonlat)}")
        print(f"First 20 node IDs: {matched_node_ids[:20]}")

    return {
        "ok": True,
        "reason": "ok",
        "point_count": len(points),
        "matched_point_count": len(matched_lonlat),
    }


def run_for_single_taxi(engine, taxi_id: int, trip_id: Optional[int], max_points: int, search_padding_deg: float):
    trips = list_trips(engine, taxi_id, trip_id)
    if not trips:
        if trip_id is not None:
            raise RuntimeError(f"Trip {trip_id} not found for taxi_id={taxi_id}")
        raise RuntimeError(f"No trips found for taxi_id={taxi_id}")

    print(f"Found {len(trips)} trip(s) to process for taxi_id={taxi_id}")

    success = 0
    skipped = 0
    failed = 0

    for idx, trip in enumerate(trips, start=1):
        print(f"\nTaxi {taxi_id} trip progress {progress_bar(idx - 1, len(trips))} ({idx}/{len(trips)})")
        print(f"Processing trip_id={trip.trip_id}")

        try:
            trip_id_int = int(trip.trip_id)
        except ValueError:
            skipped += 1
            print(f"Skip non-numeric trip_id={trip.trip_id}")
            continue

        print(
            f"Using taxi_id={taxi_id}, trip_id={trip.trip_id}, "
            f"points={trip.point_count}, range={trip.start_time} -> {trip.end_time}"
        )

        result = match_single_trip(
            engine=engine,
            taxi_id=taxi_id,
            trip_id_text=trip.trip_id,
            max_points=max_points,
            search_padding_deg=search_padding_deg,
            search_radius_m=250.0,
            max_candidates=6,
            sigma_z=80.0,
            beta=350.0,
            verbose=True,
        )
        if result["ok"]:
            success += 1
            print(f"Upserted matched_trips row for trip_id={trip_id_int}")
        elif result["reason"] == "not-enough-points":
            skipped += 1
            print("Skip: not enough points for matching")
        else:
            failed += 1
            print(f"Fail trip_id={trip_id_int}: {result['reason']}")
            if result.get("error"):
                print(f"Error detail: {result['error']}")

    print(f"\nTaxi {taxi_id} trip progress {progress_bar(len(trips), len(trips))}")
    print(f"Batch done for taxi_id={taxi_id}: success={success}, skipped={skipped}, failed={failed}")
    return {"success": success, "skipped": skipped, "failed": failed, "total": len(trips)}


def run(taxi_id: Optional[int], trip_id: Optional[int], max_points: int, search_padding_deg: float, all_taxis: bool):
    engine = get_engine()

    if all_taxis:
        taxi_ids = list_taxi_ids(engine)
        if not taxi_ids:
            raise RuntimeError("No taxi IDs found in taxi_points")

        print(f"Found {len(taxi_ids)} taxi IDs to process")
        total_success = 0
        total_skipped = 0
        total_failed = 0

        for i, tid in enumerate(taxi_ids, start=1):
            print(f"\nAll taxi progress {progress_bar(i - 1, len(taxi_ids))} ({i}/{len(taxi_ids)}) -> taxi_id={tid}")
            stats = run_for_single_taxi(engine, tid, None, max_points, search_padding_deg)
            total_success += stats["success"]
            total_skipped += stats["skipped"]
            total_failed += stats["failed"]

        print(f"\nAll taxi progress {progress_bar(len(taxi_ids), len(taxi_ids))}")
        print(
            f"All taxi batch done: success={total_success}, skipped={total_skipped}, failed={total_failed}"
        )
        return

    if taxi_id is None:
        raise RuntimeError("Please provide --taxi-id, or use --all-taxis")

    run_for_single_taxi(engine, taxi_id, trip_id, max_points, search_padding_deg)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="HMM map matching for taxi trajectory")
    parser.add_argument("--taxi-id", type=int, default=None)
    parser.add_argument("--trip-id", type=int, default=None)
    parser.add_argument("--max-points", type=int, default=200)
    parser.add_argument("--padding-deg", type=float, default=0.01)
    parser.add_argument("--all-taxis", action="store_true")
    args = parser.parse_args()

    run(
        taxi_id=args.taxi_id,
        trip_id=args.trip_id,
        max_points=args.max_points,
        search_padding_deg=args.padding_deg,
        all_taxis=args.all_taxis,
    )
