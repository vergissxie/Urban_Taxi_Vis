import {
  BEIJING_CORE_BBOX,
  DATA_END_MS,
  DATA_START_MS,
  F4_CHOROPLETH_LEVELS,
  F4_RECOMMENDED_LEVELS,
  MIN_TIME_WINDOW_PERCENT,
} from './config';
import type {
  DatasetSummary,
  F3BBox,
  F4ClassifyMethod,
  F4H3BaseData,
  F4LegendMeta,
  F4RenderMode,
  F4WorkerResponse,
  LineGeometryLike,
} from './types';
import type { F4GridCell, F5BBox, F7FrequentPath } from '../../services/trajectoryService';

export function formatInt(value: number | null | undefined, fallback = '--') {
  if (value == null || Number.isNaN(value)) return fallback;
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function formatCompact(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '--';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}w`;
  return formatInt(value);
}

export function formatDateRange(summary: DatasetSummary | null) {
  const start = summary?.time_range?.start_time?.slice(0, 10);
  const end = summary?.time_range?.end_time?.slice(0, 10);
  if (!start || !end) return '--';
  return `${start} - ${end}`;
}

export function formatBoundaryShare(summary: DatasetSummary | null) {
  const total = summary?.point_count ?? 0;
  const outliers = summary?.outlier_point_count ?? 0;
  if (!total) return '--';
  const ratio = Math.max(0, Math.min(1, (total - outliers) / total));
  return `${(ratio * 100).toFixed(1)}%`;
}

export function clampTimeRange(next: [number, number]): [number, number] {
  const start = Math.max(0, Math.min(100 - MIN_TIME_WINDOW_PERCENT, next[0]));
  const end = Math.min(100, Math.max(start + MIN_TIME_WINDOW_PERCENT, next[1]));
  return [Number(start.toFixed(2)), Number(end.toFixed(2))];
}

export function estimateGridCells(bbox: F5BBox, gridSizeM: number) {
  const widthMeters = distanceMeters([bbox.minLon, bbox.minLat], [bbox.maxLon, bbox.minLat]);
  const heightMeters = distanceMeters([bbox.minLon, bbox.minLat], [bbox.minLon, bbox.maxLat]);
  const estimatedCells = Math.max(1, Math.round((widthMeters / gridSizeM) * (heightMeters / gridSizeM)));
  return { widthMeters, heightMeters, estimatedCells };
}

export function recommendF4GridSpec(bbox: F5BBox) {
  const levels = F4_RECOMMENDED_LEVELS.map((item) => ({
    ...item,
    estimatedCells: estimateGridCells(bbox, item.gridSizeM).estimatedCells,
  }));
  const recommended = levels.find((item) => item.estimatedCells <= 500) ?? levels[levels.length - 1];
  return {
    estimatedCells: recommended.estimatedCells,
    recommendedGridSizeM: recommended.gridSizeM,
    recommendedLevel: recommended.label,
  };
}

export function percentToDate(percent: number) {
  const clamped = Math.max(0, Math.min(100, percent));
  return new Date(DATA_START_MS + ((DATA_END_MS - DATA_START_MS) * clamped) / 100);
}

export function toBackendTime(percent: number) {
  return percentToDate(percent).toISOString().slice(0, 19);
}

export function formatAxisTime(percent: number) {
  return percentToDate(percent).toISOString().slice(11, 16);
}

export function formatFullTime(percent: number) {
  return percentToDate(percent).toISOString().replace('T', ' ').slice(0, 16);
}

export function formatTimeRange(range: [number, number]) {
  return `${formatFullTime(range[0])} - ${formatFullTime(range[1])}`;
}

export function isSameTimeRange(a: [number, number], b: [number, number]) {
  return Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4;
}

export function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - 0.00669342162296594323 * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((6335552.717000426 * magic) / (sqrtMagic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((6378245.0 / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lng + dLng, lat + dLat];
}

export function gcj02ToWgs84(lng: number, lat: number): [number, number] {
  const [mgLng, mgLat] = wgs84ToGcj02(lng, lat);
  return [lng * 2 - mgLng, lat * 2 - mgLat];
}

export function readLngLatLike(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

export function distanceKm(coords: Array<[number, number]>) {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) total += distanceMeters(coords[i - 1], coords[i]);
  return total / 1000;
}

export function normalizeLineCoords(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  return value.map(readLngLatLike).filter((point): point is [number, number] => point != null);
}

export function clipSegmentToBBox(a: [number, number], b: [number, number], bbox: F3BBox): [[number, number], [number, number]] | null {
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

export function pointsEqual(a: [number, number], b: [number, number]) {
  return Math.abs(a[0] - b[0]) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10;
}

export function clipPolylineToBBoxes(coords: Array<[number, number]>, bboxes: F3BBox[]) {
  const segments: Array<Array<[number, number]>> = [];
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1];
    const b = coords[i];
    bboxes.forEach((bbox) => {
      const clipped = clipSegmentToBBox(a, b, bbox);
      if (!clipped || pointsEqual(clipped[0], clipped[1])) return;
      const last = segments[segments.length - 1];
      if (last && pointsEqual(last[last.length - 1], clipped[0])) last.push(clipped[1]);
      else segments.push([clipped[0], clipped[1]]);
    });
  }
  return segments;
}

export function isValidGeoPoint(point: [number, number]) {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]) && point[0] >= -180 && point[0] <= 180 && point[1] >= -90 && point[1] <= 90;
}

export function isPointInBBox(point: [number, number], bbox: F3BBox) {
  return point[0] >= bbox.minLon && point[0] <= bbox.maxLon && point[1] >= bbox.minLat && point[1] <= bbox.maxLat;
}

export function normalizeRawPoints(value: unknown): Array<[number, number]> {
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

export function pointDistanceSquared(a: [number, number], b: [number, number]) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

export function alignLineDirectionToRaw(matched: Array<[number, number]>, raw: Array<[number, number]>) {
  if (matched.length < 2 || raw.length < 2) return matched;
  const rawStart = raw[0];
  const rawEnd = raw[raw.length - 1];
  const matchedStart = matched[0];
  const matchedEnd = matched[matched.length - 1];
  const forwardScore = pointDistanceSquared(matchedStart, rawStart) + pointDistanceSquared(matchedEnd, rawEnd);
  const reverseScore = pointDistanceSquared(matchedEnd, rawStart) + pointDistanceSquared(matchedStart, rawEnd);
  return reverseScore < forwardScore ? [...matched].reverse() : matched;
}

export function nearestLinePointIndex(line: Array<[number, number]>, point: [number, number]) {
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

export function matchedPlaybackLine(matched: Array<[number, number]>, raw: Array<[number, number]>) {
  if (matched.length < 2 || raw.length < 2) return matched;
  const startIndex = nearestLinePointIndex(matched, raw[0]);
  const endIndex = nearestLinePointIndex(matched, raw[raw.length - 1]);
  if (startIndex === endIndex) return alignLineDirectionToRaw(matched, raw);
  const ordered = startIndex < endIndex ? matched.slice(startIndex, endIndex + 1) : matched.slice(endIndex, startIndex + 1).reverse();
  return ordered.length >= 2 ? ordered : alignLineDirectionToRaw(matched, raw);
}

export function baseTripId(value: unknown) {
  return String(value ?? '').split('_s', 1)[0] || String(value ?? '');
}

export function buildCompactPageItems(current: number, total: number) {
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

export function hashColor(key: string) {
  const palette = ['#22d3ee', '#facc15', '#fb7185', '#34d399', '#a78bfa', '#fb923c', '#60a5fa', '#f472b6', '#bef264', '#2dd4bf'];
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export function formatTripClock(value?: string | null) {
  return value ? value.slice(11, 19) : '--:--:--';
}

export function formatTripDateTime(value?: string | null) {
  return value ? value.replace('T', ' ').slice(5, 19) : '--';
}

export function formatTripDuration(start?: string | null, end?: string | null) {
  if (!start || !end) return '--';
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatDensity(value: number) {
  return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatElapsedMs(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '--';
  if (Number(value) < 1000) return `${Math.round(Number(value))} ms`;
  return `${(Number(value) / 1000).toFixed(Number(value) >= 10000 ? 1 : 2)} s`;
}

export function getCellAreaKm2(bounds: [number, number, number, number]): number {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const sw: [number, number] = [minLon, minLat];
  const se: [number, number] = [maxLon, minLat];
  const nw: [number, number] = [minLon, maxLat];
  const widthM = distanceMeters(sw, se);
  const heightM = distanceMeters(sw, nw);
  return Math.max(1e-8, (widthM * heightM) / 1_000_000);
}

export function distanceMeters(a: [number, number], b: [number, number]) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusM = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lerpColor(from: string, to: string, ratio: number) {
  const clamp = Math.max(0, Math.min(1, ratio));
  const parse = (hex: string) => {
    const normalized = hex.replace('#', '');
    return [Number.parseInt(normalized.slice(0, 2), 16), Number.parseInt(normalized.slice(2, 4), 16), Number.parseInt(normalized.slice(4, 6), 16)];
  };
  const [fr, fg, fb] = parse(from);
  const [tr, tg, tb] = parse(to);
  const value = [fr + (tr - fr) * clamp, fg + (tg - fg) * clamp, fb + (tb - fb) * clamp].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  return `#${value}`;
}

