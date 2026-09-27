'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { 
  ArrowLeft, Camera, CheckCircle2, LocateFixed, LoaderCircle, 
  FileUp, AlertCircle, Trash2, RefreshCw, X 
} from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { supabase, type ProgramType } from '@/lib/supabase';
import type { SurveyPolygonResult } from '@/components/SurveyDrawMap';
import { parseGeoFile, formatAreaM2 } from '@/lib/parseGeoFile';

const SurveyDrawMap = dynamic(() => import('@/components/SurveyDrawMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[50vh] min-h-[350px] sm:h-[420px] md:h-[480px] w-full rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-xs text-slate-500 font-mono">
      Memuat Peta Delineasi Spasial...
    </div>
  ),
});

type GpsFix = { lat: number; lng: number; accuracy: number };

interface PhotoItem {
  id: string;
  blob: Blob;
  previewUrl: string;
  sizeKb: number;
  extension: 'webp' | 'jpg';
}

const BUCKET = 'parcel-photos';
const MAX_PHOTOS = 3;
const buttonClass = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2';

function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Terjadi kesalahan. Periksa koneksi internet lalu coba lagi.';
}

function validGps({ lat, lng, accuracy }: GpsFix): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180
    && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 1000;
}

function createSurveyFolder(owner: string, nibVal: string): string {
  const sanitize = (str: string) =>
    str
      .trim()
      .replace(/[\/\\?%*:|"<>]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_');

  const cleanOwner = sanitize(owner) || 'Tanpa_Nama';
  const cleanNib = sanitize(nibVal) || 'Tanpa_NIB';
  return `${cleanOwner}_${cleanNib}`;
}

/**
 * Kompresi foto secara client-side menggunakan browser-image-compression
 * Target maksimal 250 KB dan otomatis dikonversi ke format WebP
 */
async function compressPhotoToWebp(file: File): Promise<{ blob: Blob; extension: 'webp' | 'jpg'; sizeKb: number }> {
  if (!file.type.startsWith('image/')) throw new Error('Pilih berkas foto yang valid.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Foto sumber maksimal 25 MB.');

  const options = {
    maxSizeMB: 0.25, // Target <= 250 KB
    maxWidthOrHeight: 1280,
    useWebWorker: true,
    fileType: 'image/webp' as const,
    initialQuality: 0.75,
  };

  try {
    const compressedBlob = await imageCompression(file, options);
    return {
      blob: compressedBlob,
      extension: compressedBlob.type === 'image/webp' ? 'webp' : 'jpg',
      sizeKb: Math.max(1, Math.round(compressedBlob.size / 1024)),
    };
  } catch (err) {
    console.warn('[compressPhotoToWebp] Web worker gagal, beralih ke mode sinkron:', err);
    const fallbackOptions = { ...options, useWebWorker: false };
    const compressedBlob = await imageCompression(file, fallbackOptions);
    return {
      blob: compressedBlob,
      extension: compressedBlob.type === 'image/webp' ? 'webp' : 'jpg',
      sizeKb: Math.max(1, Math.round(compressedBlob.size / 1024)),
    };
  }
}

export default function SurveyPage() {
  const [nib, setNib] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [address, setAddress] = useState('');
  const [gps, setGps] = useState<GpsFix | null>(null);
  const [locating, setLocating] = useState(false);
  const [programType, setProgramType] = useState<ProgramType>('Reguler');

  // Sesi pengguna terdeteksi (opsional untuk metadata surveyor)
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  // Multi-photo state (hingga 3 foto)
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [savedPhotos, setSavedPhotos] = useState<string[]>([]);
  const [savedFolder, setSavedFolder] = useState<string>('');
  const photoInputRef = useRef<HTMLInputElement>(null);
  const replaceIndexRef = useRef<number | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const [surveyPolygon, setSurveyPolygon] = useState<SurveyPolygonResult>({
    geojson: null,
    areaM2: null,
    points: [],
    centroid: null,
  });
  const [importedPoints, setImportedPoints] = useState<[number, number][] | null>(null);
  const [mapResetKey, setMapResetKey] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<{
    type: 'success' | 'error';
    message: string;
    details?: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [problem, setProblem] = useState('');
  const alive = useRef(true);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const gpsRequest = useRef(0);
  const submitLock = useRef(false);

  const cleanNib = nib.trim();
  const busy = locating || processing || submitting;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      gpsRequest.current += 1;
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
    };
  }, []);

  // Deteksi sesi pengguna jika sudah login sebelumnya (opsional untuk catatan warkah detail_lokasi.txt)
  useEffect(() => {
    async function loadUser() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setCurrentUserEmail(user?.email ?? null);
      } catch {
        // Abaikan jika tidak ada sesi
      }
    }
    void loadUser();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUserEmail(session?.user?.email ?? null);
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  const handleImportGeoFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportNotice(null);

    try {
      const result = await parseGeoFile(file);
      setImportedPoints(result.polygon);

      // Auto-fill NIB & atribut dari metadata properties berkas jika ada
      const props = result.properties;
      const nibCandidate =
        props.nib ||
        props.NIB ||
        props.Nib ||
        props.name ||
        props.Name ||
        props.title ||
        props.Title ||
        props.id ||
        props.ID;

      let filledNibText = '';
      if (nibCandidate && typeof nibCandidate === 'string' && nibCandidate.trim().length >= 3) {
        const cleanVal = nibCandidate.trim();
        setNib(cleanVal);
        filledNibText = `NIB "${cleanVal}" otomatis terisi dari berkas.`;
      }

      const ownerCandidate = props.owner_name || props.pemilik || props.owner || props.Nama_Pemilik;
      if (ownerCandidate && typeof ownerCandidate === 'string') {
        setOwnerName(ownerCandidate.trim());
      }
      const addressCandidate = props.address || props.alamat || props.lokasi || props.Alamat;
      if (addressCandidate && typeof addressCandidate === 'string') {
        setAddress(addressCandidate.trim());
      }

      setImportNotice({
        type: 'success',
        message: `Berhasil mengimpor poligon batas (${result.format.toUpperCase()})`,
        details: `${result.polygon.length} patok terpasang · Luas: ${formatAreaM2(result.areaM2)} ${filledNibText ? `· ${filledNibText}` : ''}`,
      });
    } catch (err) {
      setImportNotice({
        type: 'error',
        message: messageOf(err),
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  function captureGps() {
    if (busy || submitLock.current) return;
    setProblem('');
    setFeedback('');
    setGps(null);
    if (!window.isSecureContext || !navigator.geolocation) {
      setProblem('GPS memerlukan HTTPS (atau localhost) dan browser yang mendukung lokasi.');
      return;
    }
    const request = ++gpsRequest.current;
    setLocating(true);
    navigator.geolocation.getCurrentPosition((position) => {
      if (!alive.current || request !== gpsRequest.current) return;
      const fix = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
      setLocating(false);
      if (!validGps(fix)) {
        setProblem('Koordinat tidak valid atau akurasi melebihi 1000 meter. Pindah ke tempat terbuka dan ambil GPS lagi.');
        return;
      }
      setGps(fix);
    }, (error) => {
      if (!alive.current || request !== gpsRequest.current) return;
      setLocating(false);
      const messages: Record<number, string> = {
        1: 'Izin lokasi ditolak. Izinkan akses lokasi pada pengaturan browser.',
        2: 'Lokasi belum tersedia. Aktifkan GPS dan pindah ke tempat terbuka.',
        3: 'GPS belum ditemukan dalam 15 detik. Pindah ke tempat terbuka dan coba lagi.',
      };
      setProblem(messages[error.code] ?? error.message);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  async function handleAddPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0 || busy || submitLock.current) return;
    event.target.value = '';

    const remainingSlots = MAX_PHOTOS - photos.length;
    if (remainingSlots <= 0) {
      setProblem(`Maksimal ${MAX_PHOTOS} foto diperbolehkan per survei.`);
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remainingSlots);
    setProcessing(true);
    setProblem('');
    setFeedback('');

    try {
      const newItems: PhotoItem[] = [];
      for (const file of filesToProcess) {
        const compressed = await compressPhotoToWebp(file);
        const previewUrl = URL.createObjectURL(compressed.blob);
        objectUrlsRef.current.add(previewUrl);
        newItems.push({
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          blob: compressed.blob,
          previewUrl,
          sizeKb: compressed.sizeKb,
          extension: compressed.extension,
        });
      }

      setPhotos((prev) => [...prev, ...newItems]);
    } catch (error) {
      const msg = messageOf(error);
      setProblem(msg);
      window.alert(`Peringatan Foto: ${msg}`);
    } finally {
      setProcessing(false);
    }
  }

  function handleRemovePhoto(indexToRemove: number) {
    setPhotos((prev) => {
      const target = prev[indexToRemove];
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
        objectUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter((_, idx) => idx !== indexToRemove);
    });
  }

  function triggerReplacePhoto(index: number) {
    replaceIndexRef.current = index;
    replaceInputRef.current?.click();
  }

  async function handleReplacePhotoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const targetIndex = replaceIndexRef.current;
    event.target.value = '';
    replaceIndexRef.current = null;

    if (!file || targetIndex === null || targetIndex >= photos.length || busy) return;

    setProcessing(true);
    setProblem('');

    try {
      const compressed = await compressPhotoToWebp(file);
      const newPreviewUrl = URL.createObjectURL(compressed.blob);
      objectUrlsRef.current.add(newPreviewUrl);

      setPhotos((prev) => {
        const next = [...prev];
        const oldItem = next[targetIndex];
        if (oldItem?.previewUrl) {
          URL.revokeObjectURL(oldItem.previewUrl);
          objectUrlsRef.current.delete(oldItem.previewUrl);
        }
        next[targetIndex] = {
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          blob: compressed.blob,
          previewUrl: newPreviewUrl,
          sizeKb: compressed.sizeKb,
          extension: compressed.extension,
        };
        return next;
      });
    } catch (err) {
      const msg = messageOf(err);
      setProblem(`Gagal mengganti foto: ${msg}`);
      window.alert(`Gagal mengganti foto: ${msg}`);
    } finally {
      setProcessing(false);
    }
  }

  async function submitSurvey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || busy) return;

    const hasPolygon = Boolean(surveyPolygon.geojson && surveyPolygon.points.length >= 3);
    const hasCoordinates = (gps && validGps(gps)) || (hasPolygon && surveyPolygon.centroid);

    if (cleanNib.length < 3 || !hasCoordinates || photos.length === 0) {
      const validationMsg = 'Lengkapi NIB (minimal 3 karakter), tentukan koordinat (ambil GPS atau delineasi poligon), dan ambil minimal 1 foto dokumentasi.';
      setProblem(validationMsg);
      window.alert(validationMsg);
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    setFeedback('');
    setProblem('');

    const uploadedPaths: string[] = [];
    try {
      const folderName = createSurveyFolder(ownerName, cleanNib);

      // 1. Unggah semua foto WebP terkompresi ke folder [nama_pemilik]_[NIB]/photo_N.webp
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const photoPath = `${folderName}/photo_${i + 1}.${p.extension}`;
        
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(
          photoPath,
          await p.blob.arrayBuffer(),
          {
            contentType: p.blob.type,
            cacheControl: '31536000, immutable',
            upsert: true,
          }
        );
        
        if (uploadError) {
          const detailMsg = `Gagal mengunggah foto #${i + 1} ke Storage (${uploadError.message}). Pastikan koneksi internet stabil dan kebijakan RLS Storage Supabase sudah dijalankan.`;
          window.alert(detailMsg);
          throw new Error(detailMsg);
        }
        
        uploadedPaths.push(photoPath);
      }

      const combinedPhotoPath = uploadedPaths.join(',');

      // Tentukan koordinat lat/lng dan akurasi
      const finalLat = (gps && validGps(gps)) ? gps.lat : surveyPolygon.centroid![0];
      const finalLng = (gps && validGps(gps)) ? gps.lng : surveyPolygon.centroid![1];
      const finalAccuracy = (gps && validGps(gps)) ? gps.accuracy : null;

      // 2. Generate dan unggah berkas detail_lokasi.txt ke dalam folder yang sama
      const txtContent = [
        '================================================================',
        '       GEOTANAH DAIRI — DOKUMENTASI DATA SURVEI LAPANGAN',
        '                 KANTOR PERTANAHAN KABUPATEN DAIRI',
        '================================================================',
        '',
        `NIB (Nomor Identifikasi Bidang) : ${cleanNib}`,
        `Nama Pemilik                    : ${ownerName.trim() || 'Tidak Disebutkan'}`,
        `Alamat / Dusun / RT-RW          : ${address.trim() || 'Tidak Disebutkan'}`,
        `Klasifikasi Program             : ${programType}`,
        `Waktu Perekaman                 : ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`,
        `Surveyor Pengunggah             : ${currentUserEmail || 'Anonim / Belum Login'}`,
        '',
        '----------------------------------------------------------------',
        'KOORDINAT & SPASIAL',
        '----------------------------------------------------------------',
        `Latitude                        : ${finalLat.toFixed(7)}`,
        `Longitude                       : ${finalLng.toFixed(7)}`,
        `Akurasi GPS Alat                : ${finalAccuracy !== null ? `±${finalAccuracy.toFixed(2)} meter` : 'N/A (Menggunakan Centroid Poligon)'}`,
        `Delineasi Poligon Batas         : ${surveyPolygon.geojson ? `Tersedia (${surveyPolygon.points.length} patok batas, Luas: ${surveyPolygon.areaM2 ? surveyPolygon.areaM2.toLocaleString('id-ID') : '-'} m²)` : 'Tidak ada (Hanya titik koordinat)'}`,
        '',
        '----------------------------------------------------------------',
        'DOKUMENTASI FOTO LAPANGAN',
        '----------------------------------------------------------------',
        `Total Berkas Foto WebP          : ${photos.length} berkas`,
        ...photos.map((p, idx) => `  - Foto #${idx + 1} : photo_${idx + 1}.${p.extension} (${p.sizeKb} KB)`),
        '',
        '================================================================',
      ].join('\r\n');

      const txtBlob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
      const txtPath = `${folderName}/detail_lokasi.txt`;

      const { error: txtError } = await supabase.storage.from(BUCKET).upload(
        txtPath,
        await txtBlob.arrayBuffer(),
        {
          contentType: 'text/plain;charset=utf-8',
          cacheControl: '3600',
          upsert: true,
        }
      );
      if (txtError) {
        const detailMsg = `Gagal mengunggah berkas detail_lokasi.txt ke Storage: ${txtError.message}`;
        window.alert(detailMsg);
        throw new Error(detailMsg);
      }

      // 3. Panggil RPC submit_survey_data_v2 dengan field nama pemilik, alamat, dan multi-foto
      const { data, error } = await supabase.rpc('submit_survey_data_v2', {
        p_nib: cleanNib,
        p_lat: finalLat,
        p_lng: finalLng,
        p_accuracy: finalAccuracy,
        p_photo_path: combinedPhotoPath,
        p_geojson: surveyPolygon.geojson || null,
        p_program_type: programType,
        p_owner_name: ownerName.trim() || null,
        p_address: address.trim() || null,
      });
      if (error) {
        const detailMsg = `Gagal menyimpan data ke database: ${error.message}`;
        window.alert(detailMsg);
        throw new Error(detailMsg);
      }

      if (alive.current) {
        // Simpan preview URL foto yang baru saja berhasil diunggah
        const savedUrls = photos.map((p) => p.previewUrl);
        setSavedPhotos(savedUrls);
        setSavedFolder(folderName);

        setPhotos([]);
        setGps(null);
        setProgramType('Reguler');
        setNib('');
        setOwnerName('');
        setAddress('');
        setSurveyPolygon({
          geojson: null,
          areaM2: null,
          points: [],
          centroid: null,
        });
        setImportedPoints(null);
        setMapResetKey((k) => k + 1);

        const polygonNote = (data as { has_polygon?: boolean; spatial_area_m2?: number })?.has_polygon
          ? ` lengkap dengan poligon batas (${(data as { spatial_area_m2?: number }).spatial_area_m2} m²)`
          : '';
        const successMsg = `Survei NIB ${cleanNib} (${uploadedPaths.length} foto & detail_lokasi.txt) berhasil disimpan di folder "${folderName}"${polygonNote}.`;
        setFeedback(successMsg);
        window.alert(successMsg);
      }
    } catch (error) {
      if (alive.current) {
        const detail = messageOf(error);
        setProblem(detail);
      }
    } finally {
      submitLock.current = false;
      if (alive.current) setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 sm:px-6 py-4 sm:py-8 text-slate-900">
      <div className="mx-auto max-w-2xl lg:max-w-3xl">
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          <Link 
            href="/" 
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-xs transition-all duration-150 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Kembali ke peta
          </Link>

          {/* Akses Terbuka Tanpa Hambatan Login (Input Terbuka) */}
          <div className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-200/90 px-3.5 py-2 text-xs shadow-xs text-slate-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-emerald-800">Mode Input Terbuka</span>
            {currentUserEmail && (
              <span className="hidden sm:inline font-mono text-[11px] text-slate-500 border-l border-slate-200 pl-2">
                {currentUserEmail}
              </span>
            )}
          </div>
        </div>

        <header className="mb-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100/80 border border-emerald-300/80 text-emerald-800 text-xs font-semibold uppercase tracking-wider mb-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
            GeoTanah Dairi · Mode Sensus
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Survei Lapangan Baru</h1>
          <p className="mt-1.5 text-sm text-slate-600">Ketik NIB baru, lengkapi pemilik & alamat, ambil koordinat GPS terverifikasi, serta unggah dokumentasi foto.</p>
        </header>

        <aside className="mb-6 rounded-2xl border border-amber-200/80 bg-amber-50/80 p-4 text-xs text-amber-900 space-y-1">
          <p className="font-semibold text-amber-950">Mode Demonstrasi Lapangan</p>
          <p className="leading-relaxed">
            Foto dan berkas detail lokasi akan tersimpan rapi per folder di cloud storage (<span className="font-mono font-semibold">[nama_pemilik]_[NIB]/</span>). Mohon hindari memotret dokumen berdata pribadi rahasia atau wajah.
          </p>
        </aside>

        <form onSubmit={submitSurvey} className="space-y-5" aria-busy={submitting}>
          {/* Section 1: Identifikasi Bidang & Pemilik */}
          <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-3.5">
            <h2 className="text-base font-semibold text-slate-900">1. Identifikasi Bidang Tanah & Pemilik</h2>
            
            <div className="space-y-1">
              <label htmlFor="survey-nib" className="block text-sm font-medium text-slate-700">
                Nomor Identifikasi Bidang (NIB)
              </label>
              <input
                id="survey-nib"
                type="text"
                value={nib}
                disabled={busy}
                onChange={(e) => {
                  setNib(e.target.value);
                  setFeedback('');
                  setProblem('');
                }}
                placeholder="Ketik NIB data baru (contoh: 02.03.04.05.00123)..."
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all disabled:bg-slate-100 disabled:opacity-60"
                autoComplete="off"
              />
              <p className="text-xs text-slate-500">
                Masukkan NIB bidang tanah baru yang sedang disurvei.
              </p>
            </div>

            {/* Form Input: Nama Pemilik dan Alamat */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="space-y-1">
                <label htmlFor="survey-owner" className="block text-sm font-medium text-slate-700">
                  Nama Pemilik
                </label>
                <input
                  id="survey-owner"
                  type="text"
                  value={ownerName}
                  disabled={busy}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Nama pemilik tanah..."
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all disabled:bg-slate-100 disabled:opacity-60"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="survey-address" className="block text-sm font-medium text-slate-700">
                  Alamat / Dusun / RT-RW
                </label>
                <input
                  id="survey-address"
                  type="text"
                  value={address}
                  disabled={busy}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Alamat atau lokasi tanah..."
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all disabled:bg-slate-100 disabled:opacity-60"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 space-y-1.5">
              <label htmlFor="survey-program" className="block text-sm font-medium text-slate-700">
                Jenis Program
              </label>
              <select
                id="survey-program"
                value={programType}
                disabled={busy}
                onChange={(e) => setProgramType(e.target.value as ProgramType)}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all disabled:bg-slate-100 disabled:opacity-60 cursor-pointer"
              >
                <option value="Reguler">📋 Reguler (Rutin / Non-Target Khusus)</option>
                <option value="Wakaf">🕌 Wakaf (Tanah Wakaf Keagamaan)</option>
                <option value="Rumah Ibadah">🏛️ Rumah Ibadah (Gereja, Masjid, Vihara, Kuil)</option>
                <option value="MBR">🏠 MBR (Masyarakat Berpenghasilan Rendah)</option>
                <option value="Hibah">🎁 Hibah (Hibah Tanah Pemerintah/Masyarakat)</option>
              </select>
              <p className="text-xs text-slate-500">
                Pilih klasifikasi program pendaftaran bidang tanah sesuai target sensus Kantah Dairi.
              </p>
            </div>
          </section>

          {/* Section 2: Delineasi Batas Bidang */}
          <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <span>2. Delineasi Batas Bidang (Peta Kerja)</span>
                  <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                    Opsional
                  </span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Ketuk peta satelit di bawah untuk menandai titik-titik patok batas tanah (minimal 3 patok). Luas area dihitung real-time. Jika dilewati, sistem akan menggunakan titik GPS saja.
                </p>
              </div>
            </div>

            <SurveyDrawMap
              gps={gps}
              onPolygonChange={setSurveyPolygon}
              disabled={busy}
              importedPoints={importedPoints}
              resetKey={mapResetKey}
            />

            {/* Tombol & Uploader Import File GPS (Avenza / Locus / GPS Handheld) */}
            <div className="pt-2 space-y-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".geojson,.json,.gpx,.kml"
                disabled={busy || importing}
                onChange={handleImportGeoFile}
                className="hidden"
                id="survey-geo-file-input"
              />

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-slate-800">
                    Punya file batas dari Avenza Maps atau GPS?
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Mendukung format GeoJSON, GPX, atau KML (maks. 5 MB).
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy || importing}
                  onClick={() => fileInputRef.current?.click()}
                  className={`${buttonClass} border border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50 hover:border-emerald-400 text-xs py-2.5 px-3.5 shrink-0 shadow-xs`}
                >
                  {importing ? (
                    <LoaderCircle className="h-4 w-4 animate-spin text-emerald-700" />
                  ) : (
                    <FileUp className="h-4 w-4 text-emerald-700" />
                  )}
                  <span>{importing ? 'Membaca Berkas...' : 'Import File GPS (GeoJSON/GPX/KML)'}</span>
                </button>
              </div>

              {importNotice && (
                <div
                  role="alert"
                  className={`rounded-xl p-3 text-xs border transition-all animate-in fade-in duration-200 ${
                    importNotice.type === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-red-200 bg-red-50 text-red-900'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {importNotice.type === 'success' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="font-semibold">{importNotice.message}</p>
                      {importNotice.details && (
                        <p className="text-[11px] opacity-90 mt-0.5">{importNotice.details}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Section 3: Ambil Lokasi GPS */}
          <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-3">
            <h2 className="text-base font-semibold text-slate-900">3. Ambil Lokasi GPS</h2>
            <p className="text-xs text-slate-500">Berdiri di batas bidang pada tempat terbuka, lalu tekan tombol untuk mencatat koordinat satelit.</p>
            <button 
              type="button" 
              onClick={captureGps} 
              disabled={busy}
              className={`${buttonClass} w-full border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:border-emerald-400`}
            >
              {locating ? <LoaderCircle className="h-5 w-5 animate-spin text-emerald-700" aria-hidden="true" /> : <LocateFixed className="h-5 w-5 text-emerald-700" aria-hidden="true" />}
              {locating ? 'Mencari sinyal GPS (maks. 15 detik)...' : gps ? 'Ambil ulang lokasi GPS' : 'Ambil lokasi GPS sekarang'}
            </button>
            <div aria-live="polite" className="text-xs text-slate-600">
              {gps ? (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 font-mono space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-sans">Latitude:</span>
                    <span className="text-slate-800 font-semibold">{gps.lat.toFixed(7)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-sans">Longitude:</span>
                    <span className="text-slate-800 font-semibold">{gps.lng.toFixed(7)}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-200">
                    <span className="text-slate-500 font-sans">Akurasi Perangkat:</span>
                    <span className="text-emerald-700 font-bold">±{gps.accuracy.toFixed(2)} meter</span>
                  </div>
                  {gps.accuracy > 50 && (
                    <p className="pt-1 text-[11px] text-amber-700 font-sans">
                      Akurasi masih rendah (&gt;50m). Disarankan mengambil ulang di tempat terbuka.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-slate-400 italic">Belum ada lokasi GPS baru tercatat.</p>
              )}
            </div>
          </section>

          {/* Section 4: Dokumentasi Foto Lapangan (UX Pre-Submit Preview & Replace) */}
          <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <span>4. Dokumentasi Foto Lapangan</span>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                    {photos.length} / {MAX_PHOTOS} Foto
                  </span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ambil hingga 3 foto (patok, tampak depan, lingkungan). Dikompresi otomatis ke WebP (&le;250 KB) dan disimpan ke folder spesifik.
                </p>
              </div>
            </div>

            {/* Input Tambah Foto */}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              disabled={busy || photos.length >= MAX_PHOTOS}
              onChange={handleAddPhotos}
              className="hidden"
              id="survey-photo-input"
            />

            {/* Input Ganti Foto Spesifik */}
            <input
              ref={replaceInputRef}
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={handleReplacePhotoFile}
              className="hidden"
              id="survey-photo-replace-input"
            />

            {/* Grid Thumbnail Foto yang sudah dipilih (Dengan tombol X cepat & Ganti Foto) */}
            {photos.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {photos.map((item, idx) => (
                  <div key={item.id} className="relative rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm space-y-2">
                    <div className="relative aspect-4/3 w-full rounded-xl overflow-hidden bg-slate-100 border border-slate-200/60">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.previewUrl}
                        alt={`Pratinjau Foto ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      
                      {/* Tombol X Batalkan Foto di pojok kanan atas */}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRemovePhoto(idx)}
                        title="Hapus / Batalkan foto ini"
                        className="absolute top-2 right-2 h-7 w-7 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center text-xs font-bold shadow-md cursor-pointer transition-transform active:scale-90"
                      >
                        <X className="h-4 w-4" />
                      </button>

                      {/* Badge info foto */}
                      <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/70 text-white text-[10px] font-mono font-semibold backdrop-blur-xs">
                        Foto #{idx + 1}
                      </span>
                      <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-emerald-600/90 text-white text-[10px] font-mono font-bold backdrop-blur-xs">
                        {item.sizeKb} KB · WebP
                      </span>
                    </div>

                    {/* Tombol Aksi Bawah: Ganti Foto & Hapus */}
                    <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => triggerReplacePhoto(idx)}
                        className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 text-xs font-semibold transition-all cursor-pointer"
                        title="Ambil ulang atau ganti foto pada slot ini"
                      >
                        <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                        <span>Ganti</span>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRemovePhoto(idx)}
                        className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 text-xs font-semibold transition-all cursor-pointer"
                        title="Hapus foto ini dari pilihan"
                      >
                        <Trash2 className="h-3.5 w-3.5 shrink-0" />
                        <span>Hapus</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tombol Ambil / Tambah Foto jika < 3 */}
            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                disabled={busy}
                onClick={() => photoInputRef.current?.click()}
                className={`${buttonClass} w-full border border-dashed border-emerald-400 bg-emerald-50/60 text-emerald-800 hover:bg-emerald-100/70 hover:border-emerald-500 py-3.5 cursor-pointer`}
              >
                {processing ? (
                  <>
                    <LoaderCircle className="h-5 w-5 animate-spin text-emerald-700" />
                    <span>Mengompresi Foto ke WebP...</span>
                  </>
                ) : (
                  <>
                    <Camera className="h-5 w-5 text-emerald-700" />
                    <span>
                      {photos.length === 0
                        ? 'Buka Kamera / Pilih Foto Lapangan'
                        : `+ Tambah Foto Lainnya (${photos.length}/${MAX_PHOTOS})`}
                    </span>
                  </>
                )}
              </button>
            )}

            {/* Status info */}
            <p role="status" className="text-xs text-slate-500">
              {processing
                ? 'Sedang memproses dan mengompresi gambar ke WebP secara client-side...'
                : photos.length === 0
                ? 'Minimal 1 foto diperlukan sebelum menyimpan survei.'
                : `${photos.length} foto siap diunggah ke folder [nama_pemilik]_[NIB] (Total: ${photos.reduce((acc, p) => acc + p.sizeKb, 0)} KB).`}
            </p>
          </section>

          {problem && (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-900 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">{problem}</div>
            </div>
          )}

          {feedback && (
            <p role="status" className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <span>{feedback}</span>
            </p>
          )}
          
          <button 
            type="submit" 
            disabled={cleanNib.length < 3 || (!gps && !(surveyPolygon.geojson && surveyPolygon.points.length >= 3)) || photos.length === 0 || busy}
            className={`${buttonClass} w-full bg-emerald-700 text-white shadow-md shadow-emerald-700/20 hover:bg-emerald-800 active:scale-[0.98]`}
          >
            {submitting && <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />}
            {submitting ? 'Mengunggah foto, detail_lokasi.txt & menyimpan data...' : 'Simpan Data Survei'}
          </button>

          {savedPhotos.length > 0 && (
            <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-4 text-emerald-950 shadow-xs space-y-2">
              <div className="flex items-center gap-1.5 font-bold text-sm text-emerald-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>Survei & Berkas Tersimpan di Cloud Storage ✓</span>
              </div>
              <p className="text-xs text-emerald-800 font-mono">
                Folder: <span className="font-semibold bg-emerald-100 px-1.5 py-0.5 rounded">{savedFolder}</span>
              </p>
              <div className="flex items-center gap-2 overflow-x-auto pt-1">
                {savedPhotos.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={url}
                    alt={`Foto tersimpan ${i + 1}`}
                    className="h-16 w-16 rounded-xl object-cover border border-emerald-300 shrink-0 bg-white"
                  />
                ))}
              </div>
            </div>
          )}

          <p className="pb-6 text-center text-xs text-slate-500">Pastikan data dan foto sesuai dengan kondisi lapangan sebelum menyimpan.</p>
        </form>
      </div>
    </main>
  );
}
