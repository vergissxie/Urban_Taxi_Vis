import React from 'react';
import {
  ArrowRightLeft,
  ChevronRight,
  GitBranch,
  Loader2,
  Map,
  Route,
  Shield,
  Target,
  Zap,
} from 'lucide-react';
import type {
  F7FrequentPath,
  F7FrequentPathsResponse,
  F7RoadDetailResponse,
  F8Corridor,
  F8FrequentRoute,
  F8FrequentRoutesResponse,
} from '../services/trajectoryService';

type F8SortMode = 'frequency' | 'p50' | 'avg';
type F9Strategy = 'fastest' | 'stable' | 'frequent_fast';

interface GeoWorkbenchDecisionPanelProps {
  demoReadonly?: boolean;
  f7TopK: number;
  setF7TopK: React.Dispatch<React.SetStateAction<number>>;
  f8TopK: number;
  setF8TopK: React.Dispatch<React.SetStateAction<number>>;
  minLengthX: number;
  setMinLengthX: React.Dispatch<React.SetStateAction<number>>;
  f8DrawingTarget: 'A' | 'B' | null;
  f8CandidateMode: 'strict_od' | 'pass_through';
  setF8CandidateMode: React.Dispatch<React.SetStateAction<'strict_od' | 'pass_through'>>;
  f8Loading: boolean;
  f8Result: F8FrequentRoutesResponse | null;
  f8FocusedRouteKey: string | null;
  setF8FocusedRouteKey: React.Dispatch<React.SetStateAction<string | null>>;
  f8AnimatingRouteKey: string | null;
  toggleF8RouteAnimation: (routeKey: string) => void;
  resetF8RouteAnimation: (routeKey: string) => void;
  runF8DrawAreaA: () => Promise<void>;
  runF8DrawAreaB: () => Promise<void>;
  runF8ClearAreaA: () => Promise<void>;
  runF8ClearAreaB: () => Promise<void>;
  runF8Mining: () => Promise<void>;
  showF8RoutesOnMap: () => void;
  showF9RoutesOnMap: (routeKey?: string | null) => void;
  onSectionChange: (section: 'f7' | 'f89' | null) => void;
  onF8RouteDoubleClick: (payload: {
    source: 'f8' | 'f9';
    routeKey: string;
    item: F8Corridor | F8FrequentRoute;
    displayRank: number;
    sortMode: F8SortMode;
  }) => void;
  onF9RecommendedRouteChange: (routeKey: string | null) => void;
  f7Loading: boolean;
  f7Result: F7FrequentPathsResponse | null;
  f7RoadDetail: F7RoadDetailResponse | null;
  f7DetailLoading: boolean;
  f7ViewMode: 'overview' | 'detail';
  f7SelectedPath: F7FrequentPath | null;
  f7HoveredSegmentUid: number | null;
  setF7HoveredSegmentUid: React.Dispatch<React.SetStateAction<number | null>>;
  f7FocusedPathKey: string | null;
  setF7FocusedPathKey: React.Dispatch<React.SetStateAction<string | null>>;
  runF78Mining: () => Promise<void>;
  runF7RoadDetail: (path: F7FrequentPath) => Promise<void>;
  returnF7Overview: () => void;
  onValidationNotice: (message: string) => void;
}

function formatNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString('zh-CN');
}

function formatPercent(value: number | null | undefined, digits = 0) {
  return `${(Number(value ?? 0) * 100).toFixed(digits)}%`;
}

