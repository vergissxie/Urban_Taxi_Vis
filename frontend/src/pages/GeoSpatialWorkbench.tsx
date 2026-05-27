import React from 'react';
import {
  Activity,
  AreaChart,
  ArrowRight,
  ArrowLeft,
  Brush,
  CalendarDays,
  CarFront,
  Clock3,
  Database,
  Download,
  Gauge,
  Layers,
  Loader2,
  Map,
  MapPinned,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  RotateCw,
  Route,
  Search,
  Sparkles,
  TimerReset,
  Trash2,
  ChevronDown,
  ChevronRight,
  Minus,
  X,
} from 'lucide-react';
import GeoWorkbenchMapStage from '../components/GeoWorkbenchMapStage';
import GeoWorkbenchOverviewPanel from '../components/GeoWorkbenchOverviewPanel';
import GeoWorkbenchRegionPanel from '../components/GeoWorkbenchRegionPanel';
import GeoWorkbenchAssistant from '../components/GeoWorkbenchAssistant';
import GeoWorkbenchShell from '../components/GeoWorkbenchShell';
import GeoWorkbenchSidebar from '../components/GeoWorkbenchSidebar';
import GeoWorkbenchTimeline from '../components/GeoWorkbenchTimeline';
import GeoWorkbenchTrajectoryPanel from '../components/GeoWorkbenchTrajectoryPanel';
import { APP_CONFIG } from '../config/appConfig';
import GeoWorkbenchDecisionPanel from '../components/GeoWorkbenchDecisionPanel';
import { useAmapSdk } from '../hooks/useAmapSdk';
import { apiClient } from '../services/api';
import {
  queryF7FrequentPaths,
  queryF7RoadDetail,
  queryF8ABFrequentRoutes,
  queryF4GridDensity,
  queryF5ABFlow,
  queryF5TransitionThresholdRecommendation,
  queryF6RadiationFlow,
  queryMatchedByTrips,
  queryRawTrajectoryByTrip,
  queryUnionVehicleDetailByBBoxes,
  type F3UnionDetailRow,
  type F7FrequentPath,
  type F7FrequentPathsResponse,
  type F7RoadDetailResponse,
  type F7RoadDetailSegment,
  type F8Corridor,
  type F8FrequentRoute,
  type F8FrequentRoutesResponse,
  type F4GridCell,
  type F4GridDensityResponse,
  type F4H3BaseDensityResponse,
  type F5ABFlowResponse,
  type F5BBox,
  type F5ThresholdRecommendationResponse,
  type F6RadiationRegion,
  type F6RadiationResponse,
} from '../services/trajectoryService';
import type { AssistantAction } from '../services/assistantService';
import readonlyFixture from '../demo/readonlyFixture.json';

type WorkbenchMode = 'overview' | 'trajectory' | 'region' | 'decision';
type ComputeStatus = 'idle' | 'computing' | 'ready' | 'empty' | 'error';
type BrushMode = 'none' | 'areaA' | 'areaB';
type MapStyleKey = 'darkblue' | 'dark' | 'normal';
type RegionTool = 'f3' | 'f4' | 'f5' | 'f6';
type F4RenderMode = 'heatmap' | 'choropleth';
type F4ClassifyMethod = 'quantile' | 'jenks' | 'equal';
type F6Direction = 'outbound' | 'inbound' | 'both';
type F6AnalysisMode = 'strict_od' | 'through_flow';
type RunningTaskCode = 'F1-F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8';
const DEMO_FIXTURE = readonlyFixture as any;

const getDemoF6RadiationResponse = (analysisMode: F6AnalysisMode): F6RadiationResponse => {
  const strictResponse = DEMO_FIXTURE.f6StrictOd ?? DEMO_FIXTURE.f6;
  const throughResponse = DEMO_FIXTURE.f6ThroughFlow ?? DEMO_FIXTURE.f6;
  return (analysisMode === 'strict_od' ? strictResponse : throughResponse) as F6RadiationResponse;
};

interface RunningTaskState {
  code: RunningTaskCode;
  label: string;
  startedAt: number;
  estimateMs?: number | null;
}

interface CompletedTaskState {
  code: RunningTaskCode;
  label: string;
  elapsedMs: number;
}

interface StatusNoticeState {
  tone: 'warning' | 'error';
  text: string;
}

interface F4GridDensityCacheEntry {
  storedAt: number;
  response: F4GridDensityResponse;
}

interface DatasetSummary {
  point_count?: number;
  outlier_point_count?: number;
  vehicle_count?: number;
  trip_count?: number;
  taxi_id_range?: { min?: number; max?: number; missing_id_count?: number };
  time_range?: { start_time?: string | null; end_time?: string | null };
  spatial_bound?: { label?: string; min_lon?: number | null; min_lat?: number | null; max_lon?: number | null; max_lat?: number | null };
  coordinate_system?: string;
  accuracy_note?: string;
  vehicle_count_note?: string;
}

interface OverviewStats {
  summary: DatasetSummary | null;
  activeVehicles: number | null;
  summaryLoaded: boolean;
  activeLoaded: boolean;
  error?: string;
}

interface AnalysisEntry {
  mode: Exclude<WorkbenchMode, 'overview'>;
  title: string;
  description: string;
  icon: React.ElementType;
}

interface RegionToolEntry {
  key: RegionTool;
  code: string;
  title: string;
  description: string;
  icon: React.ElementType;
}

interface ResultMetric {
  label: string;
  value: string;
}

interface AnalysisResult {
  title: string;
  subtitle: string;
  metrics: ResultMetric[];
  note?: string;
}

interface RegionParams {
  f5FlowThreshold: number;
}

interface F3BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

interface F3BoxSummary {
  boxIndex: number;
  color: string;
  vehicleCount: number;
}

interface F4LegendMeta {
  mode: F4RenderMode;
  maxDensity: number;
  cellCount: number;
  queryTimeLabel: string;
  gridSizeM: number;
  bboxLabel: string;
  elapsedMs?: number;
  classifyMethod?: F4ClassifyMethod;
  heatRanges?: Array<{ label: string; min: number; max: number; color: string }>;
  levels?: Array<{ label: string; color: string; min: number; max: number }>;
  heatGradientCss?: string;
  notice?: string;
}

interface F4H3BaseData {
  baseResolution: number;
  totalPoints: number;
  bbox: {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  };
  gridList: Array<{
    h3Id: string;
    count: number;
  }>;
}

interface F4WorkerResponse {
  requestId: number;
  result?: F4GridCell[];
  error?: string;
}

interface TrajectoryTripCard {
  id: string;
  tripId: string;
  taxiId?: number;
  index: number;
  status: 'matched' | 'drift';
  start: string;
  end: string;
  startTime?: string | null;
  endTime?: string | null;
  distanceKm: number;
  duration: string;
  points: number;
  coordinates: Array<[number, number]>;
  matchedCoordinates?: Array<[number, number]>;
}

interface RawTrajectoryFeature {
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: {
    taxi_id?: number;
    trip_id?: string | number;
    point_count?: number;
    start_time?: string | null;
    end_time?: string | null;
    [key: string]: unknown;
  };
}

interface TrajectoryOverlayGroup {
  overlays: any[];
  markers: any[];
  playbackMarker?: any;
  startMarker?: any;
  endMarker?: any;
  displayPath: Array<[number, number]>;
  playbackPath: Array<[number, number]>;
}

interface F6OverlayEntry {
  overlay: any;
  base: Record<string, unknown>;
  dim: Record<string, unknown>;
  focus: Record<string, unknown>;
}

type F7OverlayEntry = F6OverlayEntry & {
  fullPath?: Array<[number, number]>;
  animatePath?: boolean;
};

const DATA_START = '2008-02-02T00:00:00';
const DATA_END = '2008-02-08T23:59:59';
const DATA_START_MS = new Date(DATA_START).getTime();
const DATA_END_MS = new Date(DATA_END).getTime();
const MIN_TIME_WINDOW_PERCENT = 0.7;
const BEIJING_CORE_BBOX = {
  minLon: 116.32,
  minLat: 39.86,
  maxLon: 116.46,
  maxLat: 39.98,
};
const DEMO_F7_VIEWPORT_BBOX = {
  minLon: 116.15,
  minLat: 39.80,
  maxLon: 116.58,
  maxLat: 40.03,
};

const analysisEntries: AnalysisEntry[] = [
  { mode: 'trajectory', title: '基础轨迹检索 (F1-F2)', description: '车辆轨迹查询、抽稀回放与路网匹配对比', icon: Route },
  { mode: 'region', title: '区域与网格态势 (F3-F6)', description: '框选统计、栅格热力、OD 流向与核心区诊断', icon: AreaChart },
  { mode: 'decision', title: 'Frequent Paths & Recommendations (F7-F9)', description: 'Frequent roads, A/B routes, and strategy ranking', icon: Sparkles },
];

const regionToolEntries: RegionToolEntry[] = [
  { key: 'f3', code: 'F3', title: '框选统计', description: '矩形框选与并集统计', icon: Brush },
  { key: 'f4', code: 'F4', title: '栅格热力', description: '分辨率、热点网格与密度高亮', icon: AreaChart },
  { key: 'f5', code: 'F5', title: 'OD 流向', description: '流量阈值、核心迁徙路线与飞线聚焦', icon: Route },
  { key: 'f6', code: 'F6', title: '辐射分析', description: '圆心半径、圈层覆盖与距离衰减', icon: Activity },
];

const defaultRegionParams: RegionParams = {
  f5FlowThreshold: 20,
};

const F3_MAX_TAXI_ID = 10357;
const F3_BOX_COLORS = ['#22d3ee', '#60a5fa', '#34d399', '#facc15', '#fb7185', '#a78bfa'];
const F4_H3_BASE_RESOLUTION = 10;
const F4_RECOMMENDED_LEVELS = [
  { label: '街区级', gridSizeM: 200 },
  { label: '街道级', gridSizeM: 400 },
  { label: '城区级', gridSizeM: 700 },
  { label: '片区级', gridSizeM: 1000 },
  { label: '市域级', gridSizeM: 1500 },
];
const F4_CHOROPLETH_LEVELS = [
  { label: '极高', color: '#dc2626' },
  { label: '较高', color: '#f97316' },
  { label: '中等', color: '#facc15' },
  { label: '较低', color: '#84cc16' },
  { label: '低', color: '#22c55e' },
];
const F8_DEFAULT_BUFFER_METERS = 30;
const F8_DEFAULT_MIN_EDGE_LENGTH_M = 20;
const F8_DEFAULT_MIN_ROUTE_LENGTH_M = 500;
const F8_INTERACTIVE_MAX_CANDIDATE_TRIPS = 10000;

const histogram = [28, 44, 36, 62, 51, 78, 56, 42, 66, 84, 73, 58, 47, 69, 92, 74, 53, 38, 49, 61, 45, 34, 29, 41];

const mapStyleOptions: Array<{ key: MapStyleKey; label: string; hint: string; value: string }> = [
  { key: 'darkblue', label: '极夜蓝', hint: '推荐', value: APP_CONFIG.map.darkStyle },
  { key: 'dark', label: '幻影黑', hint: '高对比', value: APP_CONFIG.map.blackStyle },
  { key: 'normal', label: '标准', hint: '旧版', value: APP_CONFIG.map.lightStyle },
];

const trajectoryTripCards: TrajectoryTripCard[] = [
  { id: '1', tripId: '1', index: 1, status: 'matched', start: '13:35:53', end: '18:46:28', distanceKm: 121.8, duration: '5h 10m', points: 1925, coordinates: [] },
  { id: '2', tripId: '2', index: 2, status: 'matched', start: '00:56:13', end: '01:01:14', distanceKm: 2.7, duration: '5m', points: 67, coordinates: [] },
  { id: '3', tripId: '3', index: 3, status: 'matched', start: '07:18:44', end: '09:02:31', distanceKm: 28.4, duration: '1h 43m', points: 614, coordinates: [] },
  { id: '4', tripId: '4', index: 4, status: 'drift', start: '10:12:20', end: '13:40:19', distanceKm: 62.8, duration: '3h 27m', points: 1187, coordinates: [] },
  { id: '5', tripId: '5', index: 5, status: 'matched', start: '20:16:09', end: '22:08:52', distanceKm: 41.3, duration: '1h 52m', points: 732, coordinates: [] },
];

const modeTitle: Record<WorkbenchMode, string> = {
  overview: '数据总览',
  trajectory: '轨迹溯源',
  region: '区域诊断',
  decision: '决策建议',
};

const statusCopy: Record<ComputeStatus, string> = {
  idle: '待计算',
  computing: '计算中',
  ready: '已渲染',
  empty: '无匹配结果',
  error: '接口异常',
};

function formatInt(value: number | null | undefined, fallback = '--') {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.round(value).toLocaleString('zh-CN');
}

function formatCompact(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '--';
  if (value >= 100000000) return `${(value / 100000000).toFixed(2)} 亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`;
  return formatInt(value);
}

function formatDateRange(summary: DatasetSummary | null) {
  const start = summary?.time_range?.start_time;
  const end = summary?.time_range?.end_time;
  if (!start || !end) return '--';
  const startDate = start.slice(0, 10).replace(/-/g, '.');
  const endDate = end.slice(5, 10).replace('-', '.');
  return `${startDate} - ${endDate}`;
}

function formatBoundaryShare(summary: DatasetSummary | null) {
  const total = summary?.point_count;
  const outliers = summary?.outlier_point_count;
  if (!total || outliers == null) return '--';
  return `${Math.max(0, Math.min(100, ((total - outliers) / total) * 100)).toFixed(1)}%`;
}

function clampTimeRange(next: [number, number]): [number, number] {
  const start = Math.max(0, Math.min(100 - MIN_TIME_WINDOW_PERCENT, next[0]));
  const end = Math.max(start + MIN_TIME_WINDOW_PERCENT, Math.min(100, next[1]));
  return [Number(start.toFixed(2)), Number(end.toFixed(2))];
}

function estimateGridCells(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  gridSizeM: number,
) {
  const sw: [number, number] = [bbox.minLon, bbox.minLat];
  const se: [number, number] = [bbox.maxLon, bbox.minLat];
  const nw: [number, number] = [bbox.minLon, bbox.maxLat];
  const widthM = distanceMeters(sw, se);
  const heightM = distanceMeters(sw, nw);
  return Math.ceil(widthM / gridSizeM) * Math.ceil(heightM / gridSizeM);
}

function recommendF4GridSpec(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  renderMode: F4RenderMode,
) {
  const candidates = F4_RECOMMENDED_LEVELS.map((level) => ({
    ...level,
    estimatedCells: estimateGridCells(bbox, level.gridSizeM),
  }));
  const preferredRange = renderMode === 'choropleth'
    ? { min: 500, max: 1800, target: 1100 }
    : { min: 800, max: 2500, target: 1400 };
  const preferred = candidates.find((item) => (
    item.estimatedCells >= preferredRange.min && item.estimatedCells <= preferredRange.max
  ));
  if (preferred) return preferred;
  return candidates.reduce((best, current) => {
    const bestScore = Math.abs(best.estimatedCells - preferredRange.target);
    const currentScore = Math.abs(current.estimatedCells - preferredRange.target);
    return currentScore < bestScore ? current : best;
  });
}

function percentToDate(percent: number) {
  const safePercent = Math.max(0, Math.min(100, percent));
  return new Date(DATA_START_MS + ((DATA_END_MS - DATA_START_MS) * safePercent) / 100);
}

function toBackendTime(percent: number) {
  const date = percentToDate(percent);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatAxisTime(percent: number) {
  return toBackendTime(percent).replace('T', ' ').slice(0, 16);
}

function formatFullTime(percent: number) {
  return toBackendTime(percent).replace('T', ' ');
}

function formatTimeRange(range: [number, number]) {
  return `${formatFullTime(range[0])} - ${formatFullTime(range[1])}`;
}

function isSameTimeRange(a: [number, number], b: [number, number]) {
  return Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
}

function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  const PI = Math.PI;
  const A = 6378245.0;
  const EE = 0.00669342162296594323;
  const outOfChina = (x: number, y: number) => x < 72.004 || x > 137.8347 || y < 0.8293 || y > 55.8271;
  const transformLat = (x: number, y: number) => {
    let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
    ret += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
    ret += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
    return ret;
  };
  const transformLng = (x: number, y: number) => {
    let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
    ret += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
    ret += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
    return ret;
  };
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105, lat - 35);
  let dLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

function gcj02ToWgs84(lng: number, lat: number): [number, number] {
  const [mgLng, mgLat] = wgs84ToGcj02(lng, lat);
  return [lng * 2 - mgLng, lat * 2 - mgLat];
}

function readLngLatLike(value: unknown): [number, number] | null {
  if (!value) return null;
  const item = value as { lng?: unknown; lat?: unknown; getLng?: () => unknown; getLat?: () => unknown };
  const lng = Number(typeof item.getLng === 'function' ? item.getLng() : item.lng);
  const lat = Number(typeof item.getLat === 'function' ? item.getLat() : item.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

function readPixelLike(value: unknown): [number, number] | null {
  if (!value) return null;
  const item = value as { x?: unknown; y?: unknown; getX?: () => unknown; getY?: () => unknown };
  const x = Number(typeof item.getX === 'function' ? item.getX() : item.x);
  const y = Number(typeof item.getY === 'function' ? item.getY() : item.y);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function distanceKm(coords: Array<[number, number]>) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    total += 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return total;
}

function normalizeLineCoords(value: unknown): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item) && item.length >= 2 && Number.isFinite(Number(item[0])) && Number.isFinite(Number(item[1]))) {
      points.push([Number(item[0]), Number(item[1])]);
      return;
    }
    if (Array.isArray(item)) item.forEach(visit);
  };
  visit(value);
  return points.filter(([lng, lat]) => lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90);
}

function clipSegmentToBBox(
  a: [number, number],
  b: [number, number],
  bbox: F3BBox,
): [[number, number], [number, number]] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;

  const update = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (!update(-dx, a[0] - bbox.minLon)) return null;
  if (!update(dx, bbox.maxLon - a[0])) return null;
  if (!update(-dy, a[1] - bbox.minLat)) return null;
  if (!update(dy, bbox.maxLat - a[1])) return null;

  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
}

function pointsEqual(a: [number, number], b: [number, number]) {
  return Math.abs(a[0] - b[0]) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10;
}

function clipPolylineToBBoxes(coords: Array<[number, number]>, bboxes: F3BBox[]) {
  const segments: Array<Array<[number, number]>> = [];

  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1];
    const b = coords[i];
    bboxes.forEach((bbox) => {
      const clipped = clipSegmentToBBox(a, b, bbox);
      if (!clipped || pointsEqual(clipped[0], clipped[1])) return;

      const last = segments[segments.length - 1];
      if (last && pointsEqual(last[last.length - 1], clipped[0])) {
        last.push(clipped[1]);
      } else {
        segments.push([clipped[0], clipped[1]]);
      }
    });
  }

  return segments;
}

function isValidGeoPoint(point: [number, number]) {
  return Number.isFinite(point[0])
    && Number.isFinite(point[1])
    && point[0] >= -180
    && point[0] <= 180
    && point[1] >= -90
    && point[1] <= 90;
}

function isPointInBBox(point: [number, number], bbox: F3BBox) {
  return point[0] >= bbox.minLon && point[0] <= bbox.maxLon && point[1] >= bbox.minLat && point[1] <= bbox.maxLat;
}

function normalizeRawPoints(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!Array.isArray(item) || item.length < 2) return null;
      const lng = Number(item[0]);
      const lat = Number(item[1]);
      return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] as [number, number] : null;
    })
    .filter((item): item is [number, number] => item != null);
}

function pointDistanceSquared(a: [number, number], b: [number, number]) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function areMapPointsVisuallyClose(map: any, a: [number, number], b: [number, number]) {
  try {
    const pointA = readPixelLike(map?.lngLatToContainer?.(a));
    const pointB = readPixelLike(map?.lngLatToContainer?.(b));
    if (pointA && pointB) {
      const dx = pointA[0] - pointB[0];
      const dy = pointA[1] - pointB[1];
      return Math.sqrt(dx * dx + dy * dy) < 28;
    }
  } catch {
    // Fall back to coordinate distance when the map SDK cannot project yet.
  }
  return pointDistanceSquared(a, b) < 0.00006 ** 2;
}

function endpointMarkerContent(label: 'S' | 'E', color: string) {
  return `<div style="position:relative;width:22px;height:24px;pointer-events:none;">
    <div style="position:absolute;left:1px;top:0;width:20px;height:20px;display:grid;place-items:center;border-radius:9999px;background:${color};border:2px solid #fff;color:#fff;font:700 10px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 0 0 2px rgba(15,23,42,.55),0 0 14px ${color};">${label}</div>
    <div style="position:absolute;left:9px;top:19px;width:4px;height:4px;border-radius:9999px;background:${color};border:1px solid #fff;"></div>
  </div>`;
}

function alignLineDirectionToRaw(matched: Array<[number, number]>, raw: Array<[number, number]>) {
  if (matched.length < 2 || raw.length < 2) return matched;
  const rawStart = raw[0];
  const rawEnd = raw[raw.length - 1];
  const matchedStart = matched[0];
  const matchedEnd = matched[matched.length - 1];
  const forwardScore = pointDistanceSquared(matchedStart, rawStart) + pointDistanceSquared(matchedEnd, rawEnd);
  const reverseScore = pointDistanceSquared(matchedEnd, rawStart) + pointDistanceSquared(matchedStart, rawEnd);
  return reverseScore < forwardScore ? [...matched].reverse() : matched;
}

function nearestLinePointIndex(line: Array<[number, number]>, point: [number, number]) {
  let index = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  line.forEach((candidate, candidateIndex) => {
    const distance = pointDistanceSquared(candidate, point);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      index = candidateIndex;
    }
  });
  return index;
}

function matchedPlaybackLine(matched: Array<[number, number]>, raw: Array<[number, number]>) {
  if (matched.length < 2 || raw.length < 2) return matched;
  const startIndex = nearestLinePointIndex(matched, raw[0]);
  const endIndex = nearestLinePointIndex(matched, raw[raw.length - 1]);
  if (startIndex === endIndex) return alignLineDirectionToRaw(matched, raw);
  const ordered = startIndex < endIndex
    ? matched.slice(startIndex, endIndex + 1)
    : matched.slice(endIndex, startIndex + 1).reverse();
  return ordered.length >= 2 ? ordered : alignLineDirectionToRaw(matched, raw);
}

function getPartialPathByRatio(path: Array<[number, number]>, lengths: number[], ratio: number) {
  if (path.length < 2) return path;
  const point = getPointOnPath(path, lengths, ratio);
  const total = lengths[lengths.length - 1] || 0;
  if (total <= 0) return [path[0], point];
  const target = total * Math.max(0, Math.min(1, ratio));
  let endIndex = 1;
  while (endIndex < lengths.length && lengths[endIndex] < target) endIndex += 1;
  const visible = path.slice(0, Math.max(1, endIndex));
  visible.push(point);
  return visible;
}

function baseTripId(value: unknown) {
  return String(value ?? '').split('_s', 1)[0] || String(value ?? '');
}

function buildCompactPageItems(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const items: Array<number | 'ellipsis'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) items.push('ellipsis');
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < total - 1) items.push('ellipsis');
  items.push(total);
  return items;
}

function hashColor(key: string): string {
  const palette = [
    '#22d3ee',
    '#facc15',
    '#fb7185',
    '#34d399',
    '#a78bfa',
    '#fb923c',
    '#60a5fa',
    '#f472b6',
    '#bef264',
    '#2dd4bf',
  ];
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function formatTripClock(value?: string | null) {
  return value ? value.slice(11, 19) : '--:--:--';
}

function formatTripDateTime(value?: string | null) {
  return value ? value.replace('T', ' ').slice(5, 19) : '--';
}

function formatTripDuration(start?: string | null, end?: string | null) {
  if (!start || !end) return '--';
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatDensity(value: number) {
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatElapsedMs(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '--';
  if (Number(value) < 1000) return `${Math.round(Number(value))} ms`;
  return `${(Number(value) / 1000).toFixed(Number(value) >= 10000 ? 1 : 2)} s`;
}

function formatRunningElapsed(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '--';
  const seconds = Math.max(0, Math.floor(Number(value) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return restSeconds ? `${minutes}m${restSeconds}s` : `${minutes}m`;
}

function formatRunningEstimate(estimateMs: number | null | undefined, elapsedMs: number | null | undefined) {
  if (estimateMs == null || !Number.isFinite(Number(estimateMs))) {
    return '预计: 暂无历史';
  }
  const estimate = Math.max(0, Number(estimateMs));
  const elapsed = Math.max(0, Number(elapsedMs ?? 0));
  const delta = estimate - elapsed;
  if (delta > 1500) {
    return `预计总 ${formatRunningElapsed(estimate)} · 剩余约 ${formatRunningElapsed(delta)}`;
  }
  if (delta >= -1500) {
    return `预计总 ${formatRunningElapsed(estimate)} · 接近完成`;
  }
  return `预计总 ${formatRunningElapsed(estimate)} · 已超出 ${formatRunningElapsed(Math.abs(delta))}`;
}

function getCellAreaKm2(bounds: [number, number, number, number]): number {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const sw: [number, number] = [minLon, minLat];
  const se: [number, number] = [maxLon, minLat];
  const nw: [number, number] = [minLon, maxLat];
  const widthM = distanceMeters(sw, se);
  const heightM = distanceMeters(sw, nw);
  return Math.max(1e-8, (widthM * heightM) / 1_000_000);
}

function distanceMeters(a: [number, number], b: [number, number]) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusM = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function lerpColor(from: string, to: string, ratio: number) {
  const clamp = Math.max(0, Math.min(1, ratio));
  const parse = (hex: string) => {
    const normalized = hex.replace('#', '');
    return [
      Number.parseInt(normalized.slice(0, 2), 16),
      Number.parseInt(normalized.slice(2, 4), 16),
      Number.parseInt(normalized.slice(4, 6), 16),
    ];
  };
  const [fr, fg, fb] = parse(from);
  const [tr, tg, tb] = parse(to);
  const value = [fr + (tr - fr) * clamp, fg + (tg - fg) * clamp, fb + (tb - fb) * clamp]
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('');
  return `#${value}`;
}

function steppedColor(stops: string[], ratio: number) {
  if (stops.length <= 1) return stops[0] ?? '#2563eb';
  const clamped = Math.max(0, Math.min(1, ratio));
  const scaled = clamped * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  return lerpColor(stops[idx], stops[idx + 1], scaled - idx);
}

function formatDurationMinutes(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '--';
  const minutes = Math.max(0, Number(value));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = Math.round(minutes - hours * 60);
  return restMinutes <= 0 ? `${hours}h` : `${hours}h${restMinutes}m`;
}

function formatLengthMeters(value: number | null | undefined) {
  const meters = Number(value ?? 0);
  if (!Number.isFinite(meters) || meters <= 0) return '--';
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatRatioPercent(value: number | null | undefined, digits = 0) {
  return `${(Number(value ?? 0) * 100).toFixed(digits)}%`;
}

function recommendF8MinSupport(range: [number, number]) {
  const hours = Math.max(0, ((range[1] - range[0]) / 100) * 168);
  if (hours <= 2) return 1;
  if (hours <= 12) return 2;
  if (hours <= 24) return 3;
  if (hours <= 72) return 4;
  return 5;
}


function getBBoxCenter(bbox: F5BBox): [number, number] {
  return [(bbox.minLon + bbox.maxLon) / 2, (bbox.minLat + bbox.maxLat) / 2];
}

function offsetLineByMeters(line: Array<[number, number]>, offsetMeters: number): Array<[number, number]> {
  if (!line.length || Math.abs(offsetMeters) < 0.01) return line;
  const first = line[0];
  const last = line[line.length - 1] ?? first;
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 1e-9) return line;
  const nx = -dy / length;
  const ny = dx / length;
  const midLat = line.reduce((sum, point) => sum + point[1], 0) / line.length;
  const safeCos = Math.max(0.01, Math.abs(Math.cos((midLat * Math.PI) / 180)));
  const deltaLat = (offsetMeters * ny) / 110540;
  const deltaLon = (offsetMeters * nx) / (111320 * safeCos);
  return line.map(([lng, lat]) => [lng + deltaLon, lat + deltaLat]);
}

function getF7SegmentColor(ratio: number): string {
  const value = Math.max(0, Math.min(1, ratio));
  if (value >= 0.92) return '#fff7ed';
  if (value >= 0.78) return '#fb923c';
  if (value >= 0.55) return '#ef4444';
  if (value >= 0.30) return '#991b1b';
  return '#3f0b1b';
}

function getF7SegmentBandWidth(ratio: number): number {
  const value = Math.max(0, Math.min(1, ratio));
  return Math.max(3, Math.min(8, 2.6 + Math.pow(value, 0.62) * 5.8));
}

function getF7PathKey(path: F7FrequentPath): string {
  const componentId = path.corridor_component_id ?? path.component_id ?? 0;
  return `${path.road_group_key}::${path.direction_value}::${componentId}`;
}

function getF7DirectionMarker(path: F7FrequentPath): string {
  if (!path.direction_supported || path.direction_value === 0) return '<->';
  return path.direction_value > 0 ? '>' : '<';
}

type LineGeometryLike = {
  type?: 'LineString' | 'MultiLineString';
  coordinates?: unknown;
} | null | undefined;

function extractLineStringsFromGeometry(geometry: LineGeometryLike): Array<Array<[number, number]>> {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === 'LineString') {
    const line = geometry.coordinates.filter(isValidGeoPoint).map((point) => [Number(point[0]), Number(point[1])] as [number, number]);
    return line.length >= 2 ? [line] : [];
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates
      .filter((line): line is unknown[] => Array.isArray(line))
      .map((line) => (line as unknown[])
        .filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
        .map((point) => [Number(point[0]), Number(point[1])] as [number, number]))
      .filter((line) => line.length >= 2);
  }
  return [];
}

function stitchLinesToContinuousChain(lines: Array<Array<[number, number]>>): Array<[number, number]> {
  if (!lines.length) return [];
  let chain = [...lines.reduce((best, line) => (distanceMeters(line[0], line[line.length - 1]) > distanceMeters(best[0], best[best.length - 1]) ? line : best), lines[0])];
  const remaining = lines.filter((line) => line !== chain);
  while (remaining.length) {
    let bestIdx = 0;
    let bestMode: 'append_forward' | 'append_reverse' | 'prepend_forward' | 'prepend_reverse' = 'append_forward';
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((line, idx) => {
      const candidates: Array<[number, typeof bestMode]> = [
        [distanceMeters(chain[chain.length - 1], line[0]), 'append_forward'],
        [distanceMeters(chain[chain.length - 1], line[line.length - 1]), 'append_reverse'],
        [distanceMeters(chain[0], line[line.length - 1]), 'prepend_forward'],
        [distanceMeters(chain[0], line[0]), 'prepend_reverse'],
      ];
      const [distance, mode] = candidates.reduce((best, item) => (item[0] < best[0] ? item : best), candidates[0]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIdx = idx;
        bestMode = mode;
      }
    });
    const picked = remaining.splice(bestIdx, 1)[0];
    if (bestMode === 'append_forward') chain = [...chain, ...picked.slice(1)];
    else if (bestMode === 'append_reverse') chain = [...chain, ...[...picked].reverse().slice(1)];
    else if (bestMode === 'prepend_forward') chain = [...picked.slice(0, -1), ...chain];
    else chain = [...[...picked].reverse().slice(0, -1), ...chain];
  }
  return chain;
}

function expandBBoxByKm(bbox: F5BBox, radiusKm: number): F5BBox {
  const center = getBBoxCenter(bbox);
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.max(0.18, Math.cos((center[1] * Math.PI) / 180)));
  return {
    minLon: Math.max(BEIJING_CORE_BBOX.minLon, bbox.minLon - lonDelta),
    minLat: Math.max(BEIJING_CORE_BBOX.minLat, bbox.minLat - latDelta),
    maxLon: Math.min(BEIJING_CORE_BBOX.maxLon, bbox.maxLon + lonDelta),
    maxLat: Math.min(BEIJING_CORE_BBOX.maxLat, bbox.maxLat + latDelta),
  };
}

function getBezierPoint(start: [number, number], control: [number, number], end: [number, number], t: number): [number, number] {
  const oneMinusT = 1 - t;
  return [
    oneMinusT * oneMinusT * start[0] + 2 * oneMinusT * t * control[0] + t * t * end[0],
    oneMinusT * oneMinusT * start[1] + 2 * oneMinusT * t * control[1] + t * t * end[1],
  ];
}

function buildBezierCurvePoints(start: [number, number], control: [number, number], end: [number, number], samples = 52) {
  return Array.from({ length: samples + 1 }, (_, index) => getBezierPoint(start, control, end, index / samples));
}

function getPathLengths(points: Array<[number, number]>) {
  const lengths = [0];
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    sum += Math.sqrt((points[i][0] - points[i - 1][0]) ** 2 + (points[i][1] - points[i - 1][1]) ** 2);
    lengths.push(sum);
  }
  return lengths;
}

function getPointOnPath(points: Array<[number, number]>, lengths: number[], ratio: number): [number, number] {
  if (points.length <= 1) return points[0] ?? [0, 0];
  const total = lengths[lengths.length - 1];
  if (total <= 0) return points[0];
  const target = Math.max(0, Math.min(total, total * ratio));
  let idx = 1;
  while (idx < lengths.length && lengths[idx] < target) idx += 1;
  const i = Math.max(1, Math.min(lengths.length - 1, idx));
  const startLen = lengths[i - 1];
  const endLen = lengths[i];
  const localRatio = endLen - startLen > 1e-9 ? (target - startLen) / (endLen - startLen) : 0;
  const a = points[i - 1];
  const b = points[i];
  return [a[0] + (b[0] - a[0]) * localRatio, a[1] + (b[1] - a[1]) * localRatio];
}

function metersToLngLatDelta(base: [number, number], dxMeters: number, dyMeters: number): [number, number] {
  const safeCos = Math.max(0.01, Math.abs(Math.cos((base[1] * Math.PI) / 180)));
  return [dxMeters / (111320 * safeCos), dyMeters / 110540];
}

function buildDirectionArrowSegments(line: Array<[number, number]>, count: number, sizeMeters: number): Array<Array<[number, number]>> {
  if (line.length < 2 || count <= 0) return [];
  const lengths = getPathLengths(line);
  const segments: Array<Array<[number, number]>> = [];
  const total = lengths[lengths.length - 1] || 0;
  if (total <= 0) return [];

  for (let i = 0; i < count; i += 1) {
    const ratio = count === 1 ? 0.82 : 0.42 + (i / Math.max(1, count - 1)) * 0.42;
    const tip = getPointOnPath(line, lengths, ratio);
    const before = getPointOnPath(line, lengths, Math.max(0, ratio - 0.018));
    const midLat = tip[1];
    const safeCos = Math.max(0.01, Math.abs(Math.cos((midLat * Math.PI) / 180)));
    const dxMeters = (tip[0] - before[0]) * 111320 * safeCos;
    const dyMeters = (tip[1] - before[1]) * 110540;
    const normMeters = Math.hypot(dxMeters, dyMeters);
    if (normMeters <= 1e-6) continue;

    const ux = dxMeters / normMeters;
    const uy = dyMeters / normMeters;
    const px = -uy;
    const py = ux;
    const backMeters = sizeMeters;
    const wingMeters = sizeMeters * 0.42;
    const leftDelta = metersToLngLatDelta(tip, -ux * backMeters + px * wingMeters, -uy * backMeters + py * wingMeters);
    const rightDelta = metersToLngLatDelta(tip, -ux * backMeters - px * wingMeters, -uy * backMeters - py * wingMeters);
    const left: [number, number] = [tip[0] + leftDelta[0], tip[1] + leftDelta[1]];
    const right: [number, number] = [tip[0] + rightDelta[0], tip[1] + rightDelta[1]];
    segments.push([left, tip, right]);
  }
  return segments;
}

function getF7DirectionColor(direction: F7FrequentPath['direction']): { main: string; glow: string; cap: string } {
  if (direction === 'reverse') return { main: '#f59e0b', glow: '#fde68a', cap: '#fffbeb' };
  if (direction === 'forward') return { main: '#e11d48', glow: '#fecdd3', cap: '#fff1f2' };
  return { main: '#0ea5e9', glow: '#bae6fd', cap: '#f0f9ff' };
}

function computeJenksBreaks(valuesAsc: number[], classes: number): number[] {
  const n = valuesAsc.length;
  if (!n || classes < 2 || n < classes) return [];
  const lower = Array.from({ length: n + 1 }, () => Array(classes + 1).fill(0));
  const variances = Array.from({ length: n + 1 }, () => Array(classes + 1).fill(Number.POSITIVE_INFINITY));

  for (let i = 1; i <= classes; i += 1) {
    lower[1][i] = 1;
    variances[1][i] = 0;
  }

  for (let l = 2; l <= n; l += 1) {
    let s1 = 0;
    let s2 = 0;
    let w = 0;
    for (let m = 1; m <= l; m += 1) {
      const i3 = l - m + 1;
      const val = valuesAsc[i3 - 1];
      s1 += val;
      s2 += val * val;
      w += 1;
      const variance = s2 - ((s1 * s1) / w);
      if (i3 !== 1) {
        for (let j = 2; j <= classes; j += 1) {
          const candidate = variance + variances[i3 - 1][j - 1];
          if (candidate < variances[l][j]) {
            lower[l][j] = i3;
            variances[l][j] = candidate;
          }
        }
      }
    }
    lower[l][1] = 1;
    variances[l][1] = 0;
  }

  const breaks = Array(classes + 1).fill(0);
  breaks[0] = valuesAsc[0];
  breaks[classes] = valuesAsc[n - 1];
  let k = n;
  let count = classes;
  while (count > 1) {
    const id = lower[k][count];
    const index = Math.max(0, id - 2);
    breaks[count - 1] = valuesAsc[index];
    k = Math.max(1, id - 1);
    count -= 1;
  }
  return breaks;
}

function buildF4Levels(values: number[], method: F4ClassifyMethod): Array<{ label: string; color: string; min: number; max: number }> {
  const asc = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!asc.length) return F4_CHOROPLETH_LEVELS.map((item) => ({ ...item, min: 0, max: 0 }));
  const classes = 5;
  const min = asc[0];
  const max = asc[asc.length - 1];

  let breaks: number[] = [];
  if (method === 'equal') {
    const step = (max - min) / classes;
    breaks = [min];
    for (let i = 1; i < classes; i += 1) breaks.push(min + step * i);
    breaks.push(max);
  } else if (method === 'jenks') {
    breaks = computeJenksBreaks(asc, classes);
  } else {
    breaks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((q) => {
      const idx = Math.max(0, Math.min(asc.length - 1, Math.floor((asc.length - 1) * q)));
      return asc[idx];
    });
  }

  if (!breaks.length || breaks.length !== classes + 1) {
    breaks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((q) => {
      const idx = Math.max(0, Math.min(asc.length - 1, Math.floor((asc.length - 1) * q)));
      return asc[idx];
    });
  }

  const rangesAsc = Array.from({ length: classes }, (_, index) => ({
    min: index === 0 ? breaks[0] : breaks[index],
    max: index === classes - 1 ? breaks[classes] : breaks[index + 1],
  }));

  return [
    { ...F4_CHOROPLETH_LEVELS[0], min: rangesAsc[4].min, max: rangesAsc[4].max },
    { ...F4_CHOROPLETH_LEVELS[1], min: rangesAsc[3].min, max: rangesAsc[3].max },
    { ...F4_CHOROPLETH_LEVELS[2], min: rangesAsc[2].min, max: rangesAsc[2].max },
    { ...F4_CHOROPLETH_LEVELS[3], min: rangesAsc[1].min, max: rangesAsc[1].max },
    { ...F4_CHOROPLETH_LEVELS[4], min: rangesAsc[0].min, max: rangesAsc[0].max },
  ];
}

function getF4LevelByDensity(levels: Array<{ min: number; max: number }>, density: number) {
  for (let i = 0; i < levels.length; i += 1) {
    if (density >= levels[i].min && density <= levels[i].max) return i;
  }
  if (!levels.length) return 0;
  if (density > levels[0].max) return 0;
  return levels.length - 1;
}

function calcDynamicHeatRadiusPx(map: any, meterRadius: number) {
  const zoom = Number(map?.getZoom?.() ?? 10);
  const base = Math.max(16, Math.min(96, meterRadius / 10));
  const zoomScale = Math.max(0.72, Math.min(1.26, 1 + (zoom - 11) * 0.06));
  return Math.round(base * zoomScale);
}

function buildHeatViewportProfile(values: number[]) {
  const asc = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!asc.length) {
    return {
      clippedMax: 1,
      gradient: {
        0.0: 'rgba(0,0,0,0)',
        0.2: 'rgba(56,189,248,0.14)',
        0.48: 'rgba(96,165,250,0.18)',
        0.74: 'rgba(132,204,22,0.24)',
        0.92: 'rgba(250,204,21,0.3)',
        1.0: 'rgba(249,115,22,0.38)',
      },
      ranges: [] as Array<{ label: string; min: number; max: number; color: string }>,
      gradientCss: 'linear-gradient(90deg, rgba(0,0,0,0), #38bdf8 20%, #60a5fa 48%, #84cc16 74%, #facc15 92%, #f97316 100%)',
    };
  }

  const pick = (q: number) => {
    const idx = Math.max(0, Math.min(asc.length - 1, Math.floor((asc.length - 1) * q)));
    return asc[idx];
  };
  const q40 = pick(0.4);
  const q60 = pick(0.6);
  const q80 = pick(0.8);
  const q95 = pick(0.95);
  const clippedMax = Math.max(1, q95);
  const s40 = Math.max(0.08, Math.min(0.55, q40 / clippedMax));
  const s60 = Math.max(s40 + 0.06, Math.min(0.78, q60 / clippedMax));
  const s80 = Math.max(s60 + 0.06, Math.min(0.92, q80 / clippedMax));

  return {
    clippedMax,
    gradient: {
      0.0: 'rgba(0,0,0,0)',
      [s40]: 'rgba(56,189,248,0.16)',
      [s60]: 'rgba(96,165,250,0.22)',
      [s80]: 'rgba(132,204,22,0.28)',
      0.94: 'rgba(250,204,21,0.34)',
      1.0: 'rgba(249,115,22,0.42)',
    },
    ranges: [
      { label: '极高 (Top 20%)', min: q80, max: clippedMax, color: '#f97316' },
      { label: '较高 (20%-40%)', min: q60, max: q80, color: '#facc15' },
      { label: '中等 (40%-60%)', min: q40, max: q60, color: '#84cc16' },
      { label: '低 (0%-40%)', min: asc[0], max: q40, color: '#38bdf8' },
    ],
    gradientCss: `linear-gradient(90deg, rgba(0,0,0,0) 0%, #38bdf8 ${Math.round(s40 * 100)}%, #60a5fa ${Math.round(s60 * 100)}%, #84cc16 ${Math.round(s80 * 100)}%, #f97316 100%)`,
  };
}

