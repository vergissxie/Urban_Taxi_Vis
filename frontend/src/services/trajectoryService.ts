import { apiClient } from './api';
const LONG_ANALYTICS_TIMEOUT_MS = 300000;

interface RawFeature {
  geometry?: {
    coordinates?: Array<[number, number]>;
  };
  properties?: Record<string, unknown>;
}

interface MatchedResponse {
  features?: RawFeature[];
}

export interface RawTrajectoryResponse {
  trip_id: number;
  taxi_id?: number;
  raw_points?: Array<[number, number]>;
  matched_route?: unknown;
  distance_km?: number | null;
  meta?: {
    raw_point_count?: number;
    has_matched?: boolean;
  };
}

interface UnionVehicleCountRequest {
  start_time: string;
  end_time: string;
  taxi_id_min: number;
  taxi_id_max: number;
  bboxes: Array<{
    min_lon: number;
    min_lat: number;
    max_lon: number;
    max_lat: number;
  }>;
}

interface UnionVehicleDetailResponse {
  active_vehicle_count?: number;
  box_vehicle_counts?: Array<{
    box_index?: number;
    vehicle_count?: number;
  }>;
  rows?: Array<{
    key?: string;
    taxi_id?: number;
    box_labels?: string;
    trip_ids?: Array<string | number>;
  }>;
}

export interface F3UnionDetailRow {
  key: string;
  taxiId: number;
  boxLabels: string;
  tripIds: string[];
}

export interface F3UnionBoxCount {
  boxIndex: number;
  vehicleCount: number;
}

export interface F4GridCell {
  i?: number;
  j?: number;
  h3_id?: string;
  bounds: [number, number, number, number];
  center: [number, number];
  boundary?: Array<[number, number]>;
  resolution?: number;
  point_count: number;
  vehicle_count?: number | null;
  density: number;
}

export interface F4GridDensityResponse {
  cells: F4GridCell[];
  meta?: {
    grid_size_m?: number;
    cell_count?: number;
    max_cells?: number;
    max_density?: number;
    max_vehicle_count?: number;
    total_points?: number;
    include_vehicle_count?: boolean;
    cache_hit?: boolean;
    cache_ttl_seconds?: number;
    elapsed_ms?: number;
    query_mode?: string;
    error?: string;
  };
}

export interface F4H3BaseCell {
  h3Id: string;
  count: number;
}

export interface F4H3BaseDensityResponse {
  data?: {
    baseResolution: number;
    totalPoints: number;
    bbox: {
      minLon: number;
      minLat: number;
      maxLon: number;
      maxLat: number;
    };
    gridList: F4H3BaseCell[];
  };
  meta?: {
    cell_count?: number;
    total_points?: number;
    start_time?: string;
    end_time?: string;
    error?: string;
  };
}

export interface F5BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface F5ABFlowItem {
  time_bucket: string;
  a_to_b: number;
  b_to_a: number;
  total: number;
  net_flow: number;
  a_to_b_avg_duration_min: number | null;
  b_to_a_avg_duration_min: number | null;
}

export interface F5ABFlowSummary {
  a_to_b_total: number;
  b_to_a_total: number;
  total: number;
  net_flow: number;
  dominant_direction: 'A_TO_B' | 'B_TO_A' | 'BALANCED';
  a_to_b_avg_duration_min: number | null;
  b_to_a_avg_duration_min: number | null;
}

export interface F5ABFlowResponse {
  items: F5ABFlowItem[];
  summary: F5ABFlowSummary;
  meta?: {
    granularity?: 'hour' | 'day';
    buffer_meters?: number;
    max_transition_seconds?: number;
    error?: string;
  };
}

export interface F5ThresholdRecommendationResponse {
  recommended_seconds: number;
  recommended_minutes: number;
  distance_meters: number;
  raw_seconds: number;
  meta?: {
    pessimistic_mps?: number;
    pessimistic_kmh?: number;
    road_winding_factor?: number;
    absolute_minimum_seconds?: number;
    absolute_maximum_seconds?: number;
    logic_mode?: string;
    error?: string;
  };
}