export function steppedColor(stops: string[], ratio: number) {
  if (stops.length <= 1) return stops[0] ?? '#2563eb';
  const clamped = Math.max(0, Math.min(1, ratio));
  const scaled = clamped * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  return lerpColor(stops[idx], stops[idx + 1], scaled - idx);
}

export function formatDurationMinutes(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '--';
  const minutes = Math.max(0, Number(value));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = Math.round(minutes - hours * 60);
  return restMinutes <= 0 ? `${hours}h` : `${hours}h${restMinutes}m`;
}

export function formatLengthMeters(value: number | null | undefined) {
  const meters = Number(value ?? 0);
  if (!Number.isFinite(meters) || meters <= 0) return '--';
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export function formatRatioPercent(value: number | null | undefined, digits = 0) {
  return `${(Number(value ?? 0) * 100).toFixed(digits)}%`;
}

export function recommendF8MinSupport(range: [number, number]) {
  const hours = Math.max(0, ((range[1] - range[0]) / 100) * 168);
  if (hours <= 2) return 1;
  if (hours <= 12) return 2;
  if (hours <= 24) return 3;
  if (hours <= 72) return 4;
  return 5;
}


export function getBBoxCenter(bbox: F5BBox): [number, number] {
  return [(bbox.minLon + bbox.maxLon) / 2, (bbox.minLat + bbox.maxLat) / 2];
}

export function offsetLineByMeters(line: Array<[number, number]>, offsetMeters: number): Array<[number, number]> {
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

export function getF7SegmentColor(ratio: number): string {
  const value = Math.max(0, Math.min(1, ratio));
  if (value >= 0.92) return '#fff7ed';
  if (value >= 0.78) return '#fb923c';
  if (value >= 0.55) return '#ef4444';
  if (value >= 0.30) return '#991b1b';
  return '#3f0b1b';
}

export function getF7SegmentBandWidth(ratio: number): number {
  const value = Math.max(0, Math.min(1, ratio));
  return Math.max(3, Math.min(8, 2.6 + Math.pow(value, 0.62) * 5.8));
}

export function getF7PathKey(path: F7FrequentPath): string {
  const componentId = path.corridor_component_id ?? path.component_id ?? 0;
  return `${path.road_group_key}::${path.direction_value}::${componentId}`;
}

export function getF7DirectionMarker(path: F7FrequentPath): string {
  if (!path.direction_supported || path.direction_value === 0) return '<->';
  return path.direction_value > 0 ? '>' : '<';
}

export function extractLineStringsFromGeometry(geometry: LineGeometryLike): Array<Array<[number, number]>> {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === 'LineString') {
    const line = geometry.coordinates.filter(isValidGeoPoint).map((point) => [Number(point[0]), Number(point[1])] as [number, number]);
    return line.length >= 2 ? [line] : [];
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates
      .filter((line): line is unknown[] => Array.isArray(line))
      .map((line) => (line as unknown[]).filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))).map((point) => [Number(point[0]), Number(point[1])] as [number, number]))
      .filter((line) => line.length >= 2);
  }
  return [];
}

