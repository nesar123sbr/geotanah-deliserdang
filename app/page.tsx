'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase, ParcelData } from '@/lib/supabase';
import { 
  ShieldCheck, AlertTriangle, Layers, 
  FileCheck2, Compass, Activity, CheckCircle2, ChevronRight, HelpCircle
} from 'lucide-react';

const ParcelMap = dynamic(() => import('@/components/ParcelMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-slate-950 text-slate-400 font-mono text-xs">
      Memuat Mesin Spasial Leaflet...
    </div>
  ),
});

export default function Dashboard() {
  const [parcels, setParcels] = useState<ParcelData[]>([]);
  const [selectedParcel, setSelectedParcel] = useState<ParcelData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchParcels() {
      const { data, error } = await supabase.rpc('get_parcels_with_metrics');
      if (error) {
        console.error('Error memuat data persil:', error);
      } else if (data) {
        setParcels(data);
        if (data.length > 0) setSelectedParcel(data[0]);
      }
      setLoading(false);
    }
    fetchParcels();
  }, []);

  // Logika Filter Metrik Matematika Konsisten
  const totalParcels = parcels.length;
  const conflictCount = parcels.filter(p => p.is_overlapping || p.status === 'Tumpang Tindih').length;
  const verificationCount = parcels.filter(
    p => !p.is_overlapping && p.status !== 'Tumpang Tindih' && (Number(p.deviation_percent) > 2.0 || p.status === 'Perlu Verifikasi')
  ).length;
  const validCount = parcels.filter(
    p => !p.is_overlapping && p.status === 'Terverifikasi' && Number(p.deviation_percent) <= 2.0
  ).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
      {/* Top Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur px-6 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-sm sm:text-base tracking-tight text-white">GeoTanah Deli Serdang</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-950 border border-emerald-800 text-emerald-400">
                PostGIS Spheroid
              </span>
            </div>
            <p className="text-xs text-slate-400">Monitoring & Validasi Spasial Bidang Tanah PTSL</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700 px-3 py-1.5 rounded-lg text-xs">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-slate-300 hidden sm:inline">Kantah Kab. Deli Serdang</span>
        </div>
      </header>

      {/* Bento Grid */}
      <main className="flex-1 p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 max-w-[1700px] w-full mx-auto">
        
        {/* Panel Kiri (3 Col) */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          
          {/* Bento Card: 4 KPI Metrics (Grid 2x2 - Konsisten 1 + 1 + 2 = 4) */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
              <span className="text-[11px] text-slate-400">Total NIB</span>
              <div className="text-lg font-bold text-white mt-0.5">{totalParcels}</div>
              <span className="text-[10px] text-slate-500">Persil Masuk</span>
            </div>
            <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-3">
              <span className="text-[11px] text-emerald-400">Valid (K1)</span>
              <div className="text-lg font-bold text-emerald-300 mt-0.5">{validCount}</div>
              <span className="text-[10px] text-emerald-500">Siap Terbit</span>
            </div>
            <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-3">
              <span className="text-[11px] text-amber-400">Verifikasi</span>
              <div className="text-lg font-bold text-amber-300 mt-0.5">{verificationCount}</div>
              <span className="text-[10px] text-amber-500">Deviasi &gt; 2%</span>
            </div>
            <div className="bg-rose-950/30 border border-rose-800/50 rounded-xl p-3">
              <span className="text-[11px] text-rose-400">Tumpang Tindih</span>
              <div className="text-lg font-bold text-rose-300 mt-0.5">{conflictCount}</div>
              <span className="text-[10px] text-rose-500">Sengketa Batas</span>
            </div>
          </div>

          {/* List Persil */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex-1 flex flex-col min-h-[300px]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-emerald-400" /> Daftar Persil Tanah
              </h2>
              <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400">Lubuk Pakam</span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[440px]">
              {loading ? (
                <div className="text-xs text-slate-500 text-center py-8">Mengambil data dari Supabase...</div>
              ) : (
                parcels.map((parcel) => (
                  <button
                    key={parcel.id}
                    onClick={() => setSelectedParcel(parcel)}
                    className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between ${
                      selectedParcel?.id === parcel.id
                        ? 'bg-emerald-950/40 border-emerald-500/60 shadow-sm'
                        : 'bg-slate-950/40 border-slate-800/80 hover:bg-slate-850'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-mono font-medium text-slate-200">{parcel.nib}</div>
                      <div className="text-[11px] text-slate-400">{parcel.owner_name}</div>
                      <div className="text-[10px] text-slate-500">{parcel.village}</div>
                    </div>
                    <ChevronRight className={`h-4 w-4 ${selectedParcel?.id === parcel.id ? 'text-emerald-400' : 'text-slate-600'}`} />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Panel Peta Tengah (6 Col) */}
        <div className="lg:col-span-6 bg-slate-900/80 border border-slate-800 rounded-2xl p-2 min-h-[450px] lg:min-h-[580px] shadow-xl relative">
          <div className="absolute top-4 left-4 z-10 bg-slate-900/90 backdrop-blur border border-slate-700 px-3 py-1.5 rounded-lg text-xs flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-slate-300 font-medium">Digital Cadastral Viewer</span>
          </div>
          <ParcelMap 
            parcels={parcels} 
            selectedParcel={selectedParcel} 
            onSelectParcel={setSelectedParcel} 
          />
        </div>

        {/* Panel Kanan (3 Col) */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Inspector Bidang
            </h2>

            {selectedParcel ? (
              <div className="space-y-4 text-xs">
                
                {/* Status Pill Card Dinamis */}
                {(() => {
                  const isConflict = selectedParcel.is_overlapping || selectedParcel.status === 'Tumpang Tindih';
                  const isWarning = !isConflict && (Number(selectedParcel.deviation_percent) > 2.0 || selectedParcel.status === 'Perlu Verifikasi');

                  if (isConflict) {
                    return (
                      <div className="p-3 rounded-xl border flex items-center gap-3 bg-rose-950/40 border-rose-800 text-rose-300">
                        <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400" />
                        <div>
                          <div className="font-bold text-xs">Tumpang Tindih Terdeteksi</div>
                          <div className="text-[10px] opacity-80">Batas berpotongan dengan persil lain</div>
                        </div>
                      </div>
                    );
                  }

                  if (isWarning) {
                    return (
                      <div className="p-3 rounded-xl border flex items-center gap-3 bg-amber-950/40 border-amber-800 text-amber-300">
                        <HelpCircle className="h-5 w-5 shrink-0 text-amber-400" />
                        <div>
                          <div className="font-bold text-xs">Perlu Verifikasi Ulang</div>
                          <div className="text-[10px] opacity-80">Deviasi luas melebihi toleransi (&gt;2%)</div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="p-3 rounded-xl border flex items-center gap-3 bg-emerald-950/40 border-emerald-800 text-emerald-300">
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                      <div>
                        <div className="font-bold text-xs">Terverifikasi (Valid)</div>
                        <div className="text-[10px] opacity-80">Lolos toleransi luas & topologi</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Info NIB */}
                <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800 space-y-1.5 font-mono text-[11px]">
                  <div className="flex justify-between pb-1 border-b border-slate-800">
                    <span className="text-slate-500 font-sans">NIB</span>
                    <span className="text-slate-200">{selectedParcel.nib}</span>
                  </div>
                  <div className="flex justify-between pb-1 border-b border-slate-800">
                    <span className="text-slate-500 font-sans">Pemilik</span>
                    <span className="text-slate-200 font-sans">{selectedParcel.owner_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-sans">Desa</span>
                    <span className="text-slate-200 font-sans">{selectedParcel.village}</span>
                  </div>
                </div>

                {/* Perhitungan Luas */}
                <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800 space-y-2">
                  <span className="text-[10px] font-semibold text-slate-400 block uppercase">
                    Kalkulasi Luas (Meter²)
                  </span>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Surat Ukur:</span>
                    <span className="font-mono text-slate-200">{selectedParcel.legal_area_m2} m²</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Hitung Spasial:</span>
                    <span className="font-mono text-emerald-400">{selectedParcel.spatial_area_m2} m²</span>
                  </div>
                  <div className="pt-1.5 border-t border-slate-800 flex justify-between text-xs">
                    <span className="text-slate-400">Margin Deviasi:</span>
                    <span className={`font-mono font-bold ${
                      Number(selectedParcel.deviation_percent) > 2.0 ? 'text-amber-400' : 'text-emerald-400'
                    }`}>
                      {Number(selectedParcel.deviation_percent).toFixed(2)}%
                    </span>
                  </div>
                </div>

                {/* Catatan Juru Ukur */}
                <div className="bg-slate-950/40 rounded-xl p-2.5 border border-slate-800">
                  <span className="text-[10px] text-slate-500 block mb-0.5 uppercase font-semibold">Catatan Survei</span>
                  <p className="text-[11px] text-slate-300 italic">
                    &quot;{selectedParcel.surveyor_notes || '-'}&quot;
                  </p>
                </div>

                <button 
                  onClick={() => alert(`BAP NIB ${selectedParcel.nib} siap dicetak.`)}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <FileCheck2 className="h-4 w-4" /> Cetak Berita Acara
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}