export interface F6RadiationRegion {
  region_id: string;
  h3_index?: string;
  center: [number, number];
  boundary?: Array<[number, number]>;
  bounds: [number, number, number, number];
  outbound_total: number;
  inbound_total: number;
  total: number;
  net_flow: number;
  avg_duration_min: number | null;
}

export interface F6RadiationSeriesItem {
  time_bucket: string;
  region_id: string;
  outbound: number;
  inbound: number;
  total: number;
  net_flow: number;
}

export interface F6RadiationSummary {
  total_outbound: number;
  total_inbound: number;
  total_flow: number;
  net_flow: number;
  dominant_direction: 'outbound' | 'inbound' | 'balanced';
  top_k_flow: number;
  top_k_ratio: number;
  avg_duration_min: number | null;
  external_region_count: number;
}

export interface F6RadiationResponse {
  regions: F6RadiationRegion[];
  series: F6RadiationSeriesItem[];
  summary: F6RadiationSummary;
  meta?: {
    granularity?: 'hour' | 'day';
    direction?: 'outbound' | 'inbound' | 'both';
    analysis_mode?: 'strict_od' | 'through_flow';
    analysis_scope?: 'full_dataset';
    h3_resolution?: number;
    buffer_meters?: number;
    top_k?: number;
    elapsed_ms?: number;
    cached_compute_elapsed_ms?: number;
    error?: string;
  };
}

export interface F7FrequentPath {
  rank: number;
  road_group_key: string;
  road_name: string;
  highway?: string | null;
  direction: 'forward' | 'reverse' | 'unknown';
  direction_value: number;
  direction_supported: boolean;
  component_id?: number;
  corridor_component_id?: number;
  corridor_component_ids?: number[];
  normalized_road_group_key?: string;
  trip_count: number;
  vehicle_count: number;
  edge_pass_weight?: number;
  segment_count: number;
  group_length_m: number;
  matched_segment_length_m: number;
  has_oneway_segment: boolean;
  geometry_backbone?: {
    type?: 'LineString' | 'MultiLineString';
    coordinates?: unknown;
  } | null;
  geometry_branches?: {
    type?: 'LineString' | 'MultiLineString';
    coordinates?: unknown;
  } | null;
  is_fragmented?: boolean;
  fragment_count?: number;
  branch_count?: number;
  backbone_segment_count?: number;
  corridor_confidence?: number;
  geometry?: {
    type?: 'LineString' | 'MultiLineString';
    coordinates?: unknown;
  } | null;
}

export interface F7FrequentPathsSummary {
  path_count: number;
  total_path_count_before_top_k: number;
  top_k_trip_count: number;
  total_ranked_trip_count: number;
  top_k_ratio: number;
  max_trip_count: number;
  max_vehicle_count: number;
  top_k_edge_pass_weight?: number;
  total_edge_pass_weight?: number;
  candidate_trip_count?: number;
  sampled_trip_count?: number;
  sample_ratio?: number;
}

export interface F7FrequentPathsResponse {
  corridors?: F7FrequentPath[];
  paths: F7FrequentPath[];
  summary: F7FrequentPathsSummary;
  meta?: {
    logic_mode?: string;
    precision_level?: string;
    direction_supported?: boolean;
    elapsed_ms?: number;
    max_trips?: number;
    sampling_mode?: string;
    metric_mode?: string;
    metric_note?: string;
    vehicle_count_mode?: string;
    error?: string;
  };
}

export interface F7RoadDetailSegment {
  rank: number;
  flow_rank?: number;
  profile_order?: number;
  road_uid: number;
  road_id?: number | null;
  highway?: string | null;
  trip_count: number;
  raw_trip_count?: number;
  edge_pass_weight: number;
  vehicle_count?: number;
  length_m: number;
  geometry?: {
    type?: 'LineString' | 'MultiLineString';
    coordinates?: unknown;
  } | null;
}

