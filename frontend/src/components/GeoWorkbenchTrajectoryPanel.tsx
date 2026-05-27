import React from 'react';
import { ArrowRight, Download, Loader2, Pause, Play, RotateCw, Route, Search } from 'lucide-react';

interface TrajectoryTripCardLike {
  id: string;
  tripId: string;
  taxiId?: number;
  index: number;
  status: 'matched' | 'drift';
  startTime?: string | null;
  endTime?: string | null;
  distanceKm: number;
  duration: string;
  points: number;
}

interface PlaybackStateLike {
  tripId: string | null;
  status: 'idle' | 'playing' | 'paused';
}

interface GeoWorkbenchTrajectoryPanelProps<TTrip extends TrajectoryTripCardLike> {
  status: 'idle' | 'computing' | 'ready' | 'empty' | 'error';
  demoReadonly?: boolean;
  targetTaxiId: string;
  hasTrajectoryInput: boolean;
  trajectoryTarget: string | null;
  tripCards: TTrip[];
  selectedTripId: string | null;
  showMatchedMode: boolean;
  useMapVMode: boolean;
  showOtherTrips: boolean;
  playbackState: PlaybackStateLike;
  onTargetTaxiIdChange: (value: string) => void;
  onSubmitTrajectorySearch: () => boolean;
  onRunCompute: () => void;
  onToggleMatchedMode: () => void;
  onToggleMapVMode: () => void;
  onToggleShowOtherTrips: () => void;
  onSelectTrip: (tripId: string) => void;
  onToggleTripPlayback: (trip: TTrip) => void;
  onRestoreTripPlayback: (tripId: string) => void;
  onExportTripJson: (trip: TTrip) => void;
  formatInt: (value: number | null | undefined) => string;
  formatTripDateTime: (value?: string | null) => string;
}

