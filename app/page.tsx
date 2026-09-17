'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { supabase, type ParcelData } from '@/lib/supabase';
import { 
  ShieldCheck, AlertTriangle, Layers, 
  Compass, Activity, CheckCircle2, ChevronRight, HelpCircle,
  Download, FileCode, Search
} from 'lucide-react';

const ParcelMap = dynamic(() => import('@/components/ParcelMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-slate-950 text-slate-400 font-mono text-xs">
      Memuat Mesin Spasial Leaflet Sidikalang...
    </div>
  ),
});

export default function Dashboard() {
  const [parcels, setParcels] = useState<ParcelData[]>([]);
  const [selectedParcel, setSelectedParcel] = useState<ParcelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<'SEMUA' | 'KW1' | 'KW456' | 'CONFLICT'>('SEMUA');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Jeda pencarian agar performa web tetap cepat
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim().toLowerCase());
    }, 200);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  // Reset tab filter ke 'SEMUA' saat user mengetik pencarian
  useEffect(() => {
    if (searchQuery) setFilterTab('SEMUA');
  }, [searchQuery]);

  useEffect(() => {
    async function fetchParcels() {
      const { data, error } = await supabase.rpc('get_parcels_with_metrics_v2', {
        p_dataset_key: 'dairi-demo'
      });

      if (error) {
        console.error('Error memuat data persil Dairi:', error);
      } else if (data) {
        setParcels(data);
        if (data.length > 0) setSelectedParcel(data[0]);
      }
      setLoading(false);
    }
    fetchParcels();
  }, []);

  const totalParcels = parcels.length;
  const kw1Count = parcels.filter(p => p.kkp_category === 'KW 1').length;
  const kw456Count = parcels.filter(p => 
    p.kkp_category ? ['KW 4', 'KW 5', 'KW 6'].includes(p.kkp_category) : false
  ).length;
  const conflictCount = parcels.filter(p => p.is_overlapping === true || p.status === 'Tumpang Tindih').length;

  // Logika Filter Gabungan (Pencarian + Kategori Tab)
  const filteredParcels = parcels.filter((p) => {
    let matchTab = true;
    if (filterTab === 'KW1') {
      matchTab = p.kkp_category === 'KW 1';
    } else if (filterTab === 'KW456') {
      matchTab = p.kkp_category ? ['KW 4', 'KW 5', 'KW 6'].includes(p.kkp_category) : false;
    } else if (filterTab === 'CONFLICT') {
      matchTab = p.is_overlapping === true || p.status === 'Tumpang Tindih';
    }

    let matchSearch = true;
    if (debouncedQuery) {
      matchSearch = p.nib.toLowerCase().includes(debouncedQuery) || 
                    p.owner_name.toLowerCase().includes(debouncedQuery);
    }

    return matchTab && matchSearch;
  });

  const handleExportCadCsv = (parcel: ParcelData) => {
    if (!parcel.geojson) return;
    try {
      const geom = JSON.parse(parcel.geojson);
      if (geom.type !== 'Polygon' || !geom.coordinates?.[0]) {
        alert('Format poligon tidak kompatibel untuk ekspor titik batas.');
        return;
      }
      const ring = geom.coordinates[0];
      const vertices = ring.slice(0, -1);
      let csv = 'No_Patok,Longitude_X,Latitude_Y\r\n';
      vertices.forEach((pt: number[], idx: number) => {
        csv += `P-${idx + 1},${Number(pt[0]).toFixed(7)},${Number(pt[1]).toFixed(7)}\r\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Koordinat_Patok_CAD_${parcel.nib.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Gagal mengekstrak koordinat geometri persil.');
    }
  };

  const handleExportGeoJson = (parcel: ParcelData) => {
    if (!parcel.geojson) return;
    try {
      const geom = JSON.parse(parcel.geojson);
      const featureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: parcel.id,
            geometry: geom,
            properties: {
              nib: parcel.nib,
              pemilik: parcel.owner_name,
              kategori_kkp: parcel.kkp_category,
              jenis_hak: parcel.hak_type,
              luas_surat_m2: parcel.legal_area_m2,
              luas_spasial_m2: parcel.spatial_area_m2,
              deviasi_persen: parcel.deviation_percent,
              indikasi_overlap: parcel.is_overlapping,
              desa: parcel.village,
              kecamatan: parcel.sub_district,
              sumber_geometri: parcel.geometry_source,
            },
          },
        ],
      };
      const blob = new Blob([JSON.stringify(featureCollection, null, 2)], { type: 'application/geo+json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Persil_GIS_${parcel.nib.replace(/[^a-zA-Z0-9]/g, '_')}.geojson`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Gagal memproses berkas GeoJSON.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur px-4 sm:px-6 py-3 flex flex-wrap gap-3 items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-sm sm:text-base tracking-tight text-white">GeoTanah Dairi</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-950 border border-emerald-800 text-emerald-400">
                PostGIS v2 Spheroid
              </span>
            </div>
            <p className="text-xs text-slate-400">Monitoring Kadastral & Inventarisasi KKP Kantah Dairi</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/survey" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors">
            Buka Mode Sensus
          </Link>
          <div className="hidden xl:flex items-center gap-2 bg-slate-800/60 border border-slate-700 px-3 py-1.5 rounded-lg text-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-300">Kantah Kab. Dairi</span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 max-w-[1700px] w-full mx-auto">
        <div className="lg:col-span-3 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
              <span className="text-[11px] text-slate-400">Total NIB</span>
              <div className="text-lg font-bold text-white mt-0.5">{totalParcels}</div>
              <span className="text-[10px] text-slate-500">Persil Sidikalang</span>
            </div>
            <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-3">
              <span className="text-[11px] text-emerald-400">KKP: KW 1</span>
              <div className="text-lg font-bold text-emerald-300 mt-0.5">{kw1Count}</div>
              <span className="text-[10px] text-emerald-500">Spasial Lengkap</span>
            </div>
            <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-3">
              <span className="text-[11px] text-amber-400">KKP: KW 4/5/6</span>
              <div className="text-lg font-bold text-amber-300 mt-0.5">{kw456Count}</div>
              <span className="text-[10px] text-amber-500">Belum Terpetakan</span>
            </div>
            <div className="bg-rose-950/30 border border-rose-800/50 rounded-xl p-3">
              <span className="text-[11px] text-rose-400">Tumpang Tindih</span>
              <div className="text-lg font-bold text-rose-300 mt-0.5">{conflictCount}</div>
              <span className="text-[10px] text-rose-500">Indikasi Overlap</span>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex-1 flex flex-col min-h-[400px]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-emerald-400" /> Persil Dairi
              </h2>
              <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400">Sidikalang</span>
            </div>

            {/* Kotak Input Pencarian */}
            <div className="relative mb-3">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-500" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari NIB atau Pemilik..."
                className="w-full bg-slate-950/50 border border-slate-800/80 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-slate-600"
              />
            </div>

            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-950/60 rounded-xl border border-slate-800/80 mb-3 text-[10px]">
              <button 
                onClick={() => setFilterTab('SEMUA')}
                className={`py-1 rounded-lg transition-colors ${filterTab === 'SEMUA' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-slate-200'}`}
              >
                Semua
              </button>
              <button 
                onClick={() => setFilterTab('KW1')}
                className={`py-1 rounded-lg transition-colors ${filterTab === 'KW1' ? 'bg-emerald-900/60 text-emerald-300 font-medium' : 'text-slate-400 hover:text-slate-200'}`}
              >
                KW 1
              </button>
              <button 
                onClick={() => setFilterTab('KW456')}
                className={`py-1 rounded-lg transition-colors ${filterTab === 'KW456' ? 'bg-amber-900/60 text-amber-300 font-medium' : 'text-slate-400 hover:text-slate-200'}`}
              >
                KW 4/5/6
              </button>
              <button 
                onClick={() => setFilterTab('CONFLICT')}
                className={`py-1 rounded-lg transition-colors ${filterTab === 'CONFLICT' ? 'bg-rose-900/60 text-rose-300 font-medium' : 'text-slate-400 hover:text-slate-200'}`}
              >
                Overlap
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[350px]">
              {loading ? (
                <div className="text-xs text-slate-500 text-center py-8">Mengambil data dari Supabase RPC v2...</div>
              ) : filteredParcels.length === 0 ? (
                <div className="text-xs text-slate-500 text-center py-8">Tidak ada persil yang cocok.</div>
              ) : (
                filteredParcels.map((parcel) => (
                  <button
                    key={parcel.id}
                    onClick={() => setSelectedParcel(parcel)}
                    className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between ${
                      selectedParcel?.id === parcel.id
                        ? 'bg-emerald-950/40 border-emerald-500/60 shadow-sm'
                        : 'bg-slate-950/40 border-slate-800/80 hover:bg-slate-800'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono font-medium text-slate-200">{parcel.nib}</span>
                        {parcel.kkp_category && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-emerald-400 font-mono">
                            {parcel.kkp_category}
                          </span>
                        )}
                      </div>
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

        <div className="lg:col-span-6 bg-slate-900/80 border border-slate-800 rounded-2xl p-2 min-h-[450px] lg:min-h-[580px] shadow-xl relative">
          <div className="absolute top-4 left-4 z-10 bg-slate-900/90 backdrop-blur border border-slate-700 px-3 py-1.5 rounded-lg text-xs flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-slate-300 font-medium">Sidikalang Cadastral Viewer</span>
          </div>
          <ParcelMap 
            parcels={filteredParcels} 
            selectedParcel={selectedParcel} 
            onSelectParcel={setSelectedParcel} 
          />
        </div>

        <div className="lg:col-span-3 flex flex-col gap-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Inspector Persil Dairi
            </h2>

            {selectedParcel ? (
              <div className="space-y-3.5 text-xs">
                {(() => {
                  const isConflict = selectedParcel.is_overlapping === true || selectedParcel.status === 'Tumpang Tindih';
                  const isWarning = !isConflict && (
                    selectedParcel.status === 'Perlu Verifikasi' || 
                    (selectedParcel.deviation_percent !== null && Number(selectedParcel.deviation_percent) > 2.0)
                  );

                  if (isConflict) {
                    return (
                      <div className="p-3 rounded-xl border flex items-center gap-3 bg-rose-950/40 border-rose-800 text-rose-300">
                        <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400" />
                        <div>
                          <div className="font-bold text-xs">Indikasi Tumpang Tindih</div>
                          <div className="text-[10px] opacity-80">Irisan area terdeteksi dengan persil lain</div>
                        </div>
                      </div>
                    );
                  }

                  if (isWarning) {
                    return (
                      <div className="p-3 rounded-xl border flex items-center gap-3 bg-amber-950/40 border-amber-800 text-amber-300">
                        <HelpCircle className="h-5 w-5 shrink-0 text-amber-400" />
                        <div>
                          <div className="font-bold text-xs">Perlu Verifikasi Lapangan</div>
                          <div className="text-[10px] opacity-80">Deviasi &gt; 2% / Geometri indikatif</div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="p-3 rounded-xl border flex items-center gap-3 bg-emerald-950/40 border-emerald-800 text-emerald-300">
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                      <div>
                        <div className="font-bold text-xs">Lolos Cek Teknis Demo</div>
                        <div className="text-[10px] opacity-80">Topologi bersih & deviasi wajar</div>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-800/80 text-[11px] font-mono text-emerald-300">
                    {selectedParcel.kkp_category || 'KW -'}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 text-[11px] text-slate-300 font-sans">
                    {selectedParcel.hak_type || 'Hak Milik'}
                  </span>
                  <span className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] text-slate-400 font-mono">
                    src: {selectedParcel.geometry_source || 'survei'}
                  </span>
                </div>

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

                <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800 space-y-2">
                  <span className="text-[10px] font-semibold text-slate-400 block uppercase">
                    Kalkulasi Luas (Meter²)
                  </span>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Surat Dokumen:</span>
                    <span className="font-mono text-slate-200">{selectedParcel.legal_area_m2} m²</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Hitung Spasial:</span>
                    <span className="font-mono text-emerald-400">{selectedParcel.spatial_area_m2 ?? '-'} m²</span>
                  </div>
                  <div className="pt-1.5 border-t border-slate-800 flex justify-between text-xs">
                    <span className="text-slate-400">Margin Deviasi:</span>
                    <span className={`font-mono font-bold ${
                      selectedParcel.deviation_percent !== null && Number(selectedParcel.deviation_percent) > 2.0 
                        ? 'text-amber-400' 
                        : 'text-emerald-400'
                    }`}>
                      {selectedParcel.deviation_percent !== null 
                        ? `${Number(selectedParcel.deviation_percent).toFixed(2)}%` 
                        : '-'}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-950/40 rounded-xl p-2.5 border border-slate-800">
                  <span className="text-[10px] text-slate-500 block mb-0.5 uppercase font-semibold">Catatan Lapangan</span>
                  <p className="text-[11px] text-slate-300 italic">
                    &quot;{selectedParcel.surveyor_notes || '-'}&quot;
                  </p>
                </div>

                <div className="space-y-2 pt-1">
                  <button 
                    onClick={() => handleExportCadCsv(selectedParcel)}
                    className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Download className="h-3.5 w-3.5 text-emerald-400" /> Export Patok (AutoCAD / CSV)
                  </button>
                  <button 
                    onClick={() => handleExportGeoJson(selectedParcel)}
                    className="w-full py-2 rounded-xl bg-emerald-700/80 hover:bg-emerald-600 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <FileCode className="h-3.5 w-3.5" /> Export Layer (QGIS / GeoJSON)
                  </button>
                </div>

              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}