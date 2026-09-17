'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { supabase, type ParcelData } from '@/lib/supabase';
import { 
  ShieldCheck, AlertTriangle, Layers, 
  Compass, Activity, CheckCircle2, ChevronRight, HelpCircle,
  Download, FileCode, Search, Camera, ExternalLink, MapPin
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

  useEffect(() => {
    async function fetchParcels() {
      const { data, error } = await supabase.rpc('get_parcels_with_metrics_v2', {
        p_dataset_key: 'dairi-demo'
      });

      // Ambil juga kolom survei dari tabel parcels agar photo_path & gps selalu terjamin terisi
      const { data: surveyData } = await supabase
        .from('parcels')
        .select('id, gps_lat, gps_lng, gps_accuracy_m, photo_path, surveyed_at')
        .eq('dataset_key', 'dairi-demo');

      if (error) {
        console.error('Error memuat data persil Dairi:', error);
      } else if (data) {
        const surveyMap = new Map((surveyData || []).map(s => [s.id, s]));
        const enriched = (data as ParcelData[]).map((p: ParcelData) => {
          const s = surveyMap.get(p.id);
          return {
            ...p,
            gps_lat: p.gps_lat ?? s?.gps_lat ?? null,
            gps_lng: p.gps_lng ?? s?.gps_lng ?? null,
            gps_accuracy_m: p.gps_accuracy_m ?? s?.gps_accuracy_m ?? null,
            photo_path: p.photo_path ?? s?.photo_path ?? null,
            surveyed_at: p.surveyed_at ?? s?.surveyed_at ?? null,
          };
        });
        setParcels(enriched);
        if (enriched.length > 0) setSelectedParcel(enriched[0]);
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
      <header className="border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md px-4 sm:px-6 py-3.5 flex flex-wrap gap-3 items-center justify-between sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white shrink-0">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base sm:text-lg tracking-tight text-white">GeoTanah Dairi</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-950/80 border border-emerald-800 text-emerald-400">
                PostGIS v2 Spheroid
              </span>
            </div>
            <p className="text-xs text-slate-400">Monitoring Kadastral & Inventarisasi KKP Kantah Dairi</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link 
            href="/survey" 
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-500 active:scale-[0.98] transition-all shadow-sm shadow-emerald-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
          >
            <Camera className="h-4 w-4" />
            <span>Buka Mode Sensus</span>
          </Link>
          <div className="hidden xl:flex items-center gap-2 bg-slate-800/60 border border-slate-700/80 px-3 py-1.5 rounded-xl text-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-300 font-medium">Kantah Kab. Dairi</span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 max-w-[1700px] w-full mx-auto">
        <div className="lg:col-span-3 flex flex-col gap-4">
          {loading ? (
            <div className="grid grid-cols-2 gap-2.5">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 animate-pulse space-y-2">
                  <div className="h-3 w-16 bg-slate-800 rounded" />
                  <div className="h-6 w-12 bg-slate-700 rounded" />
                  <div className="h-2.5 w-20 bg-slate-800/60 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
                <span className="text-[11px] text-slate-400 font-medium">Total NIB</span>
                <div className="text-xl font-bold font-mono text-white mt-0.5">{totalParcels}</div>
                <span className="text-[10px] text-slate-500">Persil Sidikalang</span>
              </div>
              <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-3.5">
                <span className="text-[11px] text-emerald-400 font-medium">KKP: KW 1</span>
                <div className="text-xl font-bold font-mono text-emerald-300 mt-0.5">{kw1Count}</div>
                <span className="text-[10px] text-emerald-500">Spasial Lengkap</span>
              </div>
              <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-3.5">
                <span className="text-[11px] text-amber-400 font-medium">KKP: KW 4/5/6</span>
                <div className="text-xl font-bold font-mono text-amber-300 mt-0.5">{kw456Count}</div>
                <span className="text-[10px] text-amber-500">Belum Terpetakan</span>
              </div>
              <div className="bg-rose-950/30 border border-rose-800/50 rounded-xl p-3.5">
                <span className="text-[11px] text-rose-400 font-medium">Tumpang Tindih</span>
                <div className="text-xl font-bold font-mono text-rose-300 mt-0.5">{conflictCount}</div>
                <span className="text-[10px] text-rose-500">Indikasi Overlap</span>
              </div>
            </div>
          )}

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex-1 flex flex-col min-h-[400px]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-emerald-400" /> Daftar Persil
              </h2>
              <span className="text-[10px] bg-slate-800 border border-slate-700/60 px-2 py-0.5 rounded-md text-slate-300 font-mono">
                {loading ? '...' : `${filteredParcels.length} Bidang`}
              </span>
            </div>

            {/* Kotak Input Pencarian */}
            <div className="relative mb-3">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-500" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (e.target.value) setFilterTab('SEMUA');
                }}
                placeholder="Cari NIB atau Pemilik..."
                className="w-full min-h-10 bg-slate-950/70 border border-slate-800/90 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
              />
            </div>

            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-950/60 rounded-xl border border-slate-800/80 mb-3 text-[10px]">
              <button 
                onClick={() => setFilterTab('SEMUA')}
                className={`py-1.5 rounded-lg transition-all active:scale-[0.98] ${filterTab === 'SEMUA' ? 'bg-slate-800 text-white font-semibold shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
              >
                Semua
              </button>
              <button 
                onClick={() => setFilterTab('KW1')}
                className={`py-1.5 rounded-lg transition-all active:scale-[0.98] ${filterTab === 'KW1' ? 'bg-emerald-900/60 text-emerald-300 font-semibold shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
              >
                KW 1
              </button>
              <button 
                onClick={() => setFilterTab('KW456')}
                className={`py-1.5 rounded-lg transition-all active:scale-[0.98] ${filterTab === 'KW456' ? 'bg-amber-900/60 text-amber-300 font-semibold shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
              >
                KW 4/5/6
              </button>
              <button 
                onClick={() => setFilterTab('CONFLICT')}
                className={`py-1.5 rounded-lg transition-all active:scale-[0.98] ${filterTab === 'CONFLICT' ? 'bg-rose-900/60 text-rose-300 font-semibold shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
              >
                Overlap
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[350px]">
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="p-3 rounded-xl border border-slate-800 bg-slate-950/40 animate-pulse space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="h-3.5 w-24 bg-slate-800 rounded" />
                        <div className="h-3.5 w-10 bg-slate-800 rounded" />
                      </div>
                      <div className="h-3 w-32 bg-slate-800/80 rounded" />
                      <div className="h-2.5 w-20 bg-slate-800/50 rounded" />
                    </div>
                  ))}
                </div>
              ) : filteredParcels.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                  <div className="h-10 w-10 rounded-full bg-slate-800/70 border border-slate-700/60 flex items-center justify-center text-slate-400 mb-2">
                    <Search className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-semibold text-slate-300">Tidak ada persil cocok</p>
                  <p className="text-[11px] text-slate-500 mt-1 max-w-[200px]">Coba ubah kata kunci NIB atau ganti filter tab di atas.</p>
                </div>
              ) : (
                filteredParcels.map((parcel) => (
                  <button
                    key={parcel.id}
                    onClick={() => setSelectedParcel(parcel)}
                    className={`w-full text-left p-3 rounded-xl border transition-all active:scale-[0.99] flex items-center justify-between ${
                      selectedParcel?.id === parcel.id
                        ? 'bg-emerald-950/40 border-emerald-500/70 shadow-sm shadow-emerald-950/50'
                        : 'bg-slate-950/40 border-slate-800/80 hover:bg-slate-800/60 hover:border-slate-700/80'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono font-semibold text-slate-200">{parcel.nib}</span>
                        {parcel.kkp_category && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-emerald-400 font-mono">
                            {parcel.kkp_category}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{parcel.owner_name}</div>
                      <div className="text-[10px] text-slate-500">{parcel.village}</div>
                    </div>
                    <ChevronRight className={`h-4 w-4 transition-transform ${selectedParcel?.id === parcel.id ? 'text-emerald-400 translate-x-0.5' : 'text-slate-600'}`} />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 bg-slate-900/80 border border-slate-800 rounded-2xl p-2 min-h-[480px] lg:min-h-[620px] shadow-xl relative overflow-hidden flex flex-col">
          <div className="absolute top-4 left-4 z-10 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 px-3 py-1.5 rounded-xl text-xs flex items-center gap-2 shadow-lg">
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

            {loading ? (
              <div className="space-y-3.5 animate-pulse">
                <div className="h-14 rounded-xl bg-slate-950/60 border border-slate-800" />
                <div className="flex gap-2">
                  <div className="h-7 w-16 rounded-lg bg-slate-800" />
                  <div className="h-7 w-20 rounded-lg bg-slate-800" />
                  <div className="h-7 w-20 rounded-lg bg-slate-800" />
                </div>
                <div className="h-28 rounded-xl bg-slate-950/60 border border-slate-800" />
                <div className="h-28 rounded-xl bg-slate-950/60 border border-slate-800" />
                <div className="h-32 rounded-xl bg-slate-950/60 border border-slate-800" />
              </div>
            ) : selectedParcel ? (
              <div className="space-y-3.5 text-xs">
                {(() => {
                  const isConflict = selectedParcel.is_overlapping === true || selectedParcel.status === 'Tumpang Tindih';
                  const isWarning = !isConflict && (
                    selectedParcel.status === 'Perlu Verifikasi' || 
                    (selectedParcel.deviation_percent !== null && Number(selectedParcel.deviation_percent) > 2.0)
                  );

                  if (isConflict) {
                    return (
                      <div className="p-3.5 rounded-xl border flex items-center gap-3 bg-rose-950/40 border-rose-800/80 text-rose-300 shadow-sm">
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
                      <div className="p-3.5 rounded-xl border flex items-center gap-3 bg-amber-950/40 border-amber-800/80 text-amber-300 shadow-sm">
                        <HelpCircle className="h-5 w-5 shrink-0 text-amber-400" />
                        <div>
                          <div className="font-bold text-xs">Perlu Verifikasi Lapangan</div>
                          <div className="text-[10px] opacity-80">Deviasi &gt; 2% / Geometri indikatif</div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="p-3.5 rounded-xl border flex items-center gap-3 bg-emerald-950/40 border-emerald-800/80 text-emerald-300 shadow-sm">
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                      <div>
                        <div className="font-bold text-xs">Lolos Cek Teknis Demo</div>
                        <div className="text-[10px] opacity-80">Topologi bersih & deviasi wajar</div>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-800/80 text-[11px] font-mono text-emerald-300 font-medium">
                    {selectedParcel.kkp_category || 'KW -'}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 text-[11px] text-slate-300 font-medium">
                    {selectedParcel.hak_type || 'Hak Milik'}
                  </span>
                  <span className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] text-slate-400 font-mono">
                    src: {selectedParcel.geometry_source || 'survei'}
                  </span>
                </div>

                <div className="bg-slate-950/60 rounded-xl p-3.5 border border-slate-800/80 space-y-2 font-mono text-[11px]">
                  <div className="flex justify-between pb-1.5 border-b border-slate-800/80">
                    <span className="text-slate-400 font-sans text-xs">NIB</span>
                    <span className="text-slate-200 font-semibold">{selectedParcel.nib}</span>
                  </div>
                  <div className="flex justify-between pb-1.5 border-b border-slate-800/80">
                    <span className="text-slate-400 font-sans text-xs">Pemilik</span>
                    <span className="text-slate-200 font-sans">{selectedParcel.owner_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans text-xs">Desa</span>
                    <span className="text-slate-200 font-sans">{selectedParcel.village}</span>
                  </div>
                </div>

                <div className="bg-slate-950/60 rounded-xl p-3.5 border border-slate-800/80 space-y-2">
                  <span className="text-[10px] font-semibold text-slate-400 block uppercase tracking-wider">
                    Kalkulasi Luas (Meter²)
                  </span>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Surat Dokumen:</span>
                    <span className="font-mono text-slate-200">
                      {Number(selectedParcel.legal_area_m2) <= 0.01 
                        ? 'Belum Ada (Indikatif)' 
                        : `${selectedParcel.legal_area_m2} m²`}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Hitung Spasial:</span>
                    <span className="font-mono text-emerald-400 font-medium">{selectedParcel.spatial_area_m2 ? `${selectedParcel.spatial_area_m2} m²` : '-'}</span>
                  </div>
                  <div className="pt-1.5 border-t border-slate-800/80 flex justify-between text-xs">
                    <span className="text-slate-400">Margin Deviasi:</span>
                    <span className={`font-mono font-bold ${
                      selectedParcel.deviation_percent !== null && Number(selectedParcel.deviation_percent) > 2.0 
                        ? 'text-amber-400' 
                        : 'text-emerald-400'
                    }`}>
                      {Number(selectedParcel.legal_area_m2) <= 0.01 
                        ? 'Perlu Warkah Fisik' 
                        : selectedParcel.deviation_percent !== null 
                          ? `${Number(selectedParcel.deviation_percent).toFixed(2)}%` 
                          : '-'}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-800/80">
                  <span className="text-[10px] text-slate-500 block mb-0.5 uppercase tracking-wider font-semibold">Catatan Lapangan</span>
                  <p className="text-[11px] text-slate-300 italic">
                    &quot;{selectedParcel.surveyor_notes || '-'}&quot;
                  </p>
                </div>

                {/* Dokumentasi Foto Lapangan & Data GPS Sensus */}
                <div className="bg-slate-950/60 rounded-xl p-3.5 border border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Camera className="h-3.5 w-3.5 text-emerald-400" /> Foto & Lokasi Sensus
                    </span>
                    {selectedParcel.surveyed_at && (
                      <span className="text-[9px] text-emerald-400 font-mono bg-emerald-950/50 border border-emerald-900/60 px-1.5 py-0.5 rounded">
                        {new Date(selectedParcel.surveyed_at).toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    )}
                  </div>

                  {selectedParcel.photo_path ? (
                    <div className="space-y-1.5">
                      <a
                        href={supabase.storage.from('parcel-photos').getPublicUrl(selectedParcel.photo_path).data.publicUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative block overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900 aspect-video w-full shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                        title="Klik untuk membuka foto ukuran penuh"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={supabase.storage.from('parcel-photos').getPublicUrl(selectedParcel.photo_path).data.publicUrl}
                          alt={`Foto lapangan NIB ${selectedParcel.nib}`}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-slate-950/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-medium gap-1.5 backdrop-blur-[1px]">
                          <span>Buka Ukuran Penuh</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </div>
                      </a>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-4 text-center">
                      <Camera className="h-5 w-5 text-slate-600 mb-1" />
                      <span className="text-[11px] text-slate-400 font-medium">Belum ada foto lapangan</span>
                      <span className="text-[9px] text-slate-500 mt-0.5">Dapat disurvei melalui Mode Sensus</span>
                    </div>
                  )}

                  {/* Metadata GPS jika tersedia */}
                  {selectedParcel.gps_lat !== null && selectedParcel.gps_lat !== undefined && selectedParcel.gps_lng !== null && selectedParcel.gps_lng !== undefined && (
                    <div className="pt-2 border-t border-slate-800/80 font-mono text-[10px] space-y-1.5 text-slate-400">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 font-sans text-slate-500">
                          <MapPin className="h-3 w-3 text-emerald-400" />
                          Koordinat GPS:
                        </span>
                        <span className="text-slate-200">
                          {Number(selectedParcel.gps_lat).toFixed(6)}, {Number(selectedParcel.gps_lng).toFixed(6)}
                        </span>
                      </div>
                      {selectedParcel.gps_accuracy_m !== null && selectedParcel.gps_accuracy_m !== undefined && (
                        <div className="flex items-center justify-between">
                          <span className="font-sans text-slate-500">Akurasi Perangkat:</span>
                          <span className="text-emerald-400">±{Number(selectedParcel.gps_accuracy_m).toFixed(2)} m</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2 pt-1">
                  <button 
                    onClick={() => handleExportCadCsv(selectedParcel)}
                    className="w-full min-h-11 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700/90 border border-slate-700 text-slate-200 font-medium text-xs flex items-center justify-center gap-2 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  >
                    <Download className="h-3.5 w-3.5 text-emerald-400" /> Export Patok (AutoCAD / CSV)
                  </button>
                  <button 
                    onClick={() => handleExportGeoJson(selectedParcel)}
                    className="w-full min-h-11 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-sm shadow-emerald-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  >
                    <FileCode className="h-3.5 w-3.5" /> Export Layer (QGIS / GeoJSON)
                  </button>
                </div>

              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center flex-1">
                <div className="h-12 w-12 rounded-2xl bg-slate-800/70 border border-slate-700/60 flex items-center justify-center text-slate-400 mb-3 shadow-inner">
                  <Layers className="h-6 w-6 text-emerald-400" />
                </div>
                <h3 className="text-sm font-semibold text-slate-200">Pilih Bidang Tanah</h3>
                <p className="text-xs text-slate-400 mt-1.5 max-w-[240px] leading-relaxed">
                  Klik salah satu bidang di peta spasial atau pilih dari daftar di samping untuk meninjau status KKP, kalkulasi luas, dan dokumentasi survei.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}