function formatLength(value: number | null | undefined) {
  const meters = Number(value ?? 0);
  if (!Number.isFinite(meters) || meters <= 0) return '--';
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatDurationMinutes(value: number | null | undefined, digits = 1) {
  const minutes = Number(value ?? NaN);
  if (!Number.isFinite(minutes) || minutes <= 0) return '--';
  return `${minutes.toFixed(digits)} min`;
}

function parseBoundedInteger(raw: string, min: number, max: number, message: string, onValidationNotice: (message: string) => void) {
  const text = raw.trim();
  const value = Number(text);
  if (!text || !/^\d+$/.test(text) || !Number.isInteger(value) || value < min || value > max) {
    onValidationNotice(message);
    return null;
  }
  return value;
}

function getF7PathKey(path: F7FrequentPath) {
  return `${path.road_group_key}::${path.direction_value}::${path.corridor_component_id ?? path.component_id ?? 0}`;
}

function getF8ItemSignature(item: F8Corridor | F8FrequentRoute) {
  return 'corridor_signature' in item ? item.corridor_signature : item.route_signature;
}

function getF8ItemLength(item: F8Corridor | F8FrequentRoute) {
  if ('route_length_m' in item && item.route_length_m) return item.route_length_m;
  if ('avg_route_length_m' in item && item.avg_route_length_m) return item.avg_route_length_m;
  return null;
}

function getF8ItemP50(item: F8Corridor | F8FrequentRoute) {
  return Number(item.p50_duration_min ?? NaN);
}

function getF8ItemAvg(item: F8Corridor | F8FrequentRoute) {
  return Number(item.avg_duration_min ?? NaN);
}

function getF8ItemP90(item: F8Corridor | F8FrequentRoute) {
  return Number(item.p90_duration_min ?? NaN);
}

function getSortableDuration(value: number) {
  return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
}

function getF8FrequencyFastScore(item: F8Corridor | F8FrequentRoute, maxTripCount: number) {
  const tripScore = Number(item.trip_count || 0) / Math.max(1, maxTripCount);
  const p50 = getSortableDuration(getF8ItemP50(item));
  const avg = getSortableDuration(getF8ItemAvg(item));
  const timePenalty = (Math.min(p50, 180) / 180) * 0.65 + (Math.min(avg, 180) / 180) * 0.35;
  return tripScore * 1.35 - timePenalty;
}

function ToolBadge({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${
        active
          ? 'border-cyan-300/28 bg-cyan-300/10 text-cyan-100'
          : 'border-slate-700/70 bg-[#121a26] text-slate-400'
      }`}
    >
      {children}
    </span>
  );
}

function SectionCard({
  code,
  title,
  description,
  icon,
  accent,
  open,
  onToggle,
  children,
}: {
  code: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  accent: 'cyan' | 'rose';
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const accentClasses =
    accent === 'rose'
      ? 'border-rose-300/30 bg-rose-300/[0.08] text-rose-50'
      : 'border-cyan-300/35 bg-cyan-300/[0.08] text-cyan-50';
  const iconClasses = accent === 'rose' ? 'text-rose-200' : 'text-cyan-200';

  return (
    <div className={`overflow-hidden rounded-sm border transition ${open ? 'border-cyan-300/24 bg-[#151d29]' : 'border-[#34414c]/40 bg-[#252b35]'}`}>
      <button
        type="button"
        onClick={onToggle}
        className={`group flex w-full items-center gap-3 px-4 py-3.5 text-left transition ${open ? 'bg-cyan-300/[0.08]' : 'hover:bg-[#2b3743]'}`}
      >
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-sm border ${open ? accentClasses : 'border-[#34414c]/55 bg-[#1a212c] text-slate-300'}`}>
          <span className={iconClasses}>{icon}</span>
        </div>
        <span className="min-w-0 flex-1">
          <span className={`block text-base font-semibold ${open ? 'text-cyan-50' : 'text-slate-200'}`}>{code} {title}</span>
          <span className="mt-1 block text-xs leading-snug text-slate-500">{description}</span>
        </span>
        <ChevronRight className={`h-4 w-4 shrink-0 text-slate-500 transition ${open ? 'rotate-90 text-cyan-200' : ''}`} />
      </button>
      {open ? <div className="space-y-4 border-t border-slate-700/60 bg-[#111722]/55 p-4">{children}</div> : null}
    </div>
  );
}