export function stitchLinesToContinuousChain(lines: Array<Array<[number, number]>>): Array<[number, number]> {
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

export function expandBBoxByKm(bbox: F5BBox, radiusKm: number): F5BBox {
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

export function getBezierPoint(start: [number, number], control: [number, number], end: [number, number], t: number): [number, number] {
  const oneMinusT = 1 - t;
  return [oneMinusT * oneMinusT * start[0] + 2 * oneMinusT * t * control[0] + t * t * end[0], oneMinusT * oneMinusT * start[1] + 2 * oneMinusT * t * control[1] + t * t * end[1]];
}

export function buildBezierCurvePoints(start: [number, number], control: [number, number], end: [number, number], samples = 52) {
  return Array.from({ length: samples + 1 }, (_, index) => getBezierPoint(start, control, end, index / samples));
}

export function getPathLengths(points: Array<[number, number]>) {
  const lengths = [0];
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    sum += Math.sqrt((points[i][0] - points[i - 1][0]) ** 2 + (points[i][1] - points[i - 1][1]) ** 2);
    lengths.push(sum);
  }
  return lengths;
}

export function getPointOnPath(points: Array<[number, number]>, lengths: number[], ratio: number): [number, number] {
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

export function metersToLngLatDelta(base: [number, number], dxMeters: number, dyMeters: number): [number, number] {
  const safeCos = Math.max(0.01, Math.abs(Math.cos((base[1] * Math.PI) / 180)));
  return [dxMeters / (111320 * safeCos), dyMeters / 110540];
}

export function buildDirectionArrowSegments(line: Array<[number, number]>, count: number, sizeMeters: number): Array<Array<[number, number]>> {
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

export function getF7DirectionColor(direction: F7FrequentPath['direction']): { main: string; glow: string; cap: string } {
  if (direction === 'reverse') return { main: '#f59e0b', glow: '#fde68a', cap: '#fffbeb' };
  if (direction === 'forward') return { main: '#e11d48', glow: '#fecdd3', cap: '#fff1f2' };
  return { main: '#0ea5e9', glow: '#bae6fd', cap: '#f0f9ff' };
}

export function computeJenksBreaks(valuesAsc: number[], classes: number): number[] {
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

export function buildF4Levels(values: number[], method: F4ClassifyMethod): Array<{ label: string; color: string; min: number; max: number }> {
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

export function getF4LevelByDensity(levels: Array<{ min: number; max: number }>, density: number) {
  for (let i = 0; i < levels.length; i += 1) {
    if (density >= levels[i].min && density <= levels[i].max) return i;
  }
  if (!levels.length) return 0;
  if (density > levels[0].max) return 0;
  return levels.length - 1;
}

export function calcDynamicHeatRadiusPx(map: any, meterRadius: number) {
  const zoom = Number(map?.getZoom?.() ?? 10);
  const base = Math.max(16, Math.min(96, meterRadius / 10));
  const zoomScale = Math.max(0.72, Math.min(1.26, 1 + (zoom - 11) * 0.06));
  return Math.round(base * zoomScale);
}

export function buildHeatViewportProfile(values: number[]) {
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

export function getBoundsFromF4Cells(cells: F4GridCell[]) {
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

function outOfChina(lng: number, lat: number) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(lng: number, lat: number) {
  let ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
  ret += (20.0 * Math.sin(6.0 * lng * Math.PI) + 20.0 * Math.sin(2.0 * lng * Math.PI)) * (2.0 / 3.0);
  ret += (20.0 * Math.sin(lat * Math.PI) + 40.0 * Math.sin((lat / 3.0) * Math.PI)) * (2.0 / 3.0);
  ret += (160.0 * Math.sin((lat / 12.0) * Math.PI) + 320 * Math.sin((lat * Math.PI) / 30.0)) * (2.0 / 3.0);
  return ret;
}

function transformLng(lng: number, lat: number) {
  let ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
  ret += (20.0 * Math.sin(6.0 * lng * Math.PI) + 20.0 * Math.sin(2.0 * lng * Math.PI)) * (2.0 / 3.0);
  ret += (20.0 * Math.sin(lng * Math.PI) + 40.0 * Math.sin((lng / 3.0) * Math.PI)) * (2.0 / 3.0);
  ret += (150.0 * Math.sin((lng / 12.0) * Math.PI) + 300.0 * Math.sin((lng / 30.0) * Math.PI)) * (2.0 / 3.0);
  return ret;
}
