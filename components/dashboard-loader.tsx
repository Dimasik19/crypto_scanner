"use client";

import dynamic from "next/dynamic";

const AssetCycleDashboard = dynamic(
  () => import("@/components/asset-cycle-dashboard").then((mod) => mod.AssetCycleDashboard),
  {
    ssr: false,
    loading: () => (
      <main className="terminal-grid min-h-screen px-4 py-4 text-slate-100 md:px-6">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-4">
          <header className="flex min-h-16 items-center border border-grid bg-ink/92 px-4 py-3 shadow-terminal">
            <div>
              <h1 className="text-xl font-semibold text-white">Value Growth Tool</h1>
              <p className="font-mono text-xs text-slate-400">loading terminal...</p>
            </div>
          </header>
        </div>
      </main>
    )
  }
);

export function DashboardLoader() {
  return <AssetCycleDashboard />;
}
