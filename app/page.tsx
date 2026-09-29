'use client';

import { useEffect, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { supabase, type ParcelData, parsePhotoPaths } from '@/lib/supabase';
import { 
  ShieldCheck, AlertTriangle, Layers, 
  Compass, CheckCircle2, ChevronRight, HelpCircle,
  Download, FileCode, Search, Camera, ExternalLink, MapPin, RotateCcw,
  Trash2, LoaderCircle, LogIn, LogOut, User
} from 'lucide-react';
import ExportModal from '@/components/ExportModal';
import AuthModal from '@/components/AuthModal';
import { executeExportGeodatabase } from '@/lib/exportGeodatabase';
import { toast } from 'sonner';

/**
 * Ekstraksi pesan error secara aman dan komprehensif dari PostgrestError atau Error standar
 * Mencegah munculnya popup '[object Object]'.
 */
function extractErrorMessage(err: unknown): string {
  if (!err) return 'Terjadi kesalahan tidak dikenal.';
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    const msg = typeof obj.message === 'string' ? obj.message : '';
    const details = typeof obj.details === 'string' && obj.details ? ` (${obj.details})` : '';
    const hint = typeof obj.hint === 'string' && obj.hint ? ` [Petunjuk: ${obj.hint}]` : '';
    if (msg) return `${msg}${details}${hint}`;
    const desc = typeof obj.error_description === 'string' ? obj.error_description : '';
    if (desc) return desc;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Pemindaian rekursif seluruh berkas di dalam folder Supabase Storage
 */
async function listAllStorageFilesRecursively(bucket: string, prefix: string): Promise<string[]> {
  const collected: string[] = [];
  async function scanDir(dir: string) {
    const { data, error } = await supabase.storage.from(bucket).list(dir, {
      limit: 100,
      offset: 0,
    });
    if (error || !data) return;
    for (const item of data) {
      const itemPath = dir ? `${dir}/${item.name}` : item.name;
      // Di Supabase Storage, folder ditandai dengan id === null atau tanpa metadata
      if (!item.id && !item.metadata) {
        await scanDir(itemPath);
      } else {
        collected.push(itemPath);
      }
    }
  }
  await scanDir(prefix);
  return collected;
}

const ParcelMap = dynamic(() => import('@/components/ParcelMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-slate-100 text-slate-500 font-mono text-xs">
      Memuat Mesin Spasial Leaflet Sidikalang...
    </div>
  ),
});

const PROGRAM_CONFIG: Record<string, { icon: string; label: string; badgeClass: string }> = {
  Wakaf: { icon: '🕌', label: 'Wakaf', badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  MBR: { icon: '🏠', label: 'MBR', badgeClass: 'bg-blue-50 text-blue-800 border-blue-200' },
  'Rumah Ibadah': { icon: '🏛️', label: 'Rumah Ibadah', badgeClass: 'bg-purple-50 text-purple-800 border-purple-200' },
  Hibah: { icon: '🎁', label: 'Hibah', badgeClass: 'bg-amber-50 text-amber-800 border-amber-200' },
  Reguler: { icon: '📋', label: 'Reguler', badgeClass: 'bg-slate-100 text-slate-700 border-slate-200' },
};

export default function Dashboard() {
  const [parcels, setParcels] = useState<ParcelData[]>([]);
  const [selectedParcel, setSelectedParcel] = useState<ParcelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [currentUserRole, setCurrentUserRole] = useState<'admin' | 'validator' | 'surveyor' | 'viewer' | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [filterTab, setFilterTab] = useState<'SEMUA' | 'KW1' | 'KW456' | 'CONFLICT'>('SEMUA');
  const [programFilter, setProgramFilter] = useState<'ALL' | 'Reguler' | 'Wakaf' | 'Rumah Ibadah' | 'MBR' | 'Hibah'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgressText, setExportProgressText] = useState('');
  const [exportProgressPercent, setExportProgressPercent] = useState(0);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  // Reset indeks foto aktif ketika persil yang dipilih berganti
  useEffect(() => {
    setActivePhotoIdx(0);
  }, [selectedParcel?.id]);

  // Jeda pencarian agar performa web tetap cepat
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim().toLowerCase());
    }, 200);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      const { data, error } = await supabase.rpc('get_parcels_with_metrics_v2', {
        p_dataset_key: 'dairi-demo'
      });

      if (cancelled) return;

      if (error) {
        console.error('Error memuat data persil Dairi:', error);
        setLoadError(error.message || 'Gagal memuat data persil dari server.');
      } else if (data) {
        setLoadError(null);
        const rows = data as ParcelData[];
        setParcels(rows);
        if (rows.length > 0) {
          setSelectedParcel(prev => {
            if (!prev) return rows[0];
            return rows.find(p => p.id === prev.id) ?? rows[0];
          });
        }
      }
      setLoading(false);
    }

    void loadData();

    // Supabase Realtime subscription untuk mendeteksi penambahan / pembaruan persil dari lapangan
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel('parcels-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'parcels',
            filter: 'dataset_key=eq.dairi-demo',
          },
          () => {
            void loadData();
          }
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            console.warn('Realtime subscription tidak aktif atau gagal terhubung. Fallback ke mode polling/manual.');
          }
        });
    } catch (err) {
      console.warn('Gagal menginisialisasi Realtime channel:', err);
    }

    return () => {
      cancelled = true;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [reload]);

  // Deteksi sesi autentikasi dan role pengguna dari tabel public.profiles
  useEffect(() => {
    async function checkUserRole() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setCurrentUserEmail(user.email ?? null);
          const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();
          if (profile?.role) {
            setCurrentUserRole(profile.role);
            return;
          }
          if (user.user_metadata?.role) {
            setCurrentUserRole(user.user_metadata.role);
            return;
          }
          setCurrentUserRole('surveyor');
        } else {
          setCurrentUserEmail(null);
          setCurrentUserRole(null);
        }
      } catch (err) {
        console.warn('Gagal membaca role pengguna:', err);
      }
    }
    void checkUserRole();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setCurrentUserEmail(session.user.email ?? null);
      } else {
        setCurrentUserEmail(null);
        setCurrentUserRole(null);
      }
      void checkUserRole();
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setCurrentUserEmail(null);
    setCurrentUserRole(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('geotanah_role');
    }
    window.alert('Anda telah berhasil keluar (logout).');
  };

  const isAdmin = currentUserRole === 'admin' || (typeof window !== 'undefined' && localStorage.getItem('geotanah_role') === 'admin');

  const totalParcels = parcels.length;
  const kw1Count = useMemo(() => parcels.filter(p => p.kkp_category === 'KW 1').length, [parcels]);
  const kw456Count = useMemo(() => 
    parcels.filter(p => p.kkp_category ? ['KW 4', 'KW 5', 'KW 6'].includes(p.kkp_category) : false).length,
    [parcels]
  );
  const conflictCount = useMemo(() => 
    parcels.filter(p => p.is_overlapping === true || p.status === 'Tumpang Tindih').length,
    [parcels]
  );

  // Logika Filter Gabungan (Pencarian + Kategori Tab KKP + Filter Program)
  const filteredParcels = useMemo(() => parcels.filter((p) => {
    let matchTab = true;
    if (filterTab === 'KW1') {
      matchTab = p.kkp_category === 'KW 1';
    } else if (filterTab === 'KW456') {
      matchTab = p.kkp_category ? ['KW 4', 'KW 5', 'KW 6'].includes(p.kkp_category) : false;
    } else if (filterTab === 'CONFLICT') {
      matchTab = p.is_overlapping === true || p.status === 'Tumpang Tindih';
    }

    let matchProgram = true;
    if (programFilter !== 'ALL') {
      matchProgram = (p.program_type || 'Reguler') === programFilter;
    }

    let matchSearch = true;
    if (debouncedQuery) {
      matchSearch = p.nib.toLowerCase().includes(debouncedQuery) || 
                    p.owner_name.toLowerCase().includes(debouncedQuery);
    }

    return matchTab && matchProgram && matchSearch;
  }), [parcels, filterTab, programFilter, debouncedQuery]);

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

  const handleDeleteParcel = async (parcel: ParcelData) => {
    if (!parcel || isDeleting) return;

    const confirmed = window.confirm(
      `PERINGATAN ADMIN:\nYakin ingin menghapus NIB ${parcel.nib} (${parcel.owner_name})?\n\nSemua data spasial di database DAN seluruh berkas foto + detail_lokasi.txt di Cloud Storage akan DIHAPUS PERMANEN untuk mengosongkan storage.`
    );
    if (!confirmed) return;

    setIsDeleting(true);
    const deleteToastId = toast.loading(`Menghapus data NIB ${parcel.nib} dan membersihkan storage...`);

    try {
      const sanitize = (str: string) =>
        str
          .trim()
          .replace(/[\/\\?%*:|"<>]/g, '_')
          .replace(/\s+/g, '_')
          .replace(/_+/g, '_');

      const cleanOwner = sanitize(parcel.owner_name || 'Tanpa_Nama');
      const cleanNib = sanitize(parcel.nib || 'Tanpa_NIB');
      const baseFolderName = `${cleanOwner}_${cleanNib}`;

      // Kumpulkan kandidat folder yang relevan dengan persil ini
      const candidateFolders = new Set<string>();
      candidateFolders.add(baseFolderName);

      // Ambil folder dari path foto yang tersimpan
      if (parcel.photo_path) {
        const storedPhotoPaths = parsePhotoPaths(parcel.photo_path);
        storedPhotoPaths.forEach((p) => {
          if (p.includes('/')) {
            const folderPart = p.substring(0, p.lastIndexOf('/'));
            if (folderPart) candidateFolders.add(folderPart);
          }
        });
      }

      // Periksa juga folder root untuk mencocokkan pola [Pemilik]_[NIB]*
      try {
        const { data: rootList } = await supabase.storage.from('parcel-photos').list('', { limit: 100 });
        if (rootList && rootList.length > 0) {
          rootList.forEach((item) => {
            if (!item.id && !item.metadata) {
              if (item.name.startsWith(baseFolderName) || item.name.includes(cleanNib)) {
                candidateFolders.add(item.name);
              }
            }
          });
        }
      } catch (err) {
        console.warn('[handleDeleteParcel] List root warning:', err);
      }

      // Pindai seluruh berkas secara rekursif dari seluruh kandidat folder
      const filesToRemoveSet = new Set<string>();

      for (const folder of candidateFolders) {
        try {
          const files = await listAllStorageFilesRecursively('parcel-photos', folder);
          files.forEach((f) => filesToRemoveSet.add(f));
          // Pastikan file detail_lokasi.txt dimasukkan jika ada
          filesToRemoveSet.add(`${folder}/detail_lokasi.txt`);
        } catch (err) {
          console.warn(`[handleDeleteParcel] Gagal list berkas di folder ${folder}:`, err);
        }
      }

      // Masukkan juga path spesifik yang tercatat di kolom photo_path
      if (parcel.photo_path) {
        const directPaths = parsePhotoPaths(parcel.photo_path);
        directPaths.forEach((dp) => filesToRemoveSet.add(dp));
      }

      const filesToRemove = Array.from(filesToRemoveSet);

      // 1. Hapus baris data di tabel parcels melalui server API route terlebih dahulu (menggunakan hak server/service role)
      let deletedSuccessfully = false;
      let deleteErrorMessage = '';

      try {
        const res = await fetch(`/api/parcels/${encodeURIComponent(parcel.id)}`, {
          method: 'DELETE',
        });
        const resData = await res.json().catch(() => null);

        if (res.ok && resData?.success) {
          deletedSuccessfully = true;
        } else if (resData?.error) {
          deleteErrorMessage = resData.error;
          console.warn('[handleDeleteParcel] Respon API server:', resData);
        }
      } catch (apiErr) {
        console.warn('[handleDeleteParcel] API server route tidak terjangkau, mencoba fallback client:', apiErr);
      }

      // Jika belum terhapus lewat API server, coba panggil RPC delete_parcel_admin (SECURITY DEFINER)
      if (!deletedSuccessfully) {
        try {
          const { data: rpcRes, error: rpcErr } = await supabase.rpc(
            // @ts-expect-error RPC delete_parcel_admin
            'delete_parcel_admin',
            { p_parcel_id: parcel.id }
          );
          if (!rpcErr && (rpcRes as { success?: boolean })?.success) {
            deletedSuccessfully = true;
          }
        } catch {
          // Lanjut ke query langsung jika RPC belum tersedia
        }
      }

      // Jika masih belum terhapus, lakukan query delete langsung dari client
      if (!deletedSuccessfully) {
        const { error: dbError } = await supabase
          .from('parcels')
          .delete()
          .eq('id', parcel.id);

        if (dbError) {
          const detail = dbError.message || dbError.details || deleteErrorMessage || JSON.stringify(dbError);
          if (dbError.code === '42501' || detail.includes('permission denied for table profiles')) {
            throw new Error(
              `Akses ditolak (Error 42501: permission denied for table profiles).\n\nSolusi: Buka Supabase Dashboard > SQL Editor lalu jalankan file 'fix_delete_permissions.sql' yang telah disediakan di root proyek untuk memberikan hak akses RLS tabel profiles.`
            );
          }
          throw new Error(
            `Gagal menghapus baris database (${dbError.code || 'DB_ERROR'}): ${detail}`
          );
        }
        deletedSuccessfully = true;
      }

      // 2. Setelah database berhasil dihapus, bersihkan seluruh berkas foto dari bucket Supabase Storage secara bertahap
      if (filesToRemove.length > 0) {
        for (let i = 0; i < filesToRemove.length; i += 50) {
          const chunk = filesToRemove.slice(i, i + 50);
          const { error: storageDelError } = await supabase.storage
            .from('parcel-photos')
            .remove(chunk);
          if (storageDelError) {
            console.warn('[handleDeleteParcel] Sebagian berkas storage gagal dihapus:', storageDelError);
          }
        }
      }

      // 3. Perbarui state UI lokal
      setParcels((prev) => prev.filter((p) => p.id !== parcel.id));
      if (selectedParcel?.id === parcel.id) {
        setSelectedParcel(null);
      }

      const successMsg = `Pembersihan Berhasil: NIB ${parcel.nib} dan ${filesToRemove.length} berkas foto di Cloud Storage berhasil dihapus permanen.`;
      toast.success(successMsg, { id: deleteToastId, duration: 5000 });
      window.alert(successMsg);
    } catch (err: unknown) {
      const errorMsg = extractErrorMessage(err);
      console.error('[handleDeleteParcel] Error:', err);
      toast.error(`Gagal menghapus persil: ${errorMsg}`, { id: deleteToastId });
      window.alert(`Gagal memproses penghapusan:\n${errorMsg}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const exportGeodatabase = async (includePhotos: boolean) => {
    await executeExportGeodatabase({
      includePhotos,
      onProgress: (text, percent) => {
        setExportProgressText(text);
        setExportProgressPercent(percent);
      },
      triggerDownload: true,
    });
  };

  const handleStartExport = async (includePhotos: boolean) => {
    setIsExporting(true);
    setExportProgressPercent(5);
    setExportProgressText('Menyiapkan proses ekspor geodatabase...');
    try {
      await exportGeodatabase(includePhotos);
      // Jeda 1 detik agar pengguna dapat melihat progress 100% sebelum modal tertutup otomatis
      await new Promise((r) => setTimeout(r, 1000));
      setIsExportModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert('Terjadi kendala saat mengekspor geodatabase: ' + msg);
    } finally {
      setIsExporting(false);
      setExportProgressPercent(0);
      setExportProgressText('');
    }
  };

  return (
    <div className="min-h-screen bg-[oklch(0.963_0.006_240)] text-slate-900 flex flex-col font-sans selection:bg-emerald-600 selection:text-white">
      {/* ── Header: Dark Topography — authoritative cadaster nav ─────────── */}
      <header className="sticky top-0 z-50 safe-top border-b border-slate-900/10 bg-slate-950/96 backdrop-blur-xl shadow-sm shadow-black/20">
        <div className="px-3 sm:px-5 md:px-6 py-0 flex items-center justify-between gap-2 h-14 sm:h-16 max-w-[1920px] mx-auto w-full">
          {/* Brand */}
          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-900/40 text-white shrink-0">
              <Compass className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
            </div>
            <div className="leading-none">
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-sm sm:text-base tracking-tight text-white">GeoTanah Dairi</h1>
                <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-600/20 border border-emerald-500/30 text-emerald-400">
                  PostGIS v2
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 hidden xs:block">Monitoring Kadastral · Kantah Kab. Dairi</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Export */}
            <button
              type="button"
              onClick={() => setIsExportModalOpen(true)}
              disabled={isExporting || loading}
              className="inline-flex min-h-9 sm:min-h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/8 hover:bg-white/14 px-2.5 sm:px-3.5 text-xs font-semibold text-slate-200 hover:text-white transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              title="Export Geodatabase"
            >
              <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-400" />
              <span className="hidden sm:inline">Export Geodatabase</span>
              <span className="sm:hidden">Export</span>
            </button>

            {/* Sensus */}
            <Link
              href="/survey"
              className="inline-flex min-h-9 sm:min-h-10 items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3 sm:px-4 text-xs font-bold text-white shadow-lg shadow-emerald-900/30 transition-all duration-150 active:scale-[0.97]"
            >
              <Camera className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Buka Mode Sensus</span>
              <span className="sm:hidden">Sensus</span>
            </Link>

            {/* Auth */}
            {currentUserEmail ? (
              <div className="flex items-center gap-1 sm:gap-1.5 bg-white/8 border border-white/10 px-2 sm:px-3 py-1.5 rounded-xl text-xs text-slate-200">
                <User className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span className="font-mono text-[10px] sm:text-[11px] max-w-[80px] sm:max-w-[140px] truncate text-slate-300" title={currentUserEmail}>
                  {currentUserEmail}
                </span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                  isAdmin ? 'bg-rose-600/25 text-rose-300 border border-rose-500/30' : 'bg-emerald-600/25 text-emerald-300 border border-emerald-500/30'
                }`}>
                  {isAdmin ? 'Admin' : 'Surveyor'}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="ml-0.5 text-slate-500 hover:text-rose-400 transition-colors p-1 rounded cursor-pointer"
                  title="Keluar akun"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(true)}
                className="inline-flex min-h-9 sm:min-h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/8 hover:bg-white/14 px-2.5 sm:px-3 text-xs font-semibold text-slate-200 hover:text-white transition-all duration-150 cursor-pointer"
              >
                <LogIn className="h-3.5 w-3.5 text-emerald-400" />
                <span>Login</span>
              </button>
            )}

            {/* Live Status — desktop only */}
            <div className="hidden xl:flex items-center gap-1.5 bg-emerald-600/15 border border-emerald-500/25 px-2.5 py-1.5 rounded-lg text-[10px] text-emerald-400 font-medium">
              <span className="indicator-live" />
              <span>Live · Kantah Dairi</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Main Grid ─────────────────────────────────────────────────────── */}
      <main className="flex-1 p-2.5 sm:p-4 md:p-5 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-2.5 sm:gap-4 md:gap-5 max-w-[1920px] w-full mx-auto">
        {/* Panel Kiri: Statistik KPI + Daftar Persil */}
        <div className="order-2 lg:order-1 lg:col-span-3 flex flex-col gap-3">
          {loadError && (
            <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900 shadow-xs space-y-2.5">
              <div className="flex items-center gap-2 font-semibold text-rose-800">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>Gagal Memuat Data Persil</span>
              </div>
              <p className="text-[11px] text-rose-700 leading-relaxed">{loadError}</p>
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  setLoadError(null);
                  setReload((prev) => prev + 1);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-medium transition-all duration-200 hover:opacity-90 active:scale-[0.97] text-xs shadow-xs cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Coba Lagi</span>
              </button>
            </div>
          )}

          {/* ── KPI Stats Grid ────────────────────────────────────────── */}
          {loading ? (
            <div className="grid grid-cols-2 gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-white border border-slate-200 rounded-2xl p-3.5 animate-pulse space-y-2.5">
                  <div className="h-2.5 w-14 bg-slate-200 rounded-full" />
                  <div className="h-7 w-10 bg-slate-300 rounded-lg" />
                  <div className="h-2 w-20 bg-slate-200 rounded-full" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {/* Total NIB */}
              <div className="kpi-slate border rounded-2xl p-3 sm:p-3.5 shadow-xs">
                <span className="text-[10px] sm:text-[11px] text-slate-500 font-semibold tracking-wide uppercase">Total NIB</span>
                <div className="text-2xl sm:text-3xl font-black font-mono text-slate-800 mt-1 leading-none tabular-nums">{totalParcels}</div>
                <span className="text-[10px] text-slate-400 mt-1 block">Persil Sidikalang</span>
              </div>
              {/* KW 1 */}
              <div className="kpi-emerald border rounded-2xl p-3 sm:p-3.5 shadow-xs">
                <span className="text-[10px] sm:text-[11px] text-emerald-700 font-semibold tracking-wide uppercase">KKP: KW 1</span>
                <div className="text-2xl sm:text-3xl font-black font-mono text-emerald-700 mt-1 leading-none tabular-nums">{kw1Count}</div>
                <span className="text-[10px] text-emerald-600 mt-1 block">Spasial Lengkap</span>
              </div>
              {/* KW 4/5/6 */}
              <div className="kpi-amber border rounded-2xl p-3 sm:p-3.5 shadow-xs">
                <span className="text-[10px] sm:text-[11px] text-amber-700 font-semibold tracking-wide uppercase">KW 4/5/6</span>
                <div className="text-2xl sm:text-3xl font-black font-mono text-amber-700 mt-1 leading-none tabular-nums">{kw456Count}</div>
                <span className="text-[10px] text-amber-600 mt-1 block">Belum Terpetakan</span>
              </div>
              {/* Tumpang Tindih */}
              <div className="kpi-rose border rounded-2xl p-3 sm:p-3.5 shadow-xs">
                <span className="text-[10px] sm:text-[11px] text-rose-700 font-semibold tracking-wide uppercase">Overlap</span>
                <div className="text-2xl sm:text-3xl font-black font-mono text-rose-700 mt-1 leading-none tabular-nums">{conflictCount}</div>
                <span className="text-[10px] text-rose-600 mt-1 block">Indikasi Tumpang Tindih</span>
              </div>
            </div>
          )}

          {/* ── Daftar Persil Panel ──────────────────────────────────────── */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-3.5 sm:p-4 elevation-1 flex-1 flex flex-col min-h-[380px] lg:min-h-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-emerald-600" /> Daftar Persil
              </h2>
              <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md text-slate-600 font-mono font-semibold">
                {loading ? '...' : `${filteredParcels.length}`} Bidang
              </span>
            </div>

            {/* Search */}
            <div className="relative mb-2.5">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <Search className="h-3.5 w-3.5 text-slate-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (e.target.value) setFilterTab('SEMUA');
                }}
                placeholder="Cari NIB atau Pemilik..."
                className="w-full min-h-10 bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition-all duration-150"
              />
            </div>

            {/* KKP Filter Tabs */}
            <div className="grid grid-cols-4 gap-0.5 p-1 bg-slate-100 rounded-xl border border-slate-200/80 mb-2 text-[10px]">
              <button
                onClick={() => setFilterTab('SEMUA')}
                className={`py-1.5 rounded-lg font-semibold transition-all duration-150 active:scale-[0.97] ${filterTab === 'SEMUA' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Semua
              </button>
              <button
                onClick={() => setFilterTab('KW1')}
                className={`py-1.5 rounded-lg font-semibold transition-all duration-150 active:scale-[0.97] ${filterTab === 'KW1' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
              >
                KW 1
              </button>
              <button
                onClick={() => setFilterTab('KW456')}
                className={`py-1.5 rounded-lg font-semibold transition-all duration-150 active:scale-[0.97] ${filterTab === 'KW456' ? 'bg-amber-500 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
              >
                4/5/6
              </button>
              <button
                onClick={() => setFilterTab('CONFLICT')}
                className={`py-1.5 rounded-lg font-semibold transition-all duration-150 active:scale-[0.97] ${filterTab === 'CONFLICT' ? 'bg-rose-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Overlap
              </button>
            </div>

            {/* Program Filter */}
            <div className="flex items-center gap-0.5 p-1 bg-slate-100 rounded-xl border border-slate-200/80 mb-3 text-[10px] overflow-x-auto no-scrollbar">
              {[
                { id: 'ALL', label: 'Semua', icon: '' },
                { id: 'Wakaf', label: 'Wakaf', icon: '🕌' },
                { id: 'MBR', label: 'MBR', icon: '🏠' },
                { id: 'Rumah Ibadah', label: 'Ibadah', icon: '🏛️' },
                { id: 'Hibah', label: 'Hibah', icon: '🎁' },
                { id: 'Reguler', label: 'Reguler', icon: '📋' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setProgramFilter(item.id as typeof programFilter)}
                  className={`py-1 px-2 rounded-lg font-semibold transition-all duration-150 whitespace-nowrap shrink-0 flex items-center gap-0.5 ${
                    programFilter === item.id
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/70'
                  }`}
                >
                  {item.icon && <span>{item.icon}</span>}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            {/* Parcel list */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 scrollbar-thin">
              {loading ? (
                <div className="space-y-1.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 animate-pulse space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="h-3 w-24 bg-slate-200 rounded" />
                        <div className="h-3 w-8 bg-slate-200 rounded" />
                      </div>
                      <div className="h-2.5 w-32 bg-slate-200 rounded" />
                    </div>
                  ))}
                </div>
              ) : filteredParcels.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                  <div className="h-10 w-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 mb-3">
                    <Search className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-semibold text-slate-700">Tidak ada persil cocok</p>
                  <p className="text-[11px] text-slate-400 mt-1 max-w-[180px]">Ubah kata kunci atau ganti filter.</p>
                </div>
              ) : (
                filteredParcels.map((parcel) => (
                  <button
                    key={parcel.id}
                    onClick={() => setSelectedParcel(parcel)}
                    className={`w-full text-left p-2.5 rounded-xl border transition-all duration-150 active:scale-[0.98] group ${
                      selectedParcel?.id === parcel.id
                        ? 'parcel-item-selected'
                        : 'bg-slate-50/70 border-slate-200/80 hover:bg-white hover:border-slate-300 hover:shadow-xs'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-[11px] font-mono font-bold text-slate-900">{parcel.nib}</span>
                          {parcel.kkp_category && (
                            <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 font-mono font-bold">
                              {parcel.kkp_category}
                            </span>
                          )}
                          {(() => {
                            const prog = parcel.program_type || 'Reguler';
                            const conf = PROGRAM_CONFIG[prog] || PROGRAM_CONFIG.Reguler;
                            return (
                              <span
                                className={`text-[8px] px-1.5 py-0.5 rounded border font-semibold flex items-center gap-0.5 ${conf.badgeClass}`}
                                title={`Program: ${prog}`}
                              >
                                <span>{conf.icon}</span>
                                <span>{conf.label}</span>
                              </span>
                            );
                          })()}
                        </div>
                        <div className="text-[11px] text-slate-600 mt-0.5 font-medium truncate">{parcel.owner_name}</div>
                        <div className="text-[10px] text-slate-400 truncate">{parcel.village}</div>
                      </div>
                      <ChevronRight className={`h-4 w-4 shrink-0 mt-1 transition-transform ${selectedParcel?.id === parcel.id ? 'text-emerald-600 translate-x-0.5' : 'text-slate-300 group-hover:text-slate-400'}`} />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Panel Tengah: Peta Spasial Leaflet */}
        <div className="order-1 lg:order-2 lg:col-span-6 bg-white border border-slate-200/70 rounded-2xl p-1.5 h-[52vh] min-h-[360px] lg:h-[calc(100vh-130px)] lg:min-h-[600px] elevation-2 relative overflow-hidden">
          <ParcelMap
            parcels={filteredParcels}
            selectedParcel={selectedParcel}
            onSelectParcel={setSelectedParcel}
            isAdmin={isAdmin}
            onDeleteParcel={handleDeleteParcel}
          />
        </div>

        {/* Panel Kanan: Inspector Persil Dairi */}
        <div className="order-3 lg:col-span-3 flex flex-col gap-3">
          <div className="bg-white border border-slate-200/70 rounded-2xl p-3.5 sm:p-4 flex flex-col elevation-1">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Inspector Persil Dairi
            </h2>

            {loading ? (
              <div className="space-y-3.5 animate-pulse">
                <div className="h-14 rounded-xl bg-slate-100 border border-slate-200" />
                <div className="flex gap-2">
                  <div className="h-7 w-16 rounded-lg bg-slate-200" />
                  <div className="h-7 w-20 rounded-lg bg-slate-200" />
                  <div className="h-7 w-20 rounded-lg bg-slate-200" />
                </div>
                <div className="h-28 rounded-xl bg-slate-100 border border-slate-200" />
                <div className="h-28 rounded-xl bg-slate-100 border border-slate-200" />
                <div className="h-32 rounded-xl bg-slate-100 border border-slate-200" />
              </div>
            ) : selectedParcel ? (
              <div className="space-y-3 text-xs sm:text-sm">
                {(() => {
                  const isConflict = selectedParcel.is_overlapping === true || selectedParcel.status === 'Tumpang Tindih';
                  const isWarning = !isConflict && (
                    selectedParcel.status === 'Perlu Verifikasi' || 
                    (selectedParcel.deviation_percent !== null && Number(selectedParcel.deviation_percent) > 2.0)
                  );

                  if (isConflict) {
                    return (
                      <div className="p-3.5 rounded-2xl border flex items-center gap-3 bg-rose-50 border-rose-200/80 text-rose-900 shadow-xs">
                        <div className="h-9 w-9 rounded-xl bg-rose-100 border border-rose-200 flex items-center justify-center shrink-0">
                          <AlertTriangle className="h-4 w-4 text-rose-600" />
                        </div>
                        <div>
                          <div className="font-bold text-xs">Indikasi Tumpang Tindih</div>
                          <div className="text-[10px] text-rose-700 mt-0.5">Irisan area terdeteksi dengan persil lain</div>
                        </div>
                      </div>
                    );
                  }

                  if (isWarning) {
                    return (
                      <div className="p-3.5 rounded-2xl border flex items-center gap-3 bg-amber-50 border-amber-200/80 text-amber-900 shadow-xs">
                        <div className="h-9 w-9 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
                          <HelpCircle className="h-4 w-4 text-amber-600" />
                        </div>
                        <div>
                          <div className="font-bold text-xs">Perlu Verifikasi Lapangan</div>
                          <div className="text-[10px] text-amber-700 mt-0.5">Deviasi &gt; 2% / Geometri indikatif</div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="p-3.5 rounded-2xl border flex items-center gap-3 bg-emerald-50 border-emerald-200/80 text-emerald-900 shadow-xs">
                      <div className="h-9 w-9 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      </div>
                      <div>
                        <div className="font-bold text-xs">Lolos Cek Teknis Demo</div>
                        <div className="text-[10px] text-emerald-700 mt-0.5">Topologi bersih & deviasi wajar</div>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-100 border border-emerald-200 text-[11px] font-mono text-emerald-800 font-semibold">
                    {selectedParcel.kkp_category || 'KW -'}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-[11px] text-slate-700 font-medium">
                    {selectedParcel.hak_type || 'Hak Milik'}
                  </span>
                  {(() => {
                    const prog = selectedParcel.program_type || 'Reguler';
                    const conf = PROGRAM_CONFIG[prog] || PROGRAM_CONFIG.Reguler;
                    return (
                      <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 ${conf.badgeClass}`}>
                        <span>{conf.icon}</span>
                        <span>{prog}</span>
                      </span>
                    );
                  })()}
                  <span className="px-2 py-1 rounded-lg bg-slate-100 border border-slate-200 text-[10px] text-slate-500 font-mono">
                    src: {selectedParcel.geometry_source || 'survei'}
                  </span>
                </div>

                {/* Chunk 1: Informasi Identitas Bidang */}
                <dl className="inspector-section space-y-0 font-mono text-[11px]">
                  <div className="data-row">
                    <dt>NIB</dt>
                    <dd>{selectedParcel.nib}</dd>
                  </div>
                  <div className="data-row">
                    <dt>Program Sensus</dt>
                    <dd className="font-sans flex items-center gap-1.5">
                      <span>{PROGRAM_CONFIG[selectedParcel.program_type || 'Reguler']?.icon || '📋'}</span>
                      <span className="font-semibold">{selectedParcel.program_type || 'Reguler'}</span>
                    </dd>
                  </div>
                  <div className="data-row">
                    <dt>Pemilik</dt>
                    <dd className="font-sans font-medium">{selectedParcel.owner_name}</dd>
                  </div>
                  <div className="data-row" style={{ borderBottom: 'none' }}>
                    <dt>Desa</dt>
                    <dd className="font-sans">{selectedParcel.village}</dd>
                  </div>
                </dl>

                {/* Chunk 2: Kalkulasi Luas */}
                <dl className="inspector-section space-y-0">
                  <div className="flex items-center justify-between gap-2 pb-2 mb-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      Kalkulasi Luas (m²)
                    </span>
                  </div>
                  <div className="data-row">
                    <dt>Surat Dokumen</dt>
                    <dd>
                      {Number(selectedParcel.legal_area_m2) <= 0.01
                        ? <span className="text-slate-400 font-sans font-normal">Belum Ada</span>
                        : `${selectedParcel.legal_area_m2}`}
                    </dd>
                  </div>
                  <div className="data-row">
                    <dt>Hitung Spasial</dt>
                    <dd className="text-emerald-700">{selectedParcel.spatial_area_m2 ? `${selectedParcel.spatial_area_m2}` : '—'}</dd>
                  </div>
                  <div className="data-row" style={{ borderBottom: 'none' }}>
                    <dt>Margin Deviasi</dt>
                    <dd className={selectedParcel.deviation_percent !== null && Number(selectedParcel.deviation_percent) > 2.0 ? 'text-amber-600' : 'text-emerald-600'}>
                      {Number(selectedParcel.legal_area_m2) <= 0.01
                        ? <span className="font-sans font-normal text-slate-400">Perlu Warkah Fisik</span>
                        : selectedParcel.deviation_percent !== null
                          ? `${Number(selectedParcel.deviation_percent).toFixed(2)}%`
                          : '—'}
                    </dd>
                  </div>
                </dl>

                {/* Chunk 3: Catatan Lapangan */}
                <div className="inspector-section">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Catatan Lapangan</span>
                  <p className="text-[11px] text-slate-600 italic leading-relaxed">
                    &quot;{selectedParcel.surveyor_notes || '—'}&quot;
                  </p>
                </div>

                {/* Chunk 4: Dokumentasi Foto Lapangan & Data GPS Sensus */}
                <div className="inspector-section space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                      <Camera className="h-3.5 w-3.5 text-emerald-600" /> Foto & Lokasi Sensus
                    </span>
                    {selectedParcel.surveyed_at && (
                      <span className="text-[9px] text-emerald-800 font-mono bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded font-semibold tabular-nums">
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

                  {(() => {
                    const photoPaths = parsePhotoPaths(selectedParcel.photo_path);
                    if (photoPaths.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white p-4 text-center">
                          <Camera className="h-5 w-5 text-slate-400 mb-1" />
                          <span className="text-[11px] text-slate-600 font-medium">Belum ada foto lapangan</span>
                          <span className="text-[9px] text-slate-400 mt-0.5">Dapat disurvei melalui Mode Sensus</span>
                        </div>
                      );
                    }

                    const safeIdx = Math.min(activePhotoIdx, photoPaths.length - 1);
                    const activePath = photoPaths[safeIdx] || photoPaths[0];
                    // Gunakan URL murni tanpa transform agar kompatibel penuh dengan Supabase Free Tier
                    const photoUrl = supabase.storage.from('parcel-photos').getPublicUrl(activePath).data.publicUrl;

                    return (
                      <div className="space-y-2">
                        {/* Pratinjau Utama Foto Aktif */}
                        <div className="relative">
                          <a
                            href={photoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group relative block overflow-hidden rounded-xl border border-slate-200 bg-slate-100 aspect-video w-full shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                            title="Klik untuk membuka foto resolusi penuh di tab baru"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photoUrl}
                              alt={`Foto lapangan NIB ${selectedParcel.nib} (#${safeIdx + 1})`}
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                            <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-semibold gap-1.5 backdrop-blur-[1px]">
                              <span>Buka Resolusi Penuh</span>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </div>
                            {photoPaths.length > 1 && (
                              <span className="absolute top-2 right-2 bg-slate-950/75 backdrop-blur-sm text-white text-[10px] font-mono px-2 py-0.5 rounded-full border border-white/20 shadow-xs pointer-events-none tabular-nums">
                                {safeIdx + 1} / {photoPaths.length}
                              </span>
                            )}
                          </a>
                        </div>

                        {/* Galeri Thumbnail jika memiliki lebih dari 1 foto */}
                        {photoPaths.length > 1 && (
                          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar">
                            {photoPaths.map((pPath, idx) => {
                              // URL murni tanpa transform untuk thumbnail
                              const miniThumbUrl = supabase.storage.from('parcel-photos').getPublicUrl(pPath).data.publicUrl;
                              const isSelected = idx === safeIdx;

                              return (
                                <button
                                  key={pPath + idx}
                                  type="button"
                                  onClick={() => setActivePhotoIdx(idx)}
                                  className={`relative h-12 w-12 shrink-0 rounded-lg overflow-hidden border transition-all cursor-pointer ${
                                    isSelected
                                      ? 'ring-2 ring-emerald-500 border-emerald-500 scale-105'
                                      : 'border-slate-200 opacity-70 hover:opacity-100 hover:border-slate-400'
                                  }`}
                                  title={`Pilih foto #${idx + 1}`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={miniThumbUrl}
                                    alt={`Thumbnail ${idx + 1}`}
                                    className="h-full w-full object-cover"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                    }}
                                  />
                                  <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[8px] font-mono text-center leading-tight">
                                    #{idx + 1}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Metadata GPS / Centroid jika tersedia */}
                  {selectedParcel.gps_lat !== null && selectedParcel.gps_lat !== undefined && selectedParcel.gps_lng !== null && selectedParcel.gps_lng !== undefined && (
                    <dl className="pt-2 border-t border-slate-200/70 space-y-0 font-mono text-[10px]">
                      <div className="data-row">
                        <dt className="flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-emerald-600" />
                          <span>
                            {selectedParcel.gps_accuracy_m !== null && selectedParcel.gps_accuracy_m !== undefined
                              ? 'Koordinat GPS'
                              : 'Centroid Poligon'}
                          </span>
                        </dt>
                        <dd className="tabular-nums">
                          {Number(selectedParcel.gps_lat).toFixed(6)}, {Number(selectedParcel.gps_lng).toFixed(6)}
                        </dd>
                      </div>
                      <div className="data-row" style={{ borderBottom: 'none' }}>
                        <dt>
                          {selectedParcel.gps_accuracy_m !== null && selectedParcel.gps_accuracy_m !== undefined
                            ? 'Akurasi Perangkat'
                            : 'Status GPS'}
                        </dt>
                        {selectedParcel.gps_accuracy_m !== null && selectedParcel.gps_accuracy_m !== undefined ? (
                          <dd className="text-emerald-700 tabular-nums">±{Number(selectedParcel.gps_accuracy_m).toFixed(2)} m</dd>
                        ) : (
                          <dd className="text-amber-700 font-sans font-medium">Tanpa GPS (Poligon)</dd>
                        )}
                      </div>
                    </dl>
                  )}
                </div>

                <div className="space-y-2 pt-1">
                  <button 
                    onClick={() => handleExportCadCsv(selectedParcel)}
                    disabled={!selectedParcel?.geojson}
                    title={!selectedParcel?.geojson ? 'Hanya tersedia untuk bidang dengan poligon' : 'Export koordinat patok batas ke format CSV/AutoCAD'}
                    className={`w-full min-h-11 py-2.5 px-3 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-medium text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xs transition-all duration-200 hover:opacity-90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                      !selectedParcel?.geojson ? 'opacity-50 cursor-not-allowed active:scale-100 hover:bg-white' : ''
                    }`}
                  >
                    <Download className="h-3.5 w-3.5 text-emerald-600" /> Export Patok (AutoCAD / CSV)
                  </button>
                  <button 
                    onClick={() => handleExportGeoJson(selectedParcel)}
                    disabled={!selectedParcel?.geojson}
                    title={!selectedParcel?.geojson ? 'Hanya tersedia untuk bidang dengan poligon' : 'Export layer geometri ke format GeoJSON/QGIS'}
                    className={`w-full min-h-11 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm shadow-emerald-950/20 transition-all duration-200 hover:opacity-90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                      !selectedParcel?.geojson ? 'opacity-50 cursor-not-allowed active:scale-100 hover:bg-emerald-600' : ''
                    }`}
                  >
                    <FileCode className="h-3.5 w-3.5" /> Export Layer (QGIS / GeoJSON)
                  </button>

                  {/* Tombol Hapus Data Khusus Role Admin */}
                  {isAdmin && (
                    <div className="pt-2 border-t border-slate-200">
                      <button
                        type="button"
                        onClick={() => handleDeleteParcel(selectedParcel)}
                        disabled={isDeleting}
                        className="w-full min-h-11 py-2.5 px-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-medium text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm transition-all duration-200 hover:opacity-90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        title={`Hapus data NIB ${selectedParcel.nib} dari database (Akses Khusus Admin)`}
                      >
                        {isDeleting ? (
                          <>
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-white" />
                            <span>Menghapus data persil...</span>
                          </>
                        ) : (
                          <>
                            <Trash2 className="h-3.5 w-3.5 text-white" />
                            <span>Hapus Data Persil (Admin)</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>

              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center flex-1">
                <div className="h-12 w-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 mb-3 shadow-inner">
                  <Layers className="h-6 w-6 text-emerald-600" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800">Pilih Bidang Tanah</h3>
                <p className="text-xs text-slate-500 mt-1.5 max-w-[240px] leading-relaxed">
                  Klik salah satu bidang di peta spasial atau pilih dari daftar di samping untuk meninjau status KKP, kalkulasi luas, dan dokumentasi survei.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Modal Dialog Export Geodatabase */}
      <ExportModal
        isOpen={isExportModalOpen}
        isExporting={isExporting}
        progressText={exportProgressText}
        progressPercent={exportProgressPercent}
        onClose={() => setIsExportModalOpen(false)}
        onStartExport={handleStartExport}
      />

      {/* Modal Dialog Autentikasi Pengguna (Login & Register) */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={() => setReload((r) => r + 1)}
      />
    </div>
  );
}