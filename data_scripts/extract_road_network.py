import argparse
import os
from pathlib import Path
import time

from pyrosm import OSM
from sqlalchemy import create_engine

DEFAULT_PBF_FILE = "/app/data/beijing-260401.osm.pbf"
DEFAULT_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://taxi_user:taxi_pass@postgis:5432/taxi_vis",
)


def extract_and_save_network(pbf_file_path: str, database_url: str) -> None:
    pbf_path = Path(pbf_file_path)
    if not pbf_path.exists():
        raise FileNotFoundError(f"PBF file not found: {pbf_path}")

    print(f"Reading OSM PBF: {pbf_path}")
    start_time = time.time()

    osm = OSM(str(pbf_path))

    print("Extracting driving network...")
    nodes, edges = osm.get_network(network_type="driving", nodes=True)

    print(f"Extracted {len(nodes):,} nodes and {len(edges):,} edges")

    engine = create_engine(database_url)

    print("Writing edges to PostGIS table road_edges...")
    edges.to_postgis(
        name="road_edges",
        con=engine,
        if_exists="replace",
        index=False,
    )

    print("Writing nodes to PostGIS table road_nodes...")
    nodes.to_postgis(
        name="road_nodes",
        con=engine,
        if_exists="replace",
        index=False,
    )

    elapsed = time.time() - start_time
    print(f"Done. Total time: {elapsed:.2f}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract driving road network from OSM PBF into PostGIS.")
    parser.add_argument("--pbf-file", default=DEFAULT_PBF_FILE)
    parser.add_argument("--database-url", default=DEFAULT_DATABASE_URL)
    args = parser.parse_args()
    extract_and_save_network(args.pbf_file, args.database_url)