export interface F7RoadDetailResponse {
  segments: F7RoadDetailSegment[];
  summary: {
    segment_count: number;
    total_trip_count: number;
    total_edge_pass_weight: number;
    max_trip_count: number;
    max_edge_pass_weight: number;
  };
  meta?: {
    logic_mode?: string;
    metric_mode?: string;
    road_group_key?: string;
    direction?: number;
    component_id?: number;
    corridor_object?: string;
    elapsed_ms?: number;
    error?: string;
  };
}

export interface F8FrequentRoute {
  rank: number;
  route_signature: string;
  route_signature_array: string[];
  representative_taxi_id?: number | null;
  representative_trip_id?: number | null;
  representative_quality_score?: number | null;
  quality_tier?: 'high_confidence' | 'low_confidence' | string | null;
  quality_warnings?: string[];
  ranking_score?: number | null;
  parent_cluster_id?: string | null;
  subcluster_id?: string | null;
  split_mode?: string | null;
  share_of_parent_cluster?: number | null;
  trip_count: number;
  vehicle_count: number;
  avg_duration_min: number | null;
  p20_duration_min?: number | null;
  p50_duration_min?: number | null;
  p90_duration_min?: number | null;
  duration_tail_ratio?: number | null;
  route_length_m: number;
  avg_route_length_m: number;
  edge_count: number;
  durations_by_hour?: Record<string, number>;
  duration_samples_by_hour?: Record<string, number[]>;
  trip_count_by_hour?: Record<string, number>;
  quality_metrics?: {
    geometry_point_count?: number;
    geometry_length_m?: number;
    direct_distance_m?: number;
    directness_ratio?: number | null;
    repeat_point_ratio?: number;
    a_hit_edge_count?: number;
    b_hit_edge_count?: number;
    repeated_edge_count?: number;
    subpath_edge_count?: number;
    soft_center_score?: number;
    high_freq_token_recall?: number;
    token_centrality_ratio?: number;
    directness_score?: number;
    repeat_score?: number;
    physical_score?: number;
    center_score?: number;
  };
  geometry?: {
    type?: 'LineString' | 'MultiLineString';
    coordinates?: unknown;
  } | null;
}

export interface F8Variant {
  variant_signature: string;
  trip_count: number;
  share_within_corridor: number;
  avg_duration_min?: number | null;
  p50_duration_min?: number | null;
  p90_duration_min?: number | null;
  geometry?: {
    type?: 'LineString' | 'MultiLineString';
    coordinates?: unknown;
  } | null;
}

export interface F8Corridor {
  rank: number;
  corridor_signature: string;
  trip_count: number;
  vehicle_count: number;
  share_of_candidates: number;
  avg_duration_min?: number | null;
  p20_duration_min?: number | null;
  p50_duration_min?: number | null;
  p90_duration_min?: number | null;
  duration_tail_ratio?: number | null;
  avg_route_length_m?: number;
  durations_by_hour?: Record<string, number>;
  duration_samples_by_hour?: Record<string, number[]>;
  trip_count_by_hour?: Record<string, number>;
  representative_taxi_id?: number | null;
  representative_trip_id?: number | null;
  representative_quality_score?: number | null;
  quality_tier?: 'high_confidence' | 'low_confidence' | string | null;
  quality_warnings?: string[];
  ranking_score?: number | null;
  representative_fallback_rank?: number;
  cluster_similarity_threshold?: number;
  parent_cluster_id?: string | null;
  subcluster_id?: string | null;
  split_mode?: string | null;
  share_of_parent_cluster?: number | null;
  route_length_m?: number;
  quality_metrics?: {
    geometry_point_count?: number;
    geometry_length_m?: number;
    direct_distance_m?: number;
    directness_ratio?: number | null;
    repeat_point_ratio?: number;
    a_hit_edge_count?: number;
    b_hit_edge_count?: number;
    repeated_edge_count?: number;
    subpath_edge_count?: number;
    soft_center_score?: number;
    high_freq_token_recall?: number;
    token_centrality_ratio?: number;
    directness_score?: number;
    repeat_score?: number;
    physical_score?: number;
    center_score?: number;
  };
  geometry?: {
    type?: 'LineString' | 'MultiLineString';
    coordinates?: unknown;
  } | null;
  variants: F8Variant[];
}

