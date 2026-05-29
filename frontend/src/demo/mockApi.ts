import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

type LngLat = [number, number];
type BBox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

type DemoTrip = {
  taxiId: number;
  tripId: string;
  startTime: string;
  endTime: string;
  coords: LngLat[];
};

const DEMO_DELAY_MS = 180;
const BEIJING_BBOX: BBox = { minLon: 116.315, minLat: 39.875, maxLon: 116.485, maxLat: 39.975 };

const demoTrips: DemoTrip[] = [
  {
    taxiId: 1208,
    tripId: 'demo-1001',
    startTime: '2008-02-03 08:12:00',
    endTime: '2008-02-03 08:48:00',
    coords: [
      [116.332, 39.912], [116.346, 39.918], [116.365, 39.923], [116.386, 39.925],
      [116.407, 39.921], [116.426, 39.914], [116.444, 39.905],
    ],
  },
  {
    taxiId: 1208,
    tripId: 'demo-1002',
    startTime: '2008-02-03 18:05:00',
    endTime: '2008-02-03 18:42:00',
    coords: [
      [116.455, 39.936], [116.438, 39.932], [116.419, 39.928], [116.399, 39.920],
      [116.381, 39.909], [116.361, 39.897], [116.342, 39.889],
    ],
  },
  {
    taxiId: 3176,
    tripId: 'demo-2001',
    startTime: '2008-02-04 09:20:00',
    endTime: '2008-02-04 09:58:00',
    coords: [
      [116.355, 39.951], [116.368, 39.941], [116.383, 39.932], [116.402, 39.925],
      [116.421, 39.918], [116.442, 39.909], [116.463, 39.898],
    ],
  },
];

const f7Geometry: LngLat[] = [
  [116.340, 39.907], [116.360, 39.913], [116.382, 39.918], [116.404, 39.920], [116.430, 39.916], [116.456, 39.906],
];

const f8RouteA: LngLat[] = [
  [116.337, 39.904], [116.354, 39.911], [116.376, 39.918], [116.397, 39.919], [116.420, 39.914], [116.446, 39.904],
];

const f8RouteB: LngLat[] = [
  [116.338, 39.897], [116.356, 39.902], [116.373, 39.908], [116.394, 39.914], [116.416, 39.925], [116.438, 39.934],
];

type RagChunk = {
  title: string;
  path: string;
  heading: string;
  keywords: string[];
  content: string;
};

