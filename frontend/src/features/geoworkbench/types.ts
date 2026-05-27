import type React from 'react';
import type { F4GridCell } from '../../services/trajectoryService';

export type WorkbenchMode = 'overview' | 'trajectory' | 'region' | 'decision';
export type ComputeStatus = 'idle' | 'computing' | 'ready' | 'empty' | 'error';
export type BrushMode = 'none' | 'areaA' | 'areaB';
export type MapStyleKey = 'darkblue' | 'dark' | 'normal';
export type RegionTool = 'f3' | 'f4' | 'f5' | 'f6';
export type F4RenderMode = 'heatmap' | 'choropleth';
export type F4ClassifyMethod = 'quantile' | 'jenks' | 'equal';
export type F6Direction = 'outbound' | 'inbound' | 'both';
export type F6AnalysisMode = 'strict_od' | 'through_flow';

export interface DatasetSummary {
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

export interface OverviewStats {
  summary: DatasetSummary | null;
  activeVehicles: number | null;
  summaryLoaded: boolean;
  activeLoaded: boolean;
  error?: string;
}

export interface AnalysisEntry {
  mode: Exclude<WorkbenchMode, 'overview'>;
  title: string;
  description: string;
  icon: React.ElementType;
}

export interface RegionToolEntry {
  key: RegionTool;
  code: string;
  title: string;
  description: string;
  icon: React.ElementType;
}

export interface ResultMetric {
  label: string;
  value: string;
}

export interface AnalysisResult {
  title: string;
  subtitle: string;
  metrics: ResultMetric[];
  note?: string;
}

export interface RegionParams {
  f5FlowThreshold: number;
}

export interface F3BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface F3BoxSummary {
  boxIndex: number;
  color: string;
  vehicleCount: number;
}

export interface F4LegendMeta {
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

export interface F4H3BaseData {
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

export interface F4WorkerResponse {
  requestId: number;
  result?: F4GridCell[];
  error?: string;
}

export interface TrajectoryTripCard {
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

export interface RawTrajectoryFeature {
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

export interface TrajectoryOverlayGroup {
  overlays: any[];
  markers: any[];
  playbackMarker?: any;
  startMarker?: any;
  endMarker?: any;
  displayPath: Array<[number, number]>;
  playbackPath: Array<[number, number]>;
}

export interface F6OverlayEntry {
  overlay: any;
  base: Record<string, unknown>;
  dim: Record<string, unknown>;
  focus: Record<string, unknown>;
}

export type F7OverlayEntry = F6OverlayEntry & {
  fullPath?: Array<[number, number]>;
  animatePath?: boolean;
};

export type LineGeometryLike = {
  type?: 'LineString' | 'MultiLineString';
  coordinates?: unknown;
} | null | undefined;