export interface F8FrequentRoutesResponse {
  corridors?: F8Corridor[];
  routes: F8FrequentRoute[];
  summary: {
    route_count: number;
    candidate_trip_count: number;
    candidate_trip_count_is_limited?: boolean;
    raw_valid_ab_trip_count?: number;
    valid_ab_trip_count?: number;
    duration_outlier_filtered_trip_count?: number;
    total_route_count_before_top_k: number;
    top_k_trip_count: number;
    corridor_covered_trip_count?: number;
    total_ranked_trip_count: number;
    top_k_ratio: number;
    top_k_ranked_ratio?: number;
    ranked_trip_ratio?: number;
    max_trip_count: number;
  };
  meta?: {
    logic_mode?: string;
    signature_mode?: string;
    dedupe_mode?: string;
    geometry_mode?: string;
    requested_min_support?: number;
    effective_min_support?: number;
    support_fallback_applied?: boolean;
    empty_reason?: string | null;
    singleton_only?: boolean;
    min_support_floor?: number;
    fallback_signature_level?: string;
    elapsed_ms?: number;
    top_k?: number;
    buffer_meters?: number;
    min_support?: number;
    min_edge_length_m?: number;
    min_route_length_m?: number;
    max_candidate_trips?: number;
    raw_valid_ab_trip_count?: number;
    duration_outlier_filtered_trip_count?: number;
    duration_outlier_p50_seconds?: number;
    duration_outlier_cutoff_seconds?: number;
    token_semantic_normalization?: string;
    area_a?: {
      input?: {
        min_lon: number;
        min_lat: number;
        max_lon: number;
        max_lat: number;
      };
      buffered?: {
        min_lon: number;
        min_lat: number;
        max_lon: number;
        max_lat: number;
      };
    };
    area_b?: {
      input?: {
        min_lon: number;
        min_lat: number;
        max_lon: number;
        max_lat: number;
      };
      buffered?: {
        min_lon: number;
        min_lat: number;
        max_lon: number;
        max_lat: number;
      };
    };
    error?: string;
  };
}

const FULL_DATA_MIN_TAXI_ID = 1;
const FULL_DATA_MAX_TAXI_ID = 10357;

export async function queryMatchedByTrips(taxiId: number, tripIds: string[]): Promise<Map<string, RawFeature>> {
  const response = await apiClient.get<MatchedResponse>('/api/trajectory/matched', {
    params: {
      taxi_id: taxiId,
      trip_ids: tripIds.length ? tripIds.join(',') : undefined,
    },
  });

  const byTrip = new Map<string, RawFeature>();
  const features = response.data.features || [];
  features.forEach((feature) => {
    const tripId = feature.properties?.trip_id;
    if (tripId != null) {
      byTrip.set(String(tripId), feature);
    }
  });

  return byTrip;
}

export async function queryRawTrajectoryByTrip(taxiId: number, tripId: string): Promise<RawTrajectoryResponse> {
  const response = await apiClient.get<RawTrajectoryResponse>(`/api/trajectory/${tripId}`, {
    params: {
      taxi_id: taxiId,
    },
  });

  return response.data;
}


