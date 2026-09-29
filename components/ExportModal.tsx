'use client';

import { useState } from 'react';
import { Download, X, Database, FileSpreadsheet, Map, AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  isExporting: boolean;
  progressText: string;
  progressPercent: number;
  onClose: () => void;
  onStartExport: (includePhotos: boolean) => void;
}

export default function ExportModal({
  isOpen,
  isExporting,
  progressText,
  progressPercent,
  onClose,
  onStartExport,
}: ExportModalProps) {
  const [includePhotos, setIncludePhotos] = useState(false);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-lg rounded-3xl border border-slate-800/80 bg-slate-900 overflow-hidden shadow-2xl shadow-black/40">
        {/* Decorative top accent */}
        <div className="h-0.5 w-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-500" />

        <div className="p-6 sm:p-7 space-y-5">
          {/* ── Header ─────────────────────────────────────────────────── */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-700/20 border border-emerald-600/30 flex items-center justify-center text-emerald-400 shrink-0">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <h2 id="export-modal-title" className="text-base font-bold text-white tracking-tight">
                  Export Geodatabase Lengkap
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Paket arsip ZIP untuk pelaporan & penyerahan unit kerja Kantah Dairi
                </p>
              </div>
            </div>
            {!isExporting && (
              <button
                onClick={onClose}
                type="button"
                aria-label="Tutup modal export"
                className="h-8 w-8 flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* ── File Structure Panel ────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-2.5 text-xs">
            <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px] block mb-3">
              Struktur Berkas Geodatabase (ZIP)
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-slate-300">
              <div className="flex items-center gap-2 py-0.5">
                <Map className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>/geojson/all_parcels.geojson</span>
              </div>
              <div className="flex items-center gap-2 py-0.5">
                <Map className="h-3.5 w-3.5 text-teal-400 shrink-0" />
                <span>/kml/all_parcels.kml (Google Earth)</span>
              </div>
              <div className="flex items-center gap-2 py-0.5">
                <Map className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                <span>/gpx/all_parcels.gpx (GPS / Avenza)</span>
              </div>
              <div className="flex items-center gap-2 py-0.5">
                <FileSpreadsheet className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <span>/csv/parcels_attributes.csv</span>
              </div>
              <div className="flex items-center gap-2 py-0.5">
                <FileSpreadsheet className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                <span>/csv/rekap_per_desa.csv</span>
              </div>
              <div className="flex items-center gap-2 py-0.5">
                <FileSpreadsheet className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span>/csv/rekap_per_program.csv</span>
              </div>
            </div>
          </div>

          {/* ── Options & Progress ──────────────────────────────────────── */}
          {!isExporting ? (
            <div className="space-y-3">
              {/* Photo checkbox option */}
              <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-800 bg-slate-950/40 hover:bg-slate-800/40 hover:border-slate-700 transition-colors cursor-pointer select-none group">
                <input
                  type="checkbox"
                  checked={includePhotos}
                  onChange={(e) => setIncludePhotos(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-800 text-emerald-600 focus:ring-emerald-500 focus:ring-offset-slate-900 cursor-pointer"
                />
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-200 group-hover:text-white transition-colors">
                      Sertakan foto lapangan sensus
                    </span>
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800 text-emerald-400 font-mono">
                      800px WebP
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {includePhotos
                      ? 'Foto lapangan akan diunduh dengan optimasi 800px WebP q55 (~100 KB/foto) untuk menghemat kuota cloud Supabase.'
                      : 'Tidak menyertakan foto. Ekspor hanya data spasial & tabular (< 1 MB, proses instan).'}
                  </p>
                </div>
              </label>

              {/* Size / time estimate */}
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-950/50 border border-slate-800/80 text-[11px]">
                {includePhotos ? (
                  <>
                    <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
                    <span className="text-amber-300">
                      Estimasi ukuran ZIP: <strong className="text-white">1–5 MB</strong> · Durasi unduh: <strong className="text-white">30–60 detik</strong>
                    </span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="text-emerald-300">
                      Estimasi ukuran ZIP: <strong className="text-white">&lt; 1 MB</strong> · Durasi unduh: <strong className="text-white">Instan (&lt; 2 detik)</strong>
                    </span>
                  </>
                )}
              </div>
            </div>
          ) : (
            /* Progress indicator */
            <div className="rounded-2xl border border-emerald-900/60 bg-emerald-950/20 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-emerald-300 flex items-center gap-2">
                  <LoaderCircle className="h-4 w-4 animate-spin text-emerald-400" />
                  {progressText || 'Memproses berkas geodatabase...'}
                </span>
                <span className="text-emerald-400 font-mono font-bold tabular-nums">
                  {Math.round(progressPercent)}%
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 w-full rounded-full bg-slate-800/80 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-400 transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(5, Math.min(100, progressPercent))}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-500 italic text-center">
                Harap jangan menutup halaman selama proses pembuatan arsip berlangsung.
              </p>
            </div>
          )}

          {/* ── Footer Actions ───────────────────────────────────────────── */}
          <div className="border-t border-slate-800/80 pt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting}
              className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer"
            >
              Batalkan
            </button>
            <button
              type="button"
              onClick={() => onStartExport(includePhotos)}
              disabled={isExporting}
              className="px-5 py-2 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-xs font-bold text-white flex items-center gap-2 shadow-lg shadow-emerald-900/30 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer"
            >
              {isExporting ? (
                <>
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  <span>Memproses Arsip...</span>
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  <span>Mulai Export ZIP</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
