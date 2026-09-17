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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl text-slate-100 space-y-5 backdrop-blur-md">
        {/* Header Modal */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-950/80 border border-emerald-700/60 flex items-center justify-center text-emerald-400 shrink-0 shadow-sm">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h2 id="export-modal-title" className="text-base font-bold text-white tracking-tight">
                Export Geodatabase Lengkap
              </h2>
              <p className="text-xs text-slate-400">
                Paket arsip ZIP untuk pelaporan & penyerahan unit kerja Kantah Dairi
              </p>
            </div>
          </div>
          {!isExporting && (
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              aria-label="Tutup modal"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Ringkasan Isi Berkas */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2 text-xs">
          <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px] block">
            Struktur Berkas Geodatabase (ZIP)
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-300">
            <div className="flex items-center gap-2">
              <Map className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>/geojson/all_parcels.geojson</span>
            </div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-3.5 w-3.5 text-blue-400 shrink-0" />
              <span>/csv/parcels_attributes.csv</span>
            </div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-3.5 w-3.5 text-purple-400 shrink-0" />
              <span>/csv/rekap_per_desa.csv</span>
            </div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span>/csv/rekap_per_program.csv</span>
            </div>
          </div>
        </div>

        {/* Opsi Unduh Foto */}
        {!isExporting ? (
          <div className="space-y-3">
            <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-800 bg-slate-950/40 hover:bg-slate-800/40 transition-colors cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includePhotos}
                onChange={(e) => setIncludePhotos(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-800 text-emerald-600 focus:ring-emerald-500 focus:ring-offset-slate-900 cursor-pointer"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-200">
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

            {/* Info Estimasi Ukuran & Waktu */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-950/40 border border-slate-800/80 text-[11px]">
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
          /* Progress Indicator saat Proses Berjalan */
          <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/20 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="text-emerald-300 flex items-center gap-2">
                <LoaderCircle className="h-4 w-4 animate-spin text-emerald-400" />
                {progressText || 'Memproses berkas geodatabase...'}
              </span>
              <span className="text-emerald-400 font-mono font-bold">
                {Math.round(progressPercent)}%
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300 ease-out"
                style={{ width: `${Math.max(5, Math.min(100, progressPercent))}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-400 italic text-center">
              Harap jangan menutup halaman selama proses pembuatan arsip berlangsung.
            </p>
          </div>
        )}

        {/* Footer Tombol Aksi */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800/80">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700/80 text-xs font-medium text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            Batalkan
          </button>
          <button
            type="button"
            onClick={() => onStartExport(includePhotos)}
            disabled={isExporting}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white flex items-center gap-2 shadow-md shadow-emerald-950/50 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
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
  );
}