export async function queryUnionVehicleDetailByBBoxes(
  bboxes: Array<{ minLon: number; minLat: number; maxLon: number; maxLat: number }>,
  options: { startTime: string; endTime: string; rowLimit?: number },
): Promise<{ activeVehicleCount?: number; rows: F3UnionDetailRow[]; boxCounts: F3UnionBoxCount[] }> {
  if (!options.startTime || !options.endTime || !bboxes.length) {
    return { activeVehicleCount: undefined, rows: [], boxCounts: [] };
  }

  const requestedRowLimit = Math.max(1, Math.min(FULL_DATA_MAX_TAXI_ID, options.rowLimit ?? FULL_DATA_MAX_TAXI_ID));
  const buildPayload = (rowLimit: number): UnionVehicleCountRequest & { row_limit: number } => ({
    start_time: options.startTime,
    end_time: options.endTime,
    taxi_id_min: FULL_DATA_MIN_TAXI_ID,
    taxi_id_max: FULL_DATA_MAX_TAXI_ID,
    row_limit: rowLimit,
    bboxes: bboxes.map((b) => ({
      min_lon: b.minLon,
      min_lat: b.minLat,
      max_lon: b.maxLon,
      max_lat: b.maxLat,
    })),
  });

  try {
    let resp;
    try {
      resp = await apiClient.post<UnionVehicleDetailResponse>(
        '/api/v1/analytics/active-vehicles-union-detail',
        buildPayload(requestedRowLimit),
        {
          timeout: 45000,
          suppressErrorToast: true,
        } as any,
      );
    } catch (error: any) {
      const status = Number(error?.response?.status || 0);
      if (status !== 422 || requestedRowLimit <= 5000) {
        throw error;
      }
      // Compatibility with a still-running backend container whose row_limit max is 5000.
      resp = await apiClient.post<UnionVehicleDetailResponse>(
        '/api/v1/analytics/active-vehicles-union-detail',
        buildPayload(5000),
        {
          timeout: 45000,
          suppressErrorToast: true,
        } as any,
      );
    }

    const rows = Array.isArray(resp.data?.rows)
      ? resp.data.rows
        .map((r) => ({
          key: String(r.key ?? r.taxi_id ?? ''),
          taxiId: Number(r.taxi_id ?? 0),
          boxLabels: String(r.box_labels ?? ''),
          tripIds: Array.isArray(r.trip_ids)
            ? r.trip_ids.map((tripId) => String(tripId)).filter((tripId) => tripId.length > 0)
            : [],
        }))
        .filter((r) => Number.isInteger(r.taxiId) && r.taxiId > 0)
      : [];

    const boxCounts = Array.isArray(resp.data?.box_vehicle_counts)
      ? resp.data.box_vehicle_counts
        .map((r) => ({
          boxIndex: Number(r.box_index ?? 0),
          vehicleCount: Number(r.vehicle_count ?? 0),
        }))
        .filter((r) => Number.isInteger(r.boxIndex) && r.boxIndex > 0)
      : [];

    return {
      activeVehicleCount: Number(resp.data?.active_vehicle_count ?? 0),
      rows,
      boxCounts,
    };
  } catch {
    return { activeVehicleCount: undefined, rows: [], boxCounts: [] };
  }
}

export async function queryF4GridDensity(params: {
  startTime: string;
  endTime: string;
  gridSizeM: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  includeVehicleCount?: boolean;
  maxCells?: number;
}): Promise<F4GridDensityResponse> {
  const response = await apiClient.get<F4GridDensityResponse>('/api/v1/analytics/f4-grid-density', {
    params: {
      start_time: params.startTime,
      end_time: params.endTime,
      grid_size_m: params.gridSizeM,
      min_lon: params.minLon,
      min_lat: params.minLat,
      max_lon: params.maxLon,
      max_lat: params.maxLat,
      include_vehicle_count: params.includeVehicleCount ?? false,
      max_cells: params.maxCells ?? 3000,
      format: 'compact',
    },
    timeout: 180000,
  });

  return response.data;
}

export async function queryF5ABFlow(params: {
  startTime: string;
  endTime: string;
  granularity: 'hour' | 'day';
  bufferMeters: number;
  maxTransitionSeconds: number;
  areaA: F5BBox;
  areaB: F5BBox;
}): Promise<F5ABFlowResponse> {
  const response = await apiClient.post<F5ABFlowResponse>(
    '/api/v1/analytics/f5-ab-flow',
    {
      start_time: params.startTime,
      end_time: params.endTime,
      granularity: params.granularity,
      buffer_meters: params.bufferMeters,
      max_transition_seconds: params.maxTransitionSeconds,
      area_a: {
        min_lon: params.areaA.minLon,
        min_lat: params.areaA.minLat,
        max_lon: params.areaA.maxLon,
        max_lat: params.areaA.maxLat,
      },
      area_b: {
        min_lon: params.areaB.minLon,
        min_lat: params.areaB.minLat,
        max_lon: params.areaB.maxLon,
        max_lat: params.areaB.maxLat,
      },
    },
    {
      timeout: 60000,
    },
  );
  return response.data;
}