const markdownModules = {
  '../../../README.md': '',
  ...import.meta.glob('../../../docs/**/*.md', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../../README.md', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

function normalizeDemoDocPath(path: string) {
  return path.replace(/^\.\.\/\.\.\/\.\.\//, '');
}

function cleanMarkdownForDemoRag(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[#>*_`|~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isProbablyCorruptedText(text: string) {
  const questionMarks = (text.match(/\?/g) || []).length;
  const replacementChars = (text.match(/\uFFFD/g) || []).length;
  return replacementChars > 0 || questionMarks >= 8 || /\?{4,}/.test(text);
}

function titleFromMarkdown(path: string, markdown: string) {
  const firstHeading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (firstHeading) return firstHeading;
  return path.split('/').pop()?.replace(/\.md$/i, '') || path;
}

function splitDemoMarkdownDoc(path: string, markdown: string): RagChunk[] {
  const relativePath = normalizeDemoDocPath(path);
  const title = titleFromMarkdown(relativePath, markdown);
  const lines = markdown.split(/\r?\n/);
  const chunks: RagChunk[] = [];
  let currentHeading = title;
  let buffer: string[] = [];

  const flush = () => {
    const content = cleanMarkdownForDemoRag(buffer.join('\n'));
    buffer = [];
    if (!content || isProbablyCorruptedText(`${currentHeading} ${content}`)) return;
    const contentParts = content.match(/.{1,1600}(?:\s|$)/g) || [content];
    contentParts.forEach((part, index) => {
      const heading = index === 0 ? currentHeading : `${currentHeading}（续）`;
      chunks.push({
        title,
        path: relativePath,
        heading,
        keywords: Array.from(new Set(tokenize(`${title} ${relativePath} ${heading} ${part}`))).slice(0, 80),
        content: part.trim(),
      });
    });
  };

  lines.forEach((line) => {
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flush();
      currentHeading = heading[2].trim();
      buffer.push(line);
      return;
    }
    buffer.push(line);
  });
  flush();
  return chunks;
}

const ragChunks: RagChunk[] = Object.entries(markdownModules)
  .flatMap(([path, markdown]) => splitDemoMarkdownDoc(path, String(markdown || '')))
  .filter((chunk) => (chunk.path === 'README.md' || chunk.path.startsWith('docs/')) && !isProbablyCorruptedText(`${chunk.heading} ${chunk.content}`));

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function parseData(data: unknown): Record<string, any> {
  if (!data) return {};
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
  if (typeof data === 'object') return data as Record<string, any>;
  return {};
}

function getParam(config: InternalAxiosRequestConfig, key: string): unknown {
  const params = config.params as Record<string, unknown> | URLSearchParams | undefined;
  if (!params) return undefined;
  if (params instanceof URLSearchParams) return params.get(key);
  return params[key];
}

function toNumber(value: unknown, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizePath(config: InternalAxiosRequestConfig) {
  const raw = config.url || '/';
  const base = config.baseURL || window.location.origin;
  return new URL(raw, base).pathname;
}

function distanceKm(coords: LngLat[]) {
  let sum = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    const x = (lng2 - lng1) * 85.3;
    const y = (lat2 - lat1) * 111.0;
    sum += Math.sqrt(x * x + y * y);
  }
  return Number(sum.toFixed(2));
}

function shiftCoords(coords: LngLat[], lngOffset: number, latOffset: number): LngLat[] {
  return coords.map(([lng, lat]) => [Number((lng + lngOffset).toFixed(6)), Number((lat + latOffset).toFixed(6))]);
}

function featureFromTrip(trip: DemoTrip, taxiIdOverride?: number, matched = false) {
  const coords = matched ? shiftCoords(trip.coords, 0.0012, -0.0007) : trip.coords;
  const taxiId = taxiIdOverride || trip.taxiId;
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: {
      taxi_id: taxiId,
      trip_id: trip.tripId,
      start_time: trip.startTime,
      end_time: trip.endTime,
      point_count: coords.length,
      distance_km: distanceKm(coords),
      duration_min: 36,
      is_matched: matched,
    },
  };
}

function demoPolylines(config: InternalAxiosRequestConfig) {
  const taxiId = toNumber(getParam(config, 'taxi_id'), demoTrips[0].taxiId);
  const maxTrips = Math.max(1, Math.min(12, toNumber(getParam(config, 'max_trips'), 3)));
  const trips = demoTrips.slice(0, maxTrips).map((trip, index) => ({ ...trip, taxiId: Number.isFinite(taxiId) ? taxiId : trip.taxiId + index }));
  return {
    type: 'FeatureCollection',
    features: trips.map((trip) => featureFromTrip(trip)),
    meta: { total_segment_count: trips.length, is_limited: false, demo: true },
  };
}

function demoMatched(config: InternalAxiosRequestConfig) {
  const taxiId = toNumber(getParam(config, 'taxi_id'), demoTrips[0].taxiId);
  return {
    type: 'FeatureCollection',
    features: demoTrips.map((trip) => featureFromTrip(trip, taxiId, true)),
    meta: { demo: true },
  };
}

function demoSpatial(config: InternalAxiosRequestConfig) {
  const taxiId = toNumber(getParam(config, 'taxi_id'), demoTrips[0].taxiId);
  return {
    type: 'FeatureCollection',
    features: demoTrips.map((trip) => featureFromTrip(trip, taxiId, true)),
    meta: { active_vehicle_count: 126, trip_count: demoTrips.length, counts_are_limited: false, detail_limit_applied: 1200 },
  };
}

function bboxFromConfig(config: InternalAxiosRequestConfig): BBox {
  return {
    minLon: toNumber(getParam(config, 'min_lon'), BEIJING_BBOX.minLon),
    minLat: toNumber(getParam(config, 'min_lat'), BEIJING_BBOX.minLat),
    maxLon: toNumber(getParam(config, 'max_lon'), BEIJING_BBOX.maxLon),
    maxLat: toNumber(getParam(config, 'max_lat'), BEIJING_BBOX.maxLat),
  };
}

function bboxFromBody(body: Record<string, any>, key: string): BBox {
  const source = body[key] || body;
  return {
    minLon: toNumber(source.min_lon ?? source.minLon, BEIJING_BBOX.minLon),
    minLat: toNumber(source.min_lat ?? source.minLat, BEIJING_BBOX.minLat),
    maxLon: toNumber(source.max_lon ?? source.maxLon, BEIJING_BBOX.maxLon),
    maxLat: toNumber(source.max_lat ?? source.maxLat, BEIJING_BBOX.maxLat),
  };
}

function makeCellBoundary(center: LngLat, radius = 0.004): LngLat[] {
  const [lng, lat] = center;
  return [
    [lng - radius, lat - radius], [lng + radius, lat - radius], [lng + radius, lat + radius], [lng - radius, lat + radius], [lng - radius, lat - radius],
  ];
}

function demoGridDensity(config: InternalAxiosRequestConfig) {
  const bbox = bboxFromConfig(config);
  const cells = Array.from({ length: 24 }, (_, idx) => {
    const col = idx % 6;
    const row = Math.floor(idx / 6);
    const lng = bbox.minLon + ((col + 0.5) / 6) * (bbox.maxLon - bbox.minLon || 0.12);
    const lat = bbox.minLat + ((row + 0.5) / 4) * (bbox.maxLat - bbox.minLat || 0.08);
    const pointCount = 80 + ((idx * 37) % 420);
    return {
      i: col,
      j: row,
      h3_id: `demo-h3-${row}-${col}`,
      bounds: [lng - 0.006, lat - 0.005, lng + 0.006, lat + 0.005],
      center: [Number(lng.toFixed(6)), Number(lat.toFixed(6))],
      boundary: makeCellBoundary([lng, lat], 0.0045),
      resolution: 8,
      point_count: pointCount,
      vehicle_count: 12 + ((idx * 7) % 65),
      density: Number((pointCount / 1000).toFixed(4)),
    };
  });
  return {
    cells,
    meta: {
      grid_size_m: toNumber(getParam(config, 'grid_size_m'), 500),
      cell_count: cells.length,
      max_density: Math.max(...cells.map((cell) => cell.density)),
      max_vehicle_count: Math.max(...cells.map((cell) => Number(cell.vehicle_count || 0))),
      total_points: cells.reduce((sum, cell) => sum + cell.point_count, 0),
      include_vehicle_count: true,
      cache_hit: true,
      elapsed_ms: 42,
      query_mode: 'frontend_demo',
    },
  };
}

function demoF5Flow() {
  const items = ['2008-02-03T08:00:00', '2008-02-03T09:00:00', '2008-02-03T17:00:00', '2008-02-03T18:00:00'].map((bucket, index) => {
    const aToB = [38, 52, 74, 66][index];
    const bToA = [25, 34, 41, 48][index];
    return {
      time_bucket: bucket,
      a_to_b: aToB,
      b_to_a: bToA,
      total: aToB + bToA,
      net_flow: aToB - bToA,
      a_to_b_avg_duration_min: 24 + index * 1.7,
      b_to_a_avg_duration_min: 27 + index * 1.3,
    };
  });
  const aTotal = items.reduce((sum, item) => sum + item.a_to_b, 0);
  const bTotal = items.reduce((sum, item) => sum + item.b_to_a, 0);
  return {
    items,
    summary: {
      a_to_b_total: aTotal,
      b_to_a_total: bTotal,
      total: aTotal + bTotal,
      net_flow: aTotal - bTotal,
      dominant_direction: 'A_TO_B',
      a_to_b_avg_duration_min: 26.4,
      b_to_a_avg_duration_min: 29.2,
    },
    meta: { granularity: 'hour', buffer_meters: 350, max_transition_seconds: 3600, demo: true },
  };
}

function demoF6Radiation(body: Record<string, any>) {
  const core = bboxFromBody(body, 'core_area');
  const coreCenter: LngLat = [(core.minLon + core.maxLon) / 2, (core.minLat + core.maxLat) / 2];
  const regions = [
    { id: '884c1a31', offset: [-0.035, 0.026] as LngLat, out: 168, in: 92 },
    { id: '884c1a47', offset: [0.041, 0.018] as LngLat, out: 141, in: 118 },
    { id: '884c1a5d', offset: [0.018, -0.032] as LngLat, out: 96, in: 124 },
    { id: '884c1a62', offset: [-0.044, -0.025] as LngLat, out: 83, in: 69 },
  ].map((item) => {
    const center: LngLat = [Number((coreCenter[0] + item.offset[0]).toFixed(6)), Number((coreCenter[1] + item.offset[1]).toFixed(6))];
    return {
      region_id: item.id,
      h3_index: item.id,
      center,
      boundary: makeCellBoundary(center, 0.008),
      bounds: [center[0] - 0.008, center[1] - 0.008, center[0] + 0.008, center[1] + 0.008],
      outbound_total: item.out,
      inbound_total: item.in,
      total: item.out + item.in,
      net_flow: item.out - item.in,
      avg_duration_min: 21.5 + (item.out % 8),
    };
  });
  const totalOutbound = regions.reduce((sum, region) => sum + region.outbound_total, 0);
  const totalInbound = regions.reduce((sum, region) => sum + region.inbound_total, 0);
  return {
    regions,
    series: regions.flatMap((region) => ['08:00', '18:00'].map((hour, idx) => ({
      time_bucket: `2008-02-03T${hour}:00`,
      region_id: region.region_id,
      outbound: Math.round(region.outbound_total * (idx ? 0.58 : 0.42)),
      inbound: Math.round(region.inbound_total * (idx ? 0.55 : 0.45)),
      total: Math.round(region.total * 0.5),
      net_flow: region.net_flow,
    }))),
    summary: {
      total_outbound: totalOutbound,
      total_inbound: totalInbound,
      total_flow: totalOutbound + totalInbound,
      net_flow: totalOutbound - totalInbound,
      dominant_direction: 'outbound',
      top_k_flow: totalOutbound + totalInbound,
      top_k_ratio: 0.64,
      avg_duration_min: 24.8,
      external_region_count: 37,
    },
    meta: { direction: body.direction || 'both', analysis_mode: body.analysis_mode || 'through_flow', analysis_scope: 'full_dataset', h3_resolution: body.h3_resolution || 8, elapsed_ms: 88, cached_compute_elapsed_ms: 12 },
  };
}

function demoF7Paths() {
  const paths = [
    {
      rank: 1,
      road_group_key: 'demo-east-west-corridor',
      road_name: '长安街-建国门走廊',
      highway: 'primary',
      direction: 'forward',
      direction_value: 1,
      direction_supported: true,
      component_id: 1,
      corridor_component_id: 1,
      trip_count: 238,
      vehicle_count: 117,
      edge_pass_weight: 312,
      segment_count: 9,
      group_length_m: 6840,
      matched_segment_length_m: 6420,
      has_oneway_segment: false,
      geometry_backbone: { type: 'LineString', coordinates: f7Geometry },
      geometry: { type: 'LineString', coordinates: f7Geometry },
      corridor_confidence: 0.91,
    },
    {
      rank: 2,
      road_group_key: 'demo-north-ring-corridor',
      road_name: '北二环-东直门走廊',
      highway: 'secondary',
      direction: 'forward',
      direction_value: 1,
      direction_supported: true,
      component_id: 2,
      corridor_component_id: 2,
      trip_count: 164,
      vehicle_count: 89,
      edge_pass_weight: 211,
      segment_count: 7,
      group_length_m: 5120,
      matched_segment_length_m: 4860,
      has_oneway_segment: true,
      geometry_backbone: { type: 'LineString', coordinates: f8RouteB },
      geometry: { type: 'LineString', coordinates: f8RouteB },
      corridor_confidence: 0.84,
    },
  ];
  return {
    paths,
    corridors: paths,
    summary: {
      path_count: paths.length,
      total_path_count_before_top_k: 18,
      top_k_trip_count: paths.reduce((sum, path) => sum + path.trip_count, 0),
      total_ranked_trip_count: 1120,
      top_k_ratio: 0.36,
      max_trip_count: Math.max(...paths.map((path) => path.trip_count)),
      max_vehicle_count: Math.max(...paths.map((path) => path.vehicle_count)),
      sampled_trip_count: 500,
      sample_ratio: 1,
    },
    meta: { logic_mode: 'frontend_demo', precision_level: 'demo', direction_supported: true, elapsed_ms: 66, metric_mode: 'frequency' },
  };
}

function demoF7Detail() {
  const segments = f7Geometry.slice(0, -1).map((point, index) => ({
    rank: index + 1,
    flow_rank: index + 1,
    profile_order: index + 1,
    road_uid: 9000 + index,
    road_id: 9000 + index,
    highway: index % 2 ? 'primary' : 'secondary',
    trip_count: 170 - index * 13,
    raw_trip_count: 170 - index * 13,
    edge_pass_weight: 220 - index * 17,
    vehicle_count: 92 - index * 5,
    length_m: 720 + index * 90,
    geometry: { type: 'LineString', coordinates: [point, f7Geometry[index + 1]] },
  }));
  return {
    segments,
    summary: {
      segment_count: segments.length,
      total_trip_count: segments.reduce((sum, segment) => sum + segment.trip_count, 0),
      total_edge_pass_weight: segments.reduce((sum, segment) => sum + segment.edge_pass_weight, 0),
      max_trip_count: Math.max(...segments.map((segment) => segment.trip_count)),
      max_edge_pass_weight: Math.max(...segments.map((segment) => segment.edge_pass_weight)),
    },
    meta: { logic_mode: 'frontend_demo', metric_mode: 'frequency', road_group_key: 'demo-east-west-corridor', direction: 1, elapsed_ms: 34 },
  };
}

function routeItem(rank: number, signature: string, coords: LngLat[], tripCount: number, duration: number) {
  return {
    rank,
    route_signature: signature,
    route_signature_array: signature.split(' > '),
    trip_count: tripCount,
    vehicle_count: Math.round(tripCount * 0.58),
    avg_duration_min: duration + 2.1,
    p20_duration_min: duration - 3.2,
    p50_duration_min: duration,
    p90_duration_min: duration + 8.8,
    duration_tail_ratio: 0.18,
    route_length_m: Math.round(distanceKm(coords) * 1000),
    avg_route_length_m: Math.round(distanceKm(coords) * 1000),
    edge_count: coords.length - 1,
    durations_by_hour: { '8': duration + 2, '18': duration + 5 },
    trip_count_by_hour: { '8': Math.round(tripCount * 0.42), '18': Math.round(tripCount * 0.58) },
    representative_taxi_id: 1208,
    representative_trip_id: 1001,
    representative_quality_score: 0.88,
    quality_tier: 'high_confidence',
    quality_warnings: [],
    ranking_score: tripCount / Math.max(1, duration),
    geometry: { type: 'LineString', coordinates: coords },
    quality_metrics: { geometry_point_count: coords.length, geometry_length_m: Math.round(distanceKm(coords) * 1000), directness_ratio: 1.22 },
  };
}

function demoF8Routes() {
  const routes = [routeItem(1, '西单 > 东单 > 建国门 > 国贸', f8RouteA, 146, 24.6), routeItem(2, '金融街 > 西直门 > 东直门 > 三元桥', f8RouteB, 92, 31.4)];
  const corridors = routes.map((route) => ({
    ...route,
    corridor_signature: route.route_signature,
    share_of_candidates: route.trip_count / 260,
    avg_route_length_m: route.avg_route_length_m,
    variants: [{ variant_signature: `${route.route_signature} / 主变体`, trip_count: Math.round(route.trip_count * 0.72), share_within_corridor: 0.72, avg_duration_min: route.avg_duration_min, p50_duration_min: route.p50_duration_min, p90_duration_min: route.p90_duration_min, geometry: route.geometry }],
  }));
  return {
    routes,
    corridors,
    summary: {
      route_count: routes.length,
      candidate_trip_count: 312,
      raw_valid_ab_trip_count: 286,
      valid_ab_trip_count: 260,
      total_route_count_before_top_k: 14,
      top_k_trip_count: routes.reduce((sum, route) => sum + route.trip_count, 0),
      corridor_covered_trip_count: 238,
      total_ranked_trip_count: 260,
      top_k_ratio: 0.92,
      top_k_ranked_ratio: 0.92,
      ranked_trip_ratio: 0.83,
      max_trip_count: Math.max(...routes.map((route) => route.trip_count)),
    },
    meta: { logic_mode: 'frontend_demo', signature_mode: 'road_name', geometry_mode: 'representative', top_k: 6, elapsed_ms: 104, buffer_meters: 350, min_support: 5 },
  };
}


function tokenize(text: string) {
  return text.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/).filter(Boolean);
}

function demoAssistant(body: Record<string, any>) {
  const question = String(body.question || '').trim();
  const terms = tokenize(question);
  const scored = ragChunks
    .map((chunk) => {
      const haystack = `${chunk.heading} ${chunk.keywords.join(' ')} ${chunk.content}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0) + (chunk.keywords.some((keyword) => question.toLowerCase().includes(keyword)) ? 2 : 0);
      return { chunk, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(5, Number(body.top_k || body.topK || 3))));
  const hits = scored.length
    ? scored
    : ragChunks.slice(0, 2).map((chunk) => ({ chunk, score: 1 }));
  const sources = hits.map(({ chunk, score }) => ({ title: chunk.title, path: chunk.path, heading: chunk.heading, score }));
  const contextLine = body.context?.activeFeature ? `当前界面上下文是 ${body.context.activeFeature}。` : '当前为课程作业 Demo 模式。';
  const answer = [
    `这是前端内置 RAG Demo 的回答：${contextLine}`,
    '',
    ...hits.map(({ chunk }, index) => `${index + 1}. **${chunk.heading}**：${chunk.content}`),
    '',
    '如果要接入真实 GPT/Agent，请在根目录 .env 配置 OPENAI_API_KEY、OPENAI_BASE_URL、OPENAI_MODEL，并将 VITE_DEMO_MODE=false 后启动完整后端。Demo 模式不会把密钥写入前端代码。',
  ].join('\n');
  const actions = [] as Array<{ type: string; label: string; value?: string | null }>;
  if (/放大|zoom\s*in/i.test(question)) actions.push({ type: 'zoom_in', label: '放大地图' });
  if (/缩小|zoom\s*out/i.test(question)) actions.push({ type: 'zoom_out', label: '缩小地图' });
  if (/深色|dark|黑/i.test(question)) actions.push({ type: 'set_map_style', label: '切换深色地图', value: 'dark' });
  return { answer, sources, suggested_actions: actions, meta: { retrieval: 'frontend_demo_rag', chunk_count: ragChunks.length, matched_chunk_count: hits.length, context: body.context || {} } };
}

function demoResponse(config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse {
  return {
    data,
    status,
    statusText: status === 200 ? 'OK' : 'Demo Error',
    headers: { 'x-demo-mode': 'true' },
    config,
    request: { demo: true },
  };
}

function routeDemo(config: InternalAxiosRequestConfig) {
  const path = normalizePath(config);
  const method = String(config.method || 'get').toLowerCase();
  const body = parseData(config.data);

  if (method === 'get' && path === '/api/v1/analytics/dataset-summary') {
    return {
      point_count: 10357942,
      outlier_point_count: 18294,
      vehicle_count: 10357,
      trip_count: 186420,
      taxi_id_range: { min: 1, max: 10357, missing_id_count: 0 },
      time_range: { start_time: '2008-02-02 00:00:00', end_time: '2008-02-08 23:59:59' },
      spatial_bound: { label: 'Beijing core demo bbox', min_lon: BEIJING_BBOX.minLon, min_lat: BEIJING_BBOX.minLat, max_lon: BEIJING_BBOX.maxLon, max_lat: BEIJING_BBOX.maxLat },
      coordinate_system: 'WGS-84',
      accuracy_note: 'Demo 数据为脱敏固定样例，保留接口结构和交互链路。',
      vehicle_count_note: '前端 Demo 模式不包含真实后端数据。',
    };
  }
  if (method === 'get' && path === '/api/v1/analytics/active-vehicles') return { active_vehicle_count: 126 };
  if (method === 'get' && path === '/api/v1/trajectories/polylines') return demoPolylines(config);
  if (method === 'get' && path === '/api/trajectory/matched') return demoMatched(config);
  if (method === 'get' && path.startsWith('/api/trajectory/') && path !== '/api/trajectory/matched/spatial') {
    const trip = demoTrips[0];
    return { trip_id: 1001, taxi_id: trip.taxiId, raw_points: trip.coords, matched_route: { type: 'LineString', coordinates: shiftCoords(trip.coords, 0.0012, -0.0007) }, distance_km: distanceKm(trip.coords), meta: { raw_point_count: trip.coords.length, has_matched: true } };
  }
  if (method === 'get' && path === '/api/trajectory/matched/spatial') return demoSpatial(config);
  if (method === 'post' && path === '/api/v1/analytics/active-vehicles-union') return { active_vehicle_count: 214 };
  if (method === 'post' && path === '/api/v1/analytics/active-vehicles-union-detail') {
    return {
      active_vehicle_count: 214,
      box_vehicle_counts: [{ box_index: 1, vehicle_count: 126 }, { box_index: 2, vehicle_count: 97 }],
      rows: [
        { key: '1208', taxi_id: 1208, box_labels: 'A,B', trip_ids: ['demo-1001', 'demo-1002'] },
        { key: '3176', taxi_id: 3176, box_labels: 'A', trip_ids: ['demo-2001'] },
      ],
    };
  }
  if (method === 'get' && path === '/api/v1/analytics/f4-grid-density') return demoGridDensity(config);
  if (method === 'post' && path === '/api/v1/analytics/f5-ab-flow') return demoF5Flow();
  if (method === 'post' && path === '/api/v1/analytics/f5-transition-threshold-recommendation') return { recommended_seconds: 2100, recommended_minutes: 35, distance_meters: 6800, raw_seconds: 1930, meta: { pessimistic_mps: 3.2, pessimistic_kmh: 11.5, road_winding_factor: 1.35, logic_mode: 'frontend_demo' } };
  if (method === 'post' && path === '/api/v1/analytics/f6-radiation-flow') return demoF6Radiation(body);
  if (method === 'post' && path === '/api/v1/analytics/f7-frequent-paths') return demoF7Paths();
  if (method === 'post' && path === '/api/v1/analytics/f7-road-detail') return demoF7Detail();
  if (method === 'post' && path === '/api/v1/analytics/f8-ab-frequent-routes') return demoF8Routes();
  if (method === 'post' && path === '/api/v1/assistant/chat') return demoAssistant(body);

  return { demo: true, detail: `No demo fixture for ${method.toUpperCase()} ${path}` };
}

export const demoAxiosAdapter: AxiosAdapter = async (config) => {
  await sleep(DEMO_DELAY_MS);
  const data = routeDemo(config as InternalAxiosRequestConfig);
  return demoResponse(config as InternalAxiosRequestConfig, data);
};
