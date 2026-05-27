import React from 'react';

interface GeoWorkbenchShellProps {
  mapStage: React.ReactNode;
  mapStatus: React.ReactNode;
  mapTools: React.ReactNode;
  sidebar: React.ReactNode;
  timeline: React.ReactNode;
}

export default function GeoWorkbenchShell({
  mapStage,
  mapStatus,
  mapTools,
  sidebar,
  timeline,
}: GeoWorkbenchShellProps) {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0B0E14] text-slate-300 [font-family:'Inter','Roboto_Mono','Noto_Sans_SC',sans-serif]">
      {mapStage}
      {mapStatus}
      {mapTools}
      {sidebar}
      {timeline}
    </main>
  );
}