export async function queryF5TransitionThresholdRecommendation(params: {
  areaA: F5BBox;
  areaB: F5BBox;
}): Promise<F5ThresholdRecommendationResponse> {
  const response = await apiClient.post<F5ThresholdRecommendationResponse>(
    '/api/v1/analytics/f5-transition-threshold-recommendation',
    {
      area_a: {
        min_lon: params.areaA.minLon,
        min_lat: params.areaA.minLat,
        max_lon: params.areaA.maxLon,
        max_lat: params.areaA.maxLat,
      },
      area_b: {
        min_lon: params.areaB.minLon,
        min_lat: params.areaB.minLat,
        max_lon: params.areaB.maxLon,
        max_lat: params.areaB.maxLat,
      },
    },
    {
      timeout: 15000,
    },
  );
  return response.data;
}

export async function queryF6RadiationFlow(params: {
  startTime: string;
  endTime: string;
  granularity: 'hour' | 'day';
  direction: 'outbound' | 'inbound' | 'both';
  analysisMode: 'strict_od' | 'through_flow';
  coreArea: F5BBox;
  h3Resolution: number;
  bufferMeters: number;
  topK: number;
  maxTransitionSeconds?: number;
}): Promise<F6RadiationResponse> {
  const response = await apiClient.post<F6RadiationResponse>(
    '/api/v1/analytics/f6-radiation-flow',
    {
      start_time: params.startTime,
      end_time: params.endTime,
      granularity: params.granularity,
      direction: params.direction,
      analysis_mode: params.analysisMode,
      core_area: {
        min_lon: params.coreArea.minLon,
        min_lat: params.coreArea.minLat,
        max_lon: params.coreArea.maxLon,
        max_lat: params.coreArea.maxLat,
      },
      h3_resolution: params.h3Resolution,
      buffer_meters: params.bufferMeters,
      top_k: params.topK,
      max_transition_seconds: params.maxTransitionSeconds ?? 3600,
    },
    {
      timeout: LONG_ANALYTICS_TIMEOUT_MS,
    },
  );
  return response.data;
}

export async function queryF7FrequentPaths(params: {
  startTime: string;
  endTime: string;
  analysisBBox: F5BBox;
  topK: number;
  minGroupLengthM: number;
  maxTrips?: number;
  scope?: 'citywide' | 'bbox';
  sortMode?: 'frequency' | 'length_weighted';
}): Promise<F7FrequentPathsResponse> {
  const response = await apiClient.post<F7FrequentPathsResponse>(
    '/api/v1/analytics/f7-frequent-paths',
    {
      start_time: params.startTime,
      end_time: params.endTime,
      analysis_bbox: {
        min_lon: params.analysisBBox.minLon,
        min_lat: params.analysisBBox.minLat,
        max_lon: params.analysisBBox.maxLon,
        max_lat: params.analysisBBox.maxLat,
      },
      top_k: params.topK,
      min_group_length_m: params.minGroupLengthM,
      scope: params.scope ?? 'bbox',
      sort_mode: params.sortMode ?? 'frequency',
      ...(params.maxTrips ? { max_trips: params.maxTrips } : {}),
    },
    {
      timeout: LONG_ANALYTICS_TIMEOUT_MS,
    },
  );
  const data = response.data;
  if ((!data.paths || !data.paths.length) && Array.isArray(data.corridors)) {
    return {
      ...data,
      paths: data.corridors,
    };
  }
  return data;
}