export default function GeoWorkbenchTrajectoryPanel<TTrip extends TrajectoryTripCardLike>(props: GeoWorkbenchTrajectoryPanelProps<TTrip>) {
  const {
    status,
    demoReadonly = false,
    targetTaxiId,
    hasTrajectoryInput,
    trajectoryTarget,
    tripCards,
    selectedTripId,
    showMatchedMode,
    useMapVMode,
    showOtherTrips,
    playbackState,
    onTargetTaxiIdChange,
    onSubmitTrajectorySearch,
    onRunCompute,
    onToggleMatchedMode,
    onToggleMapVMode,
    onToggleShowOtherTrips,
    onSelectTrip,
    onToggleTripPlayback,
    onRestoreTripPlayback,
    onExportTripJson,
    formatInt,
    formatTripDateTime,
  } = props;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <section className="shrink-0 rounded-sm bg-[#20242d] p-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-[#173d4a] text-cyan-200">
            <Route className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-100">轨迹溯源 (F1-F2)</div>
            <div className="mt-0.5 text-[10px] leading-relaxed text-slate-500">探查单车行为与路网匹配精度</div>
          </div>
        </div>
      </section>

      <section className="shrink-0 rounded-sm bg-[#20242d] p-2.5">
        <div className="flex items-center rounded-sm border border-[#34414c] bg-[#151a22] px-3 py-1.5 transition focus-within:border-cyan-300/40">
          <Search className="mr-2 h-4 w-4 text-slate-500" />
          <input
            value={targetTaxiId}
            onChange={(event) => onTargetTaxiIdChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && status !== 'computing') {
                event.preventDefault();
                if (onSubmitTrajectorySearch()) onRunCompute();
              }
            }}
            readOnly={demoReadonly}
            placeholder="输入出租车 ID"
            className={`min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-600 ${demoReadonly ? 'cursor-not-allowed text-slate-400' : 'text-slate-100'}`}
          />
          <button
            type="button"
            onClick={() => {
              if (onSubmitTrajectorySearch()) onRunCompute();
            }}
            disabled={!hasTrajectoryInput}
            className="grid h-7 w-7 place-items-center rounded-sm bg-cyan-300/12 text-cyan-200 transition hover:bg-cyan-300/20"
            title="查询车辆"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-1.5 text-[10px] text-slate-500">全量车辆范围：1-10357</div>

        <div className="mt-2 space-y-1.5">
          <button
            type="button"
            onClick={onToggleMatchedMode}
            className="flex w-full items-center justify-between gap-3 rounded-sm bg-[#252b35] px-3 py-1.5 text-left transition hover:bg-[#2b3743]"
          >
            <span className="text-xs font-semibold text-slate-200">
              路网模式：{showMatchedMode ? '匹配轨迹 + 停留段' : '原始全部轨迹'}
            </span>
            <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${showMatchedMode ? 'bg-blue-500' : 'bg-slate-600'}`}>
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${showMatchedMode ? 'left-6' : 'left-1'}`} />
            </span>
          </button>

          <button
            type="button"
            onClick={onToggleMapVMode}
            className="flex w-full items-center justify-between gap-3 rounded-sm bg-[#252b35] px-3 py-1.5 text-left transition hover:bg-[#2b3743]"
          >
            <span className="text-xs font-semibold text-slate-200">
              渲染模式：{useMapVMode ? '海量线段 MapV' : '普通线段'}
            </span>
            <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${useMapVMode ? 'bg-blue-500' : 'bg-slate-600'}`}>
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${useMapVMode ? 'left-6' : 'left-1'}`} />
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={onRunCompute}
          disabled={status === 'computing' || !hasTrajectoryInput}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-sm bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-wait disabled:bg-blue-600/55"
        >
          {status === 'computing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
          {status === 'computing' ? '查询中...' : '查询轨迹'}
        </button>

        <div className="mt-2 rounded-sm border border-cyan-300/12 bg-cyan-300/[0.06] p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] text-slate-500">当前目标</div>
            <span className="rounded-sm bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">
              {trajectoryTarget ? `ID #${trajectoryTarget}` : '未选择'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-sm bg-[#151a22]/70 p-1.5">
              <div className="text-sm font-semibold text-cyan-50">{tripCards.length ? tripCards.reduce((sum, trip) => sum + trip.distanceKm, 0).toFixed(1) : '--'}</div>
              <div className="mt-0.5 text-[10px] text-slate-500">总里程 km</div>
            </div>
            <div className="rounded-sm bg-[#151a22]/70 p-1.5">
              <div className="text-sm font-semibold text-cyan-50">{tripCards.length ? formatInt(tripCards.length) : '--'}</div>
              <div className="mt-0.5 text-[10px] text-slate-500">记录行程</div>
            </div>
            <div className="rounded-sm bg-[#151a22]/70 p-1.5">
              <div className="text-sm font-semibold text-cyan-50">{tripCards.length ? formatInt(tripCards.reduce((sum, trip) => sum + trip.points, 0)) : '--'}</div>
              <div className="mt-0.5 text-[10px] text-slate-500">坐标点</div>
            </div>
          </div>
        </div>
      </section>

      <section className="min-h-0 flex-1 rounded-sm bg-[#20242d] p-2.5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="whitespace-nowrap text-sm font-semibold text-slate-100">行程明细</div>
          <button type="button" onClick={onToggleShowOtherTrips} className="flex shrink-0 items-center gap-2 text-[11px] text-slate-500 transition hover:text-cyan-200">
            显示其他轨迹
            <span className={`relative h-5 w-9 rounded-full transition ${showOtherTrips ? 'bg-blue-500' : 'bg-slate-600'}`}>
              <span className={`absolute top-1 h-3 w-3 rounded-full bg-white transition ${showOtherTrips ? 'left-5' : 'left-1'}`} />
            </span>
          </button>
        </div>

        <div className="h-[calc(100%-2rem)] space-y-2 overflow-y-auto pr-1">
          {!tripCards.length ? (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-sm border border-dashed border-[#34414c] bg-[#151a22]/50 px-4 text-center">
              <Route className="h-7 w-7 text-slate-600" />
              <div className="mt-3 text-sm font-semibold text-slate-300">暂无行程数据</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-500">输入车辆 ID 后点击“查询轨迹”。</div>
            </div>
          ) : tripCards.map((trip) => {
            const selected = selectedTripId === trip.id;
            const matched = trip.status === 'matched';
            const isPlaybackTrip = playbackState.tripId === trip.id;
            const isPlayingTrip = isPlaybackTrip && playbackState.status === 'playing';
            const canRestorePlayback = isPlaybackTrip && playbackState.status !== 'idle';

            return (
              <div
                key={trip.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectTrip(trip.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectTrip(trip.id);
                  }
                }}
                className={`w-full rounded-sm border p-3 text-left transition ${
                  selected
                    ? 'border-cyan-300/40 bg-cyan-300/[0.08] shadow-[0_0_24px_rgba(34,211,238,0.08)]'
                    : 'border-[#343b46] bg-[#252b35] hover:border-cyan-300/20 hover:bg-[#2b3743]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate font-semibold text-slate-100">Trip {trip.tripId || trip.index}</div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      title={isPlayingTrip ? '暂停回放' : '从起点回放此段'}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleTripPlayback(trip);
                      }}
                      className={`grid h-[22px] w-[22px] place-items-center rounded-sm border transition ${
                        isPlayingTrip
                          ? 'border-amber-200/30 bg-amber-300/14 text-amber-100 hover:bg-amber-300/22'
                          : 'border-cyan-200/20 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/18'
                      }`}
                    >
                      {isPlayingTrip ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 fill-current" />}
                    </button>
                    <button
                      type="button"
                      title="还原完整轨迹"
                      disabled={!canRestorePlayback}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRestoreTripPlayback(trip.id);
                      }}
                      className="grid h-[22px] w-[22px] place-items-center rounded-sm border border-slate-500/20 bg-slate-900/40 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <RotateCw className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      title="导出 JSON"
                      onClick={(event) => {
                        event.stopPropagation();
                        onExportTripJson(trip);
                      }}
                      className="grid h-[22px] w-[22px] place-items-center rounded-sm border border-slate-500/20 bg-slate-900/50 text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
                    >
                      <Download className="h-3 w-3" />
                    </button>
                    <div className="pl-1 text-[10px] text-slate-500">{formatInt(trip.points)} 点</div>
                  </div>
                </div>

                <div className="mt-3 space-y-1.5 text-[11px] text-slate-400">
                  {trip.taxiId != null && !trajectoryTarget ? <div>车辆：Taxi #{trip.taxiId}</div> : null}
                  <div>起点：{formatTripDateTime(trip.startTime)}</div>
                  <div>终点：{formatTripDateTime(trip.endTime)}</div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-sm border border-emerald-300/20 bg-emerald-300/[0.08] px-2 py-1 font-semibold text-emerald-100">{trip.distanceKm.toFixed(1)} km</span>
                  <span className="rounded-sm border border-blue-300/20 bg-blue-300/[0.08] px-2 py-1 font-semibold text-blue-100">{trip.duration}</span>
                  <span className={`rounded-sm border px-2 py-1 font-semibold ${matched ? 'border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100' : 'border-amber-300/20 bg-amber-300/[0.08] text-amber-100'}`}>
                    {matched ? '匹配' : '原始'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
