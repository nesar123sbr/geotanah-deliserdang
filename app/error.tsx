'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';
import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GeoTanah Dairi Runtime Error]:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-slate-900/90 p-6 text-center shadow-2xl backdrop-blur-md space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
          <AlertTriangle className="h-7 w-7" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-slate-100">Gangguan Sistem Kadastral</h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            Terjadi kesalahan saat memproses data spasial atau koneksi ke database.
          </p>
        </div>
        <div className="rounded-xl bg-slate-950 p-3 text-left font-mono text-[11px] text-rose-400 overflow-x-auto border border-slate-800/80">
          {error.message || 'Kesalahan runtime tidak terduga.'}
        </div>
        <div className="flex gap-2.5 pt-2">
          <button
            type="button"
            onClick={() => reset()}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 text-xs font-semibold shadow-md active:scale-95 transition-all"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Coba Lagi</span>
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2.5 text-xs font-medium active:scale-95 transition-all"
          >
            <Home className="h-3.5 w-3.5" />
            <span>Dashboard</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
