import React from 'react';
import { ArrowLeft, Map, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

interface GeoWorkbenchSidebarProps {
  collapsed: boolean;
  title: string;
  subtitle: string;
  showBack: boolean;
  onBack: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  demoActive?: boolean;
  onDemoToggle?: () => void;
  children: React.ReactNode;
}

export default function GeoWorkbenchSidebar({
  collapsed,
  title,
  subtitle,
  showBack,
  onBack,
  onCollapse,
  onExpand,
  demoActive = false,
  onDemoToggle,
  children,
}: GeoWorkbenchSidebarProps) {
  return (
    <>
      {collapsed ? (
        <button
          type="button"
          title="Expand sidebar"
          onClick={onExpand}
          className="fixed left-4 top-4 z-20 grid h-8 w-8 place-items-center rounded-sm bg-[#8b95a4] text-[#0f1720] shadow-[0_10px_28px_rgba(0,0,0,0.3)] transition duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#a6afbb]"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      ) : null}

      <aside className={`fixed bottom-0 left-0 top-0 z-20 flex w-[420px] flex-col border-r border-[#34414c] bg-[#20242d]/92 shadow-[12px_0_36px_rgba(0,0,0,0.38)] backdrop-blur-md transition duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${collapsed ? 'pointer-events-none -translate-x-full opacity-0' : 'translate-x-0 opacity-100'}`}>
        <div className="border-b border-[#343b46] bg-[#2a333d]/90 px-4 py-3 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-[#233f4b]">
                <Map className="h-4 w-4 text-cyan-300" />
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="truncate text-sm font-bold text-slate-100">{title}</div>
                  {onDemoToggle ? (
                    <button
                      type="button"
                      onClick={onDemoToggle}
                      className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-black tracking-wide transition ${demoActive ? 'border-cyan-300/35 bg-cyan-300/14 text-cyan-100' : 'border-slate-600/70 bg-[#1b2330] text-slate-400 hover:border-cyan-300/30 hover:text-cyan-200'}`}
                      title={demoActive ? '?? Demo ????' : '?? Demo ????'}
                    >
                      DEMO
                    </button>
                  ) : null}
                </div>
                <div className="mt-1 text-[11px] tracking-[0.16em] text-slate-500">{subtitle}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {showBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5 text-[7px] text-slate-500 transition hover:bg-[#34414c] hover:text-cyan-200"
                >
                  <ArrowLeft className="h-2 w-2" />
                  返回总览
                </button>
              ) : null}
              <button
                type="button"
                title="折叠侧边栏"
                onClick={onCollapse}
                className="grid h-8 w-8 place-items-center rounded-sm text-slate-400 transition hover:bg-[#34414c] hover:text-cyan-200"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full overflow-hidden p-3 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]">
            {children}
          </div>
        </div>
      </aside>
    </>
  );
}