export default function GeoWorkbenchDecisionPanel({
  demoReadonly = false,
  f7TopK,
  setF7TopK,
  f8TopK,
  setF8TopK,
  minLengthX,
  setMinLengthX,
  f8DrawingTarget,
  f8CandidateMode,
  setF8CandidateMode,
  f8Loading,
  f8Result,
  f8FocusedRouteKey,
  setF8FocusedRouteKey,
  f8AnimatingRouteKey,
  toggleF8RouteAnimation,
  resetF8RouteAnimation,
  runF8DrawAreaA,
  runF8DrawAreaB,
  runF8ClearAreaA,
  runF8ClearAreaB,
  runF8Mining,
  showF8RoutesOnMap,
  showF9RoutesOnMap,
  onSectionChange,
  onF8RouteDoubleClick,
  onF9RecommendedRouteChange,
  f7Loading,
  f7Result,
  f7FocusedPathKey,
  setF7FocusedPathKey,
  runF78Mining,
  onValidationNotice,
}: GeoWorkbenchDecisionPanelProps) {
  const [openSection, setOpenSection] = React.useState<'f7' | 'f89' | null>(null);
  const [f8SortMode, setF8SortMode] = React.useState<F8SortMode>('frequency');
  const [f9Strategy, setF9Strategy] = React.useState<F9Strategy>('fastest');
  const [f7TopKInput, setF7TopKInput] = React.useState(String(f7TopK));
  const [minLengthXInput, setMinLengthXInput] = React.useState(String(minLengthX));
  const [f8TopKInput, setF8TopKInput] = React.useState(String(f8TopK));
  const parameterLocked = demoReadonly;

  React.useEffect(() => setF7TopKInput(String(f7TopK)), [f7TopK]);
  React.useEffect(() => setMinLengthXInput(String(minLengthX)), [minLengthX]);
  React.useEffect(() => setF8TopKInput(String(f8TopK)), [f8TopK]);

  const f7Paths = f7Result?.paths ?? [];
  const f7Summary = f7Result?.summary;
  const f8Summary = f8Result?.summary;
  const f8Items = React.useMemo(
    () => ((f8Result?.corridors?.length ? f8Result.corridors : f8Result?.routes) ?? []),
    [f8Result],
  );
  const maxF8TripCount = React.useMemo(
    () => Math.max(1, ...f8Items.map((item) => Number(item.trip_count || 0))),
    [f8Items],
  );

  const f8CandidateTripCount = Number(f8Summary?.candidate_trip_count ?? 0);
  const f8ValidTripCount = Number(f8Summary?.valid_ab_trip_count ?? 0);
  const f8TopKTripCount = Number(f8Summary?.top_k_trip_count ?? 0);
  const f8RankedTripCount = Number(f8Summary?.total_ranked_trip_count ?? 0);
  const f8CorridorCount = Number(f8Summary?.total_route_count_before_top_k ?? f8Summary?.route_count ?? 0);
  const f8RawValidTripCount = Number((f8Summary as Record<string, unknown> | null)?.raw_valid_ab_trip_count ?? 0);
  const f8DurationFilteredCount = Number((f8Summary as Record<string, unknown> | null)?.duration_outlier_filtered_count ?? 0);
  const f8CoveragePercent = Math.round((f8TopKTripCount / Math.max(1, f8ValidTripCount)) * 100);
  const f8RankedCoveragePercent = Math.round((f8RankedTripCount / Math.max(1, f8ValidTripCount)) * 100);
  const f8TopKWithinRankedPercent = Math.round((f8TopKTripCount / Math.max(1, f8RankedTripCount)) * 100);

  const sortedF8Items = React.useMemo(() => {
    const items = [...f8Items];
    items.sort((a, b) => {
      if (f8SortMode === 'frequency') return Number(b.trip_count || 0) - Number(a.trip_count || 0);
      if (f8SortMode === 'avg') {
        const durationDiff = getSortableDuration(getF8ItemAvg(a)) - getSortableDuration(getF8ItemAvg(b));
        if (durationDiff !== 0) return durationDiff;
        return Number(b.trip_count || 0) - Number(a.trip_count || 0);
      }
      const durationDiff = getSortableDuration(getF8ItemP50(a)) - getSortableDuration(getF8ItemP50(b));
      if (durationDiff !== 0) return durationDiff;
      return Number(b.trip_count || 0) - Number(a.trip_count || 0);
    });
    return items;
  }, [f8Items, f8SortMode]);

  const recommendedF9Item = React.useMemo(() => {
    if (!f8Items.length) return null;
    const items = [...f8Items];
    items.sort((a, b) => {
      if (f9Strategy === 'stable') {
        const p90Diff = getSortableDuration(getF8ItemP90(a)) - getSortableDuration(getF8ItemP90(b));
        if (p90Diff !== 0) return p90Diff;
        return getSortableDuration(getF8ItemP50(a)) - getSortableDuration(getF8ItemP50(b));
      }
      if (f9Strategy === 'frequent_fast') {
        return getF8FrequencyFastScore(b, maxF8TripCount) - getF8FrequencyFastScore(a, maxF8TripCount);
      }
      const p50Diff = getSortableDuration(getF8ItemP50(a)) - getSortableDuration(getF8ItemP50(b));
      if (p50Diff !== 0) return p50Diff;
      return Number(b.trip_count || 0) - Number(a.trip_count || 0);
    });
    return items[0] ?? null;
  }, [f8Items, f9Strategy, maxF8TripCount]);

  const strategyCards = [
    { key: 'fastest' as const, title: '策略：最快路径', subtitle: 'p50 耗时最低', icon: <Zap className="h-4 w-4" /> },
    { key: 'stable' as const, title: '策略：最稳路径', subtitle: 'p90 耗时最低', icon: <Shield className="h-4 w-4" /> },
    { key: 'frequent_fast' as const, title: '策略：高频且快', subtitle: '频次高且耗时低', icon: <Target className="h-4 w-4" /> },
  ];

  const strategyLabel = React.useMemo(() => {
    if (f9Strategy === 'stable') return '最稳路径';
    if (f9Strategy === 'frequent_fast') return '高频且快';
    return '最快路径';
  }, [f9Strategy]);

  React.useEffect(() => {
    onF9RecommendedRouteChange(recommendedF9Item ? getF8ItemSignature(recommendedF9Item) : null);
  }, [onF9RecommendedRouteChange, recommendedF9Item]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <section className="shrink-0 bg-[#20242d]/70 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-[#173d4a] text-cyan-200">
            <Route className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-100">频繁路径与效能挖掘 (F7-F9)</div>
            <div className="mt-0.5 text-[10px] leading-relaxed text-slate-500">高频走廊与 A/B 推荐</div>
          </div>
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-y-auto bg-[#20242d]/70 px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/80">Engine</div>
          <span className="rounded-sm bg-[#151a22] px-2 py-1 text-[10px] text-slate-500">F7-F9</span>
        </div>

        <div className="space-y-3">
          <SectionCard
            code="F7"
            title="高频走廊"
            description="识别当前视窗内的高频走廊。"
            icon={<GitBranch className="h-4 w-4" />}
            accent="rose"
            open={openSection === 'f7'}
            onToggle={() => {
              const nextSection = openSection === 'f7' ? null : 'f7';
              setOpenSection(nextSection);
              onSectionChange(nextSection);
            }}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-xs text-slate-400">
                Top-K
                <input
                  type="number"
                  min={1}
                  max={80}
                  step={1}
                  value={f7TopKInput}
                  disabled={parameterLocked}
                  onChange={(event) => {
                    const rawValue = event.target.value;
                    setF7TopKInput(rawValue);
                    const nextValue = parseBoundedInteger(rawValue, 1, 80, 'F7 Top-K 必须输入 1-80 之间的整数。', onValidationNotice);
                    if (nextValue != null) setF7TopK(nextValue);
                  }}
                  onBlur={() => setF7TopKInput(String(f7TopK))}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-[#0f1622] px-3 text-sm font-semibold text-rose-100 outline-none transition focus:border-rose-300/50 disabled:cursor-not-allowed disabled:opacity-55"
                />
              </label>
              <label className="block text-xs text-slate-400">
                最小长度 x（米）
                <input
                  type="number"
                  min={100}
                  max={5000}
                  step={100}
                  value={minLengthXInput}
                  disabled={parameterLocked}
                  onChange={(event) => {
                    const rawValue = event.target.value;
                    setMinLengthXInput(rawValue);
                    const nextValue = parseBoundedInteger(rawValue, 100, 5000, 'F7 最小长度 x 必须输入 100-5000 米之间的整数。', onValidationNotice);
                    if (nextValue != null) setMinLengthX(nextValue);
                  }}
                  onBlur={() => setMinLengthXInput(String(minLengthX))}
                  className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-[#0f1622] px-3 text-sm font-semibold text-rose-100 outline-none transition focus:border-rose-300/50 disabled:cursor-not-allowed disabled:opacity-55"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => { void runF78Mining(); }}
              disabled={f7Loading}
              className="flex w-full items-center justify-center gap-2 rounded-sm bg-[#b42318] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#c93528] disabled:cursor-wait disabled:bg-[#b42318]/45"
            >
              {f7Loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
              {f7Loading ? '正在分析高频走廊...' : '启动高频走廊分析'}
            </button>

            {f7Summary ? (
              <div className="rounded-sm border border-[#34414c]/70 bg-[#0f1622]/75 p-3">
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div><div className="text-base font-semibold text-rose-100">{formatNumber(f7Summary.path_count)}</div><div className="text-[10px] text-slate-500">返回走廊</div></div>
                  <div><div className="text-base font-semibold text-slate-100">{formatNumber(f7Summary.total_path_count_before_top_k)}</div><div className="text-[10px] text-slate-500">候选总数</div></div>
                  <div><div className="text-base font-semibold text-amber-100">{formatNumber(f7Summary.top_k_trip_count)}</div><div className="text-[10px] text-slate-500">Top-K 经过</div></div>
                  <div><div className="text-base font-semibold text-cyan-100">{formatPercent(f7Summary.top_k_ratio)}</div><div className="text-[10px] text-slate-500">覆盖占比</div></div>
                </div>
              </div>
            ) : (
              <div className="rounded-sm border border-slate-700/50 bg-[#0f1622]/70 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                结合当前时间范围与地图视窗，抽取连续高频走廊并展示核心统计指标。
              </div>
            )}

            {f7Result ? (
              <div className="rounded-sm border border-[#34414c]/55 bg-[#151a22]/70 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-200">走廊总览</div>
                  <ToolBadge>{formatNumber(f7Paths.length)} 条</ToolBadge>
                </div>
                <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                  {!f7Paths.length ? (
                    <div className="rounded-sm border border-dashed border-[#34414c] bg-[#0f1622]/60 px-3 py-5 text-center text-xs text-slate-500">启动分析后，这里会展示当前视窗内的高频走廊。</div>
                  ) : (
                    f7Paths.map((path) => {
                      const pathKey = getF7PathKey(path);
                      const focused = f7FocusedPathKey === pathKey;
                      return (
                        <div
                          key={pathKey}
                          onMouseEnter={() => setF7FocusedPathKey(pathKey)}
                          onMouseLeave={() => setF7FocusedPathKey((current) => (current === pathKey ? null : current))}
                          className={`w-full rounded-sm border px-3 py-3 text-left transition ${focused ? 'border-rose-300/30 bg-[#201116]' : 'border-slate-700/45 bg-[#111722] hover:border-rose-300/20 hover:bg-[#161d28]'}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-100">#{path.rank} {path.road_name || '未命名道路'}</div>
                            </div>
                            <span className="shrink-0 text-[10px] text-slate-500">{formatPercent(path.corridor_confidence ?? 1)}</span>
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-slate-400">
                            <span>经过 {formatNumber(path.trip_count)}</span>
                            <span>车辆 {formatNumber(path.vehicle_count)}</span>
                            <span>长度 {formatLength(path.group_length_m)}</span>
                          </div>
                          <div className="mt-2 text-[11px] text-slate-500">主链 {formatNumber(path.backbone_segment_count ?? path.segment_count ?? 0)} 段</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard
            code="F8、F9"
            title="A/B 高频路线"
            description="挖掘 A/B 候选并推荐更优路线。"
            icon={<ArrowRightLeft className="h-4 w-4" />}
            accent="cyan"
            open={openSection === 'f89'}
            onToggle={() => {
              const nextSection = openSection === 'f89' ? null : 'f89';
              setOpenSection(nextSection);
              onSectionChange(nextSection);
            }}
          >
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-2">
                <div className="grid grid-cols-[1fr_auto] overflow-hidden rounded-xl border border-blue-300/25 bg-[#0d1520]">
                  <button
                    type="button"
                    onClick={() => { void runF8DrawAreaA(); }}
                    disabled={parameterLocked || f8Loading}
                    className={`h-10 text-[12px] font-semibold leading-tight transition ${f8DrawingTarget === 'A' ? 'bg-blue-400/18 text-blue-50' : 'text-blue-100 hover:bg-blue-300/10'} disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    绘制区域 A
                  </button>
                  <button
                    type="button"
                    onClick={() => { void runF8ClearAreaA(); }}
                    disabled={parameterLocked}
                    className="border-l border-red-300/20 px-4 text-[12px] font-semibold text-red-200 transition hover:bg-red-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    清除
                  </button>
                </div>

                <div className="grid grid-cols-[1fr_auto] overflow-hidden rounded-xl border border-slate-600/60 bg-[#0d1520]">
                  <button
                    type="button"
                    onClick={() => { void runF8DrawAreaB(); }}
                    disabled={parameterLocked || f8Loading}
                    className={`h-10 text-[12px] font-semibold leading-tight transition ${f8DrawingTarget === 'B' ? 'bg-slate-300/14 text-slate-50' : 'text-slate-200 hover:bg-slate-300/8'} disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    绘制区域 B
                  </button>
                  <button
                    type="button"
                    onClick={() => { void runF8ClearAreaB(); }}
                    disabled={parameterLocked}
                    className="border-l border-red-300/20 px-4 text-[12px] font-semibold text-red-200 transition hover:bg-red-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    清除
                  </button>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-[1fr_1fr]">
                <label className="grid h-10 grid-cols-[96px_1fr] overflow-hidden rounded-xl border border-slate-700/70 bg-[#0d1520]">
                  <span className="flex h-10 items-center justify-center border-r border-slate-700/70 text-[11px] font-semibold text-slate-300">Top-K</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    value={f8TopKInput}
                    disabled={parameterLocked}
                    onChange={(event) => {
                      const rawValue = event.target.value;
                      setF8TopKInput(rawValue);
                      const nextValue = parseBoundedInteger(rawValue, 1, 50, 'F8 Top-K 必须输入 1-50 之间的整数。', onValidationNotice);
                      if (nextValue != null) setF8TopK(nextValue);
                    }}
                    onBlur={() => setF8TopKInput(String(f8TopK))}
                    className="h-10 bg-transparent px-4 text-[11px] font-semibold text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-55"
                  />
                </label>

                <div className="grid h-10 grid-cols-2 overflow-hidden rounded-xl border border-slate-700/70 bg-[#0d1520]">
                  <button
                    type="button"
                    onClick={() => setF8CandidateMode('strict_od')}
                    disabled={parameterLocked}
                    className={`h-10 border-r border-slate-700/70 text-[11px] font-semibold leading-tight transition disabled:cursor-not-allowed disabled:opacity-60 ${f8CandidateMode === 'strict_od' ? 'bg-slate-200/12 text-slate-50 shadow-[inset_0_0_0_1px_rgba(226,232,240,0.16)]' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    严格 OD
                  </button>
                  <button
                    type="button"
                    onClick={() => setF8CandidateMode('pass_through')}
                    disabled={parameterLocked}
                    className={`h-10 text-[11px] font-semibold leading-tight transition disabled:cursor-not-allowed disabled:opacity-60 ${f8CandidateMode === 'pass_through' ? 'bg-blue-500 text-white shadow-[0_8px_24px_rgba(37,99,235,0.28)]' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    途经候选
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => { void runF8Mining(); }}
                disabled={f8Loading}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#2563eb,#1d4ed8)] px-3 text-[12px] font-semibold text-blue-50 shadow-[0_10px_30px_rgba(37,99,235,0.26)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-55"
              >
                {f8Loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
                {f8Loading ? '正在挖掘 A→B 高频候选走廊...' : '挖掘 A→B 高频候选走廊 (F8)'}
              </button>

              <div className="space-y-4 pt-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[12px] font-semibold text-slate-100">F8: 高频走廊分析与排序</div>
                    <div className="mt-1 text-[10px] text-slate-500">按频次、p50 或平均耗时查看 A→B 典型走廊。</div>
                  </div>
                  <ToolBadge active>{formatNumber(sortedF8Items.length)} 条</ToolBadge>
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-700/70 bg-[#121a26]">
                  <div className="grid grid-cols-3">
                    {[
                      ['frequency', '频次'],
                      ['p50', 'p50'],
                      ['avg', 'avg'],
                    ].map(([key, label], index) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setF8SortMode(key as F8SortMode)}
                        disabled={f8Loading}
                        className={`min-w-0 px-1.5 py-2 text-center text-[8px] font-semibold leading-tight whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-60 ${index > 0 ? 'border-l border-slate-700/70' : ''} ${f8SortMode === key ? 'bg-slate-200/12 text-slate-50' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {f8Summary ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-slate-700/60 bg-[#111826] px-3 py-2">
                        <div className="text-[10px] text-slate-500">候选行程</div>
                        <div className="mt-1 text-sm font-semibold text-slate-100">{formatNumber(f8CandidateTripCount)}</div>
                      </div>
                      <div className="rounded-lg border border-slate-700/60 bg-[#111826] px-3 py-2">
                        <div className="text-[10px] text-slate-500">有效 A→B</div>
                        <div className="mt-1 text-sm font-semibold text-slate-100">{formatNumber(f8ValidTripCount)}</div>
                      </div>
                      <div className="rounded-lg border border-slate-700/60 bg-[#111826] px-3 py-2">
                        <div className="text-[10px] text-slate-500">返回走廊</div>
                        <div className="mt-1 text-sm font-semibold text-slate-100">{formatNumber(f8Summary.route_count)}</div>
                      </div>
                      <div className="rounded-lg border border-slate-700/60 bg-[#111826] px-3 py-2">
                        <div className="text-[10px] text-slate-500">Top-K 行程</div>
                        <div className="mt-1 text-sm font-semibold text-slate-100">{formatNumber(f8TopKTripCount)}</div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-700/60 bg-[#111826] px-3 py-3">
                      <div className="text-[11px] text-slate-300">Top-K 覆盖有效 A→B 行程 {formatNumber(f8TopKTripCount)} / {formatNumber(f8ValidTripCount)}，约 {f8CoveragePercent}%</div>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full rounded-full bg-rose-500" style={{ width: `${Math.max(0, Math.min(100, f8CoveragePercent))}%` }} />
                        </div>
                        <div className="shrink-0 text-[11px] font-semibold text-slate-300">{f8CoveragePercent}%</div>
                      </div>
                      <div className="mt-2 text-[11px] leading-relaxed text-slate-400">
                        已聚类走廊覆盖 {formatNumber(f8RankedTripCount)} / {formatNumber(f8ValidTripCount)}，约 {f8RankedCoveragePercent}%；
                        Top-K 占已聚类结果 {f8TopKWithinRankedPercent}%；候选走廊 {formatNumber(f8CorridorCount)}
                        {f8DurationFilteredCount > 0 ? `；剔除长尾耗时 ${formatNumber(f8DurationFilteredCount)} / ${formatNumber(f8RawValidTripCount)}` : ''}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="max-h-[20rem] space-y-2 overflow-y-auto pr-1">
                  {!sortedF8Items.length ? (
                    <div className="rounded-xl border border-dashed border-slate-700/70 bg-[#101722] px-4 py-8 text-center text-xs text-slate-500">先绘制区域 A 和 B，再启动 F8 挖掘高频候选走廊。</div>
                  ) : (
                    sortedF8Items.map((item, index) => {
                      const signature = getF8ItemSignature(item);
                      const focused = f8FocusedRouteKey === signature;
                      const percent = Math.max(4, Math.round((Number(item.trip_count || 0) / maxF8TripCount) * 100));
                      const isRoute = 'route_signature' in item;
                      return (
                        <div
                          key={signature}
                          onMouseEnter={() => setF8FocusedRouteKey(signature)}
                          onMouseLeave={() => setF8FocusedRouteKey((current) => (current === signature ? null : current))}
                          onDoubleClick={() => onF8RouteDoubleClick({
                            source: 'f8',
                            routeKey: signature,
                            item,
                            displayRank: index + 1,
                            sortMode: f8SortMode,
                          })}
                          className={`rounded-xl border px-3 py-3 transition ${focused ? 'border-cyan-300/30 bg-cyan-300/8' : 'border-slate-700/60 bg-[#111826] hover:border-slate-600/70 hover:bg-[#151d2a]'}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-100">#{index + 1} A→B 走廊</div>
                              <div className="mt-1 truncate text-[11px] text-slate-400">{signature}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isRoute ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      toggleF8RouteAnimation(signature);
                                    }}
                                    className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition ${f8AnimatingRouteKey === signature ? 'border-cyan-300/30 bg-cyan-300/12 text-cyan-100' : 'border-slate-700/70 bg-[#0f1622] text-slate-300 hover:border-slate-600/80'}`}
                                  >
                                    {f8AnimatingRouteKey === signature ? '暂停' : '动画'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      resetF8RouteAnimation(signature);
                                    }}
                                    disabled={f8AnimatingRouteKey === signature}
                                    className="rounded-md border border-slate-700/70 bg-[#0f1622] px-2 py-1 text-[10px] font-semibold text-slate-300 transition hover:border-slate-600/80 disabled:opacity-40"
                                  >
                                    重置
                                  </button>
                                </>
                              ) : null}
                              <span className="shrink-0 rounded-full border border-cyan-300/28 bg-cyan-300/10 px-3 py-1 text-[10px] font-semibold leading-none text-cyan-100">
                                覆盖 {formatNumber(item.trip_count)}
                              </span>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                            <span>车辆 {formatNumber(item.vehicle_count)}</span>
                            <span>长度 {formatLength(getF8ItemLength(item))}</span>
                            <span>p50 {formatDurationMinutes(getF8ItemP50(item))}</span>
                            <span>avg {formatDurationMinutes(getF8ItemAvg(item))}</span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                            <div className="h-full rounded-full bg-cyan-400" style={{ width: `${percent}%` }} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div>
                  <div className="mb-3">
                    <div className="text-[13px] font-semibold text-slate-100">F9: 最优路径推荐</div>
                    <div className="mt-1 text-[11px] text-slate-500">从 F8 候选走廊里挑出更快、更稳或更常用的推荐路线。</div>
                  </div>

                  <div className="grid gap-2 md:grid-cols-3">
                    {strategyCards.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setF9Strategy(item.key)}
                        disabled={f8Loading}
                        className={`rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${f9Strategy === item.key ? 'border-cyan-300/26 bg-cyan-300/10 shadow-[inset_0_0_0_1px_rgba(103,232,249,0.08)]' : 'border-slate-700/70 bg-[#111826] hover:border-slate-600/80'}`}
                      >
                        <div className="flex items-center gap-2 text-cyan-200">
                          {item.icon}
                          <span className="text-[12px] font-semibold leading-tight text-slate-100">{item.title}</span>
                        </div>
                        <div className="mt-1 text-[10px] leading-tight text-slate-500">{item.subtitle}</div>
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 space-y-2">
                    {recommendedF9Item ? (
                      <div
                        onDoubleClick={() => onF8RouteDoubleClick({
                          source: 'f9',
                          routeKey: getF8ItemSignature(recommendedF9Item),
                          item: recommendedF9Item,
                          displayRank: 1,
                          sortMode: f9Strategy === 'stable' ? 'p50' : f9Strategy === 'frequent_fast' ? 'frequency' : 'p50',
                        })}
                        className="rounded-xl border border-slate-700/60 bg-[#111826] px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-100">全天 · {strategyLabel}</div>
                            <div className="mt-1 truncate text-[11px] text-slate-400">{getF8ItemSignature(recommendedF9Item)}</div>
                          </div>
                          <span className="shrink-0 rounded-full border border-cyan-300/28 bg-cyan-300/10 px-3 py-1 text-[10px] font-semibold leading-none text-cyan-100">
                            样本 {formatNumber(recommendedF9Item.trip_count)}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                          <span>p50 {formatDurationMinutes(getF8ItemP50(recommendedF9Item))}</span>
                          <span>p90 {formatDurationMinutes(getF8ItemP90(recommendedF9Item))}</span>
                          <span>avg {formatDurationMinutes(getF8ItemAvg(recommendedF9Item))}</span>
                          <span>长度 {formatLength(getF8ItemLength(recommendedF9Item))}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-700/70 bg-[#101722] px-4 py-6 text-center text-xs text-slate-500">F8 结果生成后，这里会展示当前策略下的推荐路线。</div>
                    )}
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={showF8RoutesOnMap}
                    disabled={!f8Result}
                    className="flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-700/70 bg-[#151c28] px-3 text-[12px] font-semibold text-slate-300 transition hover:border-cyan-300/22 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Map className="h-4 w-4" />
                    地图显示 F8
                  </button>
                  <button
                    type="button"
                    onClick={() => showF9RoutesOnMap(recommendedF9Item ? getF8ItemSignature(recommendedF9Item) : null)}
                    disabled={!recommendedF9Item}
                    className="flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-700/70 bg-[#151c28] px-3 text-[12px] font-semibold text-slate-300 transition hover:border-amber-300/22 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Map className="h-4 w-4" />
                    地图显示 F9
                  </button>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      </section>
    </div>
  );
}
