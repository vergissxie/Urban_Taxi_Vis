import { Activity, AreaChart, Brush, Route, Sparkles } from 'lucide-react';
import { APP_CONFIG } from '../../config/appConfig';
import type {
  AnalysisEntry,
  ComputeStatus,
  MapStyleKey,
  RegionParams,
  RegionToolEntry,
  TrajectoryTripCard,
  WorkbenchMode,
} from './types';

export const DATA_START = '2008-02-02T00:00:00';
export const DATA_END = '2008-02-08T23:59:59';
export const DATA_START_MS = new Date(DATA_START).getTime();
export const DATA_END_MS = new Date(DATA_END).getTime();
export const MIN_TIME_WINDOW_PERCENT = 0.7;
export const BEIJING_CORE_BBOX = {
  minLon: 116.32,
  minLat: 39.86,
  maxLon: 116.46,
  maxLat: 39.98,
};

export const analysisEntries: AnalysisEntry[] = [
  { mode: 'trajectory', title: '基础轨迹检索 (F1-F2)', description: '车辆轨迹查询、抽稀回放与路网匹配对比', icon: Route },
  { mode: 'region', title: '区域与网格态势 (F3-F6)', description: '框选统计、栅格热力、OD 流向与核心区诊断', icon: AreaChart },
  { mode: 'decision', title: '高频路径与策略推荐 (F7-F9)', description: '高频道路、A/B 路线与策略排序', icon: Sparkles },
];

export const regionToolEntries: RegionToolEntry[] = [
  { key: 'f3', code: 'F3', title: '框选统计', description: '矩形框选与并集统计', icon: Brush },
  { key: 'f4', code: 'F4', title: '栅格热力', description: '分辨率、热点网格与密度高亮', icon: AreaChart },
  { key: 'f5', code: 'F5', title: 'OD 流向', description: '流量阈值、核心迁徙路线与飞线聚焦', icon: Route },
  { key: 'f6', code: 'F6', title: '辐射分析', description: '圆心半径、圈层覆盖与距离衰减', icon: Activity },
];

export const defaultRegionParams: RegionParams = {
  f5FlowThreshold: 20,
};

export const F3_MAX_TAXI_ID = 10357;
export const F3_BOX_COLORS = ['#22d3ee', '#60a5fa', '#34d399', '#facc15', '#fb7185', '#a78bfa'];
export const F4_H3_BASE_RESOLUTION = 10;
export const F4_RECOMMENDED_LEVELS = [
  { label: '街区级', gridSizeM: 200 },
  { label: '街道级', gridSizeM: 400 },
  { label: '城区级', gridSizeM: 700 },
  { label: '片区级', gridSizeM: 1000 },
  { label: '市域级', gridSizeM: 1500 },
];
export const F4_CHOROPLETH_LEVELS = [
  { label: '极高', color: '#dc2626' },
  { label: '较高', color: '#f97316' },
  { label: '中等', color: '#facc15' },
  { label: '较低', color: '#84cc16' },
  { label: '低', color: '#22c55e' },
];
export const F8_DEFAULT_BUFFER_METERS = 30;
export const F8_DEFAULT_MIN_EDGE_LENGTH_M = 20;
export const F8_DEFAULT_MIN_ROUTE_LENGTH_M = 500;
export const F8_INTERACTIVE_MAX_CANDIDATE_TRIPS = 10000;

export const histogram = [28, 44, 36, 62, 51, 78, 56, 42, 66, 84, 73, 58, 47, 69, 92, 74, 53, 38, 49, 61, 45, 34, 29, 41];

export const mapStyleOptions: Array<{ key: MapStyleKey; label: string; hint: string; value: string }> = [
  { key: 'darkblue', label: '极夜蓝', hint: '推荐', value: APP_CONFIG.map.darkStyle },
  { key: 'dark', label: '幻影黑', hint: '高对比', value: APP_CONFIG.map.blackStyle },
  { key: 'normal', label: '标准', hint: '旧版', value: APP_CONFIG.map.lightStyle },
];

export const trajectoryTripCards: TrajectoryTripCard[] = [
  { id: '1', tripId: '1', index: 1, status: 'matched', start: '13:35:53', end: '18:46:28', distanceKm: 121.8, duration: '5h 10m', points: 1925, coordinates: [] },
  { id: '2', tripId: '2', index: 2, status: 'matched', start: '00:56:13', end: '01:01:14', distanceKm: 2.7, duration: '5m', points: 67, coordinates: [] },
  { id: '3', tripId: '3', index: 3, status: 'matched', start: '07:18:44', end: '09:02:31', distanceKm: 28.4, duration: '1h 43m', points: 614, coordinates: [] },
  { id: '4', tripId: '4', index: 4, status: 'drift', start: '10:12:20', end: '13:40:19', distanceKm: 62.8, duration: '3h 27m', points: 1187, coordinates: [] },
  { id: '5', tripId: '5', index: 5, status: 'matched', start: '20:16:09', end: '22:08:52', distanceKm: 41.3, duration: '1h 52m', points: 732, coordinates: [] },
];

export const modeTitle: Record<WorkbenchMode, string> = {
  overview: '数据总览',
  trajectory: '轨迹溯源',
  region: '区域诊断',
  decision: '决策建议',
};

export const statusCopy: Record<ComputeStatus, string> = {
  idle: '待计算',
  computing: '计算中',
  ready: '已渲染',
  empty: '无匹配结果',
  error: '接口异常',
};
