import React from 'react';
import { Activity, CalendarDays, CarFront, Database, Sparkles } from 'lucide-react';

interface DatasetSummaryLike {
  vehicle_count?: number;
  point_count?: number;
  trip_count?: number;
  coordinate_system?: string;
  taxi_id_range?: { max?: number };
}

interface OverviewStatsLike {
  summaryLoaded: boolean;
  error?: string;
}

interface AnalysisEntryLike {
  mode: 'trajectory' | 'region' | 'decision';
  title: string;
  description: string;
  icon: React.ElementType;
}

interface GeoWorkbenchOverviewPanelProps {
  summary: DatasetSummaryLike | null;
  overviewStats: OverviewStatsLike;
  analysisEntries: AnalysisEntryLike[];
  onEnterMode: (mode: 'trajectory' | 'region' | 'decision') => void;
  formatInt: (value: number | null | undefined) => string;
  formatCompact: (value: number | null | undefined) => string;
  formatDateRange: (summary: DatasetSummaryLike | null) => string;
  formatBoundaryShare: (summary: DatasetSummaryLike | null) => string;
}

export default function GeoWorkbenchOverviewPanel({
  summary,
  overviewStats,
  analysisEntries,
  onEnterMode,
  formatInt,
  formatCompact,
  formatDateRange,
  formatBoundaryShare,
}: GeoWorkbenchOverviewPanelProps) {
  return (
    <div className="flex min-h-full flex-col gap-2">
      <section className="rounded-sm bg-[#20242d] p-2.5">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Database className="h-4 w-4 text-cyan-300" />
              数据底座：T-Driver 2008
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">北京出租车 GPS 样本</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-sm bg-[#26313d] p-2.5">
            <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-sm bg-[#173d4a] text-cyan-200">
              <CarFront className="h-4 w-4" />
            </div>
            <div className="text-xl font-semibold tracking-tight text-cyan-50">{overviewStats.summaryLoaded ? formatInt(summary?.vehicle_count) : '--'}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">采样车辆</div>
          </div>
          <div className="rounded-sm bg-[#26313d] p-2.5">
            <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-sm bg-[#2f3d58] text-blue-200">
              <Activity className="h-4 w-4" />
            </div>
            <div className="text-xl font-semibold tracking-tight text-blue-50">{overviewStats.summaryLoaded ? formatCompact(summary?.point_count) : '--'}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">轨迹点位</div>
          </div>
        </div>

        <div className="mt-2">
          <div className="rounded-sm bg-[#252b35] p-2.5">
            <div className="flex items-center gap-2 text-slate-400">
              <CalendarDays className="h-3.5 w-3.5 text-cyan-300" />
              <span className="text-[10px] uppercase tracking-[0.16em]">时序范围</span>
            </div>
            <div className="mt-1.5 text-lg font-semibold tracking-tight text-slate-100">{formatDateRange(summary)}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">观测周期 · 7 Days</div>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-sm bg-[#1c212a] p-1.5">
            <div className="text-sm font-semibold text-slate-100">{overviewStats.summaryLoaded ? formatCompact(summary?.trip_count) : '--'}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">行程总数</div>
          </div>
          <div className="rounded-sm bg-[#1c212a] p-1.5">
            <div className="text-sm font-semibold text-slate-100">{summary?.coordinate_system ?? 'WGS-84'}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">坐标系统</div>
          </div>
          <div className="rounded-sm bg-[#1c212a] p-1.5">
            <div className="text-sm font-semibold text-slate-100">{formatInt(summary?.taxi_id_range?.max)}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">最大车辆 ID</div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          {[
            `边界内点位 ${formatBoundaryShare(summary)}`,
            '已清洗',
            '已路网匹配',
          ].map((label, index) => (
            <span
              key={label}
              className={`rounded-sm border px-2 py-0.5 text-[10px] ${
                index === 0
                  ? 'border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100/85'
                  : 'border-cyan-300/15 bg-cyan-300/[0.07] text-cyan-100/85'
              }`}
            >
              {label}
            </span>
          ))}
        </div>

        {overviewStats.error ? <div className="mt-2 rounded border border-amber-300/20 bg-amber-300/8 p-1.5 text-[11px] text-amber-100">{overviewStats.error}</div> : null}
      </section>

      <section className="rounded-sm bg-[#20242d] p-2.5">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Sparkles className="h-4 w-4 text-cyan-300" />
          分析模块
        </div>
        <div className="space-y-1.5">
          {analysisEntries.map(({ mode, title, description, icon: Icon }) => (
            <button
              key={mode}
              type="button"
              onClick={() => onEnterMode(mode)}
              className="group flex w-full items-center gap-3 rounded-sm bg-[#252b35] p-2.5 text-left transition hover:bg-[#2b3743]"
            >
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-[#173d4a] text-cyan-200 transition group-hover:bg-[#1c4d5b] group-hover:text-cyan-100">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-slate-100">{title}</div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{description}</div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
