import React from 'react';
import { Clock3, Loader2, RotateCw, TimerReset } from 'lucide-react';

interface GeoWorkbenchTimelineProps {
  leftOffset: string;
  demoReadonly?: boolean;
  queryTimeLabel: string;
  displayedTimeLabel: string;
  startLabel: string;
  endLabel: string;
  queryTimeRange: [number, number];
  displayedTimeRange: [number, number];
  histogram: number[];
  timeDirty: boolean;
  mode: 'overview' | 'trajectory' | 'region' | 'decision';
  status: 'idle' | 'computing' | 'ready' | 'empty' | 'error';
  activeVehiclesLabel: string;
  onApplyTimeQuery: () => void;
  onStartRangeChange: (value: number) => void;
  onEndRangeChange: (value: number) => void;
}

export default function GeoWorkbenchTimeline({
  leftOffset,
  demoReadonly = false,
  queryTimeLabel,
  displayedTimeLabel,
  startLabel,
  endLabel,
  queryTimeRange,
  displayedTimeRange,
  histogram,
  timeDirty,
  mode,
  status,
  activeVehiclesLabel,
  onApplyTimeQuery,
  onStartRangeChange,
  onEndRangeChange,
}: GeoWorkbenchTimelineProps) {
  return (
    <div
      className="absolute bottom-5 right-5 z-10 flex justify-center transition-[left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] max-[900px]:left-5"
      style={{ left: leftOffset, right: '20px' }}
    >
      <section className="w-[min(1000px,100%)] min-w-[640px] rounded-2xl border border-white/10 bg-slate-950/72 px-4 py-3 shadow-2xl shadow-black/45 backdrop-blur-xl transition hover:border-cyan-300/30 max-[900px]:min-w-0">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> {startLabel}</span>
              <span className={`hidden shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold md:block lg:text-[11px] ${
                timeDirty
                  ? 'border-amber-200/20 bg-amber-300/10 text-amber-100'
                  : 'border-cyan-200/15 bg-cyan-300/8 text-cyan-100/80'
              }`}>查询时间：{queryTimeLabel}</span>
              <span>{endLabel}</span>
            </div>
            <div className="relative h-20 rounded-md border border-white/8 bg-black/28 px-3 pb-3 pt-4">
              <div
                className="pointer-events-none absolute top-3 h-12 rounded-sm border border-cyan-200/45 bg-cyan-300/8 shadow-[0_0_24px_rgba(103,232,249,0.16)]"
                style={{ left: `${displayedTimeRange[0]}%`, width: `${displayedTimeRange[1] - displayedTimeRange[0]}%` }}
              />
              {timeDirty ? (
                <div
                  className="pointer-events-none absolute top-2 h-14 rounded-sm border border-dashed border-amber-200/60 bg-amber-300/8"
                  style={{ left: `${queryTimeRange[0]}%`, width: `${queryTimeRange[1] - queryTimeRange[0]}%` }}
                />
              ) : null}
              <div className="flex h-10 items-end gap-1">
                {histogram.map((height, index) => {
                  const percent = ((index + 0.5) / histogram.length) * 100;
                  const inDisplayed = percent >= displayedTimeRange[0] && percent <= displayedTimeRange[1];
                  const inQuery = percent >= queryTimeRange[0] && percent <= queryTimeRange[1];
                  return (
                    <div
                      key={`${height}-${index}`}
                      className={`flex-1 rounded-t-sm transition ${
                        inDisplayed
                          ? 'bg-gradient-to-t from-blue-500/20 via-cyan-400/55 to-cyan-100/95 shadow-[0_0_12px_rgba(103,232,249,0.16)]'
                          : inQuery && timeDirty
                            ? 'bg-gradient-to-t from-amber-500/25 to-amber-200/45'
                            : 'bg-slate-700/34'
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  );
                })}
              </div>
              <div className="relative mt-2 h-2 rounded-full bg-slate-800">
                <div
                  className="absolute top-0 h-full rounded-full bg-gradient-to-r from-cyan-300 to-blue-400"
                  style={{ left: `${displayedTimeRange[0]}%`, width: `${displayedTimeRange[1] - displayedTimeRange[0]}%` }}
                />
                {timeDirty ? (
                  <div
                    className="absolute -top-0.5 h-3 rounded-full border border-dashed border-amber-200/70 bg-amber-300/12"
                    style={{ left: `${queryTimeRange[0]}%`, width: `${queryTimeRange[1] - queryTimeRange[0]}%` }}
                  />
                ) : null}
              </div>
              <input
                aria-label="查询开始时间"
                type="range"
                min={0}
                max={100}
                step={0.05}
                value={queryTimeRange[0]}
                disabled={demoReadonly}
                onChange={(event) => onStartRangeChange(Number(event.target.value))}
                className="pointer-events-none absolute inset-x-3 top-2 h-16 cursor-ew-resize appearance-none bg-transparent accent-cyan-300 disabled:cursor-not-allowed disabled:opacity-45 [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-cyan-100 [&::-webkit-slider-thumb]:bg-[#0b1220] [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(34,211,238,0.16)]"
              />
              <input
                aria-label="查询结束时间"
                type="range"
                min={0}
                max={100}
                step={0.05}
                value={queryTimeRange[1]}
                disabled={demoReadonly}
                onChange={(event) => onEndRangeChange(Number(event.target.value))}
                className="pointer-events-none absolute inset-x-3 top-2 h-16 cursor-ew-resize appearance-none bg-transparent accent-cyan-300 disabled:cursor-not-allowed disabled:opacity-45 [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-cyan-100 [&::-webkit-slider-thumb]:bg-[#0b1220] [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(34,211,238,0.16)]"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex min-w-0 items-center gap-2 text-slate-500">
                <span className={`h-2 w-2 rounded-full ${timeDirty ? 'bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.7)]' : 'bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.45)]'}`} />
                <span className="truncate">当前数据时间：{displayedTimeLabel}</span>
              </div>
              {timeDirty ? <span className="text-amber-200/80">时间已修改，尚未同步到地图</span> : <span className="text-emerald-200/70">数据时间已同步</span>}
            </div>
          </div>
          <div className="hidden w-[148px] shrink-0 space-y-2 text-xs md:block">
            {timeDirty && mode !== 'region' ? (
              <button
                type="button"
                onClick={onApplyTimeQuery}
                disabled={demoReadonly || status === 'computing'}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-200/30 bg-amber-300/16 px-3 py-2 font-semibold text-amber-50 transition hover:bg-amber-300/24 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {status === 'computing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                应用查询
                <span className="rounded bg-black/24 px-1.5 py-0.5 text-[10px] text-amber-100/70">Enter</span>
              </button>
            ) : null}
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
              <div className="flex items-center gap-2 text-slate-500"><TimerReset className="h-3.5 w-3.5" /> 活跃车辆</div>
              <div className="mt-1 text-xl font-semibold text-slate-100">{activeVehiclesLabel}</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