function getBoundsFromF4Cells(cells: F4GridCell[]) {
  if (!cells.length) return null;
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  cells.forEach((cell) => {
    const [cellMinLon, cellMinLat, cellMaxLon, cellMaxLat] = cell.bounds;
    minLon = Math.min(minLon, cellMinLon);
    minLat = Math.min(minLat, cellMinLat);
    maxLon = Math.max(maxLon, cellMaxLon);
    maxLat = Math.max(maxLat, cellMaxLat);
  });
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

export default function GeoSpatialWorkbench() {
  const { amap, sdkStatus, sdkError } = useAmapSdk();
  const mapContainerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any | null>(null);
  const mouseToolRef = React.useRef<any | null>(null);
  const f4WorkerRef = React.useRef<Worker | null>(null);
  const f4WorkerRequestIdRef = React.useRef(0);
  const f4WorkerPendingRef = React.useRef(new globalThis.Map<number, { resolve: (cells: F4GridCell[]) => void; reject: (error: Error) => void }>());
  const trajectoryOverlaysRef = React.useRef<any[]>([]);
  const f4OverlaysRef = React.useRef<any[]>([]);
  const f4HeatmapRef = React.useRef<any | null>(null);
  const f4HeatmapDataRef = React.useRef<Array<{ lng: number; lat: number; count: number; rawDensity: number }>>([]);
  const f4ChoroplethEntriesRef = React.useRef<Array<{ polygon: any; levelLabel: string; baseOpacity: number }>>([]);
  const f4CellsRef = React.useRef<F4GridCell[]>([]);
  const f4BaseDataRef = React.useRef<F4H3BaseData | null>(null);
  const f4BaseCacheKeyRef = React.useRef<string | null>(null);
  const f4BaseDataCacheRef = React.useRef<globalThis.Map<string, F4H3BaseData>>(new globalThis.Map());
  const f4AggregationCacheRef = React.useRef<globalThis.Map<string, F4GridCell[]>>(new globalThis.Map());
  const f4GridDensityCacheRef = React.useRef<globalThis.Map<string, F4GridDensityCacheEntry>>(new globalThis.Map());
  const f4SnapshotBBoxOverlayRef = React.useRef<any | null>(null);
  const f4HighlightOverlayRef = React.useRef<any | null>(null);
  const f4HoverInfoWindowRef = React.useRef<any | null>(null);
  const f4HoveredPolygonRef = React.useRef<any | null>(null);
  const f3DrawHandlerRef = React.useRef<((evt: unknown) => void) | null>(null);
  const f3BBoxPayloadsRef = React.useRef<F3BBox[]>([]);
  const f3BBoxOverlaysRef = React.useRef<any[]>([]);
  const f3MatchedTripIdsByTaxiRef = React.useRef<globalThis.Map<number, Set<string>>>(new globalThis.Map());
  const f3OverlayRequestIdRef = React.useRef(0);
  const f5DrawHandlerRef = React.useRef<((evt: unknown) => void) | null>(null);
  const f5AreaPayloadRef = React.useRef<Record<'A' | 'B', F5BBox | null>>({ A: null, B: null });
  const f5AreaOverlayRef = React.useRef<Record<'A' | 'B', any | null>>({ A: null, B: null });
  const f5AreaLabelRef = React.useRef<Record<'A' | 'B', any | null>>({ A: null, B: null });
  const f5FlowOverlaysRef = React.useRef<any[]>([]);
  const f5PulseRef = React.useRef<{ rafId: number | null; entries: Array<{ marker: any; points: Array<[number, number]>; lengths: number[]; durationMs: number; phaseMs: number }> }>({
    rafId: null,
    entries: [],
  });
  const f6DrawHandlerRef = React.useRef<((evt: unknown) => void) | null>(null);
  const f6CoreAreaRef = React.useRef<F5BBox | null>(null);
  const f6CoreOverlayRef = React.useRef<any | null>(null);
  const f6FlowOverlaysRef = React.useRef<any[]>([]);
  const f6RegionOverlayGroupsRef = React.useRef<Record<string, F6OverlayEntry[]>>({});
  const f6TooltipRef = React.useRef<any | null>(null);
  const f6PulseRef = React.useRef<{ rafId: number | null; entries: Array<{ marker: any; points: Array<[number, number]>; lengths: number[]; durationMs: number; phaseMs: number }> }>({
    rafId: null,
    entries: [],
  });
  const f7PathOverlaysRef = React.useRef<any[]>([]);
  const f7HoverArrowOverlaysRef = React.useRef<any[]>([]);
  const f7HoverArrowSpecsRef = React.useRef<Record<string, Array<{ line: Array<[number, number]>; color: string; width: number; balanced: boolean }>>>({});
  const f7DetailOverlaysRef = React.useRef<any[]>([]);
  const f7PathOverlayGroupsRef = React.useRef<Record<string, F7OverlayEntry[]>>({});
  const f7ViewportOverlayRef = React.useRef<any | null>(null);
  const f7AnalysisBBoxRef = React.useRef<F5BBox | null>(null);
  const f7DetailOverlayGroupsRef = React.useRef<Record<string, F7OverlayEntry[]>>({});
  const f7TooltipRef = React.useRef<any | null>(null);
  const f8RouteOverlaysRef = React.useRef<any[]>([]);
  const f8RouteOverlayGroupsRef = React.useRef<Record<string, F7OverlayEntry[]>>({});
  const f8TooltipRef = React.useRef<any | null>(null);
  const f8RouteAnimationRef = React.useRef<{ rafId: number | null; routeKey: string | null }>({ rafId: null, routeKey: null });
  const f8PinnedRouteKeyRef = React.useRef<string | null>(null);
  const f8RequestIdRef = React.useRef(0);
  const decisionOverlaysRef = React.useRef<any[]>([]);
  const decisionTooltipRef = React.useRef<any | null>(null);
  const trajectoryOverlayGroupsRef = React.useRef<globalThis.Map<string, TrajectoryOverlayGroup>>(new globalThis.Map());
  const trajectoryFocusTimerRef = React.useRef<number | null>(null);
  const trajectoryPlaybackRef = React.useRef<{
    rafId: number | null;
    tripId: string | null;
    startedAt: number;
    elapsedMs: number;
    durationMs: number;
    fullPath: Array<[number, number]>;
    pathLengths: number[];
  }>({ rafId: null, tripId: null, startedAt: 0, elapsedMs: 0, durationMs: 0, fullPath: [], pathLengths: [] });
  const [mapReady, setMapReady] = React.useState(false);
  const [viewportRevision, setViewportRevision] = React.useState(0);
  const [mode, setMode] = React.useState<WorkbenchMode>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [queryTimeRange, setQueryTimeRange] = React.useState<[number, number]>([0, 100]);
  const [displayedTimeRange, setDisplayedTimeRange] = React.useState<[number, number]>([0, 100]);
  const [status, setStatus] = React.useState<ComputeStatus>('idle');
  const [runningTask, setRunningTask] = React.useState<RunningTaskState | null>(null);
  const [lastCompletedTask, setLastCompletedTask] = React.useState<CompletedTaskState | null>(null);
  const [statusNotice, setStatusNotice] = React.useState<StatusNoticeState | null>(null);
  const [runningNow, setRunningNow] = React.useState(() => performance.now());
  const taskDurationHistoryRef = React.useRef<Partial<Record<RunningTaskCode, number>>>({});
  const statusNoticeTimerRef = React.useRef<number | null>(null);
  const [brushMode, setBrushMode] = React.useState<BrushMode>('none');
  const [activeRegionTool, setActiveRegionTool] = React.useState<RegionTool | null>(null);
  const [regionParams, setRegionParams] = React.useState<RegionParams>(defaultRegionParams);
  const [appliedRegionParams, setAppliedRegionParams] = React.useState<RegionParams>(defaultRegionParams);
  const detailOpen = false;
  const setDetailOpen = React.useCallback((_next: boolean) => undefined, []);
  const [activeVehicles, setActiveVehicles] = React.useState(0);
  const [f3Loading, setF3Loading] = React.useState(false);
  const [f3Drawing, setF3Drawing] = React.useState(false);
  const [f3Rows, setF3Rows] = React.useState<F3UnionDetailRow[]>([]);
  const [f3BoxSummaries, setF3BoxSummaries] = React.useState<F3BoxSummary[]>([]);
  const [f3ResultHint, setF3ResultHint] = React.useState('');
  const [f3SelectedTaxiId, setF3SelectedTaxiId] = React.useState<number | null>(null);
  const [f3DetailsExpanded, setF3DetailsExpanded] = React.useState(false);
  const [f3Page, setF3Page] = React.useState(1);
  const [f3JumpPage, setF3JumpPage] = React.useState('1');
  const [f3ShowOnlyInBBox, setF3ShowOnlyInBBox] = React.useState(true);
  const [f4TopCells, setF4TopCells] = React.useState<F4GridCell[]>([]);
  const [f4GridSize, setF4GridSize] = React.useState(500);
  const [f4RenderMode, setF4RenderMode] = React.useState<F4RenderMode>('heatmap');
  const [f4ClassifyMethod, setF4ClassifyMethod] = React.useState<F4ClassifyMethod>('quantile');
  const [f4LegendMeta, setF4LegendMeta] = React.useState<F4LegendMeta | null>(null);
  const [f4LegendDismissed, setF4LegendDismissed] = React.useState(false);
  const [f4Feedback, setF4Feedback] = React.useState<{ tone: 'info' | 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [f4LegendFilter, setF4LegendFilter] = React.useState<string | null>(null);
  const [f4LastElapsedMs, setF4LastElapsedMs] = React.useState<number | null>(null);
  const [f4LastEstimatedCells, setF4LastEstimatedCells] = React.useState<number | null>(null);
  const [f4LastDataSource, setF4LastDataSource] = React.useState<'cache' | 'live' | null>(null);
  const [f4PreviewGridCount, setF4PreviewGridCount] = React.useState<number | null>(null);
  const [f4BaseCellCount, setF4BaseCellCount] = React.useState<number | null>(null);
  const [f4GeneralizationUnlocked, setF4GeneralizationUnlocked] = React.useState(false);
  const [f4Generalizing, setF4Generalizing] = React.useState(false);
  const [f4Generating, setF4Generating] = React.useState(false);
  const [f4PanelsOpen, setF4PanelsOpen] = React.useState({ hotspots: false, details: false });
  const f4LastRenderedResolutionRef = React.useRef<number | null>(null);
  const f4RequestIdRef = React.useRef(0);
  const [f5DrawingTarget, setF5DrawingTarget] = React.useState<'A' | 'B' | null>(null);
  const [odGranularity, setOdGranularity] = React.useState<'hour' | 'day'>('hour');
  const [f5BufferMeters, setF5BufferMeters] = React.useState(30);
  const [f5MaxTransitionMinutes, setF5MaxTransitionMinutes] = React.useState(30);
  const [f5ThresholdRecommendation, setF5ThresholdRecommendation] = React.useState<F5ThresholdRecommendationResponse | null>(null);
  const [f5Result, setF5Result] = React.useState<F5ABFlowResponse | null>(null);
  const [f5DetailsExpanded, setF5DetailsExpanded] = React.useState(false);
  const [f6Direction, setF6Direction] = React.useState<F6Direction>('outbound');
  const [f6AnalysisMode, setF6AnalysisMode] = React.useState<F6AnalysisMode>('strict_od');
  const [f6Drawing, setF6Drawing] = React.useState(false);
  const [f6H3Resolution, setF6H3Resolution] = React.useState(8);
  const [f6TopK, setF6TopK] = React.useState(30);
  const [f6BufferMeters, setF6BufferMeters] = React.useState(30);
  const [f6StrictMaxTripMinutes, setF6StrictMaxTripMinutes] = React.useState(60);
  const [f6DetailsExpanded, setF6DetailsExpanded] = React.useState(false);
  const [f6Result, setF6Result] = React.useState<F6RadiationResponse | null>(null);
  const [f7DecisionLoading, setF7DecisionLoading] = React.useState(false);
  const [f7DetailLoading, setF7DetailLoading] = React.useState(false);
  const [f8DecisionLoading, setF8DecisionLoading] = React.useState(false);
  const [f7TopK, setF7TopK] = React.useState(30);
  const [f7MinLengthMeters, setF7MinLengthMeters] = React.useState(600);
  const [f7Scope, setF7Scope] = React.useState<'bbox' | 'citywide'>('bbox');
  const [f7SortMode, setF7SortMode] = React.useState<'frequency' | 'length_weighted'>('frequency');
  const [f8TopK, setF8TopK] = React.useState(6);
  const [f8CandidateMode, setF8CandidateMode] = React.useState<'strict_od' | 'pass_through'>('pass_through');
  const [f7Result, setF7Result] = React.useState<F7FrequentPathsResponse | null>(null);
  const [f7RoadDetail, setF7RoadDetail] = React.useState<F7RoadDetailResponse | null>(null);
  const [f7ViewMode, setF7ViewMode] = React.useState<'overview' | 'detail'>('overview');
  const [f7SelectedPath, setF7SelectedPath] = React.useState<F7FrequentPath | null>(null);
  const [f7HoveredSegmentUid, setF7HoveredSegmentUid] = React.useState<number | null>(null);
  const [f7FocusedPathKey, setF7FocusedPathKey] = React.useState<string | null>(null);
  const [f8Result, setF8Result] = React.useState<F8FrequentRoutesResponse | null>(null);
  const [f8FocusedRouteKey, setF8FocusedRouteKey] = React.useState<string | null>(null);
  const [f8AnimatingRouteKey, setF8AnimatingRouteKey] = React.useState<string | null>(null);
  const [f8PinnedRouteKey, setF8PinnedRouteKey] = React.useState<string | null>(null);
  const [f8PinnedRouteOrder, setF8PinnedRouteOrder] = React.useState<number | null>(null);
  const [f8PinnedRouteSortMode, setF8PinnedRouteSortMode] = React.useState<'frequency' | 'p50' | 'avg' | null>(null);
  const [f8PinnedRouteItem, setF8PinnedRouteItem] = React.useState<F8Corridor | F8FrequentRoute | null>(null);
  const [f9RecommendedRouteKey, setF9RecommendedRouteKey] = React.useState<string | null>(null);
  const [decisionMapLayer, setDecisionMapLayer] = React.useState<'f7-overview' | 'f7-detail' | 'f8' | 'f9' | null>(null);
  const [mapStyleKey, setMapStyleKey] = React.useState<MapStyleKey>('darkblue');
  const [stylePickerOpen, setStylePickerOpen] = React.useState(false);
  const [assistantOpen, setAssistantOpen] = React.useState(false);
  const [demoReadonly, setDemoReadonly] = React.useState(true);
  const [targetTaxiId, setTargetTaxiId] = React.useState('');
  const [trajectoryTarget, setTrajectoryTarget] = React.useState('');

  const toggleF4Panel = React.useCallback((key: 'hotspots' | 'details') => {
    setF4PanelsOpen((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  const setF4MapInteractionEnabled = React.useCallback((enabled: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    try {
      if (typeof map.setStatus === 'function') {
        map.setStatus({
          dragEnable: enabled,
          zoomEnable: enabled,
          doubleClickZoom: enabled,
          scrollWheel: enabled,
          keyboardEnable: enabled,
          touchZoom: enabled,
        });
      }
    } catch {
      // Some AMap wrappers throw internally when reading map status before full readiness.
      // F4 should remain usable even if temporary interaction locking is unavailable.
    }
  }, []);

  React.useEffect(() => {
    const worker = new Worker(new URL('../workers/f4H3AggregationWorker.ts', import.meta.url), { type: 'module' });
    f4WorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent<F4WorkerResponse>) => {
      const payload = event.data;
      const pending = f4WorkerPendingRef.current.get(payload.requestId);
      if (!pending) return;
      f4WorkerPendingRef.current.delete(payload.requestId);
      if (payload.error) pending.reject(new Error(payload.error));
      else pending.resolve(payload.result ?? []);
    };
    worker.onerror = (event) => {
      const message = event.message || 'F4 H3 worker crashed';
      f4WorkerPendingRef.current.forEach((pending) => pending.reject(new Error(message)));
      f4WorkerPendingRef.current.clear();
    };
    return () => {
      worker.terminate();
      f4WorkerRef.current = null;
      f4WorkerPendingRef.current.clear();
    };
  }, []);

  React.useEffect(() => {
    if (!runningTask) return undefined;
    const timer = window.setInterval(() => setRunningNow(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [runningTask]);

  React.useEffect(() => () => {
    if (statusNoticeTimerRef.current != null) {
      window.clearTimeout(statusNoticeTimerRef.current);
    }
  }, []);

  const showValidationNotice = React.useCallback((text: string) => {
    if (statusNoticeTimerRef.current != null) {
      window.clearTimeout(statusNoticeTimerRef.current);
    }
    setStatusNotice({ tone: 'warning', text });
    statusNoticeTimerRef.current = window.setTimeout(() => {
      setStatusNotice(null);
      statusNoticeTimerRef.current = null;
    }, 5000);
  }, []);

  const runAssistantAction = React.useCallback((action: AssistantAction) => {
    if (action.type === 'zoom_in') {
      if (!mapRef.current?.zoomIn) {
        showValidationNotice('地图尚未初始化，暂时无法放大。');
        return;
      }
      mapRef.current.zoomIn();
      return;
    }

    if (action.type === 'zoom_out') {
      if (!mapRef.current?.zoomOut) {
        showValidationNotice('地图尚未初始化，暂时无法缩小。');
        return;
      }
      mapRef.current.zoomOut();
      return;
    }

    if (action.type === 'set_map_style') {
      const nextStyle = action.value as MapStyleKey | undefined;
      if (nextStyle === 'darkblue' || nextStyle === 'dark' || nextStyle === 'normal') {
        setMapStyleKey(nextStyle);
        setStylePickerOpen(false);
        return;
      }
      showValidationNotice('助手返回了暂不支持的底图样式。');
    }
  }, [showValidationNotice]);

  const beginRunningTask = React.useCallback((code: RunningTaskCode, label: string) => {
    const estimateMs = taskDurationHistoryRef.current[code] ?? null;
    setStatus('computing');
    setRunningNow(performance.now());
    setLastCompletedTask(null);
    setRunningTask({
      code,
      label,
      startedAt: performance.now(),
      estimateMs,
    });
  }, []);

  const finishRunningTask = React.useCallback((code: RunningTaskCode) => {
    setRunningTask((current) => {
      if (!current || current.code !== code) return current;
      const elapsedMs = Math.max(0, performance.now() - current.startedAt);
      const previousMs = taskDurationHistoryRef.current[code];
      taskDurationHistoryRef.current[code] = previousMs == null
        ? elapsedMs
        : Math.round((previousMs * 0.65) + (elapsedMs * 0.35));
      setLastCompletedTask({
        code: current.code,
        label: current.label,
        elapsedMs,
      });
      return null;
    });
  }, []);

  const aggregateF4H3Cells = React.useCallback((baseData: F4H3BaseData, gridSizeM: number) => {
    const worker = f4WorkerRef.current;
    if (!worker) return Promise.reject(new Error('F4 H3 worker 尚未初始化'));
    const requestId = ++f4WorkerRequestIdRef.current;
    return new Promise<F4GridCell[]>((resolve, reject) => {
      f4WorkerPendingRef.current.set(requestId, { resolve, reject });
      worker.postMessage({
        requestId,
        baseData,
        gridSizeM,
      });
    });
  }, []);

  const buildF4BaseCacheKey = React.useCallback((params: {
    startTime: string;
    endTime: string;
    baseResolution: number;
    bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  }) => JSON.stringify({
    start: params.startTime,
    end: params.endTime,
    baseResolution: params.baseResolution,
    bbox: [
      Number(params.bbox.minLon.toFixed(6)),
      Number(params.bbox.minLat.toFixed(6)),
      Number(params.bbox.maxLon.toFixed(6)),
      Number(params.bbox.maxLat.toFixed(6)),
    ],
  }), []);

  const buildF4AggregationCacheKey = React.useCallback((baseKey: string, gridSizeM: number) => (
    `${baseKey}::${gridSizeM}`
  ), []);

  const buildF4GridDensityCacheKey = React.useCallback((params: {
    startTime: string;
    endTime: string;
    gridSizeM: number;
    bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
    includeVehicleCount: boolean;
    maxCells: number;
  }) => JSON.stringify({
    start: params.startTime,
    end: params.endTime,
    gridSizeM: params.gridSizeM,
    bbox: [
      Number(params.bbox.minLon.toFixed(6)),
      Number(params.bbox.minLat.toFixed(6)),
      Number(params.bbox.maxLon.toFixed(6)),
      Number(params.bbox.maxLat.toFixed(6)),
    ],
    includeVehicleCount: params.includeVehicleCount,
    maxCells: params.maxCells,
  }), []);

  const f4ViewportBBox = React.useMemo(() => {
    const bounds = mapRef.current?.getBounds?.();
    const swPoint = bounds ? readLngLatLike(bounds.getSouthWest()) : null;
    const nePoint = bounds ? readLngLatLike(bounds.getNorthEast()) : null;
    if (!swPoint || !nePoint) return null;
    const swWgs = gcj02ToWgs84(swPoint[0], swPoint[1]);
    const neWgs = gcj02ToWgs84(nePoint[0], nePoint[1]);
    const bbox = {
      minLon: Math.min(swWgs[0], neWgs[0]),
      minLat: Math.min(swWgs[1], neWgs[1]),
      maxLon: Math.max(swWgs[0], neWgs[0]),
      maxLat: Math.max(swWgs[1], neWgs[1]),
    };
    return bbox;
  }, [displayedTimeRange, mode, status, viewportRevision]);

  const f4ViewportEstimate = React.useMemo(() => {
    if (!f4ViewportBBox) return null;
    const recommended = recommendF4GridSpec(f4ViewportBBox, f4RenderMode);
    return {
      bbox: f4ViewportBBox,
      recommendedLevel: recommended.label,
      recommendedGridSizeM: recommended.gridSizeM,
      estimatedCells: recommended.estimatedCells,
      lonSpan: f4ViewportBBox.maxLon - f4ViewportBBox.minLon,
      latSpan: f4ViewportBBox.maxLat - f4ViewportBBox.minLat,
    };
  }, [f4RenderMode, f4ViewportBBox]);

  React.useEffect(() => {
    const baseData = f4BaseDataRef.current;
    const baseKey = f4BaseCacheKeyRef.current;
    if (!baseData || !baseKey || mode !== 'region' || activeRegionTool !== 'f4') return;
    const aggregationKey = buildF4AggregationCacheKey(baseKey, f4GridSize);
    const cached = f4AggregationCacheRef.current.get(aggregationKey);
    if (cached) {
      setF4PreviewGridCount(cached.length);
      return;
    }
    let cancelled = false;
    aggregateF4H3Cells(baseData, f4GridSize)
      .then((cells) => {
        if (cancelled) return;
        f4AggregationCacheRef.current.set(aggregationKey, cells);
        setF4PreviewGridCount(cells.length);
      })
      .catch(() => {
        if (!cancelled) setF4PreviewGridCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeRegionTool, aggregateF4H3Cells, buildF4AggregationCacheKey, mode, f4GridSize]);

  const [selectedTripId, setSelectedTripId] = React.useState<string | null>(null);
  const [tripCards, setTripCards] = React.useState<TrajectoryTripCard[]>([]);
  const [showMatchedMode, setShowMatchedMode] = React.useState(true);
  const [useMapVMode, setUseMapVMode] = React.useState(true);
  const [showOtherTrips, setShowOtherTrips] = React.useState(false);
  const [playbackState, setPlaybackState] = React.useState<{ tripId: string | null; status: 'idle' | 'playing' | 'paused' }>({
    tripId: null,
    status: 'idle',
  });
  const [overviewStats, setOverviewStats] = React.useState<OverviewStats>({
    summary: null,
    activeVehicles: null,
    summaryLoaded: false,
    activeLoaded: false,
  });
  const [analysisResult, setAnalysisResult] = React.useState<AnalysisResult | null>(null);
  const timeDirty = !isSameTimeRange(queryTimeRange, displayedTimeRange);
  const regionParamDirty = JSON.stringify(regionParams) !== JSON.stringify(appliedRegionParams);
  const regionDirty = mode === 'region' && (timeDirty || regionParamDirty);
  const activeRegionEntry = regionToolEntries.find((entry) => entry.key === activeRegionTool) ?? null;
  const f3PageSize = 10;
  const f3PageCount = Math.max(1, Math.ceil(f3Rows.length / f3PageSize));
  const f3VisibleRows = f3Rows.slice((Math.min(f3Page, f3PageCount) - 1) * f3PageSize, Math.min(f3Page, f3PageCount) * f3PageSize);
  const f3PageItems = buildCompactPageItems(f3Page, f3PageCount);
  const f5Items = f5Result?.items ?? [];
  const f7Paths = f7Result?.paths ?? [];
  const f8Corridors = f8Result?.corridors ?? [];
  const f8Routes = f8Result?.routes ?? [];
  const f8Summary = f8Result?.summary;
  const f7Summary = f7Result?.summary;
  const f7DetailSegments = React.useMemo(() => {
    if (!f7RoadDetail?.segments?.length) return [];
    return [...f7RoadDetail.segments].sort((a, b) => {
      const aOrder = Number(a.profile_order ?? a.rank ?? 0);
      const bOrder = Number(b.profile_order ?? b.rank ?? 0);
      return aOrder - bOrder || Number(a.road_uid || 0) - Number(b.road_uid || 0);
    });
  }, [f7RoadDetail]);
  const maxF7PathCount = Math.max(1, ...(f7Paths.length ? f7Paths.map((path) => Number(path.trip_count || 0)) : [1]));
  const maxF8PathCount = Math.max(
    1,
    ...((f8Corridors.length ? f8Corridors.map((corridor) => Number(corridor.trip_count || 0)) : f8Routes.map((route) => Number(route.trip_count || 0))).length
      ? (f8Corridors.length ? f8Corridors.map((corridor) => Number(corridor.trip_count || 0)) : f8Routes.map((route) => Number(route.trip_count || 0)))
      : [1]),
  );
  const hasTrajectoryInput = targetTaxiId.trim().length > 0;
  const f5MaxBucketFlow = Math.max(1, ...f5Items.map((item) => Math.max(Number(item.a_to_b || 0), Number(item.b_to_a || 0))));
  const f6Summary = f6Result?.summary ?? null;
  const f6Regions = f6Result?.regions ?? [];
  const f6MaxOutbound = Math.max(1, ...f6Regions.map((region) => Number(region.outbound_total || 0)));
  const f6MaxInbound = Math.max(1, ...f6Regions.map((region) => Number(region.inbound_total || 0)));
  const f6TopKRatio = f6Result?.summary ? Math.round(Number(f6Result.summary.top_k_ratio || 0) * 100) : 0;
  const formatF5BucketLabel = React.useCallback((bucket: string) => (
    bucket.replace('T', ' ').slice(0, odGranularity === 'day' ? 10 : 16)
  ), [odGranularity]);
  const trajectorySelectionUiRef = React.useRef({ detailOpen, showOtherTrips, sidebarCollapsed, useMapVMode });

  React.useEffect(() => {
    trajectorySelectionUiRef.current = { detailOpen, showOtherTrips, sidebarCollapsed, useMapVMode };
  }, [detailOpen, showOtherTrips, sidebarCollapsed, useMapVMode]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      mapRef.current?.resize?.();
    }, 320);
    return () => window.clearTimeout(timer);
  }, [sidebarCollapsed]);

  React.useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    const nextCursor = f3Drawing || f5DrawingTarget || f6Drawing ? 'crosshair' : '';
    container.style.cursor = nextCursor;
    container.querySelectorAll<HTMLElement>('*').forEach((node) => {
      node.style.cursor = nextCursor;
    });
    mapRef.current?.setDefaultCursor?.(nextCursor || 'default');
  }, [f3Drawing, f5DrawingTarget, f6Drawing]);

  React.useEffect(() => {
    if (mode !== 'region' || activeRegionTool !== 'f5') {
      setF5DrawingTarget(null);
    }
    if (mode !== 'region' || activeRegionTool !== 'f6') {
      setF6Drawing(false);
    }
  }, [activeRegionTool, mode]);

  React.useEffect(() => {
    setF3Page(1);
  }, [f3Rows]);

  React.useEffect(() => {
    setF3JumpPage(String(Math.min(f3Page, f3PageCount)));
  }, [f3Page, f3PageCount]);

  const applyF3JumpPage = React.useCallback(() => {
    const text = f3JumpPage.trim();
    const parsed = Number(text);
    if (!text || !/^\d+$/.test(text) || !Number.isInteger(parsed) || parsed < 1 || parsed > f3PageCount) {
      showValidationNotice(`F3 页码必须输入 1-${f3PageCount} 之间的整数。`);
      setF3JumpPage(String(Math.min(f3Page, f3PageCount)));
      return;
    }
    const nextPage = parsed;
    setF3Page(nextPage);
    setF3JumpPage(String(nextPage));
  }, [f3JumpPage, f3Page, f3PageCount, showValidationNotice]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadOverview() {
      try {
        const { data: summary } = await apiClient.get<DatasetSummary>('/api/v1/analytics/dataset-summary');
        if (cancelled) return;
        setOverviewStats((current) => ({
          ...current,
          summary,
          activeVehicles: null,
          summaryLoaded: true,
        }));
      } catch (error) {
        if (cancelled) return;
        setOverviewStats((current) => ({
          ...current,
          summaryLoaded: true,
          error: error instanceof Error ? error.message : '后端数据档案接口请求失败',
        }));
      }

      try {
        const { data: activeResp } = await apiClient.get<{ active_vehicle_count?: number }>(
          '/api/v1/analytics/active-vehicles',
          {
            params: {
              start_time: DATA_START,
              end_time: DATA_END,
              min_lon: BEIJING_CORE_BBOX.minLon,
              min_lat: BEIJING_CORE_BBOX.minLat,
              max_lon: BEIJING_CORE_BBOX.maxLon,
              max_lat: BEIJING_CORE_BBOX.maxLat,
            },
            timeout: 45000,
            suppressErrorToast: true,
          } as any,
        );
        if (cancelled) return;
        const nextActive = Number(activeResp.active_vehicle_count ?? 0);
        setOverviewStats((current) => ({
          ...current,
          activeVehicles: nextActive,
          activeLoaded: true,
        }));
        setActiveVehicles(nextActive);
      } catch (error) {
        if (cancelled) return;
        setOverviewStats((current) => ({
          ...current,
          activeLoaded: true,
        }));
      }
    }

    void loadOverview();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!amap || !mapContainerRef.current || mapRef.current) return undefined;

    let completed = false;
    const currentStyle = mapStyleOptions.find((option) => option.key === mapStyleKey)?.value ?? APP_CONFIG.map.darkStyle;

    const map = new amap.Map(mapContainerRef.current, {
      zoom: APP_CONFIG.map.zoom,
      center: APP_CONFIG.map.center,
      mapStyle: currentStyle,
      viewMode: '2D',
      pitch: 0,
      animateEnable: true,
      resizeEnable: true,
    });
    mapRef.current = map;
    if (amap.MouseTool) {
      mouseToolRef.current = new amap.MouseTool(map);
    }

    const handleComplete = () => {
      completed = true;
      setMapReady(true);
      setViewportRevision((value) => value + 1);
      map.resize();
    };
    const handleTilesLoaded = () => {
      completed = true;
      setMapReady(true);
      setViewportRevision((value) => value + 1);
    };
    const handleMapError = () => {
      setMapReady(false);
    };
    const handleViewportChanged = () => {
      setViewportRevision((value) => value + 1);
    };
    map.on('complete', handleComplete);
    map.on('tilesloaded', handleTilesLoaded);
    map.on('error', handleMapError);
    map.on('moveend', handleViewportChanged);
    map.on('zoomend', handleViewportChanged);

    const resizeTimer = window.setTimeout(() => {
      map.resize();
      map.setCenter(APP_CONFIG.map.center);
      map.setZoom(APP_CONFIG.map.zoom);
      if (!completed) {
        setMapReady(true);
      }
    }, 180);

    return () => {
      window.clearTimeout(resizeTimer);
      map.off('complete', handleComplete);
      map.off('tilesloaded', handleTilesLoaded);
      map.off('error', handleMapError);
      map.off('moveend', handleViewportChanged);
      map.off('zoomend', handleViewportChanged);
      if (trajectoryFocusTimerRef.current != null) {
        window.clearTimeout(trajectoryFocusTimerRef.current);
        trajectoryFocusTimerRef.current = null;
      }
      map.destroy();
      mapRef.current = null;
      mouseToolRef.current = null;
      setMapReady(false);
    };
  }, [amap]);

  React.useEffect(() => {
    const nextStyle = mapStyleOptions.find((option) => option.key === mapStyleKey)?.value ?? APP_CONFIG.map.darkStyle;
    mapRef.current?.setMapStyle?.(nextStyle);
  }, [mapStyleKey]);

  const enterMode = (nextMode: WorkbenchMode) => {
    if (nextMode !== 'trajectory') {
      clearTrajectoryOverlays();
    }
    if (nextMode !== 'decision') {
      clearPinnedF8RouteDetail();
      clearF7PathOverlays();
      clearF7DetailOverlays();
      clearF7ViewportOverlay();
      clearF8Routes();
      clearDecisionOverlays();
      setDecisionMapLayer(null);
    }
    if (nextMode !== 'region') {
      f4RequestIdRef.current += 1;
      clearF3Selection();
      clearF4Layer();
      clearF5Artifacts();
      clearF6Artifacts();
      setF4TopCells([]);
      setF4GeneralizationUnlocked(false);
      setF4Generalizing(false);
      setF4Generating(false);
      setF4MapInteractionEnabled(true);
      f4LastRenderedResolutionRef.current = null;
    }
    setMode(nextMode);
    setStatus('idle');
    setBrushMode('none');
    if (nextMode === 'region') setActiveRegionTool(null);
    setAnalysisResult(null);
  };

  const resetOverview = () => {
    f4RequestIdRef.current += 1;
    clearF3Selection();
    clearF7PathOverlays();
    clearF7DetailOverlays();
    clearF7ViewportOverlay();
    clearDecisionOverlays();
    setDecisionMapLayer(null);
    clearF4Layer();
    clearF5Artifacts();
    clearF6Artifacts();
    setF4TopCells([]);
    setF4GeneralizationUnlocked(false);
    setF4Generalizing(false);
    setF4Generating(false);
    setF4MapInteractionEnabled(true);
    f4LastRenderedResolutionRef.current = null;
    setMode('overview');
    setStatus('idle');
    setBrushMode('none');
    setActiveRegionTool(null);
    setAnalysisResult(null);
  };

  const submitTrajectorySearch = () => {
    const normalized = targetTaxiId.trim();
    if (!normalized) {
      setTrajectoryTarget('');
      setStatus('idle');
      showValidationNotice('F1-F2 请输入车辆 ID，合法范围为 1-10357。');
      setAnalysisResult({
        title: '请输入车辆 ID',
        subtitle: 'F1-F2 轨迹查询',
        metrics: [
          { label: '合法范围', value: '1-10357' },
          { label: '当前输入', value: '空' },
        ],
        note: 'F1 仅支持按单车查询，输入车辆 ID 后再执行查询。',
      });
      return false;
    }
    const parsedTaxiId = Number(normalized);
    if (!/^\d+$/.test(normalized) || !Number.isInteger(parsedTaxiId) || parsedTaxiId < 1 || parsedTaxiId > 10357) {
      setStatus('error');
      showValidationNotice(`F1-F2 车辆 ID 必须输入 1-10357 之间的整数，当前输入为 ${normalized}。`);
      setAnalysisResult({
        title: '车辆 ID 无效',
        subtitle: 'F1-F2 轨迹查询',
        metrics: [
          { label: '合法范围', value: '1-10357' },
          { label: '当前输入', value: normalized },
          { label: '状态', value: '待修正' },
        ],
        note: '请输入合法车辆 ID；F1 不支持留空查询。',
      });
      return false;
    }
    setTrajectoryTarget(normalized);
    setStatus('ready');
    return true;
  };

  const clearTrajectoryOverlays = React.useCallback(() => {
    if (trajectoryPlaybackRef.current.rafId != null) {
      window.cancelAnimationFrame(trajectoryPlaybackRef.current.rafId);
      trajectoryPlaybackRef.current.rafId = null;
    }
    trajectoryPlaybackRef.current = { rafId: null, tripId: null, startedAt: 0, elapsedMs: 0, durationMs: 0, fullPath: [], pathLengths: [] };
    setPlaybackState({ tripId: null, status: 'idle' });
    const map = mapRef.current;
    if (map && trajectoryOverlaysRef.current.length) {
      map.remove(trajectoryOverlaysRef.current);
    }
    trajectoryOverlaysRef.current = [];
    trajectoryOverlayGroupsRef.current.clear();
  }, []);

  const clearF7HoverArrows = React.useCallback(() => {
    if (mapRef.current && f7HoverArrowOverlaysRef.current.length) {
      mapRef.current.remove?.(f7HoverArrowOverlaysRef.current);
    }
    f7HoverArrowOverlaysRef.current = [];
  }, []);

  const clearF7PathOverlays = React.useCallback(() => {
    if (mapRef.current && f7PathOverlaysRef.current.length) {
      mapRef.current.remove?.(f7PathOverlaysRef.current);
    }
    clearF7HoverArrows();
    f7PathOverlaysRef.current = [];
    f7HoverArrowSpecsRef.current = {};
    f7PathOverlayGroupsRef.current = {};
    f7TooltipRef.current?.close?.();
    setF7FocusedPathKey(null);
  }, [clearF7HoverArrows]);

  const clearF7DetailOverlays = React.useCallback((options?: { preserveDetailState?: boolean }) => {
    if (mapRef.current && f7DetailOverlaysRef.current.length) {
      mapRef.current.remove?.(f7DetailOverlaysRef.current);
    }
    f7DetailOverlaysRef.current = [];
    f7DetailOverlayGroupsRef.current = {};
    f7TooltipRef.current?.close?.();
    setF7HoveredSegmentUid(null);
    if (!options?.preserveDetailState) {
      setF7RoadDetail(null);
    }
  }, []);

  const clearF7ViewportOverlay = React.useCallback(() => {
    if (f7ViewportOverlayRef.current) {
      f7ViewportOverlayRef.current.setMap?.(null);
      f7ViewportOverlayRef.current = null;
    }
  }, []);

  const clearF8Routes = React.useCallback(() => {
    if (f8RouteAnimationRef.current.rafId != null) {
      window.cancelAnimationFrame(f8RouteAnimationRef.current.rafId);
    }
    f8RouteAnimationRef.current = { rafId: null, routeKey: null };
    if (mapRef.current && f8RouteOverlaysRef.current.length) {
      mapRef.current.remove?.(f8RouteOverlaysRef.current);
    }
    f8RouteOverlaysRef.current = [];
    f8RouteOverlayGroupsRef.current = {};
    f8TooltipRef.current?.close?.();
    setF8AnimatingRouteKey(null);
    setF8FocusedRouteKey(null);
  }, []);

  const clearDecisionOverlays = React.useCallback(() => {
    const map = mapRef.current;
    if (map && decisionOverlaysRef.current.length) {
      map.remove?.(decisionOverlaysRef.current);
    }
    decisionOverlaysRef.current = [];
    decisionTooltipRef.current?.close?.();
  }, []);

  const clearF4Layer = React.useCallback(() => {
    if (f4HeatmapRef.current) {
      f4HeatmapRef.current.setMap?.(null);
      f4HeatmapRef.current = null;
    }
    f4HeatmapDataRef.current = [];
    f4CellsRef.current = [];
    f4ChoroplethEntriesRef.current = [];
    if (f4HoverInfoWindowRef.current) {
      f4HoverInfoWindowRef.current.close?.();
    }
    if (f4HoveredPolygonRef.current) {
      f4HoveredPolygonRef.current.setOptions?.({ strokeWeight: 0, strokeOpacity: 0 });
      f4HoveredPolygonRef.current = null;
    }
    if (mapRef.current && f4OverlaysRef.current.length) {
      mapRef.current.remove?.(f4OverlaysRef.current);
    }
    if (f4SnapshotBBoxOverlayRef.current) {
      f4SnapshotBBoxOverlayRef.current.setMap?.(null);
      f4SnapshotBBoxOverlayRef.current = null;
    }
    if (f4HighlightOverlayRef.current) {
      f4HighlightOverlayRef.current.setMap?.(null);
      f4HighlightOverlayRef.current = null;
    }
    f4OverlaysRef.current = [];
    setF4LegendMeta(null);
    setF4LegendFilter(null);
  }, []);

  const clearF5FlowOverlays = React.useCallback(() => {
    if (f5PulseRef.current.rafId != null) {
      window.cancelAnimationFrame(f5PulseRef.current.rafId);
      f5PulseRef.current.rafId = null;
    }
    f5PulseRef.current.entries = [];
    if (mapRef.current && f5FlowOverlaysRef.current.length) {
      mapRef.current.remove?.(f5FlowOverlaysRef.current);
    }
    f5FlowOverlaysRef.current = [];
  }, []);

  const clearF5Area = React.useCallback((target?: 'A' | 'B') => {
    const targets: Array<'A' | 'B'> = target ? [target] : ['A', 'B'];
    targets.forEach((key) => {
      f5AreaOverlayRef.current[key]?.setMap?.(null);
      f5AreaOverlayRef.current[key] = null;
      f5AreaLabelRef.current[key]?.setMap?.(null);
      f5AreaLabelRef.current[key] = null;
      f5AreaPayloadRef.current[key] = null;
    });
    setF5ThresholdRecommendation(null);
  }, []);

  const invalidateF8F9TaskState = React.useCallback((options?: { keepAreas?: boolean }) => {
    f8RequestIdRef.current += 1;
    setF8PinnedRouteKey(null);
    setF8PinnedRouteOrder(null);
    setF8PinnedRouteSortMode(null);
    setF8PinnedRouteItem(null);
    clearF8Routes();
    clearDecisionOverlays();
    setF8Result(null);
    setF9RecommendedRouteKey(null);
    setDecisionMapLayer(null);
    setF8DecisionLoading(false);
    setRunningTask((current) => (
      current && current.code === 'F8' ? null : current
    ));
    if (!options?.keepAreas) {
      clearF5Area();
    }
  }, [clearDecisionOverlays, clearF5Area, clearF8Routes]);

  const clearF6FlowOverlays = React.useCallback(() => {
    if (f6PulseRef.current.rafId != null) {
      window.cancelAnimationFrame(f6PulseRef.current.rafId);
      f6PulseRef.current.rafId = null;
    }
    f6PulseRef.current.entries = [];
    if (mapRef.current && f6FlowOverlaysRef.current.length) {
      mapRef.current.remove?.(f6FlowOverlaysRef.current);
    }
    f6FlowOverlaysRef.current = [];
    f6RegionOverlayGroupsRef.current = {};
    f6TooltipRef.current?.close?.();
  }, []);

  const clearF6CoreArea = React.useCallback(() => {
    f6CoreOverlayRef.current?.setMap?.(null);
    f6CoreOverlayRef.current = null;
    f6CoreAreaRef.current = null;
  }, []);

  const clearF5Artifacts = React.useCallback(() => {
    if (mouseToolRef.current && f5DrawHandlerRef.current) {
      mouseToolRef.current.off?.('draw', f5DrawHandlerRef.current);
      f5DrawHandlerRef.current = null;
    }
    clearF5FlowOverlays();
    clearF5Area();
    setF5DrawingTarget(null);
    setF5Result(null);
    setF5DetailsExpanded(false);
    setF5BufferMeters(30);
    setF5MaxTransitionMinutes(30);
  }, [clearF5Area, clearF5FlowOverlays]);

  const clearF6Artifacts = React.useCallback((options?: { keepCore?: boolean }) => {
    if (mouseToolRef.current && f6DrawHandlerRef.current) {
      mouseToolRef.current.off?.('draw', f6DrawHandlerRef.current);
      f6DrawHandlerRef.current = null;
    }
    clearF6FlowOverlays();
    if (!options?.keepCore) clearF6CoreArea();
    setF6Drawing(false);
    setF6Result(null);
  }, [clearF6CoreArea, clearF6FlowOverlays]);

  const createBBoxOverlays = React.useCallback((bbox: F5BBox, color: string, label: string, zIndex = 118) => {
    const amapInstance = amap;
    if (!amapInstance) return null;
    const path = [
      wgs84ToGcj02(bbox.minLon, bbox.minLat),
      wgs84ToGcj02(bbox.maxLon, bbox.minLat),
      wgs84ToGcj02(bbox.maxLon, bbox.maxLat),
      wgs84ToGcj02(bbox.minLon, bbox.maxLat),
    ];
    const polygon = new amapInstance.Polygon({
      path,
      strokeColor: color,
      strokeOpacity: 0.95,
      strokeWeight: 2,
      fillColor: color,
      fillOpacity: 0.16,
      zIndex,
    });
    const text = new amapInstance.Text({
      text: label,
      position: wgs84ToGcj02(...getBBoxCenter(bbox)),
      anchor: 'center',
      style: {
        background: 'rgba(15,23,42,0.78)',
        border: `1px solid ${color}`,
        color: '#f8fafc',
        padding: '2px 7px',
        borderRadius: '6px',
        fontSize: '11px',
        fontWeight: '700',
      },
      zIndex: zIndex + 40,
    });
    return { polygon, text };
  }, [amap]);

  const renderDemoPresetRegionBoxes = React.useCallback((target: RegionTool | 'decision') => {
    if (!demoReadonly || !mapRef.current) return;
    const map = mapRef.current;
    const fitTargets: any[] = [];

    if (target === 'f3') {
      const overlays = createBBoxOverlays(DEMO_FIXTURE.areas.f3, '#38bdf8', 'F3 Demo');
      if (overlays) {
        map.add?.([overlays.polygon, overlays.text]);
        f3BBoxOverlaysRef.current = [overlays.polygon, overlays.text];
        fitTargets.push(overlays.polygon);
      }
      f3BBoxPayloadsRef.current = [DEMO_FIXTURE.areas.f3];
    }

    if (target === 'f5' || target === 'decision') {
      clearF5Area();
      const areaA = createBBoxOverlays(DEMO_FIXTURE.areas.areaA, '#2563eb', 'A');
      const areaB = createBBoxOverlays(DEMO_FIXTURE.areas.areaB, '#f97316', 'B');
      const overlays = [areaA?.polygon, areaA?.text, areaB?.polygon, areaB?.text].filter(Boolean);
      if (overlays.length) map.add?.(overlays);
      f5AreaOverlayRef.current.A = areaA?.polygon ?? null;
      f5AreaOverlayRef.current.B = areaB?.polygon ?? null;
      f5AreaLabelRef.current.A = areaA?.text ?? null;
      f5AreaLabelRef.current.B = areaB?.text ?? null;
      f5AreaPayloadRef.current.A = DEMO_FIXTURE.areas.areaA;
      f5AreaPayloadRef.current.B = DEMO_FIXTURE.areas.areaB;
      if (areaA?.polygon) fitTargets.push(areaA.polygon);
      if (areaB?.polygon) fitTargets.push(areaB.polygon);
    }

    if (target === 'f6') {
      const core = createBBoxOverlays(DEMO_FIXTURE.areas.core, '#f59e0b', 'Core', 112);
      if (core) {
        map.add?.([core.polygon, core.text]);
        f6CoreOverlayRef.current = core.polygon;
        fitTargets.push(core.polygon);
      }
      f6CoreAreaRef.current = DEMO_FIXTURE.areas.core;
    }

    if (fitTargets.length) {
      map.setFitView?.(fitTargets, false, [90, 90, 150, sidebarCollapsed ? 90 : 460]);
    }
  }, [clearF5Area, createBBoxOverlays, demoReadonly, sidebarCollapsed]);

  const refreshF5TransitionRecommendation = React.useCallback(async (areaA: F5BBox | null, areaB: F5BBox | null) => {
    if (!areaA || !areaB) {
      setF5ThresholdRecommendation(null);
      return;
    }
    try {
      if (demoReadonly) {
        const recommendedSeconds = Number(DEMO_FIXTURE.f5?.meta?.max_transition_seconds ?? 5400);
        setF5ThresholdRecommendation({
          recommended_seconds: recommendedSeconds,
          recommended_minutes: Math.round(recommendedSeconds / 60),
          distance_meters: 0,
          raw_seconds: recommendedSeconds,
          meta: { logic_mode: 'readonly_demo' },
        });
        setF5MaxTransitionMinutes(Math.max(1, Math.min(360, Math.round(recommendedSeconds / 60))));
        return;
      }
      const recommendation = await queryF5TransitionThresholdRecommendation({ areaA, areaB });
      if (recommendation.meta?.error) throw new Error(recommendation.meta.error);
      const recommendedMinutes = Math.max(1, Math.min(360, Number(recommendation.recommended_minutes || 30)));
      setF5ThresholdRecommendation(recommendation);
      setF5MaxTransitionMinutes(recommendedMinutes);
    } catch {
      setF5ThresholdRecommendation(null);
    }
  }, [demoReadonly]);

  const recommendF6ThroughTransferMinutes = React.useCallback((coreArea: F5BBox) => {
    const sw: [number, number] = [coreArea.minLon, coreArea.minLat];
    const se: [number, number] = [coreArea.maxLon, coreArea.minLat];
    const nw: [number, number] = [coreArea.minLon, coreArea.maxLat];
    const diagonalM = Math.sqrt(distanceMeters(sw, se) ** 2 + distanceMeters(sw, nw) ** 2);
    const rawMinutes = (Math.max(900, diagonalM * 0.75 + 1650) / 2.8) / 60 + 8;
    return Math.max(10, Math.min(60, Math.ceil(rawMinutes / 5) * 5));
  }, []);

  const getCurrentMapBBoxWgs84 = React.useCallback(() => {
    const bounds = mapRef.current?.getBounds?.();
    const swPoint = bounds ? readLngLatLike(bounds.getSouthWest()) : null;
    const nePoint = bounds ? readLngLatLike(bounds.getNorthEast()) : null;
    if (!swPoint || !nePoint) return null;
    const swWgs = gcj02ToWgs84(swPoint[0], swPoint[1]);
    const neWgs = gcj02ToWgs84(nePoint[0], nePoint[1]);
    return {
      minLon: Math.min(swWgs[0], neWgs[0]),
      minLat: Math.min(swWgs[1], neWgs[1]),
      maxLon: Math.max(swWgs[0], neWgs[0]),
      maxLat: Math.max(swWgs[1], neWgs[1]),
    };
  }, []);

  const drawF7ViewportBBox = React.useCallback((bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number }) => {
    const amapInstance = amap;
    const map = mapRef.current;
    if (!amapInstance || !map) return;

    clearF7ViewportOverlay();
    const path = [
      wgs84ToGcj02(bounds.minLon, bounds.minLat),
      wgs84ToGcj02(bounds.maxLon, bounds.minLat),
      wgs84ToGcj02(bounds.maxLon, bounds.maxLat),
      wgs84ToGcj02(bounds.minLon, bounds.maxLat),
    ];
    const rect = new amapInstance.Polyline({
      path: [...path, path[0]],
      strokeColor: '#f8fafc',
      strokeOpacity: 0.92,
      strokeStyle: 'dashed',
      strokeWeight: 1.6,
      zIndex: 126,
    });
    rect.setMap?.(map);
    f7ViewportOverlayRef.current = rect;
  }, [amap, clearF7ViewportOverlay]);

  const applyF7PathFocus = React.useCallback((pathKey: string | null) => {
    const groups = f7PathOverlayGroupsRef.current;
    Object.entries(groups).forEach(([currentPathKey, entries]) => {
      entries.forEach((entry) => {
        entry.overlay.setOptions?.(pathKey == null ? entry.base : currentPathKey === pathKey ? entry.focus : entry.dim);
      });
    });
  }, []);

  const applyF7DetailSegmentFocus = React.useCallback((segmentUid: number | null) => {
    const groups = f7DetailOverlayGroupsRef.current;
    const activeKey = segmentUid == null ? null : String(segmentUid);
    Object.entries(groups).forEach(([currentSegmentUid, entries]) => {
      entries.forEach((entry) => {
        entry.overlay.setOptions?.(activeKey == null ? entry.base : currentSegmentUid === activeKey ? entry.focus : entry.dim);
      });
    });
  }, []);

  const applyF8RouteFocus = React.useCallback((routeKey: string | null) => {
    const groups = f8RouteOverlayGroupsRef.current;
    Object.entries(groups).forEach(([currentRouteKey, entries]) => {
      entries.forEach((entry) => {
        entry.overlay.setOptions?.(routeKey == null ? entry.base : currentRouteKey === routeKey ? entry.focus : entry.dim);
      });
    });
  }, []);

  const setF8RoutePath = React.useCallback((entry: F7OverlayEntry, path: Array<[number, number]>) => {
    if (!entry.animatePath || !entry.fullPath?.length) return;
    if (entry.overlay.setPath) {
      entry.overlay.setPath(path);
    } else {
      entry.overlay.setOptions?.({ path });
    }
  }, []);

  const restoreF8RoutePaths = React.useCallback((routeKey?: string | null) => {
    const groups = f8RouteOverlayGroupsRef.current;
    Object.entries(groups).forEach(([currentRouteKey, entries]) => {
      if (routeKey && currentRouteKey !== routeKey) return;
      entries.forEach((entry) => {
        if (entry.animatePath && entry.fullPath?.length) {
          setF8RoutePath(entry, entry.fullPath);
        }
      });
    });
  }, [setF8RoutePath]);

  const stopF8RouteAnimation = React.useCallback((restoreFull = false) => {
    const animation = f8RouteAnimationRef.current;
    if (animation.rafId != null) {
      window.cancelAnimationFrame(animation.rafId);
    }
    const stoppedRouteKey = animation.routeKey;
    f8RouteAnimationRef.current = { rafId: null, routeKey: null };
    setF8AnimatingRouteKey(null);
    if (restoreFull) {
      restoreF8RoutePaths(stoppedRouteKey);
      applyF8RouteFocus(null);
      setF8FocusedRouteKey(null);
    }
  }, [applyF8RouteFocus, restoreF8RoutePaths]);

  const resetF8RouteAnimation = React.useCallback((routeKey: string) => {
    stopF8RouteAnimation(false);
    restoreF8RoutePaths(routeKey);
    applyF8RouteFocus(null);
    setF8FocusedRouteKey(null);
  }, [applyF8RouteFocus, restoreF8RoutePaths, stopF8RouteAnimation]);

  const toggleF8RouteAnimation = React.useCallback((routeKey: string) => {
    if (f8RouteAnimationRef.current.routeKey === routeKey) {
      stopF8RouteAnimation(false);
      return;
    }

    stopF8RouteAnimation(true);
    const entries = f8RouteOverlayGroupsRef.current[routeKey]?.filter((entry) => entry.animatePath && entry.fullPath && entry.fullPath.length >= 2) ?? [];
    if (!entries.length) return;

    setF8FocusedRouteKey(routeKey);
    setF8AnimatingRouteKey(routeKey);
    applyF8RouteFocus(routeKey);

    const maxPointCount = Math.max(2, ...entries.map((entry) => entry.fullPath?.length ?? 2));
    const durationMs = Math.max(3200, Math.min(9000, maxPointCount * 22));
    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - startedAt) / durationMs));
      entries.forEach((entry) => {
        const fullPath = entry.fullPath ?? [];
        const visibleCount = Math.max(2, Math.min(fullPath.length, Math.ceil(fullPath.length * progress)));
        setF8RoutePath(entry, fullPath.slice(0, visibleCount));
      });
      if (progress < 1 && f8RouteAnimationRef.current.routeKey === routeKey) {
        f8RouteAnimationRef.current.rafId = window.requestAnimationFrame(tick);
      } else {
        restoreF8RoutePaths(routeKey);
        f8RouteAnimationRef.current = { rafId: null, routeKey: null };
        setF8AnimatingRouteKey(null);
      }
    };

    entries.forEach((entry) => {
      const fullPath = entry.fullPath ?? [];
      setF8RoutePath(entry, fullPath.slice(0, Math.min(2, fullPath.length)));
    });
    f8RouteAnimationRef.current = {
      rafId: window.requestAnimationFrame(tick),
      routeKey,
    };
  }, [applyF8RouteFocus, restoreF8RoutePaths, setF8RoutePath, stopF8RouteAnimation]);

  const drawF7FrequentPaths = React.useCallback((result: F7FrequentPathsResponse) => {
    const amapInstance = amap;
    const map = mapRef.current;
    if (!amapInstance || !map) return;

    clearF7PathOverlays();
    const paths = Array.isArray(result.paths) ? result.paths : [];
    if (!paths.length) return;

    const maxTripCount = Math.max(1, ...paths.map((path) => Number(path.trip_count || 0)));
    const overlays: any[] = [];
    const overlayGroups: Record<string, F7OverlayEntry[]> = {};
    const isEdgePassWeightMode = result.meta?.metric_mode === 'edge_pass_weight';
    const isVehicleHourlySum = result.meta?.vehicle_count_mode === 'hourly_distinct_sum';
    const primaryMetricLabel = isEdgePassWeightMode ? '通行权重' : '经过行程';
    const directionPairTotals = new globalThis.Map<string, { forward: number; reverse: number }>();
    paths.forEach((path) => {
      const componentId = path.corridor_component_id ?? path.component_id ?? 0;
      const pairKey = `${path.road_group_key}::${componentId}`;
      const current = directionPairTotals.get(pairKey) ?? { forward: 0, reverse: 0 };
      if (path.direction === 'reverse') current.reverse += Number(path.trip_count || 0);
      else if (path.direction === 'forward') current.forward += Number(path.trip_count || 0);
      directionPairTotals.set(pairKey, current);
    });
    const tooltip = f7TooltipRef.current ?? new amapInstance.InfoWindow({
      isCustom: true,
      offset: new amapInstance.Pixel(12, -18),
      autoMove: false,
    });
    f7TooltipRef.current = tooltip;

    const getTooltipHtml = (path: F7FrequentPath) => `
      <div style="background:rgba(15,23,42,0.82);color:#f8fafc;border:1px solid rgba(248,250,252,0.28);box-shadow:0 18px 38px rgba(15,23,42,0.34);border-radius:12px;padding:10px 12px;min-width:210px;font-size:12px;line-height:1.55;backdrop-filter:blur(14px) saturate(1.25);">
        <div style="font-weight:900;margin-bottom:4px;">#${path.rank} ${path.road_name || '未命名道路'}</div>
        <div>${primaryMetricLabel}: ${Number(path.trip_count || 0).toLocaleString('zh-CN')}${isEdgePassWeightMode || isVehicleHourlySum ? '' : ` | 车辆: ${Number(path.vehicle_count || 0).toLocaleString('zh-CN')}`}</div>
        ${path.edge_pass_weight !== undefined ? `<div>通行权重: ${Number(path.edge_pass_weight || 0).toLocaleString('zh-CN')}</div>` : ''}
        <div>长度: ${path.group_length_m >= 1000 ? `${(path.group_length_m / 1000).toFixed(1)} km` : `${Math.round(path.group_length_m)} m`}</div>
        <div>路段数: ${Number(path.backbone_segment_count ?? (path.segment_count || 0)).toLocaleString('zh-CN')}</div>
      </div>
    `;

    paths.forEach((path) => {
      const pathKey = getF7PathKey(path);
      const componentId = path.corridor_component_id ?? path.component_id ?? 0;
      const pairTotals = directionPairTotals.get(`${path.road_group_key}::${componentId}`) ?? { forward: 0, reverse: 0 };
      const ownFlow = Number(path.trip_count || 0);
      const oppositeFlow = path.direction === 'reverse' ? pairTotals.forward : pairTotals.reverse;
      const dominanceRatio = ownFlow / Math.max(1, oppositeFlow);
      const isWeakDirection = oppositeFlow > 0 && oppositeFlow / Math.max(1, ownFlow) > 1.6;
      const isBalancedDirection = oppositeFlow > 0 && dominanceRatio <= 1.6 && dominanceRatio >= (1 / 1.6);
      const lines = extractLineStringsFromGeometry(path.geometry_backbone ?? path.geometry);
      const renderLines = lines.length > 1 ? lines : [stitchLinesToContinuousChain(lines)];
      if (!renderLines.some((line) => line.length >= 2)) return;

      overlayGroups[pathKey] = [];
      const flowRatio = Number(path.trip_count || 0) / maxTripCount;
      const visualRatio = Math.pow(Math.max(0, Math.min(1, flowRatio)), 0.5);
      const colors = getF7DirectionColor(path.direction);
      const width = Math.max(3, Math.min(10, 2 + visualRatio * 8));
      const opacityBase = Math.max(0.30, Math.min(0.88, 0.28 + visualRatio * 0.60));
      const opacity = isWeakDirection ? opacityBase * 0.34 : isBalancedDirection ? opacityBase * 0.76 : opacityBase;

      renderLines.forEach((stitched) => {
        if (stitched.length < 2) return;
        const shiftedLine = offsetLineByMeters(stitched, path.direction === 'reverse' ? -10 : path.direction === 'forward' ? 10 : 0);
        const gcjLine = shiftedLine.map(([lng, lat]) => wgs84ToGcj02(lng, lat));
        const anchor = gcjLine[Math.floor(gcjLine.length / 2)] ?? gcjLine[0];
        const glow = new amapInstance.Polyline({
          path: gcjLine,
          strokeColor: colors.glow,
          strokeOpacity: isWeakDirection ? 0.04 : 0.12,
          strokeWeight: width + 5,
          lineJoin: 'round',
          lineCap: 'round',
          zIndex: 108,
        });
        const main = new amapInstance.Polyline({
          path: gcjLine,
          strokeColor: colors.main,
          strokeOpacity: opacity,
          strokeWeight: width,
          lineJoin: 'round',
          lineCap: 'round',
          showDir: true,
          zIndex: 112,
        });
        const hitLine = new amapInstance.Polyline({
          path: gcjLine,
          strokeColor: colors.main,
          strokeOpacity: 0,
          strokeWeight: width + 18,
          lineJoin: 'round',
          lineCap: 'round',
          showDir: false,
          zIndex: 150,
        });
        f7HoverArrowSpecsRef.current[pathKey] = [];

        const bindHover = (overlay: any) => {
          overlay.on?.('mouseover', (evt: any) => {
            setF7FocusedPathKey(pathKey);
            applyF7PathFocus(pathKey);
            tooltip.setContent?.(getTooltipHtml(path));
            tooltip.open?.(map, evt?.lnglat ?? anchor);
          });
          overlay.on?.('mouseout', () => {
            setF7FocusedPathKey(null);
            applyF7PathFocus(null);
            tooltip.close?.();
          });
        };

        bindHover(glow);
        bindHover(main);
        bindHover(hitLine);
        overlays.push(glow, main, hitLine);
        if (anchor) {
          overlays.push(new amapInstance.Text({
            text: `#${path.rank} ${path.road_name || '未命名道路'}`,
            position: anchor,
            anchor: 'center',
            offset: new amapInstance.Pixel(0, -12),
            style: {
              background: 'rgba(15,23,42,0.84)',
              border: `1px solid ${colors.main}`,
              color: '#f8fafc',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '11px',
              lineHeight: '14px',
              fontWeight: '700',
              whiteSpace: 'nowrap',
            },
            zIndex: 152,
          }));
        }
        overlayGroups[pathKey].push({
          overlay: glow,
          base: { strokeOpacity: isWeakDirection ? 0.04 : 0.12, strokeWeight: width + 5, zIndex: 108 },
          dim: { strokeOpacity: 0.02, strokeWeight: Math.max(2, width), zIndex: 88 },
          focus: { strokeOpacity: 0.44, strokeWeight: width + 9, zIndex: 128 },
        });
        overlayGroups[pathKey].push({
          overlay: main,
          base: { strokeOpacity: opacity, strokeWeight: width, zIndex: 112, showDir: true },
          dim: { strokeOpacity: 0.08, strokeWeight: 2, zIndex: 90, showDir: true },
          focus: { strokeOpacity: 1, strokeWeight: width + 1.5, zIndex: 132, showDir: true },
        });
        overlayGroups[pathKey].push({
          overlay: hitLine,
          base: { strokeOpacity: 0, strokeWeight: width + 18, zIndex: 150, showDir: false },
          dim: { strokeOpacity: 0, strokeWeight: width + 14, zIndex: 86, showDir: false },
          focus: { strokeOpacity: 0, strokeWeight: width + 20, zIndex: 170, showDir: false },
        });
      });
    });

    if (!overlays.length) return;
    map.add?.(overlays);
    f7PathOverlaysRef.current = overlays;
    f7PathOverlayGroupsRef.current = overlayGroups;
  }, [amap, applyF7PathFocus, clearF7PathOverlays]);

  const drawF7RoadDetail = React.useCallback((detail: F7RoadDetailResponse) => {
    const amapInstance = amap;
    const map = mapRef.current;
    if (!amapInstance || !map) return;

    clearF7DetailOverlays({ preserveDetailState: true });
    const segments = Array.isArray(detail.segments) ? [...detail.segments] : [];
    if (!segments.length) return;
    const orderedSegments = segments.sort((a, b) => {
      const aOrder = Number(a.profile_order ?? a.rank ?? 0);
      const bOrder = Number(b.profile_order ?? b.rank ?? 0);
      return aOrder - bOrder || Number(a.road_uid || 0) - Number(b.road_uid || 0);
    });

    const maxTripCount = Math.max(1, detail.summary?.max_trip_count ?? 1);
    const overlays: any[] = [];
    const overlayGroups: Record<string, F7OverlayEntry[]> = {};
    const tooltip = f7TooltipRef.current ?? new amapInstance.InfoWindow({
      isCustom: true,
      offset: new amapInstance.Pixel(12, -18),
      autoMove: false,
    });
    f7TooltipRef.current = tooltip;

    const getTooltipHtml = (segment: F7RoadDetailSegment) => `
      <div style="background:rgba(15,23,42,0.84);color:#f8fafc;border:1px solid rgba(248,250,252,0.28);box-shadow:0 18px 38px rgba(15,23,42,0.34);border-radius:12px;padding:10px 12px;min-width:220px;font-size:12px;line-height:1.55;backdrop-filter:blur(14px) saturate(1.25);">
        <div style="font-weight:900;margin-bottom:4px;">空间序 #${segment.profile_order ?? segment.rank} · UID ${segment.road_uid}</div>
        <div style="color:#fecaca;">瓶颈排名: #${segment.flow_rank ?? segment.rank}</div>
        <div>经过行程: ${Number(segment.trip_count || 0).toLocaleString('zh-CN')}</div>
        <div>通行权重: ${Number(segment.edge_pass_weight || 0).toLocaleString('zh-CN')}</div>
        <div>长度: ${(Number(segment.length_m || 0)).toFixed(0)}m</div>
        <div style="color:#cbd5e1;">${segment.highway ? `道路类型: ${segment.highway}` : '道路类型: --'}</div>
      </div>
    `;

    orderedSegments.forEach((segment) => {
      const ratio = Number(segment.trip_count || 0) / maxTripCount;
      const color = getF7SegmentColor(ratio);
      const width = Math.max(3, Math.min(8, getF7SegmentBandWidth(ratio)));
      const lines = extractLineStringsFromGeometry(segment.geometry);
      const segmentKey = String(segment.road_uid);
      overlayGroups[segmentKey] = overlayGroups[segmentKey] ?? [];

      lines.forEach((line) => {
        const gcjLine = line.map(([lng, lat]) => wgs84ToGcj02(lng, lat));
        const anchor = gcjLine[Math.floor(gcjLine.length / 2)] ?? gcjLine[0];
        const outline = new amapInstance.Polyline({
          path: gcjLine,
          strokeColor: '#12070a',
          strokeOpacity: 0.82,
          strokeWeight: width + 2,
          lineJoin: 'round',
          lineCap: 'round',
          zIndex: 138,
        });
        const band = new amapInstance.Polyline({
          path: gcjLine,
          strokeColor: color,
          strokeOpacity: 0.96,
          strokeWeight: width,
          lineJoin: 'round',
          lineCap: 'round',
          showDir: true,
          zIndex: 141,
        });
        const arrowSegments = buildDirectionArrowSegments(line, Math.max(2, Math.min(6, Math.round(line.length / 12))), Math.max(7, width * 1.25));
        const arrows = arrowSegments.map((arrowLine) => new amapInstance.Polyline({
          path: arrowLine.map(([lng, lat]) => wgs84ToGcj02(lng, lat)),
          strokeColor: '#fff7ed',
          strokeOpacity: 0.72,
          strokeWeight: Math.max(1.7, width * 0.30),
          lineJoin: 'round',
          lineCap: 'round',
          zIndex: 145,
        }));

        const bindHover = (overlay: any) => {
          overlay.on?.('mouseover', (evt: any) => {
            setF7HoveredSegmentUid(segment.road_uid);
            tooltip.setContent?.(getTooltipHtml(segment));
            tooltip.open?.(map, evt?.lnglat ?? anchor);
          });
          overlay.on?.('mouseout', () => {
            setF7HoveredSegmentUid(null);
            tooltip.close?.();
          });
        };

        bindHover(outline);
        bindHover(band);
        arrows.forEach(bindHover);
        overlays.push(outline, band, ...arrows);
        overlayGroups[segmentKey].push({
          overlay: outline,
          base: { strokeColor: '#12070a', strokeOpacity: 0.82, strokeWeight: width + 2, zIndex: 138 },
          dim: { strokeOpacity: 0.18, strokeWeight: Math.max(2, width + 1), zIndex: 118 },
          focus: { strokeOpacity: 0.96, strokeWeight: Math.min(12, width + 3), zIndex: 158 },
        });
        overlayGroups[segmentKey].push({
          overlay: band,
          base: { strokeColor: color, strokeOpacity: 0.96, strokeWeight: width, zIndex: 141, showDir: true },
          dim: { strokeOpacity: 0.26, strokeWeight: Math.max(2, width - 0.5), zIndex: 120 },
          focus: { strokeColor: color, strokeOpacity: 1, strokeWeight: Math.min(10, width + 1.5), zIndex: 160, showDir: true },
        });
        arrows.forEach((arrow) => {
          overlayGroups[segmentKey].push({
            overlay: arrow,
            base: { strokeOpacity: 0.62, strokeWeight: Math.max(1.7, width * 0.30), zIndex: 145 },
            dim: { strokeOpacity: 0.14, strokeWeight: Math.max(1.3, width * 0.24), zIndex: 121 },
            focus: { strokeOpacity: 0.88, strokeWeight: Math.max(2.0, width * 0.38), zIndex: 162 },
          });
        });
      });
    });

    if (!overlays.length) return;
    map.add?.(overlays);
    f7DetailOverlaysRef.current = overlays;
    f7DetailOverlayGroupsRef.current = overlayGroups;
  }, [amap, clearF7DetailOverlays]);

  const drawF8FrequentRoutes = React.useCallback((result: F8FrequentRoutesResponse) => {
    const amapInstance = amap;
    const map = mapRef.current;
    if (!amapInstance || !map) return;

    clearDecisionOverlays();
    clearF8Routes();

    const routes = Array.isArray(result.corridors) && result.corridors.length
      ? result.corridors.map((corridor, index) => ({
        rank: corridor.rank ?? (index + 1),
        route_signature: corridor.corridor_signature,
        route_signature_array: corridor.corridor_signature.split(' > ').filter(Boolean),
        representative_taxi_id: undefined,
        representative_trip_id: undefined,
        trip_count: corridor.trip_count,
        vehicle_count: corridor.vehicle_count,
        avg_duration_min: corridor.avg_duration_min ?? null,
        p20_duration_min: corridor.p20_duration_min,
        p50_duration_min: corridor.p50_duration_min,
        p90_duration_min: corridor.p90_duration_min,
        route_length_m: corridor.route_length_m ?? corridor.avg_route_length_m ?? 0,
        avg_route_length_m: corridor.avg_route_length_m ?? corridor.route_length_m ?? 0,
        edge_count: corridor.corridor_signature.split(' > ').filter(Boolean).length,
        durations_by_hour: corridor.durations_by_hour,
        duration_samples_by_hour: corridor.duration_samples_by_hour,
        trip_count_by_hour: corridor.trip_count_by_hour,
        quality_metrics: corridor.quality_metrics,
        geometry: corridor.geometry,
      } satisfies F8FrequentRoute))
      : Array.isArray(result.routes) ? result.routes : [];
    if (!routes.length) return;
    const visibleRoutes = routes.slice(0, Math.min(routes.length, 5));

    const palette = [
      { base: '#ff2d55', glow: '#ff9db2' },
      { base: '#00e5ff', glow: '#9af6ff' },
      { base: '#b7ff2a', glow: '#e4ff9a' },
      { base: '#ff4fd8', glow: '#ffb0ee' },
      { base: '#ffd400', glow: '#fff08a' },
    ];
    const maxTripCount = Math.max(1, ...visibleRoutes.map((route) => Number(route.trip_count || 0)));
    const overlays: any[] = [];
    const overlayGroups: Record<string, F7OverlayEntry[]> = {};
    const tooltip = f8TooltipRef.current ?? new amapInstance.InfoWindow({
      isCustom: true,
      offset: new amapInstance.Pixel(12, -18),
      autoMove: false,
    });
    f8TooltipRef.current = tooltip;

    const getTooltipHtml = (route: F8FrequentRoute) => `
      <div style="background:rgba(15,23,42,0.82);color:#f8fafc;border:1px solid rgba(248,250,252,0.28);box-shadow:0 18px 38px rgba(15,23,42,0.34);border-radius:12px;padding:10px 12px;min-width:220px;font-size:12px;line-height:1.55;backdrop-filter:blur(14px) saturate(1.25);">
        <div style="font-weight:900;margin-bottom:4px;">#${route.rank} A→B 典型路径</div>
        <div>经过行程: ${Number(route.trip_count || 0).toLocaleString('zh-CN')} | 车辆: ${Number(route.vehicle_count || 0).toLocaleString('zh-CN')}</div>
        <div>平均耗时: ${route.avg_duration_min == null ? '--' : `${Number(route.avg_duration_min).toFixed(1)} 分钟`}</div>
        <div>路径长度: ${(Number(route.route_length_m || 0) / 1000).toFixed(1)}km | 边数: ${Number(route.edge_count || 0)}</div>
        <div style="color:#cbd5e1;max-width:320px;word-break:break-all;">签名: ${route.route_signature}</div>
      </div>
    `;

    visibleRoutes.forEach((route, index) => {
      const routeKey = route.route_signature;
      const lines = extractLineStringsFromGeometry(route.geometry);
      if (!lines.length) return;

      overlayGroups[routeKey] = [];
      const colors = palette[index % palette.length];
      const flowRatio = Number(route.trip_count || 0) / maxTripCount;
      const visualRatio = Math.pow(Math.max(0, Math.min(1, flowRatio)), 0.72);
      const rankFade = Math.max(0.58, 1 - index * 0.09);
      const width = Math.max(2.4, Math.min(3.6, 2.35 + visualRatio * 1.35));
      const whiteHaloOpacity = Math.max(0.04, Math.min(0.12, 0.05 + visualRatio * 0.06)) * rankFade;
      const colorGlowOpacity = Math.max(0.1, Math.min(0.22, 0.11 + visualRatio * 0.09)) * rankFade;
      const mainOpacity = Math.max(0.48, Math.min(0.72, 0.5 + visualRatio * 0.18)) * rankFade;

      lines.forEach((line) => {
        const gcjLine = line.map(([lng, lat]) => wgs84ToGcj02(lng, lat));
        if (gcjLine.length < 2) return;
        const anchor = gcjLine[Math.floor(gcjLine.length / 2)] ?? gcjLine[0];

        const ambient = new amapInstance.Polyline({
          path: gcjLine,
          strokeColor: '#f8fafc',
          strokeOpacity: whiteHaloOpacity,
          strokeWeight: width + 3.2,
          lineJoin: 'round',
          lineCap: 'round',
          zIndex: 112 + index,
        });
        const glow = new amapInstance.Polyline({
          path: gcjLine,
          strokeColor: colors.glow,
          strokeOpacity: colorGlowOpacity,
          strokeWeight: width + 1.7,
          lineJoin: 'round',
          lineCap: 'round',
          zIndex: 116 + index,
        });
        const main = new amapInstance.Polyline({
          path: gcjLine,
          strokeColor: colors.base,
          strokeOpacity: mainOpacity,
          strokeWeight: width,
          lineJoin: 'round',
          lineCap: 'round',
          showDir: true,
          zIndex: 126 + index,
        });
        const hitLine = new amapInstance.Polyline({
          path: gcjLine,
          strokeColor: colors.base,
          strokeOpacity: 0,
          strokeWeight: width + 12,
          lineJoin: 'round',
          lineCap: 'round',
          showDir: false,
          zIndex: 210 + index,
        });

        const bindHover = (overlay: any) => {
          overlay.on?.('mouseover', (evt: any) => {
            setF8FocusedRouteKey(routeKey);
            applyF8RouteFocus(routeKey);
            tooltip.setContent?.(getTooltipHtml(route));
            tooltip.open?.(map, evt?.lnglat ?? anchor);
          });
          overlay.on?.('mouseout', () => {
            setF8FocusedRouteKey(null);
            applyF8RouteFocus(f8PinnedRouteKeyRef.current);
            tooltip.close?.();
          });
        };

        bindHover(ambient);
        bindHover(glow);
        bindHover(main);
        bindHover(hitLine);
        overlays.push(ambient, glow, main, hitLine);
        overlayGroups[routeKey].push({
          overlay: ambient,
          base: { strokeOpacity: whiteHaloOpacity, strokeWeight: width + 2.4, zIndex: 112 + index },
          dim: { strokeOpacity: 0.005, strokeWeight: Math.max(1.6, width - 0.8), zIndex: 86 },
          focus: { strokeOpacity: 0.72, strokeWeight: width + 7.4, zIndex: 180 + index },
          fullPath: gcjLine,
          animatePath: true,
        });
        overlayGroups[routeKey].push({
          overlay: glow,
          base: { strokeOpacity: colorGlowOpacity, strokeWeight: width + 1.2, zIndex: 116 + index },
          dim: { strokeOpacity: 0.018, strokeWeight: Math.max(1.5, width - 1.0), zIndex: 88 },
          focus: { strokeOpacity: 0.96, strokeWeight: width + 5.4, zIndex: 184 + index },
          fullPath: gcjLine,
          animatePath: true,
        });
        overlayGroups[routeKey].push({
          overlay: main,
          base: { strokeOpacity: mainOpacity, strokeWeight: width, zIndex: 126 + index, showDir: true },
          dim: { strokeOpacity: 0.05, strokeWeight: Math.max(1.2, width - 1.4), zIndex: 90 },
          focus: { strokeOpacity: 1, strokeWeight: width + 3.2, zIndex: 188 + index },
          fullPath: gcjLine,
          animatePath: true,
        });
        overlayGroups[routeKey].push({
          overlay: hitLine,
          base: { strokeOpacity: 0, strokeWeight: width + 12, zIndex: 210 + index },
          dim: { strokeOpacity: 0, strokeWeight: width + 8, zIndex: 80 },
          focus: { strokeOpacity: 0, strokeWeight: width + 14, zIndex: 230 + index },
        });
      });
    });

    if (!overlays.length) return;
    map.add?.(overlays);
    f8RouteOverlaysRef.current = overlays;
    f8RouteOverlayGroupsRef.current = overlayGroups;
    map.setFitView?.(overlays, false, [90, 90, 150, sidebarCollapsed ? 90 : 460]);
  }, [amap, applyF8RouteFocus, clearDecisionOverlays, clearF8Routes, sidebarCollapsed]);

  const drawDecisionPolylines = React.useCallback((config: {
    lines: Array<{
      key: string;
      label: string;
      sublabel?: string;
      color: string;
      glowColor?: string;
      width: number;
      opacity?: number;
      zIndex?: number;
      showDir?: boolean;
      fit?: boolean;
      geometry: LineGeometryLike;
    }>;
    note?: string;
  }) => {
    const amapInstance = amap;
    const map = mapRef.current;
    if (!amapInstance || !map) return;
    clearDecisionOverlays();
    const overlays: any[] = [];
    const fitOverlays: any[] = [];
    const tooltip = decisionTooltipRef.current ?? new amapInstance.InfoWindow({
      isCustom: true,
      offset: new amapInstance.Pixel(10, -16),
      autoMove: false,
    });
    decisionTooltipRef.current = tooltip;

    const tooltipHtml = (label: string, sublabel?: string) => `
      <div style="background:rgba(15,23,42,0.88);color:#f8fafc;border:1px solid rgba(148,163,184,0.28);box-shadow:0 16px 36px rgba(15,23,42,0.30);border-radius:10px;padding:10px 12px;min-width:180px;font-size:12px;line-height:1.55;backdrop-filter:blur(12px);">
        <div style="font-weight:800;margin-bottom:4px;">${label}</div>
        ${sublabel ? `<div style="color:#cbd5e1;">${sublabel}</div>` : ''}
        ${config.note ? `<div style="color:#94a3b8;margin-top:4px;">${config.note}</div>` : ''}
      </div>`;

    config.lines.forEach((item) => {
      const rawLines = extractLineStringsFromGeometry(item.geometry);
      rawLines.forEach((line, lineIndex) => {
        const gcjLine = line.map(([lng, lat]) => wgs84ToGcj02(lng, lat));
        if (gcjLine.length < 2) return;
        const glow = new amapInstance.Polyline({
          path: gcjLine,
          strokeColor: item.glowColor ?? '#e2e8f0',
          strokeOpacity: Math.min(0.5, (item.opacity ?? 0.9) * 0.45),
          strokeWeight: item.width + 5,
          lineJoin: 'round',
          lineCap: 'round',
          zIndex: Math.max(120, (item.zIndex ?? 160) - 1),
        });
        const polyline = new amapInstance.Polyline({
          path: gcjLine,
          strokeColor: item.color,
          strokeOpacity: item.opacity ?? 0.94,
          strokeWeight: item.width,
          lineJoin: 'round',
          lineCap: 'round',
          zIndex: item.zIndex ?? 160,
          showDir: item.showDir ?? false,
        });
        polyline.on?.('mouseover', (evt: any) => {
          tooltip.setContent?.(tooltipHtml(item.label, item.sublabel));
          tooltip.open?.(map, evt?.lnglat ?? gcjLine[Math.floor(gcjLine.length / 2)]);
        });
        polyline.on?.('mouseout', () => tooltip.close?.());
        overlays.push(glow, polyline);
        if (item.fit !== false) fitOverlays.push(polyline);
        if (lineIndex === 0) {
          overlays.push(new amapInstance.Text({
            text: item.label,
            position: gcjLine[Math.floor(gcjLine.length / 2)],
            anchor: 'center',
            offset: new amapInstance.Pixel(0, -12),
            style: {
              background: 'rgba(15,23,42,0.82)',
              border: `1px solid ${item.color}`,
              color: '#f8fafc',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '11px',
              lineHeight: '14px',
              fontWeight: '700',
            },
            zIndex: (item.zIndex ?? 160) + 1,
          }));
        }
      });
    });

    if (!overlays.length) return;
    map.add?.(overlays);
    decisionOverlaysRef.current = overlays;
    if (fitOverlays.length) {
      map.setFitView?.(fitOverlays, false, [90, 90, 150, sidebarCollapsed ? 90 : 460]);
    }
  }, [amap, clearDecisionOverlays, sidebarCollapsed]);

  const renderF7OverviewOnMap = React.useCallback((result: F7FrequentPathsResponse, focusedPathKey?: string | null) => {
    drawF7FrequentPaths(result);
    drawF7ViewportBBox(f7AnalysisBBoxRef.current ?? getCurrentMapBBoxWgs84() ?? {
      minLon: BEIJING_CORE_BBOX.minLon,
      minLat: BEIJING_CORE_BBOX.minLat,
      maxLon: BEIJING_CORE_BBOX.maxLon,
      maxLat: BEIJING_CORE_BBOX.maxLat,
    });
    applyF7PathFocus(focusedPathKey ?? null);
  }, [applyF7PathFocus, drawF7FrequentPaths, drawF7ViewportBBox, getCurrentMapBBoxWgs84]);

  const renderF7DetailOnMap = React.useCallback((path: F7FrequentPath, detail: F7RoadDetailResponse, hoveredSegmentUid?: number | null) => {
    drawF7RoadDetail(detail);
    drawF7ViewportBBox(f7AnalysisBBoxRef.current ?? getCurrentMapBBoxWgs84() ?? {
      minLon: BEIJING_CORE_BBOX.minLon,
      minLat: BEIJING_CORE_BBOX.minLat,
      maxLon: BEIJING_CORE_BBOX.maxLon,
      maxLat: BEIJING_CORE_BBOX.maxLat,
    });
    setF7FocusedPathKey(getF7PathKey(path));
    applyF7DetailSegmentFocus(hoveredSegmentUid ?? null);
  }, [applyF7DetailSegmentFocus, drawF7RoadDetail, drawF7ViewportBBox, getCurrentMapBBoxWgs84]);

  const renderF8RoutesOnMap = React.useCallback((result: F8FrequentRoutesResponse, focusedRouteKey?: string | null, animatingRouteKey?: string | null) => {
    drawF8FrequentRoutes(result);
    if (focusedRouteKey || animatingRouteKey) {
      applyF8RouteFocus(animatingRouteKey ?? focusedRouteKey ?? null);
    }
  }, [applyF8RouteFocus, drawF8FrequentRoutes]);


  const renderSelectedF8RecommendationOnMap = React.useCallback((result: F8FrequentRoutesResponse, routeKey: string) => {
    const items = (result.corridors?.length ? result.corridors : result.routes) ?? [];
    const picked = items.find((item) => {
      const signature = 'corridor_signature' in item ? item.corridor_signature : item.route_signature;
      return signature === routeKey;
    });
    if (!picked) {
      renderF8RoutesOnMap(result, null, null);
      return;
    }
    drawF8FrequentRoutes({
      routes: [{
        rank: 1,
        route_signature: routeKey,
        route_signature_array: routeKey.split(' > ').filter(Boolean),
        trip_count: picked.trip_count,
        vehicle_count: picked.vehicle_count,
        avg_duration_min: picked.avg_duration_min ?? null,
        p20_duration_min: picked.p20_duration_min ?? null,
        p50_duration_min: picked.p50_duration_min ?? null,
        p90_duration_min: picked.p90_duration_min ?? null,
        route_length_m: ('route_length_m' in picked ? picked.route_length_m : picked.avg_route_length_m) ?? 0,
        avg_route_length_m: ('avg_route_length_m' in picked ? picked.avg_route_length_m : picked.route_length_m) ?? 0,
        edge_count: routeKey.split(' > ').filter(Boolean).length,
        durations_by_hour: ('durations_by_hour' in picked ? picked.durations_by_hour : undefined) ?? {},
        trip_count_by_hour: ('trip_count_by_hour' in picked ? picked.trip_count_by_hour : undefined) ?? {},
        geometry: picked.geometry,
      }],
      summary: {
        route_count: 1,
        candidate_trip_count: Number(picked.trip_count || 0),
        total_route_count_before_top_k: 1,
        top_k_trip_count: Number(picked.trip_count || 0),
        total_ranked_trip_count: Number(picked.trip_count || 0),
        top_k_ratio: 1,
        max_trip_count: Math.max(1, Number(picked.trip_count || 0)),
      },
    });
  }, [drawF8FrequentRoutes, renderF8RoutesOnMap]);

  const runDecisionF7 = React.useCallback(async () => {
    const analysisBBox = demoReadonly
      ? DEMO_F7_VIEWPORT_BBOX
      : getCurrentMapBBoxWgs84();
    if (!analysisBBox) {
      setStatus('error');
      setAnalysisResult({
        title: 'F7 运行失败',
        subtitle: '无法读取当前地图视窗',
        metrics: [{ label: '状态', value: '请等待地图就绪' }],
      });
      return;
    }

    const appliedRange: [number, number] = [queryTimeRange[0], queryTimeRange[1]];
    beginRunningTask('F7', '高频道路走廊');
    setF7DecisionLoading(true);
    setF4MapInteractionEnabled(false);
    try {
      f7AnalysisBBoxRef.current = analysisBBox;
      const result = demoReadonly
        ? DEMO_FIXTURE.f7 as F7FrequentPathsResponse
        : await queryF7FrequentPaths({
          startTime: toBackendTime(appliedRange[0]),
          endTime: toBackendTime(appliedRange[1]),
          analysisBBox,
          topK: f7TopK,
          minGroupLengthM: f7MinLengthMeters,
          scope: 'bbox',
          sortMode: 'frequency',
        });
      if (result.meta?.error) throw new Error(result.meta.error);
      setF7Result(result);
      setF7RoadDetail(null);
      setF7SelectedPath(null);
      setF7HoveredSegmentUid(null);
      setF7ViewMode('overview');
      clearF7DetailOverlays();
      setDisplayedTimeRange(appliedRange);
      setDecisionMapLayer('f7-overview');
      renderF7OverviewOnMap(result, null);
      setStatus(result.summary.path_count > 0 ? 'ready' : 'empty');
      setAnalysisResult({
        title: '决策建议结果',
        subtitle: 'F7 · 高频道路走廊',
        metrics: [
          { label: '返回路径', value: formatInt(result.summary.path_count) },
          { label: '候选路径', value: formatInt(result.summary.total_path_count_before_top_k) },
          { label: 'Top-K 行程', value: formatInt(result.summary.top_k_trip_count) },
        ],
        note: result.meta?.elapsed_ms != null ? `后端耗时 ${(Number(result.meta.elapsed_ms) / 1000).toFixed(2)}s` : undefined,
      });
    } catch (error) {
      setStatus('error');
      setAnalysisResult({
        title: 'F7 运行失败',
        subtitle: error instanceof Error ? error.message : '接口调用异常',
        metrics: [{ label: '状态', value: '失败' }],
      });
    } finally {
      setF4MapInteractionEnabled(true);
      setF7DecisionLoading(false);
      finishRunningTask('F7');
    }
  }, [beginRunningTask, clearF7DetailOverlays, demoReadonly, f7MinLengthMeters, f7Scope, f7SortMode, f7TopK, finishRunningTask, getCurrentMapBBoxWgs84, queryTimeRange, renderF7OverviewOnMap, setF4MapInteractionEnabled]);

  const runDecisionF8 = React.useCallback(async () => {
    const areaA = demoReadonly ? DEMO_FIXTURE.areas.areaA : f5AreaPayloadRef.current.A;
    const areaB = demoReadonly ? DEMO_FIXTURE.areas.areaB : f5AreaPayloadRef.current.B;
    if (!areaA || !areaB) {
      setStatus('error');
      setAnalysisResult({
        title: 'F8 运行失败',
        subtitle: '请先绘制区域 A 和区域 B',
        metrics: [
          { label: '区域 A', value: areaA ? '已绘制' : '未绘制' },
          { label: '区域 B', value: areaB ? '已绘制' : '未绘制' },
        ],
      });
      return;
    }

    const appliedRange: [number, number] = [queryTimeRange[0], queryTimeRange[1]];
    invalidateF8F9TaskState({ keepAreas: true });
    if (demoReadonly) renderDemoPresetRegionBoxes('decision');
    const requestId = f8RequestIdRef.current;
    beginRunningTask('F8', 'A/B 高频路径');
    setF8DecisionLoading(true);
    try {
      const result = demoReadonly
        ? DEMO_FIXTURE.f8 as F8FrequentRoutesResponse
        : await queryF8ABFrequentRoutes({
          startTime: toBackendTime(appliedRange[0]),
          endTime: toBackendTime(appliedRange[1]),
          areaA,
          areaB,
          topK: f8TopK,
          candidateMode: f8CandidateMode,
          bufferMeters: F8_DEFAULT_BUFFER_METERS,
          minSupport: recommendF8MinSupport(appliedRange),
          minEdgeLengthM: F8_DEFAULT_MIN_EDGE_LENGTH_M,
          minRouteLengthM: F8_DEFAULT_MIN_ROUTE_LENGTH_M,
          maxCandidateTrips: F8_INTERACTIVE_MAX_CANDIDATE_TRIPS,
        });
      if (requestId !== f8RequestIdRef.current) return;
      if (result.meta?.error) throw new Error(result.meta.error);
      setF8Result(result);
      setDisplayedTimeRange(appliedRange);
      setDecisionMapLayer('f8');
      renderF8RoutesOnMap(result, null, null);
      setStatus(result.summary.route_count > 0 ? 'ready' : 'empty');
      setAnalysisResult({
        title: '决策建议结果',
        subtitle: 'F8 · A/B 高频路径',
        metrics: [
          { label: '有效 A→B', value: formatInt(result.summary.valid_ab_trip_count ?? 0) },
          { label: '返回走廊', value: formatInt(result.summary.route_count) },
          { label: 'Top-K 覆盖', value: formatInt(result.summary.top_k_trip_count) },
        ],
        note: result.meta?.elapsed_ms != null ? `后端耗时 ${(Number(result.meta.elapsed_ms) / 1000).toFixed(2)}s` : undefined,
      });
    } catch (error) {
      if (requestId !== f8RequestIdRef.current) return;
      setStatus('error');
      setAnalysisResult({
        title: 'F8 运行失败',
        subtitle: error instanceof Error ? error.message : '接口调用异常',
        metrics: [{ label: '状态', value: '失败' }],
      });
    } finally {
      if (requestId === f8RequestIdRef.current) {
        setF8DecisionLoading(false);
        finishRunningTask('F8');
      }
    }
  }, [beginRunningTask, demoReadonly, f8CandidateMode, f8TopK, finishRunningTask, invalidateF8F9TaskState, queryTimeRange, renderDemoPresetRegionBoxes, renderF8RoutesOnMap]);


  const setF6RegionFocus = React.useCallback((regionId: string | null) => {
    Object.entries(f6RegionOverlayGroupsRef.current).forEach(([currentRegionId, entries]) => {
      entries.forEach((entry) => {
        entry.overlay.setOptions?.(regionId == null ? entry.base : currentRegionId === regionId ? entry.focus : entry.dim);
      });
    });
  }, []);

  const drawF5FlowLine = React.useCallback((result: F5ABFlowResponse) => {
    const amapInstance = amap;
    const map = mapRef.current;
    const areaA = f5AreaPayloadRef.current.A;
    const areaB = f5AreaPayloadRef.current.B;
    if (!amapInstance || !map || !areaA || !areaB || !result.summary?.total) return;
    clearF5FlowOverlays();

    const pointA = wgs84ToGcj02(...getBBoxCenter(areaA));
    const pointB = wgs84ToGcj02(...getBBoxCenter(areaB));
    const dx = pointB[0] - pointA[0];
    const dy = pointB[1] - pointA[1];
    const baseLen = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy));
    const normal: [number, number] = [-dy / baseLen, dx / baseLen];
    const curveOffset = Math.min(0.045, Math.max(0.004, baseLen * 0.22));
    const overlays: any[] = [];
    const pulseEntries: typeof f5PulseRef.current.entries = [];

    const buildDirection = (direction: 'A_TO_B' | 'B_TO_A', flowCount: number, color: string, sign: 1 | -1) => {
      if (flowCount <= 0) return;
      const from = direction === 'A_TO_B' ? pointA : pointB;
      const to = direction === 'A_TO_B' ? pointB : pointA;
      const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      const control: [number, number] = [mid[0] + normal[0] * curveOffset * sign, mid[1] + normal[1] * curveOffset * sign];
      const path = buildBezierCurvePoints(from, control, to, 56);
      const width = Math.max(3, Math.min(12, 2 + Math.log2(Math.max(2, flowCount))));
      const line = new amapInstance.Polyline({
        path,
        strokeColor: color,
        strokeOpacity: 0.95,
        strokeWeight: width,
        lineJoin: 'round',
        lineCap: 'round',
        zIndex: 150,
        showDir: true,
      });
      overlays.push(line);
      overlays.push(new amapInstance.Text({
        text: `${flowCount}`,
        position: getBezierPoint(from, control, to, 0.5),
        anchor: 'center',
        offset: new amapInstance.Pixel(0, -2),
        style: {
          background: 'rgba(15,23,42,0.82)',
          border: `1px solid ${color}`,
          color: '#f8fafc',
          padding: '3px 8px',
          borderRadius: '6px',
          fontSize: '12px',
          lineHeight: '14px',
          fontWeight: '700',
        },
        zIndex: 152,
      }));
      const pulse = new amapInstance.CircleMarker({
        center: from,
        radius: Math.max(4, Math.min(8, width)),
        strokeColor: '#ffffff',
        strokeWeight: 1,
        strokeOpacity: 0.9,
        fillColor: color,
        fillOpacity: 0.88,
        zIndex: 153,
      });
      overlays.push(pulse);
      pulseEntries.push({ marker: pulse, points: path, lengths: getPathLengths(path), durationMs: Math.max(2200, 6200 - Math.min(4200, flowCount * 28)), phaseMs: direction === 'A_TO_B' ? 0 : 900 });
    };

    buildDirection('A_TO_B', Number(result.summary.a_to_b_total || 0), '#2563eb', 1);
    buildDirection('B_TO_A', Number(result.summary.b_to_a_total || 0), '#f97316', -1);
    if (!overlays.length) return;
    map.add?.(overlays);
    f5FlowOverlaysRef.current = overlays;
    map.setFitView?.(overlays, false, [90, 90, 150, sidebarCollapsed ? 90 : 460]);
    f5PulseRef.current.entries = pulseEntries;

    const startedAt = performance.now();
    const tick = () => {
      const current = f5PulseRef.current;
      if (!current.entries.length) {
        current.rafId = null;
        return;
      }
      const now = performance.now();
      current.entries.forEach((entry) => {
        const local = ((now - startedAt + entry.phaseMs) % entry.durationMs) / entry.durationMs;
        entry.marker.setCenter?.(getPointOnPath(entry.points, entry.lengths, local));
      });
      current.rafId = window.requestAnimationFrame(tick);
    };
    f5PulseRef.current.rafId = window.requestAnimationFrame(tick);
  }, [amap, clearF5FlowOverlays, sidebarCollapsed]);

  const drawF6RadiationLines = React.useCallback((result: F6RadiationResponse) => {
    const amapInstance = amap;
    const map = mapRef.current;
    const coreArea = f6CoreAreaRef.current;
    if (!amapInstance || !map || !coreArea || !result.summary?.total_flow) return;
    clearF6FlowOverlays();
    const regions = Array.isArray(result.regions) ? result.regions : [];
    if (!regions.length) return;

    const corePoint = wgs84ToGcj02(...getBBoxCenter(coreArea));
    const coreRingRadius = Math.min(0.0025, Math.max(0.00018, Math.min(coreArea.maxLon - coreArea.minLon, coreArea.maxLat - coreArea.minLat) * 0.28));
    const maxRegionFlow = Math.max(1, ...regions.map((region) => Number(region.total || 0)));
    const outboundHexStops = ['#ccfbf1', '#5eead4', '#14b8a6', '#0f766e', '#134e4a'];
    const inboundHexStops = ['#fef3c7', '#fcd34d', '#f59e0b', '#d97706', '#78350f'];
    const overlays: any[] = [];
    const overlayGroups: Record<string, F6OverlayEntry[]> = {};
    const pulseEntries: typeof f6PulseRef.current.entries = [];
    const tooltip = f6TooltipRef.current ?? new amapInstance.InfoWindow({ isCustom: true, offset: new amapInstance.Pixel(12, -18), autoMove: false });
    f6TooltipRef.current = tooltip;

    const tooltipHtml = (region: F6RadiationRegion, label: string) => `
      <div style="background:rgba(15,23,42,0.82);color:#f8fafc;border:1px solid rgba(226,232,240,0.28);box-shadow:0 16px 36px rgba(15,23,42,0.30);border-radius:10px;padding:10px 12px;min-width:190px;font-size:12px;line-height:1.55;backdrop-filter:blur(12px);">
        <div style="font-weight:800;margin-bottom:4px;">H3 ${region.region_id}</div>
        <div style="color:#bfdbfe;">出向: ${Number(region.outbound_total || 0).toLocaleString('zh-CN')}</div>
        <div style="color:#fed7aa;">入向: ${Number(region.inbound_total || 0).toLocaleString('zh-CN')}</div>
        <div>总量: ${Number(region.total || 0).toLocaleString('zh-CN')} | 净流量: ${Number(region.net_flow || 0).toLocaleString('zh-CN')}</div>
        <div style="color:#cbd5e1;">主导: ${label}${region.avg_duration_min == null ? '' : ` | 均时: ${formatDurationMinutes(region.avg_duration_min)}`}</div>
      </div>`;

    const bindHover = (overlay: any, region: F6RadiationRegion, anchor: [number, number], label: string) => {
      overlay.on?.('mouseover', (evt: any) => {
        setF6RegionFocus(region.region_id);
        tooltip.setContent?.(tooltipHtml(region, label));
        tooltip.open?.(map, evt?.lnglat ?? anchor);
      });
      overlay.on?.('mouseout', () => {
        setF6RegionFocus(null);
        tooltip.close?.();
      });
    };

    regions.forEach((region, idx) => {
      const total = Number(region.total || 0);
      if (total <= 0) return;
      const regionPoint = wgs84ToGcj02(region.center[0], region.center[1]);
      const effectiveDirection: 'outbound' | 'inbound' = f6Direction === 'inbound' ? 'inbound' : f6Direction === 'outbound' ? 'outbound' : Number(region.net_flow || 0) < 0 ? 'inbound' : 'outbound';
      const directionColor = effectiveDirection === 'outbound' ? '#2dd4bf' : '#f59e0b';
      const directionLabel = effectiveDirection === 'outbound' ? '出向' : '入向';
      const anchorSeed = idx * 2.399963;
      const coreAnchor: [number, number] = [corePoint[0] + Math.cos(anchorSeed) * coreRingRadius, corePoint[1] + Math.sin(anchorSeed) * coreRingRadius];
      const from = effectiveDirection === 'outbound' ? coreAnchor : regionPoint;
      const to = effectiveDirection === 'outbound' ? regionPoint : coreAnchor;
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const baseLen = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy));
      const normal: [number, number] = [-dy / baseLen, dx / baseLen];
      const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      const curveOffset = Math.min(0.08, Math.max(0.006, baseLen * (0.2 + (idx % 4) * 0.035)));
      const control: [number, number] = [mid[0] + normal[0] * curveOffset * (idx % 2 === 0 ? 1 : -1), mid[1] + normal[1] * curveOffset * (idx % 2 === 0 ? 1 : -1)];
      const path = buildBezierCurvePoints(from, control, to, 48);
      const flowRatio = total / maxRegionFlow;
      const visualRatio = Math.pow(flowRatio, 0.45);
      const hexColor = steppedColor(effectiveDirection === 'outbound' ? outboundHexStops : inboundHexStops, Math.max(0.18, Math.sqrt(flowRatio)));
      const width = Math.max(1, Math.min(8, 1 + visualRatio * 7));
      const opacity = Math.max(0.2, Math.min(0.82, 0.18 + visualRatio * 0.64));
      overlayGroups[region.region_id] = [];

      if (Array.isArray(region.boundary) && region.boundary.length >= 3) {
        const hexPath = region.boundary.map(([lng, lat]) => wgs84ToGcj02(lng, lat));
        const hexOpacity = Math.max(0.20, Math.min(0.56, 0.18 + Math.sqrt(flowRatio) * 0.38));
        const hex = new amapInstance.Polygon({ path: hexPath, fillColor: hexColor, fillOpacity: hexOpacity, strokeColor: hexColor, strokeWeight: 0, strokeOpacity: 0, zIndex: 120 });
        bindHover(hex, region, regionPoint, directionLabel);
        overlays.push(hex);
        overlayGroups[region.region_id].push({
          overlay: hex,
          base: { fillColor: hexColor, fillOpacity: hexOpacity, strokeColor: hexColor, strokeWeight: 0, strokeOpacity: 0, zIndex: 120 },
          dim: { fillColor: hexColor, fillOpacity: 0.06, strokeColor: hexColor, strokeWeight: 0, strokeOpacity: 0, zIndex: 100 },
          focus: { fillColor: hexColor, fillOpacity: Math.min(0.72, hexOpacity + 0.14), strokeColor: directionColor, strokeWeight: 2, strokeOpacity: 0.95, zIndex: 180 },
        });
      }

      const line = new amapInstance.Polyline({ path, strokeColor: directionColor, strokeOpacity: opacity, strokeWeight: width, lineJoin: 'round', lineCap: 'round', zIndex: 140, showDir: true });
      bindHover(line, region, getBezierPoint(from, control, to, 0.55), directionLabel);
      overlays.push(line);
      overlayGroups[region.region_id].push({
        overlay: line,
        base: { strokeOpacity: opacity, strokeWeight: width, zIndex: 140 },
        dim: { strokeOpacity: 0.05, strokeWeight: 1, zIndex: 105 },
        focus: { strokeOpacity: 0.96, strokeWeight: Math.min(10, width + 2), zIndex: 182 },
      });

      const pulse = new amapInstance.CircleMarker({ center: from, radius: Math.max(3, Math.min(7, width)), strokeColor: '#f8fafc', strokeWeight: 1, strokeOpacity: 0.95, fillColor: directionColor, fillOpacity: 0.92, zIndex: 160 });
      bindHover(pulse, region, from, directionLabel);
      overlays.push(pulse);
      overlayGroups[region.region_id].push({
        overlay: pulse,
        base: { strokeOpacity: 0.95, fillOpacity: 0.86, zIndex: 160 },
        dim: { strokeOpacity: 0.08, fillOpacity: 0.08, zIndex: 106 },
        focus: { strokeOpacity: 1, fillOpacity: 1, zIndex: 184 },
      });
      pulseEntries.push({ marker: pulse, points: path, lengths: getPathLengths(path), durationMs: Math.max(2400, 7200 - Math.min(4600, total * 18)), phaseMs: idx * 180 });
    });

    if (!overlays.length) return;
    map.add?.(overlays);
    f6FlowOverlaysRef.current = overlays;
    f6RegionOverlayGroupsRef.current = overlayGroups;
    map.setFitView?.(overlays, false, [90, 90, 150, sidebarCollapsed ? 90 : 460]);
    f6PulseRef.current.entries = pulseEntries;
    const startedAt = performance.now();
    const tick = () => {
      const current = f6PulseRef.current;
      if (!current.entries.length) {
        current.rafId = null;
        return;
      }
      const now = performance.now();
      current.entries.forEach((entry) => {
        const local = ((now - startedAt + entry.phaseMs) % entry.durationMs) / entry.durationMs;
        entry.marker.setCenter?.(getPointOnPath(entry.points, entry.lengths, local));
      });
      current.rafId = window.requestAnimationFrame(tick);
    };
    f6PulseRef.current.rafId = window.requestAnimationFrame(tick);
  }, [amap, clearF6FlowOverlays, f6Direction, setF6RegionFocus, sidebarCollapsed]);

  React.useEffect(() => {
    if (mode !== 'region' || activeRegionTool !== 'f4') {
      f4RequestIdRef.current += 1;
      clearF4Layer();
      setF4GeneralizationUnlocked(false);
      setF4Generalizing(false);
      setF4Generating(false);
      setF4MapInteractionEnabled(true);
      f4LastRenderedResolutionRef.current = null;
    }
  }, [activeRegionTool, clearF4Layer, mode]);

  const setTripOverlayPath = React.useCallback((tripId: string, path: Array<[number, number]>) => {
    const group = trajectoryOverlayGroupsRef.current.get(tripId);
    if (!group) return;
    group.overlays.forEach((overlay) => {
      if (overlay.setPath) {
        overlay.setPath(path);
      } else {
        overlay.setOptions?.({ path });
      }
    });
  }, []);

  const setTripPlaybackMarker = React.useCallback((tripId: string, point?: [number, number] | null) => {
    const marker = trajectoryOverlayGroupsRef.current.get(tripId)?.playbackMarker;
    if (!marker) return;
    if (!point) {
      marker.setOptions?.({ fillOpacity: 0, strokeOpacity: 0 });
      marker.hide?.();
      return;
    }
    marker.show?.();
    marker.setPosition?.(point);
    marker.setCenter?.(point);
    marker.setOptions?.({
      center: point,
      position: point,
      radius: 6,
      strokeColor: '#ffffff',
      strokeWeight: 2,
      fillOpacity: 1,
      strokeOpacity: 1,
      fillColor: '#f472b6',
      zIndex: 260,
    });
  }, []);

  const setTripEndpointMarkers = React.useCallback((tripId: string, showStart: boolean, showEnd: boolean) => {
    const group = trajectoryOverlayGroupsRef.current.get(tripId);
    if (!group) return;
    if (showStart) group.startMarker?.show?.();
    else group.startMarker?.hide?.();
    group.startMarker?.setOptions?.({
      opacity: showStart ? 1 : 0,
      zIndex: 145,
    });
    if (showEnd) group.endMarker?.show?.();
    else group.endMarker?.hide?.();
    group.endMarker?.setOptions?.({
      opacity: showEnd ? 1 : 0,
      zIndex: 145,
    });
  }, []);

  const restoreTripPlayback = React.useCallback((tripId?: string | null) => {
    const targetTripId = tripId ?? trajectoryPlaybackRef.current.tripId;
    if (!targetTripId) return;
    const group = trajectoryOverlayGroupsRef.current.get(targetTripId);
    if (!group) return;
    if (trajectoryPlaybackRef.current.rafId != null) {
      window.cancelAnimationFrame(trajectoryPlaybackRef.current.rafId);
    }
    trajectoryPlaybackRef.current = { rafId: null, tripId: null, startedAt: 0, elapsedMs: 0, durationMs: 0, fullPath: [], pathLengths: [] };
    setTripOverlayPath(targetTripId, group.displayPath);
    setTripPlaybackMarker(targetTripId, null);
    setTripEndpointMarkers(targetTripId, selectedTripId === targetTripId && !showOtherTrips, selectedTripId === targetTripId && !showOtherTrips);
    setPlaybackState({ tripId: null, status: 'idle' });
  }, [selectedTripId, setTripEndpointMarkers, setTripOverlayPath, setTripPlaybackMarker, showOtherTrips]);

  const applyTrajectorySelection = React.useCallback((activeTripId: string | null, shouldFit = false) => {
    const map = mapRef.current;
    if (!map) return;
    if (trajectoryFocusTimerRef.current != null) {
      window.clearTimeout(trajectoryFocusTimerRef.current);
      trajectoryFocusTimerRef.current = null;
    }

    const {
      detailOpen: currentDetailOpen,
      showOtherTrips: currentShowOtherTrips,
      sidebarCollapsed: currentSidebarCollapsed,
      useMapVMode: currentUseMapVMode,
    } = trajectorySelectionUiRef.current;
    const hasSelection = activeTripId != null;
    const passiveStrokeWeight = currentUseMapVMode ? 2.4 : 3.6;
    const passiveStrokeOpacity = currentUseMapVMode ? 0.78 : 0.92;
    const passiveGlowOpacity = currentUseMapVMode ? 0.08 : 0.24;
    const passiveGlowWeight = currentUseMapVMode ? 3.8 : 6;
    const visibleOverlays: any[] = [];
    const activeOverlays: any[] = [];

    trajectoryOverlayGroupsRef.current.forEach((group, tripId) => {
      const selected = activeTripId === tripId;
      const visible = !hasSelection || currentShowOtherTrips || selected;
      const [glow, line] = group.overlays;
      glow?.setOptions?.({
        strokeOpacity: visible ? passiveGlowOpacity : 0,
        strokeWeight: passiveGlowWeight,
        zIndex: selected ? 118 : 92,
      });
      line?.setOptions?.({
        strokeOpacity: visible ? passiveStrokeOpacity : 0,
        strokeWeight: passiveStrokeWeight,
        zIndex: selected ? 120 : 96,
      });
      group.markers.forEach((marker) => {
        marker.setOptions?.({
          fillOpacity: visible ? (selected ? 0.95 : 0.55) : 0,
          strokeOpacity: visible ? 1 : 0,
          radius: selected ? 3.2 : 2.2,
          zIndex: selected ? 125 : 94,
        });
      });
      const endpointVisible = selected && !currentShowOtherTrips;
      const playbackInProgress = trajectoryPlaybackRef.current.tripId === tripId;
      setTripEndpointMarkers(tripId, endpointVisible, endpointVisible && !playbackInProgress);
      const endpointMarkers = [group.startMarker, group.endMarker].filter(Boolean);
      if (visible) visibleOverlays.push(...group.overlays, ...group.markers, ...endpointMarkers);
      if (selected) activeOverlays.push(...group.overlays, ...group.markers, ...endpointMarkers);
    });

    if (shouldFit) {
      const fitOverlays = hasSelection ? activeOverlays : visibleOverlays;
      if (fitOverlays.length) {
        const fitVisibleTrips = () => {
          const rightPadding = currentDetailOpen ? 380 : 110;
          const bottomPadding = 120;
          const leftPadding = currentSidebarCollapsed ? 80 : 460;
          map.resize?.();
          map.setFitView(fitOverlays, false, [
            hasSelection ? 96 : 64,
            rightPadding,
            bottomPadding,
            leftPadding,
          ], 17);
        };
        window.requestAnimationFrame(fitVisibleTrips);
        trajectoryFocusTimerRef.current = window.setTimeout(fitVisibleTrips, 120);
      }
    }
  }, [setTripEndpointMarkers]);

  const startTripPlayback = React.useCallback((trip: TrajectoryTripCard, resume = false) => {
    const group = trajectoryOverlayGroupsRef.current.get(trip.id);
    if (!group || group.playbackPath.length < 2) return;
    const currentTripId = trajectoryPlaybackRef.current.tripId;
    if (currentTripId && currentTripId !== trip.id) {
      restoreTripPlayback(currentTripId);
    }
    if (trajectoryPlaybackRef.current.rafId != null) {
      window.cancelAnimationFrame(trajectoryPlaybackRef.current.rafId);
      trajectoryPlaybackRef.current.rafId = null;
    }

    setSelectedTripId(trip.id);
    setShowOtherTrips(false);
    applyTrajectorySelection(trip.id, false);
    setTripEndpointMarkers(trip.id, true, false);

    const durationMs = resume && trajectoryPlaybackRef.current.tripId === trip.id
      ? trajectoryPlaybackRef.current.durationMs
      : Math.max(2600, Math.min(12000, group.playbackPath.length * 18));
    const elapsedMs = resume && trajectoryPlaybackRef.current.tripId === trip.id
      ? trajectoryPlaybackRef.current.elapsedMs
      : 0;

    trajectoryPlaybackRef.current = {
      rafId: null,
      tripId: trip.id,
      startedAt: performance.now() - elapsedMs,
      elapsedMs,
      durationMs,
      fullPath: group.playbackPath,
      pathLengths: getPathLengths(group.playbackPath),
    };
    setPlaybackState({ tripId: trip.id, status: 'playing' });

    const tick = (now: number) => {
      const current = trajectoryPlaybackRef.current;
      if (current.tripId !== trip.id) return;
      const elapsed = Math.max(0, now - current.startedAt);
      const progress = Math.max(0, Math.min(1, elapsed / current.durationMs));
      current.elapsedMs = elapsed;
      setTripOverlayPath(trip.id, getPartialPathByRatio(current.fullPath, current.pathLengths, progress));
      setTripPlaybackMarker(trip.id, getPointOnPath(current.fullPath, current.pathLengths, progress));
      if (progress < 1) {
        current.rafId = window.requestAnimationFrame(tick);
      } else {
        setTripOverlayPath(trip.id, current.fullPath);
        setTripPlaybackMarker(trip.id, null);
        trajectoryPlaybackRef.current = { rafId: null, tripId: null, startedAt: 0, elapsedMs: 0, durationMs: 0, fullPath: [], pathLengths: [] };
        setTripEndpointMarkers(trip.id, true, true);
        setPlaybackState({ tripId: null, status: 'idle' });
      }
    };

    const initialProgress = Math.max(0, Math.min(1, elapsedMs / durationMs));
    const initialPathLengths = trajectoryPlaybackRef.current.pathLengths;
    setTripOverlayPath(trip.id, getPartialPathByRatio(group.playbackPath, initialPathLengths, initialProgress));
    setTripPlaybackMarker(trip.id, getPointOnPath(group.playbackPath, initialPathLengths, initialProgress));
    trajectoryPlaybackRef.current.rafId = window.requestAnimationFrame(tick);
  }, [applyTrajectorySelection, restoreTripPlayback, setTripEndpointMarkers, setTripOverlayPath, setTripPlaybackMarker]);

  const pauseTripPlayback = React.useCallback(() => {
    const current = trajectoryPlaybackRef.current;
    if (!current.tripId) return;
    if (current.rafId != null) {
      window.cancelAnimationFrame(current.rafId);
      current.rafId = null;
    }
    current.elapsedMs = Math.max(0, performance.now() - current.startedAt);
    setPlaybackState({ tripId: current.tripId, status: 'paused' });
  }, []);

  const toggleTripPlayback = React.useCallback((trip: TrajectoryTripCard) => {
    if (playbackState.tripId === trip.id && playbackState.status === 'playing') {
      pauseTripPlayback();
      return;
    }
    startTripPlayback(trip, playbackState.tripId === trip.id && playbackState.status === 'paused');
  }, [pauseTripPlayback, playbackState, startTripPlayback]);

  const renderTrajectoryTrips = React.useCallback((trips: TrajectoryTripCard[], activeTripId: string | null = selectedTripId, shouldFit = true) => {
    const amapInstance = amap;
    const map = mapRef.current;
    if (!amapInstance || !map) return;
    clearTrajectoryOverlays();

    const overlays: any[] = [];
    const groups = new globalThis.Map<string, TrajectoryOverlayGroup>();
    trips.forEach((trip) => {
      const displaySource = showMatchedMode && trip.matchedCoordinates?.length
        ? trip.matchedCoordinates
        : trip.coordinates;
      const gcjDisplayPath = displaySource.map(([lng, lat]) => wgs84ToGcj02(lng, lat));
      if (gcjDisplayPath.length >= 2) {
        const color = hashColor(trip.id);
        const glow = new amapInstance.Polyline({
          path: gcjDisplayPath,
          strokeColor: '#e0f2fe',
          strokeOpacity: 0,
          strokeWeight: 6,
          lineJoin: 'round',
          lineCap: 'round',
          zIndex: 92,
        });
        const line = new amapInstance.Polyline({
          path: gcjDisplayPath,
          strokeColor: color,
          strokeOpacity: 0,
          strokeWeight: 3.6,
          lineJoin: 'round',
          lineCap: 'round',
          zIndex: 96,
        });
        line.on?.('click', () => {
          if (trajectoryPlaybackRef.current.tripId && trajectoryPlaybackRef.current.tripId !== trip.id) {
            restoreTripPlayback(trajectoryPlaybackRef.current.tripId);
          }
          setSelectedTripId(trip.id);
          applyTrajectorySelection(trip.id, true);
        });
        glow.on?.('click', () => {
          if (trajectoryPlaybackRef.current.tripId && trajectoryPlaybackRef.current.tripId !== trip.id) {
            restoreTripPlayback(trajectoryPlaybackRef.current.tripId);
          }
          setSelectedTripId(trip.id);
          applyTrajectorySelection(trip.id, true);
        });
        const markers: any[] = [];
        const playbackMarker = new amapInstance.Marker({
          position: gcjDisplayPath[0],
          content: '<div style="width:12px;height:12px;border-radius:9999px;background:#f472b6;border:2px solid #fff;box-shadow:0 0 0 2px rgba(244,114,182,.24),0 0 14px rgba(244,114,182,.6);"></div>',
          offset: new amapInstance.Pixel(-6, -6),
          zIndex: 260,
        });
        playbackMarker?.hide?.();
        const endpointsClose = areMapPointsVisuallyClose(map, gcjDisplayPath[0], gcjDisplayPath[gcjDisplayPath.length - 1]);
        const startMarker = new amapInstance.Marker({
          position: gcjDisplayPath[0],
          content: endpointMarkerContent('S', '#ef4444'),
          offset: new amapInstance.Pixel(endpointsClose ? -23 : -11, -25),
          zIndex: 245,
        });
        startMarker?.hide?.();
        const endMarker = new amapInstance.Marker({
          position: gcjDisplayPath[gcjDisplayPath.length - 1],
          content: endpointMarkerContent('E', '#22c55e'),
          offset: new amapInstance.Pixel(endpointsClose ? 1 : -11, -25),
          zIndex: 246,
        });
        endMarker?.hide?.();

        if (!showMatchedMode && trip.coordinates.length) {
          const step = Math.max(1, Math.floor(trip.coordinates.length / 80));
          trip.coordinates.filter((_, index) => index % step === 0).forEach(([lng, lat]) => {
            const marker = new amapInstance.CircleMarker({
              center: wgs84ToGcj02(lng, lat),
              radius: 2.2,
              strokeColor: '#0f172a',
              strokeWeight: 1,
              strokeOpacity: 0,
              fillColor: '#38bdf8',
              fillOpacity: 0,
              zIndex: 94,
            });
            markers.push(marker);
          });
        }

        overlays.push(
          glow,
          line,
          ...markers,
          ...(startMarker ? [startMarker] : []),
          ...(endMarker ? [endMarker] : []),
          ...(playbackMarker ? [playbackMarker] : []),
        );
        groups.set(trip.id, {
          overlays: [glow, line],
          markers,
          playbackMarker,
          startMarker,
          endMarker,
          displayPath: gcjDisplayPath,
          playbackPath: gcjDisplayPath,
        });
      }
    });

    if (overlays.length) {
      map.add(overlays);
      trajectoryOverlaysRef.current = overlays;
      trajectoryOverlayGroupsRef.current = groups;
      applyTrajectorySelection(activeTripId, shouldFit);
    }
  }, [amap, applyTrajectorySelection, clearTrajectoryOverlays, restoreTripPlayback, selectedTripId, showMatchedMode]);

  React.useEffect(() => {
    if (mode === 'trajectory' && tripCards.some((trip) => trip.coordinates.length >= 2)) {
      renderTrajectoryTrips(tripCards);
    }
  }, [mode, renderTrajectoryTrips, tripCards]);

  React.useEffect(() => {
    applyTrajectorySelection(selectedTripId, false);
  }, [applyTrajectorySelection, selectedTripId, showOtherTrips, useMapVMode]);

  const toggleShowOtherTrips = React.useCallback(() => {
    setShowOtherTrips((current) => {
      const next = !current;
      trajectorySelectionUiRef.current = {
        ...trajectorySelectionUiRef.current,
        showOtherTrips: next,
      };
      applyTrajectorySelection(selectedTripId, false);
      return next;
    });
  }, [applyTrajectorySelection, selectedTripId]);

  const exportTripJson = React.useCallback((trip: TrajectoryTripCard) => {
    const payload = {
      exported_at: new Date().toISOString(),
      query: {
        taxi_id: trajectoryTarget || null,
        time_range: {
          start_time: toBackendTime(displayedTimeRange[0]),
          end_time: toBackendTime(displayedTimeRange[1]),
        },
        show_matched_mode: showMatchedMode,
        use_mapv_mode: useMapVMode,
      },
      trip: {
        key: trip.id,
        trip_id: trip.tripId,
        taxi_id: trip.taxiId ?? (trajectoryTarget ? Number(trajectoryTarget) : null),
        status: trip.status,
        start_time: trip.startTime ?? null,
        end_time: trip.endTime ?? null,
        duration: trip.duration,
        distance_km: Number(trip.distanceKm.toFixed(6)),
        point_count: trip.points,
        coordinates_wgs84: trip.coordinates,
        matched_coordinates_wgs84: trip.matchedCoordinates ?? null,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const taxiPart = payload.trip.taxi_id == null ? 'all' : `taxi-${payload.trip.taxi_id}`;
    link.href = url;
    link.download = `${taxiPart}-trip-${trip.tripId || trip.index}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [displayedTimeRange, showMatchedMode, trajectoryTarget, useMapVMode]);

  const clearF3Selection = React.useCallback(() => {
    if (mouseToolRef.current && f3DrawHandlerRef.current) {
      mouseToolRef.current.off?.('draw', f3DrawHandlerRef.current);
      f3DrawHandlerRef.current = null;
    }
    mouseToolRef.current?.close?.(false);
    if (mapRef.current && f3BBoxOverlaysRef.current.length) {
      mapRef.current.remove?.(f3BBoxOverlaysRef.current);
    }
    f3BBoxPayloadsRef.current = [];
    f3BBoxOverlaysRef.current = [];
    f3MatchedTripIdsByTaxiRef.current = new globalThis.Map();
    f3OverlayRequestIdRef.current += 1;
    clearTrajectoryOverlays();
    setF3Drawing(false);
    setF3Loading(false);
    setF3Rows([]);
    setF3BoxSummaries([]);
    setF3ResultHint('');
    setF3SelectedTaxiId(null);
    setF3DetailsExpanded(false);
    setTripCards([]);
    setSelectedTripId(null);
    setF3Page(1);
    setStatus('idle');
  }, [clearTrajectoryOverlays]);

  const runF3DrawRectangle = React.useCallback(() => {
    if (f3Loading) return;
    if (!mapRef.current || !mouseToolRef.current) {
      setF3ResultHint('地图工具尚未初始化，请稍后再试。');
      return;
    }

    const mouseTool = mouseToolRef.current;
    const nextBoxIndex = f3BBoxPayloadsRef.current.length + 1;
    const nextBoxColor = F3_BOX_COLORS[(nextBoxIndex - 1) % F3_BOX_COLORS.length];

    if (f3DrawHandlerRef.current) {
      mouseTool.off?.('draw', f3DrawHandlerRef.current);
      f3DrawHandlerRef.current = null;
    }

    setF3Drawing(true);
    setF3ResultHint('请在地图上拖拽绘制矩形选区。');
    mouseTool.close?.(false);

    const onDraw = (evt: unknown) => {
      f3DrawHandlerRef.current = null;
      mouseTool.off?.('draw', onDraw);
      mouseTool.close?.(false);
      setF3Drawing(false);

      try {
        const drawEvt = evt as {
          obj?: {
            getBounds?: () => {
              getSouthWest: () => unknown;
              getNorthEast: () => unknown;
            };
            setOptions?: (options: Record<string, unknown>) => void;
          };
        };
        const rect = drawEvt.obj;
        const bounds = rect?.getBounds?.();
        const swPoint = bounds ? readLngLatLike(bounds.getSouthWest()) : null;
        const nePoint = bounds ? readLngLatLike(bounds.getNorthEast()) : null;
        if (!swPoint || !nePoint) {
          throw new Error('矩形坐标解析失败，请重新框选');
        }

        const minLon = Math.min(swPoint[0], nePoint[0]);
        const maxLon = Math.max(swPoint[0], nePoint[0]);
        const minLat = Math.min(swPoint[1], nePoint[1]);
        const maxLat = Math.max(swPoint[1], nePoint[1]);
        const lonSpan = maxLon - minLon;
        const latSpan = maxLat - minLat;

        if (lonSpan < 0.0003 || latSpan < 0.0003) {
          if (rect && mapRef.current) mapRef.current.remove?.([rect]);
          setF3ResultHint('框选区域过小，请拖拽更大范围。');
          return;
        }
        if (lonSpan > 0.45 || latSpan > 0.35 || lonSpan * latSpan > 0.08) {
          if (rect && mapRef.current) mapRef.current.remove?.([rect]);
          setF3ResultHint('框选范围过大，为保证性能请缩小范围后重试。');
          return;
        }

        rect?.setOptions?.({
          strokeColor: nextBoxColor,
          strokeOpacity: 0.9,
          strokeWeight: 2,
          fillColor: nextBoxColor,
          fillOpacity: 0.18,
        });
        if (rect) f3BBoxOverlaysRef.current = [...f3BBoxOverlaysRef.current, rect];

        const swWgs = gcj02ToWgs84(minLon, minLat);
        const neWgs = gcj02ToWgs84(maxLon, maxLat);
        const payload = {
          minLon: Math.min(swWgs[0], neWgs[0]),
          minLat: Math.min(swWgs[1], neWgs[1]),
          maxLon: Math.max(swWgs[0], neWgs[0]),
          maxLat: Math.max(swWgs[1], neWgs[1]),
        };
        f3BBoxPayloadsRef.current = [...f3BBoxPayloadsRef.current, payload];
        f3MatchedTripIdsByTaxiRef.current = new globalThis.Map();
        setF3Rows([]);
        setF3BoxSummaries([]);
        setF3SelectedTaxiId(null);
        setF3DetailsExpanded(false);
        setTripCards([]);
        setSelectedTripId(null);
        setF3Page(1);
        setF3ResultHint(`已添加选区 #${nextBoxIndex}，点击查询获取车辆统计。`);
        setStatus('idle');
      } catch (error) {
        setF3ResultHint(error instanceof Error ? error.message : '区域框选失败');
        setStatus('error');
      }
    };

    f3DrawHandlerRef.current = onDraw;
    mouseTool.on?.('draw', onDraw);
    mouseTool.rectangle?.({
      strokeColor: nextBoxColor,
      strokeOpacity: 0.9,
      strokeWeight: 2,
      fillColor: nextBoxColor,
      fillOpacity: 0.18,
    });
  }, [f3Loading]);

  const runF3QueryByRectangles = React.useCallback(async () => {
    const bboxes = f3BBoxPayloadsRef.current;
    if (!bboxes.length) {
      setF3ResultHint('请先绘制至少一个矩形选区。');
      showValidationNotice('F3 请先绘制至少一个矩形选区，再执行查询。');
      return;
    }

    const appliedRange: [number, number] = [...queryTimeRange];
    setF3Loading(true);
    setStatus('computing');
    setF3ResultHint('正在按当前时间范围检索选区车辆...');
    f3OverlayRequestIdRef.current += 1;
    const requestId = f3OverlayRequestIdRef.current;
    clearTrajectoryOverlays();

    try {
      const unionDetail = demoReadonly
        ? (() => {
          const matchedTripIdsByTaxi = new globalThis.Map<number, Set<string>>();
          (DEMO_FIXTURE.f3?.features ?? []).forEach((feature: RawTrajectoryFeature) => {
            const taxiId = Number(feature.properties?.taxi_id ?? 0);
            const tripId = baseTripId(feature.properties?.trip_id);
            if (!Number.isFinite(taxiId) || taxiId <= 0 || !tripId) return;
            if (!matchedTripIdsByTaxi.has(taxiId)) matchedTripIdsByTaxi.set(taxiId, new Set<string>());
            matchedTripIdsByTaxi.get(taxiId)!.add(tripId);
          });
          const rows = Array.from(matchedTripIdsByTaxi.entries()).slice(0, F3_MAX_TAXI_ID).map(([taxiId, tripIds]) => ({
            taxiId,
            boxLabels: '#1',
            tripIds: Array.from(tripIds).sort((a, b) => Number(a) - Number(b)),
          }));
          return {
            activeVehicleCount: Number(DEMO_FIXTURE.f3?.meta?.active_vehicle_count ?? rows.length),
            boxCounts: [{ boxIndex: 1, vehicleCount: Number(DEMO_FIXTURE.f3?.meta?.active_vehicle_count ?? rows.length) }],
            rows,
          };
        })()
        : await queryUnionVehicleDetailByBBoxes(bboxes, {
          startTime: toBackendTime(appliedRange[0]),
          endTime: toBackendTime(appliedRange[1]),
          rowLimit: F3_MAX_TAXI_ID,
        });

      const summaries = bboxes.map((_, index) => {
        const boxIndex = index + 1;
        const fromApi = unionDetail.boxCounts.find((item) => item.boxIndex === boxIndex);
        return {
          boxIndex,
          color: F3_BOX_COLORS[index % F3_BOX_COLORS.length],
          vehicleCount: Number(fromApi?.vehicleCount ?? 0),
        };
      });
      const taxiToBoxes = new globalThis.Map<number, Set<number>>();
      const matchedTripIdsByTaxi = new globalThis.Map<number, Set<string>>();
      unionDetail.rows.forEach((row) => {
        if (!taxiToBoxes.has(row.taxiId)) taxiToBoxes.set(row.taxiId, new Set<number>());
        String(row.boxLabels || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .forEach((label) => {
            const boxIndex = Number(label.replace('#', ''));
            if (Number.isInteger(boxIndex) && boxIndex > 0) {
              taxiToBoxes.get(row.taxiId)!.add(boxIndex);
            }
          });
        if (!matchedTripIdsByTaxi.has(row.taxiId)) matchedTripIdsByTaxi.set(row.taxiId, new Set<string>());
        row.tripIds.forEach((tripId) => {
          const parsedTripId = baseTripId(tripId);
          if (parsedTripId) matchedTripIdsByTaxi.get(row.taxiId)!.add(parsedTripId);
        });
      });
      const rows: F3UnionDetailRow[] = Array.from(taxiToBoxes.entries())
        .map(([taxiId, boxSet]) => ({
          key: String(taxiId),
          taxiId,
          boxLabels: Array.from(boxSet).sort((a, b) => a - b).map((boxIndex) => `#${boxIndex}`).join(', '),
          tripIds: Array.from(matchedTripIdsByTaxi.get(taxiId) || []).sort((a, b) => Number(a) - Number(b)),
        }))
        .sort((a, b) => a.taxiId - b.taxiId);
      const totalVehicles = Number.isFinite(unionDetail.activeVehicleCount)
        ? Number(unionDetail.activeVehicleCount)
        : rows.length;

      if (requestId !== f3OverlayRequestIdRef.current) return;

      setActiveVehicles(totalVehicles);
      setF3Rows(rows);
      setF3BoxSummaries(summaries);
      f3MatchedTripIdsByTaxiRef.current = matchedTripIdsByTaxi;
      setF3SelectedTaxiId(null);
      setF3DetailsExpanded(false);
      setTripCards([]);
      setSelectedTripId(null);
      setF3Page(1);
      setDisplayedTimeRange(appliedRange);
      setAppliedRegionParams(regionParams);
      setStatus(rows.length ? 'ready' : 'empty');
      setF3ResultHint(
        rows.length
          ? `当前统计口径：多矩形并集去重；明细展示全部命中 Taxi ID：${rows.length}/${totalVehicles}`
          : '当前选区与时间范围内没有命中车辆。',
      );
    } catch (error) {
      setStatus('error');
      setF3ResultHint(error instanceof Error ? error.message : 'F3 区域查询失败');
    } finally {
      setF3Loading(false);
    }
  }, [clearTrajectoryOverlays, demoReadonly, queryTimeRange, regionParams, showValidationNotice]);

  const handleF3TaxiClick = React.useCallback(async (row: F3UnionDetailRow, modeOverride?: boolean) => {
    if (f3Loading) return;
    const amapInstance = amap;
    const map = mapRef.current;
    if (!amapInstance || !map) {
      setF3ResultHint('地图尚未初始化，请稍后再试。');
      return;
    }
    const bboxes = f3BBoxPayloadsRef.current;
    if (!bboxes.length) {
      setF3ResultHint('请先绘制矩形选区。');
      return;
    }
    const tripIds = Array.from(f3MatchedTripIdsByTaxiRef.current.get(row.taxiId) || row.tripIds)
      .map((tripId) => baseTripId(tripId))
      .filter(Boolean);
    if (!tripIds.length) {
      setF3ResultHint(`Taxi ${row.taxiId} 在当前 F3 查询结果中没有可用的命中行程。`);
      setF3SelectedTaxiId(row.taxiId);
      return;
    }

    const effectiveShowOnlyInBBox = modeOverride ?? f3ShowOnlyInBBox;
    f3OverlayRequestIdRef.current += 1;
    const requestId = f3OverlayRequestIdRef.current;
    setF3Loading(true);
    setF3SelectedTaxiId(row.taxiId);
    setTripCards([]);
    setSelectedTripId(null);
    setStatus('computing');
    setF3ResultHint(effectiveShowOnlyInBBox
      ? `正在加载 Taxi ${row.taxiId} 的框内轨迹...`
      : `正在加载 Taxi ${row.taxiId} 的完整匹配行程...`);

    try {
      const matchedMap = demoReadonly
        ? new globalThis.Map<string, RawTrajectoryFeature>(
          (DEMO_FIXTURE.matched?.features ?? [])
            .filter((feature: RawTrajectoryFeature) => tripIds.includes(baseTripId(feature.properties?.trip_id)))
            .map((feature: RawTrajectoryFeature) => [baseTripId(feature.properties?.trip_id), feature] as const),
        )
        : await queryMatchedByTrips(row.taxiId, tripIds);
      clearTrajectoryOverlays();
      const taxiOverlays: any[] = [];
      const drawnMatchedTripIds = new Set<string>();
      let matchedLineCount = 0;
      Array.from(matchedMap.entries()).forEach(([tripId, feature]) => {
        const coords = normalizeLineCoords(feature.geometry?.coordinates).filter(isValidGeoPoint);
        if (coords.length < 2) return;
        const lineParts = effectiveShowOnlyInBBox ? clipPolylineToBBoxes(coords, bboxes) : [coords];
        let drewThisTrip = false;
        lineParts.forEach((linePart) => {
          const gcj = linePart
            .map((point) => wgs84ToGcj02(point[0], point[1]))
            .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
          if (gcj.length < 2) return;
          drewThisTrip = true;
          matchedLineCount += 1;
          taxiOverlays.push(new amapInstance.Polyline({
            path: gcj,
            strokeColor: '#e0f2fe',
            strokeOpacity: 0.18,
            strokeWeight: 6,
            lineJoin: 'round',
            lineCap: 'round',
            zIndex: 92,
          }));
          taxiOverlays.push(new amapInstance.Polyline({
            path: gcj,
            strokeColor: hashColor(String(tripId)),
            strokeOpacity: 0.95,
            strokeWeight: 3.6,
            lineJoin: 'round',
            lineCap: 'round',
            zIndex: 96,
          }));
        });
        if (drewThisTrip) drawnMatchedTripIds.add(baseTripId(tripId));
      });

      let rawPointCount = 0;
      const rawFallbackTripIds = tripIds.filter((tripId) => !drawnMatchedTripIds.has(baseTripId(tripId)));
      if (rawFallbackTripIds.length) {
        const rawTripResults = await Promise.all(rawFallbackTripIds.map(async (tripId) => {
          try {
            if (demoReadonly) {
              const rawFeature = (DEMO_FIXTURE.trajectory?.features ?? []).find((feature: RawTrajectoryFeature) => baseTripId(feature.properties?.trip_id) === baseTripId(tripId));
              return { tripId, data: { raw_points: normalizeLineCoords(rawFeature?.geometry?.coordinates) } };
            }
            return { tripId, data: await queryRawTrajectoryByTrip(row.taxiId, tripId) };
          } catch {
            return { tripId, data: null };
          }
        }));

        rawTripResults.forEach(({ tripId, data }) => {
          const rawPoints = normalizeRawPoints(data?.raw_points)
            .filter(isValidGeoPoint)
            .filter((point) => bboxes.some((bbox) => isPointInBBox(point, bbox)));
          rawPoints.forEach((point) => {
            const center = wgs84ToGcj02(point[0], point[1]);
            if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) return;
            taxiOverlays.push(new amapInstance.CircleMarker({
              center,
              radius: 4.2,
              strokeColor: hashColor(String(tripId)),
              strokeOpacity: 0.95,
              strokeWeight: 1,
              fillColor: '#f97316',
              fillOpacity: 0.78,
              zIndex: 126,
            }));
            rawPointCount += 1;
          });
        });
      }

      if (requestId !== f3OverlayRequestIdRef.current || !f3BBoxPayloadsRef.current.length) return;

      if (!taxiOverlays.length) {
        clearTrajectoryOverlays();
        setStatus('empty');
        setF3ResultHint(`Taxi ${row.taxiId} 的${effectiveShowOnlyInBBox ? '框内' : '完整'}命中行程暂无可绘制轨迹。`);
        return;
      }

      map.add?.(taxiOverlays);
      trajectoryOverlaysRef.current = taxiOverlays;
      setStatus('ready');
      setF3ResultHint(`Taxi ${row.taxiId} ${effectiveShowOnlyInBBox ? '框内' : '完整'}显示，命中行程 ${tripIds.length} 条，路网轨迹 ${matchedLineCount} 段，原始散点 ${rawPointCount} 个。`);
    } catch (error) {
      setStatus('error');
      setF3ResultHint(error instanceof Error ? error.message : `Taxi ${row.taxiId} 轨迹加载失败`);
    } finally {
      setF3Loading(false);
    }
  }, [amap, clearTrajectoryOverlays, demoReadonly, f3Loading, f3ShowOnlyInBBox]);

  const handleF3ModeToggle = React.useCallback((next: boolean) => {
    setF3ShowOnlyInBBox(next);
    const selectedRow = f3SelectedTaxiId == null ? null : f3Rows.find((row) => row.taxiId === f3SelectedTaxiId) ?? null;
    if (selectedRow && f3BBoxPayloadsRef.current.length > 0) {
      void handleF3TaxiClick(selectedRow, next);
    }
  }, [f3Rows, f3SelectedTaxiId, handleF3TaxiClick]);

  const readDrawnBBox = React.useCallback((evt: unknown) => {
    const drawEvt = evt as {
      obj?: {
        getBounds?: () => {
          getSouthWest: () => unknown;
          getNorthEast: () => unknown;
        };
        setOptions?: (options: Record<string, unknown>) => void;
        setMap?: (map: unknown) => void;
      };
    };
    const rect = drawEvt.obj;
    const bounds = rect?.getBounds?.();
    const swPoint = bounds ? readLngLatLike(bounds.getSouthWest()) : null;
    const nePoint = bounds ? readLngLatLike(bounds.getNorthEast()) : null;
    if (!rect || !swPoint || !nePoint) throw new Error('矩形坐标解析失败，请重新框选');
    const minLon = Math.min(swPoint[0], nePoint[0]);
    const maxLon = Math.max(swPoint[0], nePoint[0]);
    const minLat = Math.min(swPoint[1], nePoint[1]);
    const maxLat = Math.max(swPoint[1], nePoint[1]);
    if (maxLon - minLon < 0.0003 || maxLat - minLat < 0.0003) throw new Error('框选区域过小，请拖拽更大范围');
    const swWgs = gcj02ToWgs84(minLon, minLat);
    const neWgs = gcj02ToWgs84(maxLon, maxLat);
    return {
      rect,
      bbox: {
        minLon: Math.min(swWgs[0], neWgs[0]),
        minLat: Math.min(swWgs[1], neWgs[1]),
        maxLon: Math.max(swWgs[0], neWgs[0]),
        maxLat: Math.max(swWgs[1], neWgs[1]),
      },
    };
  }, []);

  const runF7RoadDetail = React.useCallback(async (path: F7FrequentPath) => {
    const targetPath = path;
    setF7SelectedPath(targetPath);
    setF7ViewMode('detail');
    setF7RoadDetail(null);
    setF7DetailLoading(true);
    setDecisionMapLayer('f7-detail');
    setStatus('computing');
    try {
      const analysisBBox = f7AnalysisBBoxRef.current ?? getCurrentMapBBoxWgs84();
      if (!analysisBBox) throw new Error('无法读取当前地图视窗');
      f7AnalysisBBoxRef.current = analysisBBox;
      clearF7PathOverlays();
      clearF7DetailOverlays({ preserveDetailState: true });
      const result = demoReadonly
        ? DEMO_FIXTURE.f7Detail as F7RoadDetailResponse
        : await queryF7RoadDetail({
          roadGroupKey: targetPath.road_group_key,
          direction: targetPath.direction_value,
          analysisBBox,
          componentId: targetPath.component_id ?? targetPath.corridor_component_id,
          startTime: toBackendTime(queryTimeRange[0]),
          endTime: toBackendTime(queryTimeRange[1]),
        });
      if (result.meta?.error) throw new Error(result.meta.error);
      setF7RoadDetail(result);
      renderF7DetailOnMap(targetPath, result, null);
      setStatus(result.segments?.length ? 'ready' : 'empty');
    } catch (error) {
      setStatus('error');
      setF7RoadDetail(null);
      setF7ViewMode('overview');
      setAnalysisResult({
        title: 'F7 详情运行失败',
        subtitle: error instanceof Error ? error.message : '接口调用异常',
        metrics: [{ label: '状态', value: '失败' }],
      });
    } finally {
      setF7DetailLoading(false);
    }
  }, [clearF7DetailOverlays, clearF7PathOverlays, demoReadonly, getCurrentMapBBoxWgs84, queryTimeRange, renderF7DetailOnMap]);

  const returnF7Overview = React.useCallback(() => {
    clearF7DetailOverlays({ preserveDetailState: true });
    setF7ViewMode('overview');
    setF7SelectedPath(null);
    setF7RoadDetail(null);
    setF7HoveredSegmentUid(null);
    setDecisionMapLayer('f7-overview');
    if (f7Result) renderF7OverviewOnMap(f7Result, f7FocusedPathKey);
    setStatus(f7Result?.paths?.length ? 'ready' : 'idle');
  }, [clearF7DetailOverlays, f7FocusedPathKey, f7Result, renderF7OverviewOnMap]);

  React.useEffect(() => {
    if (mode !== 'decision' || f7ViewMode !== 'overview' || decisionMapLayer !== 'f7-overview') return;
    applyF7PathFocus(f7FocusedPathKey);
  }, [applyF7PathFocus, decisionMapLayer, f7FocusedPathKey, f7ViewMode, mode]);

  React.useEffect(() => {
    if (mode !== 'decision' || f7ViewMode !== 'detail' || decisionMapLayer !== 'f7-detail') return;
    applyF7DetailSegmentFocus(f7HoveredSegmentUid);
  }, [applyF7DetailSegmentFocus, decisionMapLayer, f7HoveredSegmentUid, f7ViewMode, mode]);

  React.useEffect(() => {
    if (mode !== 'decision' || decisionMapLayer !== 'f8') return;
    applyF8RouteFocus(f8PinnedRouteKey ?? f8FocusedRouteKey);
  }, [applyF8RouteFocus, decisionMapLayer, f8FocusedRouteKey, f8PinnedRouteKey, mode]);

  React.useEffect(() => {
    f8PinnedRouteKeyRef.current = f8PinnedRouteKey;
  }, [f8PinnedRouteKey]);

  React.useEffect(() => {
    if (mode !== 'decision') {
      clearF8Routes();
      clearDecisionOverlays();
      return;
    }
    if (decisionMapLayer === 'f7-detail' && f7ViewMode === 'detail' && f7SelectedPath && f7RoadDetail) {
      renderF7DetailOnMap(f7SelectedPath, f7RoadDetail, null);
      return;
    }
    if (decisionMapLayer === 'f8' && f8Result) {
      renderF8RoutesOnMap(f8Result, null, null);
      return;
    }
    if (decisionMapLayer === 'f7-overview' && f7Result) {
      renderF7OverviewOnMap(f7Result, null);
    }
  }, [
    clearF8Routes,
    clearDecisionOverlays,
    decisionMapLayer,
    f7Result,
    f7RoadDetail,
    f7SelectedPath,
    f7ViewMode,
    f8Result,
    mode,
    renderF7DetailOnMap,
    renderF7OverviewOnMap,
    renderF8RoutesOnMap,
  ]);

  const showF8RoutesOnMap = React.useCallback(() => {
    if (!f8Result) return;
    setDecisionMapLayer('f8');
    renderF8RoutesOnMap(f8Result, f8FocusedRouteKey, f8AnimatingRouteKey);
  }, [f8AnimatingRouteKey, f8FocusedRouteKey, f8Result, renderF8RoutesOnMap]);

  const showF9RoutesOnMap = React.useCallback((recommendedRouteKey?: string | null) => {
    if (!recommendedRouteKey || !f8Result) return;
    setDecisionMapLayer('f9');
    renderSelectedF8RecommendationOnMap(f8Result, recommendedRouteKey);
  }, [f8Result, renderSelectedF8RecommendationOnMap]);

  React.useEffect(() => {
    if (mode !== 'decision' || decisionMapLayer !== 'f9') return;
    if (f9RecommendedRouteKey && f8Result) {
      renderSelectedF8RecommendationOnMap(f8Result, f9RecommendedRouteKey);
    }
  }, [decisionMapLayer, f8Result, f9RecommendedRouteKey, mode, renderSelectedF8RecommendationOnMap]);

  const pinF8RouteDetail = React.useCallback((payload: {
    source: 'f8' | 'f9';
    routeKey: string;
    item: F8Corridor | F8FrequentRoute;
    displayRank: number;
    sortMode: 'frequency' | 'p50' | 'avg';
  }) => {
    setF8PinnedRouteKey(payload.routeKey);
    setF8PinnedRouteOrder(payload.displayRank);
    setF8PinnedRouteSortMode(payload.sortMode);
    setF8PinnedRouteItem(payload.item);
    setF8FocusedRouteKey(payload.routeKey);
    if (payload.source === 'f9') {
      setDecisionMapLayer('f9');
      if (f8Result) {
        renderSelectedF8RecommendationOnMap(f8Result, payload.routeKey);
      }
      return;
    }
    setDecisionMapLayer('f8');
    applyF8RouteFocus(payload.routeKey);
    if (f8Result) {
      renderF8RoutesOnMap(f8Result, null, null);
    }
  }, [applyF8RouteFocus, f8Result, renderF8RoutesOnMap, renderSelectedF8RecommendationOnMap]);

  const clearPinnedF8RouteDetail = React.useCallback(() => {
    setF8PinnedRouteKey(null);
    setF8PinnedRouteOrder(null);
    setF8PinnedRouteSortMode(null);
    setF8PinnedRouteItem(null);
    if (decisionMapLayer === 'f9' && f9RecommendedRouteKey && f8Result) {
      renderSelectedF8RecommendationOnMap(f8Result, f9RecommendedRouteKey);
      return;
    }
    applyF8RouteFocus(f8FocusedRouteKey);
  }, [
    applyF8RouteFocus,
    decisionMapLayer,
    f8FocusedRouteKey,
    f8Result,
    f9RecommendedRouteKey,
    renderSelectedF8RecommendationOnMap,
  ]);

  const switchRegionTool = React.useCallback((nextTool: RegionTool | null) => {
    clearF3Selection();
    clearF4Layer();
    clearF5Artifacts();
    clearF6Artifacts();
    setF4TopCells([]);
    setF4GeneralizationUnlocked(false);
    setF4Generalizing(false);
    setF4Generating(false);
    setF4MapInteractionEnabled(true);
    f4LastRenderedResolutionRef.current = null;
    setStatus('idle');
    setAnalysisResult(null);
    setActiveRegionTool(nextTool);

    if (demoReadonly && nextTool) {
      f3BBoxPayloadsRef.current = [DEMO_FIXTURE.areas.f3];
      f5AreaPayloadRef.current.A = DEMO_FIXTURE.areas.areaA;
      f5AreaPayloadRef.current.B = DEMO_FIXTURE.areas.areaB;
      f6CoreAreaRef.current = DEMO_FIXTURE.areas.core;
      window.setTimeout(() => renderDemoPresetRegionBoxes(nextTool), 0);
    }
  }, [clearF3Selection, clearF4Layer, clearF5Artifacts, clearF6Artifacts, demoReadonly, renderDemoPresetRegionBoxes]);

  const handleDecisionSectionChange = React.useCallback((section: 'f7' | 'f89' | null) => {
    clearF7PathOverlays();
    clearF7DetailOverlays();
    clearF7ViewportOverlay();
    invalidateF8F9TaskState({ keepAreas: demoReadonly && section === 'f89' });
    setF7FocusedPathKey(null);
    setF8FocusedRouteKey(null);
    if (demoReadonly && section === 'f89') {
      window.setTimeout(() => renderDemoPresetRegionBoxes('decision'), 0);
    }
    if (section == null) {
      setStatus('idle');
      setAnalysisResult(null);
    }
  }, [
    clearF7DetailOverlays,
    clearF7PathOverlays,
    clearF7ViewportOverlay,
    demoReadonly,
    invalidateF8F9TaskState,
    renderDemoPresetRegionBoxes,
  ]);

  const runF5DrawArea = React.useCallback((target: 'A' | 'B') => {
    if (!mapRef.current || !mouseToolRef.current) {
      setAnalysisResult({ title: 'F5 区域绘制失败', subtitle: '地图工具尚未初始化', metrics: [], note: '请稍后再试。' });
      return;
    }
    clearF6Artifacts();
    clearF5FlowOverlays();
    invalidateF8F9TaskState({ keepAreas: true });
    setF5Result(null);
    setF5DetailsExpanded(false);
    setStatus('idle');
    setBrushMode(target === 'A' ? 'areaA' : 'areaB');
    setF5DrawingTarget(target);

    const mouseTool = mouseToolRef.current;
    if (f5DrawHandlerRef.current) mouseTool.off?.('draw', f5DrawHandlerRef.current);
    mouseTool.close?.(false);
    const color = target === 'A' ? '#2563eb' : '#f97316';
    const onDraw = (evt: unknown) => {
      f5DrawHandlerRef.current = null;
      mouseTool.off?.('draw', onDraw);
      mouseTool.close?.(false);
      setF5DrawingTarget(null);
      setBrushMode('none');
      try {
        const { rect, bbox } = readDrawnBBox(evt);
        clearF5Area(target);
        rect.setOptions?.({ strokeColor: color, strokeOpacity: 0.95, strokeWeight: 2, fillColor: color, fillOpacity: 0.18, zIndex: 110 });
        f5AreaOverlayRef.current[target] = rect;
        f5AreaPayloadRef.current[target] = bbox;
        invalidateF8F9TaskState({ keepAreas: true });
        void refreshF5TransitionRecommendation(f5AreaPayloadRef.current.A, f5AreaPayloadRef.current.B);
      } catch (error) {
        (evt as any)?.obj?.setMap?.(null);
        setStatus('error');
        setAnalysisResult({ title: 'F5 区域绘制失败', subtitle: `区域 ${target}`, metrics: [], note: error instanceof Error ? error.message : '区域框选失败' });
      }
    };
    f5DrawHandlerRef.current = onDraw;
    mouseTool.on?.('draw', onDraw);
    mouseTool.rectangle?.({ strokeColor: color, strokeOpacity: 0.95, strokeWeight: 2, fillColor: color, fillOpacity: 0.18 });
  }, [clearF5Area, clearF5FlowOverlays, clearF6Artifacts, invalidateF8F9TaskState, readDrawnBBox, refreshF5TransitionRecommendation]);

  const runF6DrawCoreArea = React.useCallback(() => {
    if (!mapRef.current || !mouseToolRef.current) {
      setAnalysisResult({ title: 'F6 区域绘制失败', subtitle: '地图工具尚未初始化', metrics: [], note: '请稍后再试。' });
      return;
    }
    clearF5Artifacts();
    clearF6FlowOverlays();
    setF6Result(null);
    setF6DetailsExpanded(false);
    setStatus('idle');
    setBrushMode('areaA');
    setF6Drawing(true);

    const mouseTool = mouseToolRef.current;
    if (f6DrawHandlerRef.current) mouseTool.off?.('draw', f6DrawHandlerRef.current);
    mouseTool.close?.(false);
    const onDraw = (evt: unknown) => {
      f6DrawHandlerRef.current = null;
      mouseTool.off?.('draw', onDraw);
      mouseTool.close?.(false);
      setF6Drawing(false);
      setBrushMode('none');
      try {
        const { rect, bbox } = readDrawnBBox(evt);
        clearF6CoreArea();
        rect.setOptions?.({ strokeColor: '#f59e0b', strokeOpacity: 0.95, strokeWeight: 2, fillColor: '#f59e0b', fillOpacity: 0.12, zIndex: 112 });
        f6CoreOverlayRef.current = rect;
        f6CoreAreaRef.current = bbox;
        const recommended = recommendF6ThroughTransferMinutes(bbox);
        setAnalysisResult({
          title: '核心区已设置',
          subtitle: 'F6 · 核心区域 A 已设置',
          metrics: [
            { label: '核心经度', value: `${bbox.minLon.toFixed(4)} - ${bbox.maxLon.toFixed(4)}` },
            { label: '核心纬度', value: `${bbox.minLat.toFixed(4)} - ${bbox.maxLat.toFixed(4)}` },
            { label: '推荐窗口', value: `${recommended} 分钟` },
          ],
          note: '可继续调整方向、模式和模型参数后生成辐射分析。',
        });
      } catch (error) {
        (evt as any)?.obj?.setMap?.(null);
        setStatus('error');
        setAnalysisResult({ title: 'F6 区域绘制失败', subtitle: '核心区域 A', metrics: [], note: error instanceof Error ? error.message : '区域框选失败' });
      }
    };
    f6DrawHandlerRef.current = onDraw;
    mouseTool.on?.('draw', onDraw);
    mouseTool.rectangle?.({ strokeColor: '#f59e0b', strokeOpacity: 0.95, strokeWeight: 2, fillColor: '#f59e0b', fillOpacity: 0.12 });
  }, [clearF5Artifacts, clearF6CoreArea, clearF6FlowOverlays, readDrawnBBox, recommendF6ThroughTransferMinutes]);

  const applyF4HeatmapViewportStyle = React.useCallback(() => {
    const map = mapRef.current;
    const heatmap = f4HeatmapRef.current;
    const dataset = f4HeatmapDataRef.current;
    if (!map || !heatmap || !dataset.length) {
      return {
        clippedMax: 1,
        ranges: [] as Array<{ label: string; min: number; max: number; color: string }>,
        gradientCss: 'linear-gradient(90deg, rgba(0,0,0,0), #38bdf8 20%, #60a5fa 48%, #84cc16 74%, #facc15 92%, #f97316 100%)',
      };
    }
    const bounds = map.getBounds();
    const sw = readLngLatLike(bounds.getSouthWest());
    const ne = readLngLatLike(bounds.getNorthEast());
    const inView = sw && ne
      ? dataset.filter((item) => (
        item.lng >= Math.min(sw[0], ne[0])
        && item.lng <= Math.max(sw[0], ne[0])
        && item.lat >= Math.min(sw[1], ne[1])
        && item.lat <= Math.max(sw[1], ne[1])
      ))
      : dataset;
    const source = inView.length >= 30 ? inView : dataset;
    const profile = buildHeatViewportProfile(source.map((item) => item.count));
    const radius = calcDynamicHeatRadiusPx(map, f4GridSize);
    try {
      heatmap.setOptions?.({
        radius,
        opacity: [0.02, 0.48],
        gradient: profile.gradient,
      });
    } catch {
      heatmap.setOptions?.({ radius, opacity: [0.02, 0.48] });
    }
    heatmap.setDataSet({
      data: dataset,
      max: profile.clippedMax,
    });
    return { clippedMax: profile.clippedMax, ranges: profile.ranges, gradientCss: profile.gradientCss };
  }, [f4GridSize]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || mode !== 'region' || activeRegionTool !== 'f4' || f4RenderMode !== 'heatmap' || !f4HeatmapRef.current) return undefined;
    const handleViewportChange = () => {
      try {
        applyF4HeatmapViewportStyle();
      } catch {
        // keep viewport interactions resilient even if the heatmap plugin becomes unavailable
      }
    };
    map.on?.('zoomend', handleViewportChange);
    map.on?.('moveend', handleViewportChange);
    return () => {
      map.off?.('zoomend', handleViewportChange);
      map.off?.('moveend', handleViewportChange);
    };
  }, [activeRegionTool, applyF4HeatmapViewportStyle, f4RenderMode, mode]);

  React.useEffect(() => {
    if (mode !== 'region' || activeRegionTool !== 'f4' || f4RenderMode !== 'choropleth') return;
    f4ChoroplethEntriesRef.current.forEach((entry) => {
      const isActive = !f4LegendFilter || entry.levelLabel === f4LegendFilter;
      entry.polygon.setOptions?.({
        fillOpacity: isActive ? Math.min(0.68, entry.baseOpacity + 0.12) : 0.04,
        strokeOpacity: isActive && f4LegendFilter ? 0.82 : 0,
        strokeWeight: isActive && f4LegendFilter ? 1.1 : 0,
        strokeColor: '#e2e8f0',
      });
    });
  }, [activeRegionTool, f4LegendFilter, f4RenderMode, mode]);

  React.useEffect(() => {
    if (mode !== 'region' || activeRegionTool !== 'f4' || f4RenderMode !== 'heatmap' || !f4HeatmapRef.current) return;
    applyF4HeatmapViewportStyle();
  }, [activeRegionTool, applyF4HeatmapViewportStyle, f4LegendFilter, f4RenderMode, mode]);

  const drawF4SnapshotBBox = React.useCallback((bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number }) => {
    const amapInstance = amap;
    const map = mapRef.current;
    if (!amapInstance || !map) return;
    if (f4SnapshotBBoxOverlayRef.current) {
      f4SnapshotBBoxOverlayRef.current.setMap?.(null);
      f4SnapshotBBoxOverlayRef.current = null;
    }
    const path = [
      wgs84ToGcj02(bounds.minLon, bounds.minLat),
      wgs84ToGcj02(bounds.maxLon, bounds.minLat),
      wgs84ToGcj02(bounds.maxLon, bounds.maxLat),
      wgs84ToGcj02(bounds.minLon, bounds.maxLat),
    ];
    const rect = new amapInstance.Polyline({
      path: [...path, path[0]],
      strokeColor: '#94a3b8',
      strokeOpacity: 0.85,
      strokeStyle: 'dashed',
      strokeWeight: 1.2,
      zIndex: 88,
    });
    rect.setMap?.(map);
    f4SnapshotBBoxOverlayRef.current = rect;
  }, [amap]);

  const focusF4Cell = React.useCallback((cell: F4GridCell) => {
    const amapInstance = amap;
    const map = mapRef.current;
    if (!amapInstance || !map) return;
    if (f4HighlightOverlayRef.current) {
      f4HighlightOverlayRef.current.setMap?.(null);
      f4HighlightOverlayRef.current = null;
    }
    const path = (cell.boundary?.length
      ? cell.boundary
      : [
          [cell.bounds[0], cell.bounds[1]],
          [cell.bounds[2], cell.bounds[1]],
          [cell.bounds[2], cell.bounds[3]],
          [cell.bounds[0], cell.bounds[3]],
        ]
    ).map(([lon, lat]) => wgs84ToGcj02(lon, lat));
    const overlay = new amapInstance.Polygon({
      path,
      fillOpacity: 0,
      strokeColor: '#f8fafc',
      strokeOpacity: 0.96,
      strokeWeight: 2.2,
      strokeStyle: 'dashed',
      zIndex: 140,
    });
    overlay.setMap?.(map);
    f4HighlightOverlayRef.current = overlay;
  }, [amap]);

  const ensureF4HeatMapPlugin = React.useCallback(async () => {
    if (!amap) throw new Error('地图 SDK 尚未初始化');
    if (amap.HeatMap) return;
    await new Promise<void>((resolve, reject) => {
      try {
        amap.plugin?.(['AMap.HeatMap'], () => {
          if (amap.HeatMap) resolve();
          else reject(new Error('HeatMap 插件加载后仍不可用'));
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error('HeatMap 插件加载失败'));
      }
    });
  }, [amap]);

  const renderF4Heatmap = React.useCallback((cells: F4GridCell[]) => {
    const amapInstance = amap;
    const map = mapRef.current;
    if (!amapInstance || !map) {
      return {
        clippedMax: 1,
        ranges: [] as Array<{ label: string; min: number; max: number; color: string }>,
        gradientCss: 'linear-gradient(90deg, rgba(0,0,0,0), #38bdf8 20%, #60a5fa 48%, #84cc16 74%, #facc15 92%, #f97316 100%)',
      };
    }

    const data = cells
      .map((cell) => {
        const center = cell.center;
        const density = Number(cell.density ?? cell.point_count ?? 0);
        // Zero/invalid cells must not enter HeatMap, otherwise low-value haze pollutes the base map.
        if (!center || center.length < 2 || !Number.isFinite(density) || density <= 0) return null;
        const [lng, lat] = wgs84ToGcj02(center[0], center[1]);
        const boosted = Math.max(1, Math.pow(density, 0.82));
        return { lng, lat, count: boosted, rawDensity: density };
      })
      .filter((item): item is { lng: number; lat: number; count: number; rawDensity: number } => item != null);

    if (!data.length) {
      return {
        clippedMax: 1,
        ranges: [] as Array<{ label: string; min: number; max: number; color: string }>,
        gradientCss: 'linear-gradient(90deg, rgba(0,0,0,0), #3b82f6 20%, #22c55e 45%, #facc15 75%, #dc2626 100%)',
      };
    }
    f4HeatmapDataRef.current = data;
    const radius = calcDynamicHeatRadiusPx(map, f4GridSize);

    try {
      const heatmap = new amapInstance.HeatMap(map, {
        radius,
        opacity: [0.02, 0.48],
        gradient: {
          0.0: 'rgba(0,0,0,0)',
          0.2: 'rgba(56,189,248,0.14)',
          0.48: 'rgba(96,165,250,0.18)',
          0.74: 'rgba(132,204,22,0.24)',
          0.92: 'rgba(250,204,21,0.3)',
          1.0: 'rgba(249,115,22,0.38)',
        },
      });
      f4HeatmapRef.current = heatmap;
      return applyF4HeatmapViewportStyle();
    } catch {
      const heatmap = new amapInstance.HeatMap(map, {
        radius,
        opacity: [0.02, 0.48],
        gradient: {
          0.0: 'rgba(0,0,0,0)',
          0.2: 'rgba(56,189,248,0.14)',
          0.48: 'rgba(96,165,250,0.18)',
          0.74: 'rgba(132,204,22,0.24)',
          0.92: 'rgba(250,204,21,0.3)',
          1.0: 'rgba(249,115,22,0.38)',
        },
      });
      f4HeatmapRef.current = heatmap;
      const profile = applyF4HeatmapViewportStyle();
      setF4Feedback({ tone: 'warning', text: 'F4 热力图已自动切换为兼容渐变。' });
      return profile;
    }
  }, [amap, applyF4HeatmapViewportStyle, f4GridSize]);

  const renderF4Choropleth = React.useCallback((cells: F4GridCell[], params: { timeSpanHours: number; classifyMethod: F4ClassifyMethod }) => {
    const amapInstance = amap;
    const map = mapRef.current;
    if (!amapInstance || !map) {
      return { levels: [] as Array<{ label: string; color: string; min: number; max: number }>, maxStandardDensity: 0 };
    }

    const timeSpanHours = Math.max(1 / 60, params.timeSpanHours);
    const cellMetrics = cells.map((cell) => {
      const vehicleCount = Number(cell.vehicle_count ?? 0);
      const areaKm2 = getCellAreaKm2(cell.bounds);
      const standardDensity = vehicleCount / (timeSpanHours * areaKm2);
      return {
        cell,
        vehicleCount,
        areaKm2,
        standardDensity: Number.isFinite(standardDensity) && standardDensity > 0 ? standardDensity : 0,
      };
    });
    const standardValues = cellMetrics.map((item) => item.standardDensity).filter((value) => value > 0);
    const levels = buildF4Levels(standardValues, params.classifyMethod);
    const maxValue = Math.max(1e-8, ...standardValues);

    if (!f4HoverInfoWindowRef.current) {
      f4HoverInfoWindowRef.current = new amapInstance.InfoWindow({
        isCustom: false,
        offset: new amapInstance.Pixel(0, -10),
        autoMove: false,
      });
    }

    const polygons: any[] = [];
    const entries: Array<{ polygon: any; levelLabel: string; baseOpacity: number }> = [];
    cellMetrics.forEach((metric) => {
      const { cell, vehicleCount, areaKm2, standardDensity } = metric;
      const idx = getF4LevelByDensity(levels, standardDensity);
      const level = levels[idx] ?? levels[levels.length - 1];
      const ratio = standardDensity / maxValue;
      const path = [
        wgs84ToGcj02(cell.bounds[0], cell.bounds[1]),
        wgs84ToGcj02(cell.bounds[2], cell.bounds[1]),
        wgs84ToGcj02(cell.bounds[2], cell.bounds[3]),
        wgs84ToGcj02(cell.bounds[0], cell.bounds[3]),
      ];
      const baseOpacity = Math.max(0.2, Math.min(0.78, 0.18 + ratio * 0.62));
      const polygon = new amapInstance.Polygon({
        path,
        strokeWeight: 0,
        strokeOpacity: 0,
        fillColor: level.color,
        fillOpacity: baseOpacity,
        zIndex: 72,
      });

      polygon.on?.('mouseover', () => {
        if (f4HoveredPolygonRef.current && f4HoveredPolygonRef.current !== polygon) {
          f4HoveredPolygonRef.current.setOptions?.({ strokeWeight: 0, strokeOpacity: 0 });
        }
        polygon.setOptions?.({
          strokeWeight: 1.5,
          strokeOpacity: 0.95,
          strokeColor: '#0f172a',
        });
        f4HoveredPolygonRef.current = polygon;
      });
      polygon.on?.('mousemove', (evt: any) => {
        const content = [
          '<div style="min-width:220px;font-size:12px;line-height:1.5;color:#0f172a;">',
          `<div style="font-weight:700;margin-bottom:4px;">等级：${level.label}</div>`,
          `<div>包含轨迹点：${formatInt(Number(cell.point_count ?? 0))} 个</div>`,
          `<div>活跃车辆：${vehicleCount > 0 ? `${formatInt(vehicleCount)} 辆` : '未加载'}</div>`,
          `<div>标准密度 D：${formatDensity(standardDensity)} 车/(小时·平方公里)</div>`,
          `<div>网格面积：${formatDensity(areaKm2)} 平方公里</div>`,
          '</div>',
        ].join('');
        f4HoverInfoWindowRef.current?.setContent?.(content);
        f4HoverInfoWindowRef.current?.open?.(map, evt?.lnglat);
      });
      polygon.on?.('mouseout', () => {
        polygon.setOptions?.({ strokeWeight: 0, strokeOpacity: 0 });
        if (f4HoveredPolygonRef.current === polygon) f4HoveredPolygonRef.current = null;
        f4HoverInfoWindowRef.current?.close?.();
      });
      polygons.push(polygon);
      entries.push({ polygon, levelLabel: level.label, baseOpacity });
    });

    if (polygons.length) {
      map.add?.(polygons);
      f4OverlaysRef.current = polygons;
    }
    f4ChoroplethEntriesRef.current = entries;
    return { levels, maxStandardDensity: maxValue };
  }, [amap]);


  const primeDemoReadonlyInputs = React.useCallback(() => {
    setOverviewStats({
      summary: DEMO_FIXTURE.summary,
      activeVehicles: Number(DEMO_FIXTURE.activeVehicles?.active_vehicle_count ?? 0),
      summaryLoaded: true,
      activeLoaded: true,
    });
    setTargetTaxiId(String(DEMO_FIXTURE.meta?.taxi_id ?? 8952));
    setTrajectoryTarget('');
    setTripCards([]);
    setSelectedTripId(null);
    setShowMatchedMode(true);
    setUseMapVMode(true);
    setShowOtherTrips(false);
    setF4GridSize(Number((DEMO_FIXTURE.f4Heatmap ?? DEMO_FIXTURE.f4)?.meta?.grid_size_m ?? 500));
    setF4RenderMode('heatmap');
    setF6Direction('both');
    setF6AnalysisMode('strict_od');
    setF6H3Resolution(Number((DEMO_FIXTURE.f6StrictOd ?? DEMO_FIXTURE.f6)?.meta?.h3_resolution ?? 8));
    setF6BufferMeters(Number((DEMO_FIXTURE.f6StrictOd ?? DEMO_FIXTURE.f6)?.meta?.buffer_meters ?? 120));
    setF6TopK(Number((DEMO_FIXTURE.f6StrictOd ?? DEMO_FIXTURE.f6)?.meta?.top_k ?? 8));
    setF6StrictMaxTripMinutes(Math.round(Number((DEMO_FIXTURE.f6StrictOd ?? DEMO_FIXTURE.f6)?.meta?.max_transition_seconds ?? 7200) / 60));
    setF7TopK(Number(DEMO_FIXTURE.f7?.meta?.top_k ?? 30));
    setF7MinLengthMeters(Number(DEMO_FIXTURE.f7?.meta?.min_group_length_m ?? 600));
    setF7Scope('bbox');
    setF7SortMode('frequency');
    setF8TopK(Number(DEMO_FIXTURE.f8?.summary?.route_count ?? 6));
    setF8CandidateMode(DEMO_FIXTURE.f8?.meta?.candidate_mode === 'strict_od' ? 'strict_od' : 'pass_through');
    setDisplayedTimeRange([0, 100]);
    setQueryTimeRange([0, 100]);
    f3BBoxPayloadsRef.current = [DEMO_FIXTURE.areas.f3];
    f5AreaPayloadRef.current.A = DEMO_FIXTURE.areas.areaA;
    f5AreaPayloadRef.current.B = DEMO_FIXTURE.areas.areaB;
    f6CoreAreaRef.current = DEMO_FIXTURE.areas.core;
    f3MatchedTripIdsByTaxiRef.current = new globalThis.Map();
    setStatus('idle');
  }, []);

  const exitDemoReadonly = React.useCallback(() => {
    setDemoReadonly(false);
    resetOverview();
  }, [resetOverview]);

  const toggleDemoReadonly = React.useCallback(() => {
    if (demoReadonly) {
      exitDemoReadonly();
      return;
    }
    setDemoReadonly(true);
  }, [demoReadonly, exitDemoReadonly]);

  React.useEffect(() => {
    if (!demoReadonly) return;
    primeDemoReadonlyInputs();
    setAnalysisResult({
      title: 'Demo mode enabled',
      subtitle: 'Preset inputs are ready; use the original buttons to load fixed demo data.',
      metrics: [
        { label: 'Taxi', value: `#${DEMO_FIXTURE.meta?.taxi_id ?? 8952}` },
        { label: 'Source', value: 'local fixture' },
      ],
      note: 'Demo mode does not query the database; the existing frontend flow stays unchanged.',
    });
  }, [demoReadonly, primeDemoReadonlyInputs]);

  const runCompute = async (forcedRegionTool?: RegionTool) => {
    const requestedRegionTool = forcedRegionTool ?? activeRegionTool;
    const taskCode: RunningTaskCode = mode === 'trajectory'
      ? 'F1-F2'
      : mode === 'region'
        ? requestedRegionTool === 'f3'
          ? 'F3'
          : requestedRegionTool === 'f4'
            ? 'F4'
            : requestedRegionTool === 'f5'
              ? 'F5'
              : 'F6'
        : mode === 'decision'
          ? 'F7'
          : 'F4';
    const taskLabel = mode === 'trajectory'
      ? '轨迹查询'
      : taskCode === 'F3'
        ? '车辆并集'
        : taskCode === 'F4'
          ? '网格密度'
          : taskCode === 'F5'
            ? 'A/B OD 流向'
            : taskCode === 'F6'
              ? '辐射流向'
              : '高频路径';
    if (taskCode === 'F3' && f3BBoxPayloadsRef.current.length === 0) {
      setF3ResultHint('请先绘制至少一个矩形选区。');
      showValidationNotice('F3 请先绘制至少一个矩形选区，再执行查询。');
      return;
    }
    beginRunningTask(taskCode, taskLabel);
    setAnalysisResult(null);
    const appliedRange: [number, number] = [...queryTimeRange];
    const appliedStartTime = toBackendTime(appliedRange[0]);
    const appliedEndTime = toBackendTime(appliedRange[1]);

    try {
      if (mode === 'trajectory') {
        const taxiText = targetTaxiId.trim();
        if (!taxiText) {
          setStatus('idle');
          setTripCards([]);
          setSelectedTripId(null);
          clearTrajectoryOverlays();
          setTrajectoryTarget('');
          setAnalysisResult({
            title: '请输入车辆 ID',
            subtitle: 'F1-F2 轨迹查询',
            metrics: [
              { label: '合法范围', value: '1-10357' },
              { label: '状态', value: '待输入' },
            ],
            note: 'F1 仅支持按单车查询，留空时不会发起查询。',
          });
          return;
        }
        const parsedTaxiId = Number(taxiText);
        if (!Number.isInteger(parsedTaxiId) || parsedTaxiId < 1 || parsedTaxiId > 10357) {
          setStatus('error');
          setAnalysisResult({
            title: '车辆 ID 无效',
            subtitle: 'F1-F2 轨迹查询',
            metrics: [
              { label: '合法范围', value: '1-10357' },
              { label: '当前输入', value: taxiText },
              { label: '状态', value: '待修正' },
            ],
            note: '请输入合法车辆 ID；F1 不支持留空查询。',
          });
          return;
        }
        const taxiId = parsedTaxiId;
        const enableMatched = showMatchedMode;
        const response: { data: { features?: RawTrajectoryFeature[]; meta?: { total_segment_count?: number; is_limited?: boolean } } } = demoReadonly
          ? { data: { features: DEMO_FIXTURE.trajectory?.features ?? [], meta: DEMO_FIXTURE.trajectory?.meta ?? {} } }
          : await apiClient.get<{
            features?: RawTrajectoryFeature[];
            meta?: { total_segment_count?: number; is_limited?: boolean };
          }>('/api/v1/trajectories/polylines', {
            params: {
              ...(taxiId != null ? { taxi_id: taxiId } : {}),
              start_time: appliedStartTime,
              end_time: appliedEndTime,
              zoom: 12,
              max_trips: useMapVMode ? 1200 : 300,
              use_zoom_simplify: true,
              max_gap_minutes: 40,
              max_jump_km: 8,
              max_speed_kmh: 120,
            },
            timeout: 60000,
          });

        const features = response.data.features ?? [];
        if (!features.length) {
          clearTrajectoryOverlays();
          setTripCards([]);
          setSelectedTripId(null);
          setTrajectoryTarget(taxiText);
          setDisplayedTimeRange(appliedRange);
          setStatus('empty');
          return;
        }

        const rawByTrip = new globalThis.Map<string, TrajectoryTripCard>();
        features.forEach((feature) => {
          const tripId = baseTripId(feature.properties?.trip_id);
          if (!tripId) return;
          const featureTaxiId = Number(feature.properties?.taxi_id ?? taxiId ?? 0);
          const rowKey = `${Number.isFinite(featureTaxiId) && featureTaxiId > 0 ? featureTaxiId : 'all'}-${tripId}`;
          const coords = normalizeLineCoords(feature.geometry?.coordinates);
          if (coords.length < 2) return;
          const current = rawByTrip.get(rowKey);
          if (current) {
            current.coordinates.push(...coords);
            current.points += Number(feature.properties?.point_count ?? coords.length);
            current.distanceKm = distanceKm(current.coordinates);
            if (feature.properties?.start_time && (!current.startTime || feature.properties.start_time < current.startTime)) {
              current.startTime = feature.properties.start_time;
              current.start = formatTripClock(feature.properties.start_time);
            }
            if (feature.properties?.end_time && (!current.endTime || feature.properties.end_time > current.endTime)) {
              current.endTime = feature.properties.end_time;
              current.end = formatTripClock(feature.properties.end_time);
            }
            return;
          }
          rawByTrip.set(rowKey, {
            id: rowKey,
            tripId,
            taxiId: Number.isFinite(featureTaxiId) && featureTaxiId > 0 ? featureTaxiId : undefined,
            index: rawByTrip.size + 1,
            status: 'drift',
            start: formatTripClock(feature.properties?.start_time),
            end: formatTripClock(feature.properties?.end_time),
            startTime: feature.properties?.start_time,
            endTime: feature.properties?.end_time,
            distanceKm: distanceKm(coords),
            duration: formatTripDuration(feature.properties?.start_time, feature.properties?.end_time),
            points: Number(feature.properties?.point_count ?? coords.length),
            coordinates: coords,
          });
        });

        const baseTrips = Array.from(rawByTrip.values());
        let matchedMap = new globalThis.Map<string, RawTrajectoryFeature>();
        if (enableMatched && baseTrips.length) {
          const matchedResp: { data: { features?: RawTrajectoryFeature[] } } = demoReadonly
            ? { data: { features: DEMO_FIXTURE.matched?.features ?? [] } }
            : await apiClient.get<{ features?: RawTrajectoryFeature[] }>('/api/trajectory/matched', {
              params: {
                taxi_id: taxiId,
                trip_ids: baseTrips.map((trip) => trip.tripId).join(','),
              },
              timeout: 60000,
            });
          matchedMap = new globalThis.Map(
            (matchedResp.data.features ?? [])
              .map((feature) => [baseTripId(feature.properties?.trip_id), feature] as const),
          );
        }

        const nextTrips = baseTrips.map((trip, index) => {
          const matched = matchedMap.get(trip.tripId);
          const matchedCoordinates = alignLineDirectionToRaw(
            normalizeLineCoords(matched?.geometry?.coordinates),
            trip.coordinates,
          );
          return {
            ...trip,
            index: index + 1,
            status: matchedCoordinates.length >= 2 ? 'matched' as const : 'drift' as const,
            matchedCoordinates: matchedCoordinates.length >= 2 ? matchedCoordinates : undefined,
          };
        });
        const totalDistance = nextTrips.reduce((sum, trip) => sum + trip.distanceKm, 0);
        const pointCount = nextTrips.reduce((sum, trip) => sum + trip.points, 0);
        const nextSelected = null;
        setTrajectoryTarget(taxiText);
        setTripCards(nextTrips);
        setSelectedTripId(nextSelected);
        renderTrajectoryTrips(nextTrips, nextSelected);
        setAnalysisResult({
          title: '轨迹溯源结果',
          subtitle: `F1-F2 · Taxi #${taxiId} ${enableMatched ? '路网匹配视图' : '原始轨迹视图'}`,
          metrics: [
            { label: '记录行程', value: formatInt(nextTrips.length) },
            { label: '原始点数', value: formatInt(pointCount) },
            { label: '总里程', value: `${totalDistance.toFixed(1)} km` },
          ],
          note: response.data.meta?.is_limited ? '结果已触发 max_trips 限制，建议缩小时间范围。' : '可进行动态轨迹回放。',
        });
      } else if (mode === 'region') {
        const nextRegionTool = forcedRegionTool ?? activeRegionTool;
        if (!nextRegionTool) {
          setStatus('idle');
          setAnalysisResult(null);
          return;
        }
        if (forcedRegionTool) setActiveRegionTool(forcedRegionTool);
        if (nextRegionTool === 'f3') {
          await runF3QueryByRectangles();
          return;
        }
        setAppliedRegionParams(regionParams);

        if (nextRegionTool === 'f4') {
          const requestId = ++f4RequestIdRef.current;
          const f4StartedAt = performance.now();
          setF4LegendDismissed(false);
          setF4GeneralizationUnlocked(false);
          setF4Generalizing(false);
          f4LastRenderedResolutionRef.current = null;
          setF4Feedback({ tone: 'info', text: '正在按当前视窗生成动态网格密度...' });
          setF4LastElapsedMs(null);
          setF4LastDataSource(null);
          setF4PreviewGridCount(null);
          if (!amap || !mapRef.current) {
            setStatus('error');
            setF4Feedback({ tone: 'error', text: '地图尚未初始化，F4 无法启动。' });
            setAnalysisResult({
              title: 'F4 地图未就绪',
              subtitle: '栅格热力',
              metrics: [{ label: '状态', value: '请稍后重试' }],
              note: '地图尚未初始化完成。',
            });
            return;
          }
          const bounds = mapRef.current.getBounds?.();
          const swPoint = bounds ? readLngLatLike(bounds.getSouthWest()) : null;
          const nePoint = bounds ? readLngLatLike(bounds.getNorthEast()) : null;
          if (!swPoint || !nePoint) {
            setStatus('error');
            setF4Feedback({ tone: 'error', text: '无法读取当前地图视窗，请调整地图后重试。' });
            setAnalysisResult({
              title: 'F4 视窗读取失败',
              subtitle: '栅格热力',
              metrics: [{ label: '状态', value: '无法读取地图范围' }],
              note: '请调整地图后重试。',
            });
            return;
          }

          const swWgs = gcj02ToWgs84(swPoint[0], swPoint[1]);
          const neWgs = gcj02ToWgs84(nePoint[0], nePoint[1]);
          const viewportBBox = {
            minLon: Math.min(swWgs[0], neWgs[0]),
            minLat: Math.min(swWgs[1], neWgs[1]),
            maxLon: Math.max(swWgs[0], neWgs[0]),
            maxLat: Math.max(swWgs[1], neWgs[1]),
          };
          const demoF4Snapshot = f4RenderMode === 'choropleth'
            ? (DEMO_FIXTURE.f4Choropleth ?? DEMO_FIXTURE.f4)
            : (DEMO_FIXTURE.f4Heatmap ?? DEMO_FIXTURE.f4);
          const demoF4BBox = demoF4Snapshot?.meta?.snapped_bbox
            ? {
              minLon: Number(demoF4Snapshot.meta.snapped_bbox.min_lon),
              minLat: Number(demoF4Snapshot.meta.snapped_bbox.min_lat),
              maxLon: Number(demoF4Snapshot.meta.snapped_bbox.max_lon),
              maxLat: Number(demoF4Snapshot.meta.snapped_bbox.max_lat),
            }
            : null;
          const bbox = demoReadonly && demoF4BBox ? demoF4BBox : viewportBBox;
          const snapshotTimeLabel = `${formatAxisTime(appliedRange[0]).slice(5)} 至 ${formatAxisTime(appliedRange[1]).slice(5)}`;

          const lonSpan = viewportBBox.maxLon - viewportBBox.minLon;
          const latSpan = viewportBBox.maxLat - viewportBBox.minLat;
          if (!demoReadonly && (lonSpan > 0.8 || latSpan > 0.6)) {
            setStatus('error');
            setF4Generating(false);
            setF4MapInteractionEnabled(true);
            setF4Feedback({ tone: 'warning', text: '当前地图范围过大，请先放大到目标区域。' });
            setAnalysisResult({
              title: 'F4 视窗过大',
              subtitle: '请先放大到目标区域',
              metrics: [
                { label: '当前经度跨度', value: lonSpan.toFixed(3) },
                { label: '当前纬度跨度', value: latSpan.toFixed(3) },
              ],
              note: '当前地图范围过大，建议放大后再生成网格密度。',
            });
            return;
          }

          const estimatedCells = demoReadonly
            ? Number(demoF4Snapshot?.meta?.cell_count ?? demoF4Snapshot?.cells?.length ?? 0)
            : estimateGridCells(bbox, f4GridSize);
          if (!demoReadonly && estimatedCells > 8000) {
            setStatus('error');
            setF4Generating(false);
            setF4MapInteractionEnabled(true);
            setF4Feedback({ tone: 'warning', text: '当前视窗网格过密，请放大地图或调大网格尺寸。' });
            setAnalysisResult({
              title: 'F4 网格过密',
              subtitle: '请放大视窗或调大网格尺寸后重试',
              metrics: [
                { label: '当前网格', value: `${f4GridSize} m` },
                { label: '预估网格', value: formatInt(estimatedCells) },
              ],
              note: '当前视窗网格过密，建议放大地图或增大网格尺寸。',
            });
            return;
          }
          if (!demoReadonly && f4RenderMode === 'choropleth' && estimatedCells > 3000) {
            setStatus('error');
            setF4Generating(false);
            setF4MapInteractionEnabled(true);
            setF4Feedback({ tone: 'warning', text: '色块图网格过密，建议放大地图或调大网格尺寸。' });
            setAnalysisResult({
              title: 'F4 色块图过密',
              subtitle: '请放大视窗或调大网格尺寸后重试',
              metrics: [
                { label: '当前网格', value: `${f4GridSize} m` },
                { label: '预估网格', value: formatInt(estimatedCells) },
              ],
              note: '离散色块图在高密网格下易遮挡底图，旧版前端会直接提示用户缩小范围。',
            });
            return;
          }

          const gridSizeM = f4GridSize;
          clearF4Layer();
          setF4Generating(true);
          setF4MapInteractionEnabled(false);

          const includeVehicleCount = f4RenderMode === 'choropleth';
          const maxCells = f4RenderMode === 'heatmap' ? 8000 : 3000;
          const gridDensityCacheKey = buildF4GridDensityCacheKey({
            startTime: appliedStartTime,
            endTime: appliedEndTime,
            gridSizeM,
            bbox,
            includeVehicleCount,
            maxCells,
          });
          const cachedGridDensity = f4GridDensityCacheRef.current.get(gridDensityCacheKey);
          let result: F4GridDensityResponse;
          let usedFrontendCache = false;
          if (cachedGridDensity && performance.now() - cachedGridDensity.storedAt < 60_000) {
            result = {
              ...cachedGridDensity.response,
              cells: cachedGridDensity.response.cells,
              meta: {
                ...(cachedGridDensity.response.meta ?? {}),
                cache_hit: true,
                query_mode: `${cachedGridDensity.response.meta?.query_mode ?? 'point_bucket'}+frontend_cache`,
              },
            };
            usedFrontendCache = true;
          } else {
            result = demoReadonly
              ? demoF4Snapshot as F4GridDensityResponse
              : await queryF4GridDensity({
                startTime: appliedStartTime,
                endTime: appliedEndTime,
                gridSizeM,
                minLon: bbox.minLon,
                minLat: bbox.minLat,
                maxLon: bbox.maxLon,
                maxLat: bbox.maxLat,
                includeVehicleCount,
                maxCells,
              });
            f4GridDensityCacheRef.current.set(gridDensityCacheKey, { storedAt: performance.now(), response: result });
            if (f4GridDensityCacheRef.current.size > 12) {
              const oldestKey = f4GridDensityCacheRef.current.keys().next().value;
              if (oldestKey) f4GridDensityCacheRef.current.delete(oldestKey);
            }
          }
          if (requestId !== f4RequestIdRef.current) return;
          if (result.meta?.error) throw new Error(result.meta.error);

          const cells = Array.isArray(result.cells) ? result.cells : [];
          setF4PreviewGridCount(cells.length);
          setF4LastEstimatedCells(cells.length);
          clearF4Layer();
          f4CellsRef.current = cells;
          setF4TopCells([...cells].sort((a, b) => Number(b.density || 0) - Number(a.density || 0)).slice(0, 5));
          const maxDensity = Math.max(
            Number(result.meta?.max_density ?? 0),
            ...cells.map((cell) => Number(cell.density ?? cell.point_count ?? 0)),
          );
          if (!cells.length || maxDensity <= 0) {
            setDisplayedTimeRange(appliedRange);
            setStatus('empty');
            setF4GeneralizationUnlocked(true);
            f4LastRenderedResolutionRef.current = f4GridSize;
            setF4Generating(false);
            setF4MapInteractionEnabled(true);
            setF4Feedback({ tone: 'warning', text: '当前时间窗和视窗内没有可显示的网格密度。' });
            setF4LastElapsedMs(performance.now() - f4StartedAt);
            setF4LastDataSource(usedFrontendCache || result.meta?.cache_hit ? 'cache' : 'live');
            setAnalysisResult({
              title: '网格热力结果为空',
              subtitle: `F4 · r=${gridSizeM}m`,
              metrics: [
                { label: '有效网格', value: '0' },
                { label: 'GPS 点数', value: formatInt(Number(result.meta?.total_points ?? 0)) },
              ],
              note: '当前时间窗和视窗范围内没有可显示的密度网格。',
            });
            return;
          }

          let maxDensityForLegend = maxDensity;
          let levels: Array<{ label: string; color: string; min: number; max: number }> | undefined;
          let heatRanges: Array<{ label: string; min: number; max: number; color: string }> | undefined;
          let heatGradientCss: string | undefined;
          let renderedMode: F4RenderMode = f4RenderMode;
          if (f4RenderMode === 'heatmap') {
            try {
              await ensureF4HeatMapPlugin();
              if (requestId !== f4RequestIdRef.current) return;
              const heatProfile = renderF4Heatmap(cells);
              maxDensityForLegend = heatProfile.clippedMax;
              heatRanges = heatProfile.ranges;
              heatGradientCss = heatProfile.gradientCss;
            } catch (error) {
              renderedMode = 'choropleth';
              setF4Feedback({ tone: 'warning', text: 'HeatMap 插件不可用，已自动降级为离散色块图。' });
            }
          }
          if (renderedMode === 'choropleth') {
            if (requestId !== f4RequestIdRef.current) return;
            const timeSpanHours = Math.max(1 / 60, ((appliedRange[1] - appliedRange[0]) / 100) * ((DATA_END_MS - DATA_START_MS) / 3_600_000));
            const renderResult = renderF4Choropleth(cells, { timeSpanHours, classifyMethod: f4ClassifyMethod });
            maxDensityForLegend = renderResult.maxStandardDensity;
            levels = renderResult.levels;
          }
          const snapshotBounds = getBoundsFromF4Cells(cells) ?? bbox;
          drawF4SnapshotBBox(snapshotBounds);
          const elapsedMs = performance.now() - f4StartedAt;
          setF4LegendMeta({
            mode: renderedMode,
            maxDensity: maxDensityForLegend,
            cellCount: cells.length,
            queryTimeLabel: snapshotTimeLabel,
            gridSizeM,
            bboxLabel: `经度 ${snapshotBounds.minLon.toFixed(3)}~${snapshotBounds.maxLon.toFixed(3)}，纬度 ${snapshotBounds.minLat.toFixed(3)}~${snapshotBounds.maxLat.toFixed(3)}`,
            elapsedMs,
            classifyMethod: renderedMode === 'choropleth' ? f4ClassifyMethod : undefined,
            heatRanges,
            levels,
            heatGradientCss,
            notice: renderedMode === f4RenderMode ? undefined : 'HeatMap 插件不可用，已自动降级为离散色块图。',
          });
          setDisplayedTimeRange(appliedRange);
          setStatus('ready');
          setF4GeneralizationUnlocked(true);
          f4LastRenderedResolutionRef.current = f4GridSize;
          setF4Generating(false);
          setF4MapInteractionEnabled(true);
          setF4LastElapsedMs(elapsedMs);
          setF4LastDataSource(usedFrontendCache || result.meta?.cache_hit ? 'cache' : 'live');
          if (renderedMode === f4RenderMode) {
            const cacheText = usedFrontendCache || result.meta?.cache_hit ? '（缓存复用）' : '';
            setF4Feedback({ tone: 'success', text: `已生成 ${cells.length} 个非空网格${cacheText}，当前为${renderedMode === 'heatmap' ? '模糊热力图' : '离散色块图'}。` });
          }
          setAnalysisResult({
            title: '网格热力结果',
            subtitle: `F4 · r=${gridSizeM}m ${renderedMode === 'heatmap' ? '模糊热力图' : `离散色块图 · ${f4ClassifyMethod}`}`,
            metrics: [
              { label: '有效网格', value: formatInt(cells.length) },
              { label: 'GPS 点数', value: formatInt(Number(result.meta?.total_points ?? 0)) },
              { label: '峰值密度', value: formatDensity(maxDensityForLegend) },
            ],
            note: `基于当前地图视窗调用旧接口 f4-grid-density 生成，网格大小 r=${gridSizeM}m。后端耗时 ${result.meta?.elapsed_ms != null ? `${(Number(result.meta.elapsed_ms) / 1000).toFixed(2)}s` : '--'}。`,
          });
        } else if (nextRegionTool === 'f5') {
          const areaA = f5AreaPayloadRef.current.A;
          const areaB = f5AreaPayloadRef.current.B;
          if (!areaA || !areaB) {
            setStatus('error');
            setAnalysisResult({
              title: 'F5 缺少 A/B 区域',
              subtitle: '请先绘制区域 A 和区域 B',
              metrics: [
                { label: '区域 A', value: areaA ? '已绘制' : '未绘制' },
                { label: '区域 B', value: areaB ? '已绘制' : '未绘制' },
                { label: '状态', value: '待补齐' },
              ],
              note: '两个区域都完成后才能计算双向 OD 流量。',
            });
            return;
          }
          clearF6Artifacts();
          clearF5FlowOverlays();
          const maxTransitionSeconds = Math.max(60, Math.min(21600, Math.round(f5MaxTransitionMinutes * 60)));
          const result = demoReadonly
            ? DEMO_FIXTURE.f5 as F5ABFlowResponse
            : await queryF5ABFlow({
              startTime: appliedStartTime,
              endTime: appliedEndTime,
              granularity: odGranularity,
              bufferMeters: f5BufferMeters,
              maxTransitionSeconds,
              areaA,
              areaB,
            });
          if (result.meta?.error) throw new Error(result.meta.error);
          setF5Result(result);
          setF5DetailsExpanded(false);
          drawF5FlowLine(result);
          const summary = result.summary;
          setDisplayedTimeRange(appliedRange);
          setStatus(summary.total > 0 ? 'ready' : 'empty');
          setAnalysisResult({
            title: 'OD 流向结果',
            subtitle: `F5 · A/B 双向统计 · ${odGranularity === 'day' ? '按天' : '按小时'}绘制`,
            metrics: [
              { label: 'A→B', value: formatInt(summary.a_to_b_total) },
              { label: 'B→A', value: formatInt(summary.b_to_a_total) },
              { label: '净流向', value: formatInt(summary.net_flow) },
            ],
            note: `最大直达耗时 ${Math.round(maxTransitionSeconds / 60)} 分钟；buffer=${f5BufferMeters}m；返回时间桶 ${result.items?.length ?? 0} 个。`,
          });
          return;
        } else {
          const coreArea = f6CoreAreaRef.current;
          if (!coreArea) {
            setStatus('error');
            setAnalysisResult({
              title: 'F6 缺少核心区域',
              subtitle: '请先绘制核心区域 A',
              metrics: [
                { label: '核心区域', value: '未绘制' },
                { label: '状态', value: '待补齐' },
              ],
              note: 'F6 会从核心区向外部网格统计出向、入向和净流向。',
            });
            return;
          }
          clearF5Artifacts();
          clearF6FlowOverlays();
          const maxTransitionSeconds = Math.max(
            60,
            Math.min(21600, Math.round((f6AnalysisMode === 'strict_od' ? f6StrictMaxTripMinutes : recommendF6ThroughTransferMinutes(coreArea)) * 60)),
          );
          const result = demoReadonly
            ? getDemoF6RadiationResponse(f6AnalysisMode)
            : await queryF6RadiationFlow({
              startTime: appliedStartTime,
              endTime: appliedEndTime,
              granularity: odGranularity,
              direction: f6Direction,
              analysisMode: f6AnalysisMode,
              coreArea,
              h3Resolution: f6H3Resolution,
              bufferMeters: f6BufferMeters,
              topK: f6TopK,
              maxTransitionSeconds,
            });
          if (result.meta?.error) throw new Error(result.meta.error);
          setF6Result(result);
          drawF6RadiationLines(result);
          const summary = result.summary;
          const topKRatio = Math.round(Number(summary.top_k_ratio || 0) * 100);
          setDisplayedTimeRange(appliedRange);
          setStatus(summary.total_flow > 0 ? 'ready' : 'empty');
          const backendElapsed = result.meta?.elapsed_ms;
          setAnalysisResult({
            title: '辐射分析结果',
            subtitle: `F6 · ${f6AnalysisMode === 'strict_od' ? '严格 OD' : '途经流向'} · 全量数据范围`,
            metrics: [
              { label: '全局出向', value: formatInt(summary.total_outbound) },
              { label: '全局入向', value: formatInt(summary.total_inbound) },
              { label: 'Top 覆盖', value: `${topKRatio}%` },
            ],
            note: `Top-${f6TopK}；H3=${f6H3Resolution}；buffer=${f6BufferMeters}m；全量外部 H3 区域 ${summary.external_region_count} 个；平均耗时 ${formatDurationMinutes(summary.avg_duration_min)}${backendElapsed == null ? '' : `；后端耗时 ${(Number(backendElapsed) / 1000).toFixed(2)}s`}。`,
          });
          return;
        }
      } else if (mode === 'decision') {
        const response = await apiClient.post<{
          paths?: unknown[];
          summary?: { path_count?: number; total_path_count_before_top_k?: number; top_k_trip_count?: number };
          meta?: { error?: string; elapsed_ms?: number };
        }>('/api/v1/analytics/f7-frequent-paths', {
          start_time: appliedStartTime,
          end_time: appliedEndTime,
          analysis_bbox: {
            min_lon: BEIJING_CORE_BBOX.minLon,
            min_lat: BEIJING_CORE_BBOX.minLat,
            max_lon: BEIJING_CORE_BBOX.maxLon,
            max_lat: BEIJING_CORE_BBOX.maxLat,
          },
          top_k: 10,
          min_group_length_m: 300,
          max_trips: 500,
          scope: 'bbox',
          sort_mode: 'frequency',
        }, {
          timeout: 300000,
        });

        if (response.data.meta?.error) throw new Error(response.data.meta.error);
        if (!response.data.paths?.length) {
          setDisplayedTimeRange(appliedRange);
          setStatus('empty');
          return;
        }

        setAnalysisResult({
          title: '决策建议结果',
          subtitle: 'F7 · 高频路径 Top-K',
          metrics: [
            { label: '返回路径', value: formatInt(response.data.summary?.path_count) },
            { label: '候选路径', value: formatInt(response.data.summary?.total_path_count_before_top_k) },
            { label: 'Top-K 行程', value: formatInt(response.data.summary?.top_k_trip_count) },
          ],
          note: response.data.meta?.elapsed_ms != null ? `后端耗时 ${(Number(response.data.meta.elapsed_ms) / 1000).toFixed(2)}s` : undefined,
        });
      }

      setDisplayedTimeRange(appliedRange);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      if (mode === 'region' && activeRegionTool === 'f4' && f4Generating) {
        setF4Generating(false);
        setF4MapInteractionEnabled(true);
        setF4LastElapsedMs(null);
        setF4LastDataSource(null);
        setF4Feedback({ tone: 'error', text: error instanceof Error ? error.message : 'F4 请求失败' });
      }
      setAnalysisResult({
        title: '接口请求失败',
        subtitle: modeTitle[mode],
        metrics: [
          { label: '状态', value: '异常' },
          { label: '模块', value: modeTitle[mode] },
          { label: '建议', value: '检查后端' },
        ],
        note: error instanceof Error ? error.message : '未知错误',
      });
    }
    finally {
      finishRunningTask(taskCode);
    }
  };

  const applyTimeQuery = () => {
    if (mode === 'overview') {
      setDisplayedTimeRange(queryTimeRange);
      setStatus('ready');
      return;
    }
    void runCompute();
  };

  React.useEffect(() => {
    if (mode !== 'region' || activeRegionTool !== 'f4' || !f4GeneralizationUnlocked) return;
    if (status === 'computing' || f4Generalizing) return;
    if (f4LastRenderedResolutionRef.current === f4GridSize) return;
    setF4Feedback({ tone: 'warning', text: '旧接口模式下请点击“生成密度图层”刷新分辨率结果。' });
  }, [activeRegionTool, f4GeneralizationUnlocked, f4Generalizing, mode, f4GridSize, status]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && timeDirty) {
        event.preventDefault();
        setQueryTimeRange(displayedTimeRange);
        return;
      }
      if (event.key === 'Enter' && timeDirty && mode !== 'region' && status !== 'computing') {
        event.preventDefault();
        applyTimeQuery();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [displayedTimeRange, mode, queryTimeRange, status, timeDirty]);

  const summary = overviewStats.summary;
  const modeStatusLabel: Record<WorkbenchMode, string> = {
    overview: '总览',
    trajectory: '轨迹',
    region: activeRegionEntry ? `${activeRegionEntry.code}` : '区域',
    decision: '决策',
  };
  const computeStatusLabel: Record<ComputeStatus, string> = {
    idle: '待执行',
    computing: '计算中',
    ready: '已就绪',
    empty: '结果为空',
    error: '请求失败',
  };
  const runningElapsedMs = runningTask ? runningNow - runningTask.startedAt : null;
  const runningEstimateMs = runningTask?.estimateMs ?? null;
  const runningEstimateText = formatRunningEstimate(runningEstimateMs, runningElapsedMs);
  const statusTask = runningTask ?? lastCompletedTask;
  const showTaskTiming = Boolean(statusTask && (status === 'computing' || status === 'ready' || status === 'empty' || status === 'error'));
  const mapLeftOffset = sidebarCollapsed ? '0px' : '420px';
  const timelineLeftOffset = sidebarCollapsed ? '60px' : '440px';
  const statusLeftOffset = sidebarCollapsed ? '16px' : '436px';

  const renderOverviewSidebar = () => (
    <GeoWorkbenchOverviewPanel
      summary={summary}
      overviewStats={overviewStats}
      analysisEntries={analysisEntries}
      onEnterMode={enterMode}
      formatInt={formatInt}
      formatCompact={formatCompact}
      formatDateRange={formatDateRange}
      formatBoundaryShare={formatBoundaryShare}
    />
  );

  const renderTrajectorySidebar = () => (
    <GeoWorkbenchTrajectoryPanel
      status={status}
      demoReadonly={demoReadonly}
      targetTaxiId={targetTaxiId}
      hasTrajectoryInput={hasTrajectoryInput}
      trajectoryTarget={trajectoryTarget}
      tripCards={tripCards}
      selectedTripId={selectedTripId}
      showMatchedMode={showMatchedMode}
      useMapVMode={useMapVMode}
      showOtherTrips={showOtherTrips}
      playbackState={playbackState}
      onTargetTaxiIdChange={(value) => {
        if (!demoReadonly) setTargetTaxiId(value.replace(/[^\d]/g, '').slice(0, 5));
      }}
      onSubmitTrajectorySearch={submitTrajectorySearch}
      onRunCompute={() => {
        if (submitTrajectorySearch()) {
          void runCompute();
        }
      }}
      onToggleMatchedMode={() => setShowMatchedMode((value) => !value)}
      onToggleMapVMode={() => setUseMapVMode((value) => !value)}
      onToggleShowOtherTrips={toggleShowOtherTrips}
      onSelectTrip={(tripId) => {
        if (trajectoryPlaybackRef.current.tripId && trajectoryPlaybackRef.current.tripId !== tripId) {
          restoreTripPlayback(trajectoryPlaybackRef.current.tripId);
        }
        setSelectedTripId(tripId);
        applyTrajectorySelection(tripId, true);
      }}
      onToggleTripPlayback={toggleTripPlayback}
      onRestoreTripPlayback={restoreTripPlayback}
      onExportTripJson={exportTripJson}
      formatInt={formatInt}
      formatTripDateTime={formatTripDateTime}
    />
  );

  const renderDecisionSidebar = () => (
    <GeoWorkbenchDecisionPanel
      demoReadonly={demoReadonly}
      f7TopK={f7TopK}
      setF7TopK={setF7TopK}
      f8TopK={f8TopK}
      setF8TopK={setF8TopK}
      minLengthX={f7MinLengthMeters}
      setMinLengthX={setF7MinLengthMeters}
      f8DrawingTarget={f5DrawingTarget}
      f8CandidateMode={f8CandidateMode}
      setF8CandidateMode={setF8CandidateMode}
      f8Loading={f8DecisionLoading}
      f8Result={f8Result}
      f8FocusedRouteKey={f8FocusedRouteKey}
      setF8FocusedRouteKey={setF8FocusedRouteKey}
      f8AnimatingRouteKey={f8AnimatingRouteKey}
      toggleF8RouteAnimation={toggleF8RouteAnimation}
      resetF8RouteAnimation={resetF8RouteAnimation}
      runF8DrawAreaA={async () => { runF5DrawArea('A'); }}
      runF8DrawAreaB={async () => { runF5DrawArea('B'); }}
      runF8ClearAreaA={async () => {
        invalidateF8F9TaskState({ keepAreas: true });
        clearF5Area('A');
      }}
      runF8ClearAreaB={async () => {
        invalidateF8F9TaskState({ keepAreas: true });
        clearF5Area('B');
      }}
      runF8Mining={runDecisionF8}
      showF8RoutesOnMap={showF8RoutesOnMap}
      showF9RoutesOnMap={showF9RoutesOnMap}
      onSectionChange={handleDecisionSectionChange}
      onF8RouteDoubleClick={pinF8RouteDetail}
      onF9RecommendedRouteChange={setF9RecommendedRouteKey}
      f7Loading={f7DecisionLoading}
      f7Result={f7Result}
      f7RoadDetail={f7RoadDetail}
      f7DetailLoading={f7DetailLoading}
      f7ViewMode={f7ViewMode}
      f7SelectedPath={f7SelectedPath}
      f7HoveredSegmentUid={f7HoveredSegmentUid}
      setF7HoveredSegmentUid={setF7HoveredSegmentUid}
      f7FocusedPathKey={f7FocusedPathKey}
      setF7FocusedPathKey={setF7FocusedPathKey}
      runF78Mining={runDecisionF7}
      runF7RoadDetail={runF7RoadDetail}
      returnF7Overview={returnF7Overview}
      onValidationNotice={showValidationNotice}
    />
  );

  return (
    <GeoWorkbenchShell
      mapStage={(
        <GeoWorkbenchMapStage
          leftOffset={mapLeftOffset}
          mapContainerRef={mapContainerRef}
          sdkStatus={sdkStatus}
          sdkError={sdkError}
          mapReady={mapReady}
        />
      )}
      mapStatus={(
        <div
        className="pointer-events-none absolute left-4 top-4 z-10 transition-[left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ left: statusLeftOffset }}
      >
        <div className="max-w-[min(680px,calc(100vw-2rem))] rounded-xl border border-white/10 bg-[#161b24]/84 px-3 py-2 text-[11px] text-slate-300 shadow-[0_10px_28px_rgba(0,0,0,0.28)] backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-slate-100">{modeStatusLabel[mode]}</span>
            <span className="text-slate-500">/</span>
            <span
              className={`inline-flex items-center gap-1 ${
                status === 'computing'
                  ? 'text-cyan-200'
                  : status === 'error'
                    ? 'text-rose-200'
                    : status === 'empty'
                      ? 'text-amber-200'
                      : 'text-emerald-200'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status === 'computing'
                    ? 'bg-cyan-300'
                    : status === 'error'
                      ? 'bg-rose-300'
                      : status === 'empty'
                        ? 'bg-amber-300'
                        : 'bg-emerald-300'
                }`}
              />
              {statusTask && showTaskTiming
                ? `${status === 'computing' ? '' : '上一步 '}${statusTask.code} ${statusTask.label}`
                : computeStatusLabel[status]}
            </span>
            {statusNotice ? (
              <>
                <span className="text-slate-500">/</span>
                <span className={statusNotice.tone === 'error' ? 'text-rose-200' : 'text-amber-200'}>
                  参数提示：{statusNotice.text}
                </span>
              </>
            ) : null}
            {runningTask && status === 'computing' ? (
              <>
                <span className="text-slate-500">/</span>
                <span className="text-cyan-100">已运行 {formatRunningElapsed(runningElapsedMs)}</span>
                <span className="text-slate-500">/</span>
                <span className="text-slate-300">{runningEstimateText}</span>
              </>
            ) : null}
            {!runningTask && lastCompletedTask && showTaskTiming ? (
              <>
                <span className="text-slate-500">/</span>
                <span className="text-slate-300">运行了 {formatRunningElapsed(lastCompletedTask.elapsedMs)}</span>
              </>
            ) : null}
            {timeDirty ? <span className="text-amber-200/85">时间未同步</span> : null}
          </div>
        </div>
      </div>
      )}
      mapTools={(
        <div className="absolute right-4 top-4 z-30 sm:right-5 sm:top-5">
        <div className="flex items-start gap-2">
          {mode === 'decision' && (decisionMapLayer === 'f8' || decisionMapLayer === 'f9') && f8PinnedRouteItem && f8PinnedRouteKey ? (
            <div className="w-[min(360px,calc(100vw-7rem))] rounded-2xl border border-cyan-300/24 bg-[#182231]/92 p-4 text-slate-200 shadow-[0_20px_54px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Corridor Detail</div>
                  <div className="mt-1 text-base font-semibold text-slate-50">
                    #{f8PinnedRouteOrder ?? '--'} A→B 走廊
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    排序方式：{f8PinnedRouteSortMode === 'p50' ? 'p50' : f8PinnedRouteSortMode === 'avg' ? 'avg' : '频次'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearPinnedF8RouteDetail}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-slate-600/70 bg-black/15 text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
                  aria-label="删除走廊明细"
                  title="删除"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
                {('corridor_signature' in f8PinnedRouteItem ? f8PinnedRouteItem.corridor_signature : f8PinnedRouteItem.route_signature) || '未命名走廊'}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
                  <div className="text-[10px] text-slate-500">覆盖行程</div>
                  <div className="mt-1 text-sm font-semibold text-slate-100">{formatInt(f8PinnedRouteItem.trip_count)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
                  <div className="text-[10px] text-slate-500">车辆数</div>
                  <div className="mt-1 text-sm font-semibold text-slate-100">{formatInt(f8PinnedRouteItem.vehicle_count)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
                  <div className="text-[10px] text-slate-500">典型耗时</div>
                  <div className="mt-1 text-sm font-semibold text-slate-100">{formatDurationMinutes(f8PinnedRouteItem.p50_duration_min ?? f8PinnedRouteItem.avg_duration_min ?? null)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
                  <div className="text-[10px] text-slate-500">路线长度</div>
                  <div className="mt-1 text-sm font-semibold text-slate-100">{formatLengthMeters(('route_length_m' in f8PinnedRouteItem ? f8PinnedRouteItem.route_length_m : f8PinnedRouteItem.avg_route_length_m) ?? ('avg_route_length_m' in f8PinnedRouteItem ? f8PinnedRouteItem.avg_route_length_m : null))}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
                  <div className="text-slate-500">p50</div>
                  <div className="mt-1 font-semibold text-slate-100">{formatDurationMinutes(f8PinnedRouteItem.p50_duration_min ?? null)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
                  <div className="text-slate-500">avg</div>
                  <div className="mt-1 font-semibold text-slate-100">{formatDurationMinutes(f8PinnedRouteItem.avg_duration_min ?? null)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
                  <div className="text-slate-500">p90</div>
                  <div className="mt-1 font-semibold text-slate-100">{formatDurationMinutes(f8PinnedRouteItem.p90_duration_min ?? null)}</div>
                </div>
              </div>
            </div>
          ) : null}
          {mode === 'region' && activeRegionTool === 'f4' && f4LegendMeta && !f4LegendDismissed ? (
            <div className="w-[min(360px,calc(100vw-7rem))] max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-[#3a4a58] bg-[#1d2632]/90 p-4 text-slate-300 shadow-[0_20px_54px_rgba(0,0,0,0.5)] backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold tracking-wide text-slate-100">F4 快照</div>
                <button
                  type="button"
                  onClick={() => setF4LegendDismissed(true)}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-slate-600/70 bg-black/15 text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
                  aria-label="关闭 F4 快照"
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 space-y-1.5 rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-[10px] leading-4.5 text-slate-300">
                <div>模式：{f4LegendMeta.mode === 'heatmap' ? '模糊热力图' : '离散色块图'}</div>
                {f4LegendMeta.mode === 'heatmap' ? <div>标准：分位裁剪（q40 / q60 / q80 / q95）</div> : null}
                <div>当前 r：{f4LegendMeta.gridSizeM}m</div>
                <div>网格数：{formatInt(f4LegendMeta.cellCount)}</div>
                <div>{f4LegendMeta.mode === 'heatmap' ? '热度上限：' : '峰值密度：'} {formatDensity(f4LegendMeta.maxDensity)}</div>
              </div>
              {f4LegendMeta.mode === 'heatmap' ? (
                <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5">
                  <div className="h-3 rounded-full border border-slate-700/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)]" style={{ background: f4LegendMeta.heatGradientCss || 'linear-gradient(90deg, rgba(0,0,0,0), #38bdf8 20%, #60a5fa 48%, #84cc16 74%, #facc15 92%, #f97316 100%)' }} />
                  <div className="mt-1.5 flex justify-between text-[10px] font-medium text-slate-500">
                    <span>低密度</span>
                    <span>高密度</span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {(f4LegendMeta.heatRanges ?? []).map((item) => (
                      <div key={item.label} className="flex items-center gap-2 text-[10px] text-slate-300">
                        <i className="h-3 w-3 rounded-[3px]" style={{ background: item.color }} />
                        <span className="font-semibold">{item.label}：</span>
                        <span>{formatDensity(item.min)} - {formatDensity(item.max)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5">
                  <div className="space-y-1.5">
                    {(f4LegendMeta.levels ?? []).map((item) => (
                      <div key={item.label} className="flex items-center gap-2 text-[10px] text-slate-300">
                        <i className="h-3 w-3 rounded-[3px]" style={{ background: item.color }} />
                        <span className="font-semibold">{item.label}：</span>
                        <span>{formatDensity(item.min)} - {formatDensity(item.max)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
          {stylePickerOpen ? (
            <div className="rounded-sm border border-[#34414c] bg-[#20242d]/94 p-2 shadow-[0_18px_46px_rgba(0,0,0,0.45)] backdrop-blur-md">
              <div className="mb-2 px-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">Map Style</div>
              <div className="space-y-1">
                {mapStyleOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => {
                      setMapStyleKey(option.key);
                      setStylePickerOpen(false);
                    }}
                    className={`flex w-40 items-center justify-between rounded-sm px-3 py-2 text-left transition ${
                      mapStyleKey === option.key
                        ? 'bg-cyan-300/12 text-cyan-100'
                        : 'text-slate-400 hover:bg-[#2a333d] hover:text-slate-100'
                    }`}
                  >
                    <span className="text-xs font-semibold">{option.label}</span>
                    <span className="text-[10px] text-slate-500">{option.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <GeoWorkbenchAssistant
            open={assistantOpen}
            context={{
              mode,
              activeFeature: mode === 'trajectory'
                ? 'F1-F2'
                : mode === 'region'
                  ? activeRegionTool?.toUpperCase()
                  : mode === 'decision'
                    ? decisionMapLayer ?? 'F7-F9'
                    : 'overview',
              mapStyle: mapStyleKey,
              zoom: Number(mapRef.current?.getZoom?.() ?? null),
            }}
            onRunAction={runAssistantAction}
            onClose={() => setAssistantOpen(false)}
          />
          <div className="flex flex-col gap-2">
          <button
            type="button"
            title="切换底图样式"
            onClick={() => setStylePickerOpen((value) => !value)}
            className={`grid h-10 w-10 place-items-center rounded-sm border border-[#34414c] bg-[#20242d]/94 text-slate-400 shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur-md transition hover:border-cyan-300/30 hover:text-cyan-200 ${stylePickerOpen ? 'border-cyan-300/30 text-cyan-200' : ''}`}
          >
            <Layers className="h-4 w-4" />
          </button>
          <div className="overflow-hidden rounded-sm border border-[#34414c] bg-[#20242d]/94 shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur-md">
            <button
              type="button"
              title="放大地图"
              onClick={() => mapRef.current?.zoomIn?.()}
              className="grid h-10 w-10 place-items-center text-slate-400 transition hover:bg-[#2a333d] hover:text-cyan-200"
            >
              <Plus className="h-4 w-4" />
            </button>
            <div className="h-px bg-[#34414c]" />
            <button
              type="button"
              title="缩小地图"
              onClick={() => mapRef.current?.zoomOut?.()}
              className="grid h-10 w-10 place-items-center text-slate-400 transition hover:bg-[#2a333d] hover:text-cyan-200"
            >
              <Minus className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            title="AI 项目助手"
            onClick={() => setAssistantOpen((value) => !value)}
            className={`grid h-10 w-10 place-items-center rounded-sm border border-[#34414c] bg-[#20242d]/94 text-slate-400 shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur-md transition hover:border-cyan-300/30 hover:text-cyan-200 ${assistantOpen ? 'border-cyan-300/30 text-cyan-200' : ''}`}
            aria-label="AI 项目助手"
          >
            <Sparkles className="h-4 w-4" />
          </button>
          </div>
        </div>
      </div>
      )}
      sidebar={(
        <GeoWorkbenchSidebar
          collapsed={sidebarCollapsed}
          title="Urban Taxi Vis"
          subtitle="T-Driver 2008"
          showBack={mode !== 'overview'}
          onBack={resetOverview}
          onCollapse={() => setSidebarCollapsed(true)}
          onExpand={() => setSidebarCollapsed(false)}
          demoActive={demoReadonly}
          onDemoToggle={toggleDemoReadonly}
        >
            {mode === 'overview' ? (
              renderOverviewSidebar()
            ) : (
              <div className="h-full min-h-0">
                {mode === 'trajectory' ? (
                  renderTrajectorySidebar()
                ) : mode === 'region' ? (
                  <GeoWorkbenchRegionPanel
                    status={status}
                    demoReadonly={demoReadonly}
                    activeRegionTool={activeRegionTool}
                    regionToolEntries={regionToolEntries}
                    onToggleTool={(key) => switchRegionTool(key as RegionTool | null)}
                    activeVehicles={activeVehicles}
                    formatInt={formatInt}
                    formatDurationMinutes={formatDurationMinutes}
                    formatF5BucketLabel={formatF5BucketLabel}
                    f3Loading={f3Loading}
                    f3Drawing={f3Drawing}
                    hasF3Selection={f3BBoxPayloadsRef.current.length > 0}
                    f3ShowOnlyInBBox={f3ShowOnlyInBBox}
                    f3BoxSummaries={f3BoxSummaries}
                    f3DetailsExpanded={f3DetailsExpanded}
                    f3VisibleRows={f3VisibleRows}
                    f3SelectedTaxiId={f3SelectedTaxiId}
                    f3Page={f3Page}
                    f3PageItems={f3PageItems}
                    f3PageCount={f3PageCount}
                    f3JumpPage={f3JumpPage}
                    f3RowsLength={f3Rows.length}
                    onRunF3DrawRectangle={runF3DrawRectangle}
                    onRunF3QueryByRectangles={() => { void runCompute('f3'); }}
                    onClearF3Selection={clearF3Selection}
                    onToggleF3Mode={() => handleF3ModeToggle(!f3ShowOnlyInBBox)}
                    onToggleF3Details={() => setF3DetailsExpanded((value) => !value)}
                    onF3TaxiClick={(row) => { void handleF3TaxiClick(row); }}
                    onSetF3Page={setF3Page}
                    onF3JumpPageChange={setF3JumpPage}
                    onApplyF3JumpPage={applyF3JumpPage}
                    f4Generating={f4Generating}
                    f4GridSize={f4GridSize}
                    f4ViewportEstimate={f4ViewportEstimate}
                    f4RenderMode={f4RenderMode}
                    f4ClassifyMethod={f4ClassifyMethod}
                    onSetF4GridSize={setF4GridSize}
                    onSetF4RenderMode={setF4RenderMode}
                    onSetF4ClassifyMethod={setF4ClassifyMethod}
                    onRunComputeF4={() => { void runCompute('f4'); }}
                    f5DrawingTarget={f5DrawingTarget}
                    hasF5AreaA={Boolean(f5AreaPayloadRef.current.A)}
                    hasF5AreaB={Boolean(f5AreaPayloadRef.current.B)}
                    odGranularity={odGranularity}
                    f5BufferMeters={f5BufferMeters}
                    f5MaxTransitionMinutes={f5MaxTransitionMinutes}
                    f5ThresholdRecommendation={f5ThresholdRecommendation}
                    f5Result={f5Result}
                    f5DetailsExpanded={f5DetailsExpanded}
                    f5Items={f5Items}
                    f5MaxBucketFlow={f5MaxBucketFlow}
                    onRunF5DrawArea={runF5DrawArea}
                    onClearF5Area={clearF5Area}
                    onClearF5FlowOverlays={clearF5FlowOverlays}
                    onResetF5Result={() => setF5Result(null)}
                    onSetOdGranularity={setOdGranularity}
                    onSetF5BufferMeters={setF5BufferMeters}
                    onSetF5MaxTransitionMinutes={setF5MaxTransitionMinutes}
                    onRunComputeF5={() => { void runCompute('f5'); }}
                    onToggleF5Details={() => setF5DetailsExpanded((value) => !value)}
                    f6Drawing={f6Drawing}
                    hasF6CoreArea={Boolean(f6CoreAreaRef.current)}
                    f6Direction={f6Direction}
                    f6AnalysisMode={f6AnalysisMode}
                    f6H3Resolution={f6H3Resolution}
                    f6BufferMeters={f6BufferMeters}
                    f6TopK={f6TopK}
                    f6StrictMaxTripMinutes={f6StrictMaxTripMinutes}
                    f6Summary={f6Summary}
                    f6TopKRatio={f6TopKRatio}
                    f6DetailsExpanded={f6DetailsExpanded}
                    f6Regions={f6Regions}
                    f6MaxOutbound={f6MaxOutbound}
                    f6MaxInbound={f6MaxInbound}
                    onRunF6DrawCoreArea={runF6DrawCoreArea}
                    onClearF6Artifacts={clearF6Artifacts}
                    onSetF6Direction={setF6Direction}
                    onSetF6AnalysisMode={setF6AnalysisMode}
                    onSetF6H3Resolution={setF6H3Resolution}
                    onSetF6BufferMeters={setF6BufferMeters}
                    onSetF6TopK={setF6TopK}
                    onSetF6StrictMaxTripMinutes={setF6StrictMaxTripMinutes}
                    onRunComputeF6={() => { void runCompute('f6'); }}
                    onToggleF6Details={() => setF6DetailsExpanded((value) => !value)}
                    onSetF6RegionFocus={setF6RegionFocus}
                    onValidationNotice={showValidationNotice}
                  />
                ) : (
                  renderDecisionSidebar()
                )}
              </div>
            )}
        </GeoWorkbenchSidebar>
      )}
      timeline={(
        <GeoWorkbenchTimeline
          leftOffset={timelineLeftOffset}
          demoReadonly={demoReadonly}
          queryTimeLabel={formatTimeRange(queryTimeRange)}
          displayedTimeLabel={formatTimeRange(displayedTimeRange)}
          startLabel={formatAxisTime(0)}
          endLabel={formatAxisTime(100)}
          queryTimeRange={queryTimeRange}
          displayedTimeRange={displayedTimeRange}
          histogram={histogram}
          timeDirty={timeDirty}
          mode={mode}
          status={status}
          activeVehiclesLabel={formatInt(activeVehicles)}
          onApplyTimeQuery={applyTimeQuery}
          onStartRangeChange={(value) => {
            if (!demoReadonly) setQueryTimeRange((range) => clampTimeRange([value, range[1]]));
          }}
          onEndRangeChange={(value) => {
            if (!demoReadonly) setQueryTimeRange((range) => clampTimeRange([range[0], value]));
          }}
        />
      )}
    />
  );
}