export async function queryF7RoadDetail(params: {
  startTime: string;
  endTime: string;
  analysisBBox: F5BBox;
  roadGroupKey: string;
  direction: number;
  componentId?: number;
}): Promise<F7RoadDetailResponse> {
  const response = await apiClient.post<F7RoadDetailResponse>(
    '/api/v1/analytics/f7-road-detail',
    {
      start_time: params.startTime,
      end_time: params.endTime,
      analysis_bbox: {
        min_lon: params.analysisBBox.minLon,
        min_lat: params.analysisBBox.minLat,
        max_lon: params.analysisBBox.maxLon,
        max_lat: params.analysisBBox.maxLat,
      },
      road_group_key: params.roadGroupKey,
      direction: params.direction,
      ...(params.componentId ? { component_id: params.componentId } : {}),
    },
    {
      timeout: 300000,
    },
  );
  return response.data;
}

export async function queryF8ABFrequentRoutes(params: {
  startTime: string;
  endTime: string;
  areaA: F5BBox;
  areaB: F5BBox;
  topK: number;
  candidateMode: 'strict_od' | 'pass_through';
  bufferMeters: number;
  minSupport: number;
  minEdgeLengthM: number;
  minRouteLengthM: number;
  maxCandidateTrips?: number;
}): Promise<F8FrequentRoutesResponse> {
  const response = await apiClient.post<F8FrequentRoutesResponse>(
    '/api/v1/analytics/f8-ab-frequent-routes',
    {
      start_time: params.startTime,
      end_time: params.endTime,
      area_a: {
        min_lon: params.areaA.minLon,
        min_lat: params.areaA.minLat,
        max_lon: params.areaA.maxLon,
        max_lat: params.areaA.maxLat,
      },
      area_b: {
        min_lon: params.areaB.minLon,
        min_lat: params.areaB.minLat,
        max_lon: params.areaB.maxLon,
        max_lat: params.areaB.maxLat,
      },
      top_k: params.topK,
      candidate_mode: params.candidateMode,
      buffer_meters: params.bufferMeters,
      min_support: params.minSupport,
      min_edge_length_m: params.minEdgeLengthM,
      min_route_length_m: params.minRouteLengthM,
      ...(params.maxCandidateTrips ? { max_candidate_trips: params.maxCandidateTrips } : {}),
    },
    {
      timeout: 600000,
    },
  );
  const data = response.data;
  if ((!data.routes || !data.routes.length) && Array.isArray(data.corridors)) {
    const mappedRoutes: F8FrequentRoute[] = data.corridors.map((corridor, index) => ({
      rank: corridor.rank ?? (index + 1),
      route_signature: corridor.corridor_signature,
      route_signature_array: corridor.corridor_signature.split(' > ').filter(Boolean),
      trip_count: corridor.trip_count,
      vehicle_count: corridor.vehicle_count,
      avg_duration_min: corridor.avg_duration_min ?? null,
      p50_duration_min: corridor.p50_duration_min ?? null,
      p90_duration_min: corridor.p90_duration_min ?? null,
      duration_tail_ratio: corridor.duration_tail_ratio ?? null,
      route_length_m: corridor.avg_route_length_m ?? 0,
      avg_route_length_m: corridor.avg_route_length_m ?? 0,
      edge_count: corridor.corridor_signature.split(' > ').filter(Boolean).length,
      durations_by_hour: corridor.durations_by_hour,
      duration_samples_by_hour: corridor.duration_samples_by_hour,
      trip_count_by_hour: corridor.trip_count_by_hour,
      representative_taxi_id: corridor.representative_taxi_id,
      representative_trip_id: corridor.representative_trip_id,
      representative_quality_score: corridor.representative_quality_score,
      quality_tier: corridor.quality_tier,
      quality_warnings: corridor.quality_warnings,
      ranking_score: corridor.ranking_score,
      parent_cluster_id: corridor.parent_cluster_id,
      subcluster_id: corridor.subcluster_id,
      split_mode: corridor.split_mode,
      share_of_parent_cluster: corridor.share_of_parent_cluster,
      quality_metrics: corridor.quality_metrics,
      geometry: corridor.geometry,
    }));
    return {
      ...data,
      routes: mappedRoutes,
    };
  }
  return data;
}
