import React from 'react';

interface GeoWorkbenchMapStageProps {
  leftOffset: string;
  mapContainerRef: React.RefObject<HTMLDivElement>;
  sdkStatus: 'idle' | 'loading' | 'ready' | 'error';
  sdkError?: string | null;
  mapReady: boolean;
}

export default function GeoWorkbenchMapStage({
  leftOffset,
  mapContainerRef,
  sdkStatus,
  sdkError,
  mapReady,
}: GeoWorkbenchMapStageProps) {
  return (
    <div
      className="absolute bottom-0 right-0 top-0 z-0 bg-[#0B0E14] transition-[left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{ left: leftOffset }}
    >
      <div ref={mapContainerRef} className="absolute inset-0 h-full w-full [&_.amap-copyright]:opacity-40 [&_.amap-logo]:opacity-60 [&_img]:max-w-none" />
      {sdkStatus !== 'ready' ? (
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.055)_1px,transparent_1px)] bg-[size:48px_48px]" />
      ) : null}
      {sdkStatus === 'loading' ? (
        <div className="absolute left-1/2 top-1/2 rounded-sm bg-[#20242d]/90 px-4 py-2 text-xs text-slate-300">
          高德地图加载中...
        </div>
      ) : null}
      {sdkStatus === 'error' ? (
        <div className="absolute left-1/2 top-1/2 max-w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-sm border border-amber-300/20 bg-[#2a2420]/90 px-4 py-3 text-xs leading-relaxed text-amber-100">
          高德地图加载失败：{sdkError}
        </div>
      ) : null}
      {sdkStatus === 'ready' && !mapReady ? (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 rounded-sm bg-[#20242d]/90 px-4 py-2 text-xs text-slate-300">
          底图渲染中...
        </div>
      ) : null}
    </div>
  );
}
