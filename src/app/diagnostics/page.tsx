import Link from "next/link";

import { AzureControlPlane } from "@/components/AzureControlPlane";

export default function DiagnosticsPage() {
  return (
    <main className="min-h-screen px-4 py-5 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-slate-300 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-sm font-semibold text-blue-700">
              Developer diagnostics
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-slate-950">
              Azure Diagnostics
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              This page is for Azure connection checks and guarded PR write
              validation. It is intentionally outside the ordinary request-first
              workflow.
            </p>
          </div>
          <Link
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
            href="/"
          >
            Back to workflow
          </Link>
        </header>
        <AzureControlPlane />
      </div>
    </main>
  );
}
