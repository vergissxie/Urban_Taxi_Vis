CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS taxi_points (
    id BIGSERIAL PRIMARY KEY,
    taxi_id BIGINT NOT NULL,
    trip_id TEXT NOT NULL,
    gps_time TIMESTAMP NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_taxi_points_taxi_time
    ON taxi_points (taxi_id, gps_time);

CREATE INDEX IF NOT EXISTS idx_taxi_points_trip_time
    ON taxi_points (trip_id, gps_time);

CREATE INDEX IF NOT EXISTS idx_taxi_points_taxi_trip_time
    ON taxi_points (taxi_id, trip_id, gps_time);

CREATE INDEX IF NOT EXISTS idx_taxi_points_geom_gist
    ON taxi_points USING GIST (geom);

CREATE TABLE IF NOT EXISTS road_edges (
    id BIGSERIAL PRIMARY KEY,
    edge_uid BIGSERIAL UNIQUE,
    osm_id BIGINT,
    u BIGINT,
    v BIGINT,
    length DOUBLE PRECISION,
    oneway BOOLEAN,
    maxspeed TEXT,
    name TEXT,
    highway TEXT,
    geometry GEOMETRY(LineString, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS road_nodes (
    id BIGSERIAL PRIMARY KEY,
    osm_id BIGINT,
    lon DOUBLE PRECISION,
    lat DOUBLE PRECISION,
    geometry GEOMETRY(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_road_edges_geom_gist
    ON road_edges USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_road_nodes_geom_gist
    ON road_nodes USING GIST (geometry);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'road_edges' AND column_name = 'u'
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_road_edges_u ON road_edges (u)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'road_edges' AND column_name = 'v'
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_road_edges_v ON road_edges (v)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'road_edges' AND column_name = 'osm_id'
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_road_edges_osm_id ON road_edges (osm_id)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'road_nodes' AND column_name = 'osm_id'
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_road_nodes_osm_id ON road_nodes (osm_id)';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS matched_trips (
    taxi_id BIGINT NOT NULL,
    trip_id BIGINT NOT NULL,
    matched_geom GEOMETRY(LineString, 4326),
    distance_km DOUBLE PRECISION,
    PRIMARY KEY (taxi_id, trip_id)
);

CREATE INDEX IF NOT EXISTS idx_matched_taxi_id
    ON matched_trips (taxi_id);

CREATE TABLE IF NOT EXISTS matched_trip_edges (
    taxi_id BIGINT NOT NULL,
    trip_id BIGINT NOT NULL,
    edge_seq INTEGER NOT NULL,
    road_uid BIGINT NOT NULL,
    road_id BIGINT NOT NULL,
    direction SMALLINT NOT NULL,
    PRIMARY KEY (taxi_id, trip_id, edge_seq, road_uid)
);

CREATE INDEX IF NOT EXISTS idx_matched_trip_edges_road
    ON matched_trip_edges (road_uid);

CREATE INDEX IF NOT EXISTS idx_matched_trip_edges_trip
    ON matched_trip_edges (taxi_id, trip_id);

CREATE TABLE IF NOT EXISTS pipeline_build_status (
    pipeline_name TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);

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
);

CREATE INDEX IF NOT EXISTS idx_matched_trip_road_passes_time
    ON matched_trip_road_passes (start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_matched_trip_road_passes_group
    ON matched_trip_road_passes (road_group_key, direction);

CREATE INDEX IF NOT EXISTS idx_matched_trip_road_passes_road
    ON matched_trip_road_passes (road_uid);

CREATE INDEX IF NOT EXISTS idx_matched_trip_road_passes_road_time
    ON matched_trip_road_passes (road_uid, start_time, end_time);

CREATE TABLE IF NOT EXISTS matched_road_hourly_counts (
    road_uid BIGINT NOT NULL,
    direction SMALLINT NOT NULL,
    hour_bucket TIMESTAMP NOT NULL,
    trip_count BIGINT NOT NULL,
    vehicle_count BIGINT NOT NULL,
    PRIMARY KEY (road_uid, direction, hour_bucket)
);

CREATE INDEX IF NOT EXISTS idx_matched_road_hourly_counts_time_road
    ON matched_road_hourly_counts (hour_bucket, road_uid);

CREATE TABLE IF NOT EXISTS matched_road_group_hourly_counts (
    road_group_key TEXT NOT NULL,
    direction SMALLINT NOT NULL,
    hour_bucket TIMESTAMP NOT NULL,
    trip_count BIGINT NOT NULL,
    vehicle_count BIGINT NOT NULL,
    edge_pass_weight BIGINT NOT NULL,
    PRIMARY KEY (road_group_key, direction, hour_bucket)
);

CREATE INDEX IF NOT EXISTS idx_matched_road_group_hourly_counts_time_group
    ON matched_road_group_hourly_counts (hour_bucket, road_group_key, direction);

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
);

CREATE INDEX IF NOT EXISTS idx_trip_spatial_index_grid
    ON trip_spatial_index (grid_key, first_seen_time);

CREATE INDEX IF NOT EXISTS idx_trip_spatial_index_grid_trip_seq
    ON trip_spatial_index (grid_key, taxi_id, trip_id, first_point_seq, first_seen_time);

CREATE INDEX IF NOT EXISTS idx_trip_spatial_index_trip
    ON trip_spatial_index (taxi_id, trip_id, first_point_seq);

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
);

CREATE INDEX IF NOT EXISTS idx_trip_token_sequence_time
    ON trip_token_sequence (start_time, end_time);

CREATE TABLE IF NOT EXISTS trip_edge_sequence_cache (
    taxi_id BIGINT NOT NULL,
    trip_id BIGINT NOT NULL,
    edge_count INTEGER NOT NULL DEFAULT 0,
    road_uid_array BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
    PRIMARY KEY (taxi_id, trip_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_edge_sequence_cache_edge_count
    ON trip_edge_sequence_cache (edge_count);

CREATE TABLE IF NOT EXISTS road_edge_feature_cache (
    road_uid BIGINT PRIMARY KEY,
    highway_class TEXT NOT NULL DEFAULT '',
    road_group_key TEXT,
    segment_length_m DOUBLE PRECISION NOT NULL DEFAULT 0,
    min_lon DOUBLE PRECISION,
    min_lat DOUBLE PRECISION,
    max_lon DOUBLE PRECISION,
    max_lat DOUBLE PRECISION
);

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
);

CREATE INDEX IF NOT EXISTS idx_trip_grid_points_grid_time
    ON trip_grid_points (grid_key, gps_time);

CREATE INDEX IF NOT EXISTS idx_trip_grid_points_trip_seq
    ON trip_grid_points (taxi_id, trip_id, point_seq);

CREATE INDEX IF NOT EXISTS idx_trip_grid_points_trip_grid_time
    ON trip_grid_points (taxi_id, trip_id, grid_key, gps_time);

CREATE INDEX IF NOT EXISTS idx_trip_grid_points_grid_trip_time
    ON trip_grid_points (grid_key, taxi_id, trip_id, gps_time);

CREATE INDEX IF NOT EXISTS idx_trip_grid_points_grid_bbox_trip_seq
    ON trip_grid_points (grid_key, lon, lat, taxi_id, trip_id, point_seq, gps_time);

CREATE INDEX IF NOT EXISTS idx_trip_grid_points_trip_grid_seq_time
    ON trip_grid_points (taxi_id, trip_id, grid_key, point_seq, gps_time);
