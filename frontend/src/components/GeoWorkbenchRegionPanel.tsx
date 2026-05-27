import React from 'react';
import { Activity, AreaChart, Info, Loader2, RotateCw, Route, Trash2 } from 'lucide-react';

interface RegionToolEntryLike {
  key: string;
  code: string;
  title: string;
  description: string;
  icon: React.ElementType;
}

interface GeoWorkbenchRegionPanelProps {
  status: 'idle' | 'computing' | 'ready' | 'empty' | 'error';
  demoReadonly?: boolean;
  activeRegionTool: string | null;
  regionToolEntries: RegionToolEntryLike[];
  onToggleTool: (key: string | null) => void;
  activeVehicles: number | null;
  formatInt: (value: number | null | undefined) => string;
  formatDurationMinutes: (value: number | null | undefined) => string;
  formatF5BucketLabel: (value: string) => string;
  f3Loading: boolean;
  f3Drawing: boolean;
  hasF3Selection: boolean;
  f3ShowOnlyInBBox: boolean;
  f3BoxSummaries: Array<{ boxIndex: number; color: string; vehicleCount: number }>;
  f3DetailsExpanded: boolean;
  f3VisibleRows: Array<{ key: string; taxiId: number | string; boxLabels?: string }>;
  f3SelectedTaxiId: number | string | null;
  f3Page: number;
  f3PageItems: Array<number | 'ellipsis'>;
  f3PageCount: number;
  f3JumpPage: string;
  f3RowsLength: number;
  onRunF3DrawRectangle: () => void;
  onRunF3QueryByRectangles: () => void;
  onClearF3Selection: () => void;
  onToggleF3Mode: () => void;
  onToggleF3Details: () => void;
  onF3TaxiClick: (row: any) => void;
  onSetF3Page: (page: number) => void;
  onF3JumpPageChange: (value: string) => void;
  onApplyF3JumpPage: () => void;
  f4Generating: boolean;
  f4GridSize: number;
  f4ViewportEstimate: any;
  f4RenderMode: 'heatmap' | 'choropleth';
  f4ClassifyMethod: 'quantile' | 'jenks' | 'equal';
  onSetF4GridSize: (value: number) => void;
  onSetF4RenderMode: (value: 'heatmap' | 'choropleth') => void;
  onSetF4ClassifyMethod: (value: 'quantile' | 'jenks' | 'equal') => void;
  onRunComputeF4: () => void;
  f5DrawingTarget: 'A' | 'B' | null;
  hasF5AreaA: boolean;
  hasF5AreaB: boolean;
  odGranularity: 'hour' | 'day';
  f5BufferMeters: number;
  f5MaxTransitionMinutes: number;
  f5ThresholdRecommendation: any;
  f5Result: any;
  f5DetailsExpanded: boolean;
  f5Items: any[];
  f5MaxBucketFlow: number;
  onRunF5DrawArea: (target: 'A' | 'B') => void;
  onClearF5Area: (target: 'A' | 'B') => void;
  onClearF5FlowOverlays: () => void;
  onResetF5Result: () => void;
  onSetOdGranularity: (value: 'hour' | 'day') => void;
  onSetF5BufferMeters: (value: number) => void;
  onSetF5MaxTransitionMinutes: (value: number) => void;
  onRunComputeF5: () => void;
  onToggleF5Details: () => void;
  f6Drawing: boolean;
  hasF6CoreArea: boolean;
  f6Direction: 'outbound' | 'inbound' | 'both';
  f6AnalysisMode: 'strict_od' | 'through_flow';
  f6H3Resolution: number;
  f6BufferMeters: number;
  f6TopK: number;
  f6StrictMaxTripMinutes: number;
  f6Summary: any;
  f6TopKRatio: number;
  f6DetailsExpanded: boolean;
  f6Regions: any[];
  f6MaxOutbound: number;
  f6MaxInbound: number;
  onRunF6DrawCoreArea: () => void;
  onClearF6Artifacts: () => void;
  onSetF6Direction: (value: 'outbound' | 'inbound' | 'both') => void;
  onSetF6AnalysisMode: (value: 'strict_od' | 'through_flow') => void;
  onSetF6H3Resolution: (value: number) => void;
  onSetF6BufferMeters: (value: number) => void;
  onSetF6TopK: (value: number) => void;
  onSetF6StrictMaxTripMinutes: (value: number) => void;
  onRunComputeF6: () => void;
  onToggleF6Details: () => void;
  onSetF6RegionFocus: (regionId: string | null) => void;
  onValidationNotice: (message: string) => void;
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

export default function GeoWorkbenchRegionPanel(props: GeoWorkbenchRegionPanelProps) {
  const {
    status,
    demoReadonly = false,
    activeRegionTool,
    regionToolEntries,
    onToggleTool,
    activeVehicles,
    formatInt,
    formatDurationMinutes,
    formatF5BucketLabel,
    f3Loading,
    f3Drawing,
    hasF3Selection,
    f3ShowOnlyInBBox,
    f3BoxSummaries,
    f3DetailsExpanded,
    f3VisibleRows,
    f3SelectedTaxiId,
    f3Page,
    f3PageItems,
    f3PageCount,
    f3JumpPage,
    f3RowsLength,
    onRunF3DrawRectangle,
    onRunF3QueryByRectangles,
    onClearF3Selection,
    onToggleF3Mode,
    onToggleF3Details,
    onF3TaxiClick,
    onSetF3Page,
    onF3JumpPageChange,
    onApplyF3JumpPage,
    f4Generating,
    f4GridSize,
    f4ViewportEstimate,
    f4RenderMode,
    f4ClassifyMethod,
    onSetF4GridSize,
    onSetF4RenderMode,
    onSetF4ClassifyMethod,
    onRunComputeF4,
    f5DrawingTarget,
    hasF5AreaA,
    hasF5AreaB,
    odGranularity,
    f5BufferMeters,
    f5MaxTransitionMinutes,
    f5ThresholdRecommendation,
    f5Result,
    f5DetailsExpanded,
    f5Items,
    f5MaxBucketFlow,
    onRunF5DrawArea,
    onClearF5Area,
    onClearF5FlowOverlays,
    onResetF5Result,
    onSetOdGranularity,
    onSetF5BufferMeters,
    onSetF5MaxTransitionMinutes,
    onRunComputeF5,
    onToggleF5Details,
    f6Drawing,
    hasF6CoreArea,
    f6Direction,
    f6AnalysisMode,
    f6H3Resolution,
    f6BufferMeters,
    f6TopK,
    f6StrictMaxTripMinutes,
    f6Summary,
    f6TopKRatio,
    f6DetailsExpanded,
    f6Regions,
    f6MaxOutbound,
    f6MaxInbound,
    onRunF6DrawCoreArea,
    onClearF6Artifacts,
    onSetF6Direction,
    onSetF6AnalysisMode,
    onSetF6H3Resolution,
    onSetF6BufferMeters,
    onSetF6TopK,
    onSetF6StrictMaxTripMinutes,
    onRunComputeF6,
    onToggleF6Details,
    onSetF6RegionFocus,
    onValidationNotice,
  } = props;
  const [f5MaxTransitionInput, setF5MaxTransitionInput] = React.useState(String(f5MaxTransitionMinutes));
  const [f6H3ResolutionInput, setF6H3ResolutionInput] = React.useState(String(f6H3Resolution));
  const [f6BufferInput, setF6BufferInput] = React.useState(String(f6BufferMeters));
  const [f6TopKInput, setF6TopKInput] = React.useState(String(f6TopK));
  const [f6StrictMaxTripInput, setF6StrictMaxTripInput] = React.useState(String(f6StrictMaxTripMinutes));

  React.useEffect(() => setF5MaxTransitionInput(String(f5MaxTransitionMinutes)), [f5MaxTransitionMinutes]);
  React.useEffect(() => setF6H3ResolutionInput(String(f6H3Resolution)), [f6H3Resolution]);
  React.useEffect(() => setF6BufferInput(String(f6BufferMeters)), [f6BufferMeters]);
  React.useEffect(() => setF6TopKInput(String(f6TopK)), [f6TopK]);
  React.useEffect(() => setF6StrictMaxTripInput(String(f6StrictMaxTripMinutes)), [f6StrictMaxTripMinutes]);

  const parameterLocked = demoReadonly;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <section className="shrink-0 bg-[#20242d]/70 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-[#173d4a] text-cyan-200">
            <AreaChart className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-100">区域与网格态势 (F3-F6)</div>
            <div className="mt-0.5 text-[10px] leading-relaxed text-slate-500">框选统计、栅格热力、OD 流向与核心区诊断</div>
          </div>
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-y-auto bg-[#20242d]/70 px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/80">Engine</div>
          <span className="rounded-sm bg-[#151a22] px-2 py-1 text-[10px] text-slate-500">F3-F6</span>
        </div>

        <div className="space-y-3">
          {regionToolEntries.map(({ key, code, title, description, icon: Icon }) => {
            const selected = activeRegionTool === key;
            return (
              <div key={key} className={`w-full overflow-hidden rounded-sm border transition ${selected ? 'border-cyan-300/35 bg-[#151d29] shadow-[0_10px_24px_rgba(0,0,0,0.16)]' : 'border-[#34414c]/40 bg-[#252b35]'}`}>
                <button
                  type="button"
                  onClick={() => onToggleTool(selected ? null : key)}
                  title={`${code} ${title}`}
                  className={`group flex w-full items-center gap-3 px-4 py-3.5 text-left transition ${selected ? 'bg-cyan-300/[0.08]' : 'hover:bg-[#2b3743]'}`}
                >
                  <Icon className={`h-5 w-5 shrink-0 ${selected ? 'text-cyan-100' : 'text-cyan-300'}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-base font-semibold ${selected ? 'text-cyan-50' : 'text-slate-200'}`}>{code} {title}</span>
                    <span className="mt-1 block text-xs leading-snug text-slate-500">{description}</span>
                  </span>
                  <span className={`text-sm text-slate-500 transition ${selected ? 'rotate-90 text-cyan-200' : ''}`}>›</span>
                </button>

                {selected && key === 'f3' ? (
                  <div className="region-accordion-body space-y-4 border-t border-slate-700/60 bg-[#111722]/55 p-4">
                    <div className="overflow-hidden rounded-sm border border-cyan-300/22 bg-[#0d1420] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <div className="grid grid-cols-[1.25fr_0.85fr_1.25fr]">
                        <button type="button" onClick={onRunF3DrawRectangle} disabled={f3Loading || parameterLocked} className={`flex h-10 items-center justify-center gap-1.5 border-r border-cyan-300/12 text-[10px] font-semibold transition ${f3Drawing ? 'bg-cyan-300/14 text-cyan-50' : 'bg-[#101925] text-slate-300 hover:bg-cyan-300/8 hover:text-cyan-100'} disabled:cursor-not-allowed disabled:opacity-60`}>
                          <span className={`h-3 w-3 border ${f3Drawing ? 'border-cyan-200 bg-cyan-300/20' : 'border-slate-400'}`} />
                          绘制矩形
                        </button>
                        <button type="button" onClick={onRunF3QueryByRectangles} disabled={f3Loading || !hasF3Selection} className="h-10 bg-blue-600 text-[10px] font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-600/35 disabled:text-slate-400">查询</button>
                        <button type="button" onClick={onClearF3Selection} disabled={parameterLocked || (f3Loading && !f3Drawing)} className="flex h-10 items-center justify-center gap-1.5 border-l border-red-300/18 bg-[#101925] text-[10px] font-semibold text-red-300 transition hover:bg-red-400/10 hover:text-red-100 disabled:cursor-not-allowed disabled:text-slate-500">
                          <Trash2 className="h-3 w-3" />
                          清除选区
                        </button>
                      </div>
                    </div>

                    <button type="button" onClick={onToggleF3Mode} disabled={f3Loading || parameterLocked} className="flex w-full items-center justify-between gap-3 rounded-sm bg-[#0f1622]/45 px-3 py-2.5 text-left text-sm text-slate-300 transition hover:bg-[#142033] disabled:cursor-not-allowed disabled:opacity-65">
                      <span>{f3ShowOnlyInBBox ? '仅显示框内命中' : '显示完整命中行程'}</span>
                      <span className={`relative h-6 w-11 rounded-full transition ${f3ShowOnlyInBBox ? 'bg-cyan-400/80' : 'bg-slate-600'}`}>
                        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${f3ShowOnlyInBBox ? 'left-6' : 'left-1'}`} />
                      </span>
                    </button>

                    <div className="rounded-sm border border-cyan-300/18 bg-[#0f1622]/90 px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                      <div className="text-[11px] font-medium text-slate-500">命中车辆</div>
                      <div className="mt-2 whitespace-nowrap text-3xl font-semibold leading-none tracking-tight text-cyan-100">
                        {status === 'ready' ? formatInt(activeVehicles) : f3Loading ? '...' : '--'}
                      </div>
                    </div>

                    {f3BoxSummaries.length ? (
                      <div className="rounded-sm border border-cyan-300/18 bg-[#151f29] px-2 py-1.5">
                        {f3BoxSummaries.map((item) => (
                          <div key={item.boxIndex} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="flex items-center gap-1.5 text-slate-300"><i className="h-2 w-2 rounded-full" style={{ background: item.color }} />矩形 #{item.boxIndex}</span>
                            <span className="font-semibold text-cyan-50">{formatInt(item.vehicleCount)} 辆</span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div>
                      <button type="button" onClick={onToggleF3Details} className="w-full rounded-sm border border-slate-700/45 bg-[#151a22]/70 px-3 py-2 text-left text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:bg-[#1b2430]">
                        {f3DetailsExpanded ? '收起明细' : '展开明细'}
                      </button>
                      {f3DetailsExpanded ? (
                        <div className="mt-3 overflow-hidden rounded-sm border border-slate-700/60 bg-[#111722]">
                          <div className="grid grid-cols-2 border-b border-slate-700/60 bg-[#18212e] px-2 py-1 text-[11px] font-semibold text-slate-400">
                            <div>Taxi ID</div>
                            <div>命中矩形</div>
                          </div>
                          <div className="h-[360px] overflow-hidden">
                            {f3VisibleRows.length ? f3VisibleRows.map((row) => (
                              <button key={row.key} type="button" onClick={() => onF3TaxiClick(row)} disabled={f3Loading} className={`grid h-9 w-full grid-cols-2 items-center border-b border-slate-700/40 px-2 text-left text-sm transition last:border-b-0 disabled:cursor-wait disabled:opacity-70 ${f3SelectedTaxiId === row.taxiId ? 'bg-cyan-300/10 text-cyan-100' : 'text-slate-300 hover:bg-[#1c2531]'}`}>
                                <span className="font-medium">{row.taxiId}</span>
                                <span>{row.boxLabels || '--'}</span>
                              </button>
                            )) : <div className="px-3 py-6 text-center text-xs text-slate-500">暂无明细</div>}
                          </div>
                          <div className="border-t border-slate-700/60 bg-[#151a22] px-2 py-2 text-[11px] text-slate-400">
                            <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                              <button type="button" disabled={f3Page <= 1} onClick={() => onSetF3Page(Math.max(1, f3Page - 1))} className="h-5 min-w-5 rounded bg-slate-800 px-1 transition hover:bg-slate-700 disabled:opacity-40">‹</button>
                              {f3PageItems.map((item, index) => item === 'ellipsis' ? (
                                <span key={`ellipsis-${index}`} className="px-1 text-slate-500">...</span>
                              ) : (
                                <button key={item} type="button" onClick={() => onSetF3Page(item)} className={`h-5 min-w-5 rounded px-1.5 transition ${item === f3Page ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
                                  {item}
                                </button>
                              ))}
                              <button type="button" disabled={f3Page >= f3PageCount} onClick={() => onSetF3Page(Math.min(f3PageCount, f3Page + 1))} className="h-5 min-w-5 rounded bg-slate-800 px-1 transition hover:bg-slate-700 disabled:opacity-40">›</button>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-700/40 pt-2 text-[11px] text-slate-500">
                              <span>共 {f3PageCount} 页，当前第 {Math.min(f3Page, f3PageCount)} 页</span>
                              <div className="flex items-center gap-1.5">
                                <span>跳转到</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={f3JumpPage}
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    if (nextValue && !/^\d{0,4}$/.test(nextValue)) {
                                      onValidationNotice(`F3 页码只能输入数字，范围为 1-${f3PageCount}。`);
                                      return;
                                    }
                                    onF3JumpPageChange(nextValue);
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      onApplyF3JumpPage();
                                    }
                                  }}
                                  disabled={f3Loading || f3RowsLength === 0}
                                  className="h-6 w-14 rounded border border-slate-700 bg-[#0f1622] px-2 text-center text-[11px] text-slate-200 outline-none transition focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                                />
                                <span>页</span>
                                <button type="button" onClick={onApplyF3JumpPage} disabled={f3Loading || f3RowsLength === 0} className="h-6 rounded bg-slate-800 px-2 text-[11px] text-slate-300 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
                                  跳转
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {selected && key === 'f4' ? (
                  <div className="region-accordion-body space-y-4 border-t border-slate-700/60 bg-[#111722]/55 p-4">
                    <div className="rounded-2xl border border-cyan-300/18 bg-[#0f1622]/92 px-5 py-4 shadow-[0_14px_30px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.03)]">
                      <div className="text-xs text-slate-400">网格大小 r（米）</div>
                      <input type="range" min={100} max={2000} step={100} value={f4GridSize} disabled={parameterLocked || status === 'computing' || f4Generating} onChange={(event) => onSetF4GridSize(Number(event.target.value))} className="mt-3 w-full accent-cyan-300 disabled:cursor-not-allowed disabled:opacity-45" />
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                        <span>100m</span>
                        <span>1000m</span>
                        <span>2000m</span>
                      </div>

                      <div className="mt-4 space-y-2.5 text-sm leading-6">
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0 text-slate-300"><span className="text-slate-500">当前 r：</span><span className="ml-1 font-semibold text-cyan-100">{f4GridSize} m</span></div>
                          <div className="min-w-0 w-[148px] text-left text-slate-300"><span className="text-slate-500">预估网格：</span><span className="ml-1 font-semibold text-slate-100">{f4ViewportEstimate ? formatInt(f4ViewportEstimate.estimatedCells) : '--'}</span></div>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-sm">
                          <div className="min-w-0 text-slate-300"><span className="text-slate-500">建议 r：</span><span className="ml-1 font-semibold text-cyan-100">{f4ViewportEstimate ? `${f4ViewportEstimate.recommendedGridSizeM} m` : '--'}</span></div>
                          <div className="min-w-0 w-[148px] text-left text-slate-300"><span className="text-slate-500">推荐：</span><span className="ml-1 font-semibold text-slate-100">{f4ViewportEstimate?.recommendedLevel ?? '--'}</span></div>
                        </div>
                      </div>

                      <div className="mt-5 border-t border-slate-800/90 pt-4">
                        <div className="flex rounded-xl bg-[#101722] p-1">
                          <button type="button" onClick={() => onSetF4RenderMode('heatmap')} disabled={parameterLocked} className={`min-w-0 flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${f4RenderMode === 'heatmap' ? 'bg-[#1f4654] text-cyan-50 shadow-[inset_0_0_0_1px_rgba(103,232,249,0.16)]' : 'text-slate-400 hover:text-slate-200'}`}>模糊热力图</button>
                          <button type="button" onClick={() => onSetF4RenderMode('choropleth')} disabled={parameterLocked} className={`min-w-0 flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${f4RenderMode === 'choropleth' ? 'bg-[#1f4654] text-cyan-50 shadow-[inset_0_0_0_1px_rgba(103,232,249,0.16)]' : 'text-slate-400 hover:text-slate-200'}`}>离散色块图</button>
                        </div>

                        {f4RenderMode === 'choropleth' ? (
                          <div className="mt-3 flex rounded-xl bg-[#101722] p-1">
                            {[
                              { key: 'quantile', label: '分位数' },
                              { key: 'jenks', label: '自然断点' },
                              { key: 'equal', label: '等距分段' },
                            ].map((item) => (
                              <button key={item.key} type="button" onClick={() => onSetF4ClassifyMethod(item.key as 'quantile' | 'jenks' | 'equal')} disabled={parameterLocked} className={`min-w-0 flex-1 whitespace-nowrap rounded-lg px-2 py-2 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${f4ClassifyMethod === item.key ? 'bg-cyan-300/12 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(103,232,249,0.16)]' : 'text-slate-400 hover:text-slate-200'}`}>
                                {item.label}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-3 text-[11px] text-slate-500">热力图模式使用视窗自适应渲染，无需额外分段算法。</div>
                        )}
                      </div>

                      <div className="mt-5 border-t border-slate-800/90 pt-4">
                        <button type="button" onClick={onRunComputeF4} disabled={status === 'computing' || f4Generating} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#179a8d] px-3 py-3.5 text-sm font-semibold text-cyan-50 transition hover:bg-[#1bb1a2] disabled:cursor-wait disabled:bg-[#179a8d]/50">
                          {status === 'computing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                          生成密度图层
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {selected && key === 'f5' ? (
                  <div className="region-accordion-body space-y-3 border-t border-slate-700/60 bg-[#111722]/55 p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className={`grid h-12 grid-cols-[minmax(0,1fr)_62px] overflow-hidden rounded-2xl border bg-[#101722] transition ${f5DrawingTarget === 'A' ? 'border-blue-300/45 shadow-[0_0_0_1px_rgba(147,197,253,0.12)]' : hasF5AreaA ? 'border-blue-300/28' : 'border-[#34414c]/75'}`}>
                        <button
                          type="button"
                          onClick={() => onRunF5DrawArea('A')}
                          disabled={parameterLocked || status === 'computing'}
                          className={`h-12 min-w-0 whitespace-nowrap px-2 text-[12px] font-semibold leading-none transition disabled:cursor-not-allowed disabled:opacity-55 ${f5DrawingTarget === 'A' ? 'bg-blue-400/16 text-blue-50' : hasF5AreaA ? 'text-blue-100 hover:bg-blue-300/10' : 'text-slate-200 hover:bg-slate-300/[0.06]'}`}
                        >
                          绘制区域 A
                        </button>
                        <button
                          type="button"
                          onClick={() => { onClearF5Area('A'); onClearF5FlowOverlays(); onResetF5Result(); onSetF5MaxTransitionMinutes(30); }}
                          disabled={parameterLocked}
                          className="h-12 whitespace-nowrap border-l border-red-300/22 bg-red-300/[0.04] px-2 text-[12px] font-semibold text-slate-200 transition hover:bg-red-400/12 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          清除
                        </button>
                      </div>
                      <div className={`grid h-12 grid-cols-[minmax(0,1fr)_62px] overflow-hidden rounded-2xl border bg-[#101722] transition ${f5DrawingTarget === 'B' ? 'border-orange-300/45 shadow-[0_0_0_1px_rgba(253,186,116,0.12)]' : hasF5AreaB ? 'border-orange-300/28' : 'border-[#34414c]/75'}`}>
                        <button
                          type="button"
                          onClick={() => onRunF5DrawArea('B')}
                          disabled={parameterLocked || status === 'computing'}
                          className={`h-12 min-w-0 whitespace-nowrap px-2 text-[12px] font-semibold leading-none transition disabled:cursor-not-allowed disabled:opacity-55 ${f5DrawingTarget === 'B' ? 'bg-orange-400/16 text-orange-50' : hasF5AreaB ? 'text-orange-100 hover:bg-orange-300/10' : 'text-slate-200 hover:bg-slate-300/[0.06]'}`}
                        >
                          绘制区域 B
                        </button>
                        <button
                          type="button"
                          onClick={() => { onClearF5Area('B'); onClearF5FlowOverlays(); onResetF5Result(); onSetF5MaxTransitionMinutes(30); }}
                          disabled={parameterLocked}
                          className="h-12 whitespace-nowrap border-l border-red-300/22 bg-red-300/[0.04] px-2 text-[12px] font-semibold text-slate-200 transition hover:bg-red-400/12 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          清除
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <button type="button" onClick={() => onSetOdGranularity('hour')} disabled={parameterLocked} className={`rounded-sm px-3 py-2 font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${odGranularity === 'hour' ? 'bg-blue-400/14 text-blue-100' : 'bg-[#20242d] text-slate-400 hover:bg-[#2b3743]'}`}>按小时</button>
                      <button type="button" onClick={() => onSetOdGranularity('day')} disabled={parameterLocked} className={`rounded-sm px-3 py-2 font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${odGranularity === 'day' ? 'bg-blue-400/14 text-blue-100' : 'bg-[#20242d] text-slate-400 hover:bg-[#2b3743]'}`}>按天</button>
                    </div>
                    <label className="block text-xs text-slate-400">
                      区域命中缓冲（米）
                      <input type="range" min={0} max={200} step={10} value={f5BufferMeters} disabled={parameterLocked} onChange={(event) => onSetF5BufferMeters(Number(event.target.value))} className="mt-2 w-full accent-blue-400 disabled:cursor-not-allowed disabled:opacity-45" />
                      <span className="mt-1 block font-semibold text-blue-100">{f5BufferMeters} m</span>
                    </label>
                    <label className="block text-xs text-slate-400">
                      最大允许直达耗时（分钟）
                      <input type="range" min={1} max={360} step={5} value={f5MaxTransitionMinutes} disabled={parameterLocked} onChange={(event) => onSetF5MaxTransitionMinutes(Number(event.target.value))} className="mt-2 w-full accent-blue-400 disabled:cursor-not-allowed disabled:opacity-45" />
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={360}
                          step={5}
                          value={f5MaxTransitionInput}
                          disabled={parameterLocked}
                          onChange={(event) => {
                            const rawValue = event.target.value;
                            setF5MaxTransitionInput(rawValue);
                            const nextValue = parseBoundedInteger(rawValue, 1, 360, 'F5 最大允许直达耗时必须输入 1-360 分钟之间的整数。', onValidationNotice);
                            if (nextValue != null) onSetF5MaxTransitionMinutes(nextValue);
                          }}
                          onBlur={() => setF5MaxTransitionInput(String(f5MaxTransitionMinutes))}
                          className="h-7 w-20 rounded-sm border border-slate-700 bg-[#0f1622] px-2 text-xs font-semibold text-blue-100 outline-none transition focus:border-blue-300/50 disabled:cursor-not-allowed disabled:opacity-55"
                        />
                        <span className="text-[11px] text-slate-500">可手动覆盖推荐值</span>
                      </div>
                    </label>
                    {f5ThresholdRecommendation ? (
                      <div className="rounded-sm border border-blue-300/15 bg-blue-300/[0.07] px-3 py-2 text-[11px] leading-relaxed text-blue-100/85">
                        系统推荐 {f5ThresholdRecommendation.recommended_minutes} 分钟：
                        A/B 中心距 {(f5ThresholdRecommendation.distance_meters / 1000).toFixed(1)}km，
                        按约 {Number(f5ThresholdRecommendation.meta?.pessimistic_kmh ?? 10).toFixed(0)}km/h
                        × 曲折系数 {Number(f5ThresholdRecommendation.meta?.road_winding_factor ?? 1.6).toFixed(1)} 估算，可手动覆盖。
                      </div>
                    ) : (
                      <div className="rounded-sm border border-slate-700/50 bg-[#0f1622]/70 px-3 py-2 text-[11px] leading-relaxed text-slate-500">画完 A/B 后会自动按距离推荐；当前可手动设置。</div>
                    )}
                    <button type="button" onClick={onRunComputeF5} disabled={status === 'computing'} className="flex w-full items-center justify-center gap-2 rounded-sm bg-[#2459a8] px-3 py-2 text-xs font-semibold text-blue-50 transition hover:bg-[#2f6bc8] disabled:cursor-wait disabled:bg-[#2459a8]/45">
                      {status === 'computing' && activeRegionTool === 'f5' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Route className="h-3.5 w-3.5" />}
                      计算 A↔B
                    </button>
                    {f5Result ? (
                      <div className="rounded-sm border border-[#34414c]/70 bg-[#0f1622]/75 p-3">
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div><div className="text-base font-semibold text-blue-100">{formatInt(f5Result.summary.a_to_b_total)}</div><div className="text-[10px] text-slate-500">A→B 行程</div></div>
                          <div><div className="text-base font-semibold text-orange-100">{formatInt(f5Result.summary.b_to_a_total)}</div><div className="text-[10px] text-slate-500">B→A 行程</div></div>
                          <div><div className="text-base font-semibold text-slate-100">{formatInt(f5Result.summary.net_flow)}</div><div className="text-[10px] text-slate-500">净行程</div></div>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                          <div><div className="text-base font-semibold tracking-tight text-slate-50">{formatDurationMinutes(f5Result.summary.a_to_b_avg_duration_min)}</div><div className="mt-0.5 text-[10px] text-slate-500">A→B 平均耗时</div></div>
                          <div><div className="text-base font-semibold tracking-tight text-slate-50">{formatDurationMinutes(f5Result.summary.b_to_a_avg_duration_min)}</div><div className="mt-0.5 text-[10px] text-slate-500">B→A 平均耗时</div></div>
                          <div><div className="text-base font-semibold tracking-tight text-slate-50">{formatDurationMinutes(Math.round(Number(f5Result.meta?.max_transition_seconds ?? f5MaxTransitionMinutes * 60) / 60))}</div><div className="mt-0.5 text-[10px] text-slate-500">本次直达上限</div></div>
                        </div>
                        <div className="mt-3">
                          <button type="button" onClick={onToggleF5Details} className="w-full rounded-sm border border-slate-700/45 bg-[#151a22]/70 px-3 py-2 text-left text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:bg-[#1b2430]">
                            {f5DetailsExpanded ? '收起明细' : '展开明细'}
                          </button>
                        </div>
                        {f5DetailsExpanded ? (
                          <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                            {f5Items.map((item) => {
                              const leftPercent = Math.min(100, (Number(item.b_to_a || 0) / f5MaxBucketFlow) * 100);
                              const rightPercent = Math.min(100, (Number(item.a_to_b || 0) / f5MaxBucketFlow) * 100);
                              return (
                                <div key={item.time_bucket} className="border-t border-slate-700/45 pt-2">
                                  <div className="mb-1 flex items-center justify-between text-[11px]"><span className="text-slate-300">{formatF5BucketLabel(item.time_bucket)}</span><span className="text-slate-500">总量 {item.total}</span></div>
                                  <div className="grid grid-cols-[1fr_10px_1fr] items-center gap-0">
                                    <div className="flex items-center gap-1.5"><span className="w-6 text-right text-[11px] font-semibold text-orange-100">{item.b_to_a}</span><div className="h-2 flex-1 rounded bg-slate-800"><div className="ml-auto h-full rounded bg-gradient-to-l from-orange-400 to-orange-600" style={{ width: `${leftPercent}%` }} /></div></div>
                                    <div className="mx-auto h-3 w-px rounded bg-slate-600" />
                                    <div className="flex items-center gap-1.5"><div className="h-2 flex-1 rounded bg-slate-800"><div className="h-full rounded bg-gradient-to-r from-blue-400 to-blue-600" style={{ width: `${rightPercent}%` }} /></div><span className="w-6 text-[11px] font-semibold text-blue-100">{item.a_to_b}</span></div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {selected && key === 'f6' ? (
                  <div className="region-accordion-body space-y-3 border-t border-slate-700/60 bg-[#111722]/55 p-4">
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <button type="button" onClick={onRunF6DrawCoreArea} disabled={parameterLocked || status === 'computing'} className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${f6Drawing ? 'border-blue-300/40 bg-blue-400/18 text-blue-50' : hasF6CoreArea ? 'border-blue-300/25 bg-blue-400/10 text-blue-100' : 'border-[#34414c]/50 bg-[#20242d] text-slate-300 hover:bg-[#2b3743]'}`}>绘制核心区域 A</button>
                      <button type="button" onClick={onClearF6Artifacts} disabled={parameterLocked} className="rounded-lg px-3 py-2.5 text-[11px] font-medium text-slate-400 transition hover:bg-red-400/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50">重置</button>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500">流向方向</span>
                        <div className="grid h-5 w-5 place-items-center rounded-full border border-slate-600/70 text-slate-400" title="选择从核心区向外扩散、向内汇聚，或同时对比双向潮汐。">
                          <Info className="h-3 w-3" />
                        </div>
                      </div>
                      <div className="mt-2 flex rounded-xl bg-[#101722] p-1">
                        {[
                          ['outbound', '出向'],
                          ['inbound', '入向'],
                          ['both', '双向'],
                        ].map(([value, label]) => (
                          <button key={value} type="button" onClick={() => onSetF6Direction(value as 'outbound' | 'inbound' | 'both')} disabled={parameterLocked} className={`min-w-0 flex-1 whitespace-nowrap rounded-lg px-2 py-2 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${f6Direction === value ? 'bg-cyan-300/16 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(103,232,249,0.18)]' : 'text-slate-400 hover:text-slate-200'}`}>{label}</button>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500">分析规则</span>
                        <div className="grid h-5 w-5 place-items-center rounded-full border border-slate-600/70 text-slate-400" title="严格OD仅统计行程首尾点，适用于评估商圈真实的终端吸引力。途经流向则包含轨迹经过该区域的车辆，更适合枢纽和主干道诊断。">
                          <Info className="h-3 w-3" />
                        </div>
                      </div>
                      <div className="mt-2 flex rounded-xl bg-[#101722] p-1">
                        <button type="button" onClick={() => onSetF6AnalysisMode('strict_od')} disabled={parameterLocked} className={`min-w-0 flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${f6AnalysisMode === 'strict_od' ? 'bg-blue-400/14 text-blue-100' : 'text-slate-400 hover:text-slate-200'}`}>严格起终点 OD</button>
                        <button type="button" onClick={() => onSetF6AnalysisMode('through_flow')} disabled={parameterLocked} className={`min-w-0 flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${f6AnalysisMode === 'through_flow' ? 'bg-orange-400/14 text-orange-100' : 'text-slate-400 hover:text-slate-200'}`}>途经流向</button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="block text-xs text-slate-400">
                        H3 分辨率
                        <input
                          type="number"
                          min={6}
                          max={10}
                          step={1}
                          value={f6H3ResolutionInput}
                          disabled={parameterLocked}
                          onChange={(event) => {
                            const rawValue = event.target.value;
                            setF6H3ResolutionInput(rawValue);
                            const nextValue = parseBoundedInteger(rawValue, 6, 10, 'F6 H3 分辨率必须输入 6-10 之间的整数。', onValidationNotice);
                            if (nextValue != null) onSetF6H3Resolution(nextValue);
                          }}
                          onBlur={() => setF6H3ResolutionInput(String(f6H3Resolution))}
                          className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-[#0f1622] px-3 text-sm font-semibold text-blue-100 outline-none transition focus:border-blue-300/50 disabled:cursor-not-allowed disabled:opacity-55"
                        />
                        <div className="mt-1 text-[10px] text-slate-500">7 全局 / 8 城区 / 9 商圈</div>
                      </label>
                      <label className="block text-xs text-slate-400">
                        Buffer（米）
                        <input
                          type="number"
                          min={0}
                          max={200}
                          step={10}
                          value={f6BufferInput}
                          disabled={parameterLocked}
                          onChange={(event) => {
                            const rawValue = event.target.value;
                            setF6BufferInput(rawValue);
                            const nextValue = parseBoundedInteger(rawValue, 0, 200, 'F6 Buffer 必须输入 0-200 米之间的整数。', onValidationNotice);
                            if (nextValue != null) onSetF6BufferMeters(nextValue);
                          }}
                          onBlur={() => setF6BufferInput(String(f6BufferMeters))}
                          className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-[#0f1622] px-3 text-sm font-semibold text-blue-100 outline-none transition focus:border-blue-300/50 disabled:cursor-not-allowed disabled:opacity-55"
                        />
                      </label>
                      <label className="block text-xs text-slate-400">
                        Top-K 飞线
                        <input
                          type="number"
                          min={1}
                          max={100}
                          step={5}
                          value={f6TopKInput}
                          disabled={parameterLocked}
                          onChange={(event) => {
                            const rawValue = event.target.value;
                            setF6TopKInput(rawValue);
                            const nextValue = parseBoundedInteger(rawValue, 1, 100, 'F6 Top-K 飞线必须输入 1-100 之间的整数。', onValidationNotice);
                            if (nextValue != null) onSetF6TopK(nextValue);
                          }}
                          onBlur={() => setF6TopKInput(String(f6TopK))}
                          className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-[#0f1622] px-3 text-sm font-semibold text-violet-100 outline-none transition focus:border-violet-300/50 disabled:cursor-not-allowed disabled:opacity-55"
                        />
                      </label>
                      {f6AnalysisMode === 'through_flow' ? (
                        <label className="block text-xs text-slate-400">
                          最大行程耗时（分钟）
                          <input
                            type="number"
                            min={5}
                            max={360}
                            step={5}
                            value={f6StrictMaxTripInput}
                            disabled={parameterLocked}
                            onChange={(event) => {
                              const rawValue = event.target.value;
                              setF6StrictMaxTripInput(rawValue);
                              const nextValue = parseBoundedInteger(rawValue, 5, 360, 'F6 最大行程耗时必须输入 5-360 分钟之间的整数。', onValidationNotice);
                              if (nextValue != null) onSetF6StrictMaxTripMinutes(nextValue);
                            }}
                            onBlur={() => setF6StrictMaxTripInput(String(f6StrictMaxTripMinutes))}
                            className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-[#0f1622] px-3 text-sm font-semibold text-blue-100 outline-none transition focus:border-blue-300/50 disabled:cursor-not-allowed disabled:opacity-55"
                          />
                        </label>
                      ) : null}
                    </div>

                    <button type="button" onClick={onRunComputeF6} disabled={status === 'computing'} className="flex w-full items-center justify-center gap-2 rounded-sm bg-[#2459a8] px-3 py-2 text-xs font-semibold text-blue-50 transition hover:bg-[#2f6bc8] disabled:cursor-wait disabled:bg-[#2459a8]/45">
                      {status === 'computing' && activeRegionTool === 'f6' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
                      启动辐射分析
                    </button>

                    {f6Summary ? (
                      <div className="rounded-sm border border-[#34414c]/70 bg-[#0f1622]/75 p-3">
                        <div className="grid grid-cols-4 gap-2 text-center">
                          <div><div className="text-base font-semibold text-blue-100">{formatInt(f6Summary.total_outbound)}</div><div className="text-[10px] text-slate-500">全局出向</div></div>
                          <div><div className="text-base font-semibold text-orange-100">{formatInt(f6Summary.total_inbound)}</div><div className="text-[10px] text-slate-500">全局入向</div></div>
                          <div><div className="text-base font-semibold text-slate-100">{formatInt(f6Summary.total_flow)}</div><div className="text-[10px] text-slate-500">全局总流量</div></div>
                          <div><div className="text-base font-semibold text-violet-100">{formatInt(f6Summary.net_flow)}</div><div className="text-[10px] text-slate-500">净流向</div></div>
                        </div>
                        <div className="mt-3">
                          <div className="text-[11px] text-slate-400">Top-{f6TopK} 展示流量 {formatInt(f6Summary.top_k_flow)} / 全局真实总流量 {formatInt(f6Summary.total_flow)}，覆盖 {f6TopKRatio}%</div>
                          <div className="mt-1.5 h-1.5 rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400" style={{ width: `${Math.min(100, f6TopKRatio)}%` }} /></div>
                        </div>
                        <div className="mt-3 text-[11px] text-slate-400">外部 H3 区域数：{formatInt(f6Summary.external_region_count)}；平均行程耗时：{formatDurationMinutes(f6Summary.avg_duration_min)}</div>
                        <div className="mt-3">
                          <button type="button" onClick={onToggleF6Details} className="w-full rounded-sm border border-slate-700/45 bg-[#151a22]/70 px-3 py-2 text-left text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:bg-[#1b2430]">
                            {f6DetailsExpanded ? '收起明细' : '展开明细'}
                          </button>
                        </div>
                        {f6DetailsExpanded ? (
                          <div className="mt-3 max-h-[34rem] space-y-2 overflow-y-auto pr-1">
                            {f6Regions.length === 0 ? (
                              <div className="rounded-sm border border-slate-700/45 bg-[#151a22]/70 px-3 py-3 text-center text-xs text-slate-500">当前条件下无 Top-K 区域</div>
                            ) : (
                              f6Regions.map((region, idx) => {
                                const outboundPercent = Math.round((Number(region.outbound_total || 0) / f6MaxOutbound) * 100);
                                const inboundPercent = Math.round((Number(region.inbound_total || 0) / f6MaxInbound) * 100);
                                return (
                                  <div key={region.region_id} onMouseEnter={() => onSetF6RegionFocus(region.region_id)} onMouseLeave={() => onSetF6RegionFocus(null)} className="rounded-sm border border-slate-700/45 bg-[#151a22]/70 px-2.5 py-2 text-left transition hover:border-blue-300/30 hover:bg-[#1b2430]">
                                    <div className="flex items-center justify-between gap-2 text-[11px]">
                                      <span className="truncate text-slate-200">路径 {idx + 1}</span>
                                      <span className={Number(region.net_flow || 0) > 0 ? 'text-cyan-100' : Number(region.net_flow || 0) < 0 ? 'text-amber-200' : 'text-slate-200'}>
                                        净 {Number(region.net_flow || 0) > 0 ? `+${formatInt(region.net_flow)}` : formatInt(region.net_flow)}
                                      </span>
                                    </div>
                                    <div className="mt-1 text-[10px] text-slate-500">区域 H3 {region.region_id}</div>
                                    <div className="mt-1 text-[11px] text-slate-400">
                                      出向 {formatInt(region.outbound_total)}，入向 {formatInt(region.inbound_total)}，总量 {formatInt(region.total)}
                                      {region.avg_duration_min == null ? '' : `，均时 ${formatDurationMinutes(region.avg_duration_min)}`}
                                    </div>
                                    <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                                      <span className="w-9 shrink-0 text-cyan-200">出向</span>
                                      <div className="h-1.5 flex-1 rounded-full bg-slate-800">
                                        <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.min(100, outboundPercent)}%` }} />
                                      </div>
                                    </div>
                                    <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-500">
                                      <span className="w-9 shrink-0 text-amber-200">入向</span>
                                      <div className="h-1.5 flex-1 rounded-full bg-slate-800">
                                        <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, inboundPercent)}%` }} />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-sm border border-slate-700/50 bg-[#0f1622]/70 px-3 py-2 text-[11px] leading-relaxed text-slate-500">绘制核心区域 A 后，基于当前地图视窗生成 Top-K 辐射飞线。</div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
