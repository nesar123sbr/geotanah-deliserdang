'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Camera, CheckCircle2, LocateFixed, LoaderCircle } from 'lucide-react';
import { supabase, type ParcelData, type ProgramType } from '@/lib/supabase';
import type { SurveyPolygonResult } from '@/components/SurveyDrawMap';

const SurveyDrawMap = dynamic(() => import('@/components/SurveyDrawMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[340px] sm:h-[380px] w-full rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-xs text-slate-500 font-mono">
      Memuat Peta Delineasi Spasial...
    </div>
  ),
});

type SurveyParcel = Pick<ParcelData,
  'id' | 'nib' | 'owner_name' | 'village' | 'dataset_key' | 'is_demo'
  | 'gps_lat' | 'gps_lng' | 'gps_accuracy_m' | 'photo_path' | 'surveyed_at' | 'program_type'>;
type GpsFix = { lat: number; lng: number; accuracy: number };
type SurveyPhoto = { blob: Blob; extension: 'webp' | 'jpg'; width: number; height: number };
type PendingUpload = { nib: string; blob: Blob; path: string };

const BUCKET = 'parcel-photos';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
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

function createSurveyPhotoPath(nib: string, extension: string): string {
  const sanitizedNib = nib.replace(/[^a-zA-Z0-9]/g, '');
  return `surveys/${sanitizedNib}_${Date.now()}.${extension}`;
}

async function compressPhoto(file: File): Promise<SurveyPhoto> {
  if (!file.type.startsWith('image/')) throw new Error('Pilih berkas foto yang valid.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Foto sumber maksimal 25 MB. Pilih foto yang lebih kecil.');

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new window.Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Foto tidak dapat dibaca. Coba ambil foto JPEG dari kamera.'));
      image.src = sourceUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Ukuran foto tidak valid.');

    // Deteksi dukungan format WebP pada browser
    const testCanvas = document.createElement('canvas');
    testCanvas.width = 1;
    testCanvas.height = 1;
    let supportsWebP = false;
    try {
      supportsWebP = testCanvas.toDataURL('image/webp').startsWith('data:image/webp');
    } catch {
      // Browser tidak mendukung WebP, fallback ke JPEG
    }

    const encode = (cvs: HTMLCanvasElement, mime: string, q: number) =>
      new Promise<Blob | null>((resolve) => {
        cvs.toBlob(resolve, mime, q);
      });

    // Profil kompresi adaptif bertingkat (maksimal 5 tahap, target <= 250 KB)
    const ADAPTIVE_PROFILES: Array<{ maxDim: number; quality: number }> = [
      { maxDim: 1280, quality: 0.75 },
      { maxDim: 1280, quality: 0.65 },
      { maxDim: 1024, quality: 0.65 },
      { maxDim: 800, quality: 0.55 },
      { maxDim: 640, quality: 0.50 },
    ];

    const TARGET_MAX_BYTES = 250 * 1024; // 250 KB
    let bestBlob: Blob | null = null;
    let bestMeta = { width: 0, height: 0, quality: 0.75, maxDim: 1280 };

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Browser tidak mendukung pemrosesan foto.');

    for (let i = 0; i < ADAPTIVE_PROFILES.length; i++) {
      const step = ADAPTIVE_PROFILES[i];
      const scale = Math.min(1, step.maxDim / Math.max(image.naturalWidth, image.naturalHeight));
      const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
      const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, targetWidth, targetHeight);
      context.drawImage(image, 0, 0, targetWidth, targetHeight);

      let candidateBlob: Blob | null = null;
      if (supportsWebP) {
        try {
          candidateBlob = await encode(canvas, 'image/webp', step.quality);
        } catch {
          candidateBlob = null;
        }
      }
      if (!candidateBlob || candidateBlob.type !== 'image/webp') {
        candidateBlob = await encode(canvas, 'image/jpeg', step.quality);
      }

      if (candidateBlob && candidateBlob.size > 0) {
        if (!bestBlob || candidateBlob.size < bestBlob.size) {
          bestBlob = candidateBlob;
          bestMeta = {
            width: targetWidth,
            height: targetHeight,
            quality: step.quality,
            maxDim: step.maxDim,
          };
        }

        // Jika ukuran sudah mencapai target <= 250 KB, stop iterasi
        if (candidateBlob.size <= TARGET_MAX_BYTES) {
          break;
        }
      }
    }

    if (!bestBlob || !['image/webp', 'image/jpeg'].includes(bestBlob.type)) {
      throw new Error('Kompresi foto gagal. Gunakan browser yang mendukung JPEG atau WebP.');
    }
    if (bestBlob.size === 0 || bestBlob.size > MAX_UPLOAD_BYTES) {
      throw new Error('Foto hasil kompresi harus berukuran lebih dari 0 dan maksimal 5 MB.');
    }

    console.log(
      `[compressPhoto] Final: ${(bestBlob.size / 1024).toFixed(0)} KB, quality=${bestMeta.quality}, maxDim=${bestMeta.maxDim}`
    );

    return {
      blob: bestBlob,
      extension: bestBlob.type === 'image/webp' ? 'webp' : 'jpg',
      width: bestMeta.width,
      height: bestMeta.height,
    };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export default function SurveyPage() {
  const [parcels, setParcels] = useState<SurveyParcel[]>([]);
  const [nib, setNib] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [gps, setGps] = useState<GpsFix | null>(null);
  const [locating, setLocating] = useState(false);
  const [programType, setProgramType] = useState<ProgramType>('Reguler');
  const [photo, setPhoto] = useState<SurveyPhoto | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [savedPhotoPreview, setSavedPhotoPreview] = useState('');
  const [surveyPolygon, setSurveyPolygon] = useState<SurveyPolygonResult>({
    geojson: null,
    areaM2: null,
    points: [],
    centroid: null,
  });
  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [problem, setProblem] = useState('');
  const alive = useRef(true);
  const previewRef = useRef('');
  const savedPhotoRef = useRef('');
  const gpsRequest = useRef(0);
  const photoRequest = useRef(0);
  const submitLock = useRef(false);
  const pendingUpload = useRef<PendingUpload | null>(null);

  const cleanNib = nib.trim();
  const matchedParcel = cleanNib
    ? parcels.find((parcel) => parcel.nib.toLowerCase() === cleanNib.toLowerCase()) ?? null
    : null;
  const busy = locating || processing || submitting;
  const oldPhotoUrl = matchedParcel?.photo_path
    ? supabase.storage.from(BUCKET).getPublicUrl(matchedParcel.photo_path).data.publicUrl : '';


  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      gpsRequest.current += 1;
      photoRequest.current += 1;
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      if (savedPhotoRef.current) URL.revokeObjectURL(savedPhotoRef.current);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadParcels() {
      try {
        const rows: SurveyParcel[] = [];
        const pageSize = 500;
        for (let start = 0; ; start += pageSize) {
          const { data, error } = await supabase.from('parcels')
            .select('id,nib,owner_name,village,dataset_key,is_demo,gps_lat,gps_lng,gps_accuracy_m,photo_path,surveyed_at,program_type')
            .eq('dataset_key', 'dairi-demo').eq('is_demo', true)
            .order('nib').range(start, start + pageSize - 1)
            .abortSignal(controller.signal).returns<SurveyParcel[]>();
          if (error) throw error;
          if (controller.signal.aborted) return;
          rows.push(...(data ?? []));
          if (!data || data.length < pageSize) break;
        }
        setParcels(rows);
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(`${messageOf(error)} Pastikan migrasi SQL survei sudah dijalankan.`);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadParcels();
    return () => controller.abort();
  }, [reload]);

  function clearPhoto() {
    photoRequest.current += 1;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = '';
    pendingUpload.current = null;
    setPreviewUrl('');
    setPhoto(null);
  }

  function clearSavedPhoto() {
    if (savedPhotoRef.current) {
      URL.revokeObjectURL(savedPhotoRef.current);
      savedPhotoRef.current = '';
    }
    setSavedPhotoPreview('');
  }

  function handleNibChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setNib(value);
    clearSavedPhoto();
    setFeedback('');
    setProblem('');
    const clean = value.trim().toLowerCase();
    const found = parcels.find((p) => p.nib.toLowerCase() === clean);
    if (found?.program_type) {
      setProgramType(found.program_type);
    }
  }

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

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || submitLock.current || busy) return;
    clearPhoto();
    clearSavedPhoto();
    const request = ++photoRequest.current;
    setProcessing(true);
    setProblem('');
    setFeedback('');
    try {
      const compressed = await compressPhoto(file);
      if (!alive.current || request !== photoRequest.current) return;
      const url = URL.createObjectURL(compressed.blob);
      previewRef.current = url;
      setPreviewUrl(url);
      setPhoto(compressed);
    } catch (error) {
      if (alive.current && request === photoRequest.current) setProblem(messageOf(error));
    } finally {
      if (alive.current && request === photoRequest.current) setProcessing(false);
    }
  }

  async function submitSurvey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || busy) return;

    const hasPolygon = Boolean(surveyPolygon.geojson && surveyPolygon.points.length >= 3);
    const hasCoordinates = (gps && validGps(gps)) || (hasPolygon && surveyPolygon.centroid);

    if (cleanNib.length < 3 || !hasCoordinates || !photo) {
      setProblem('Lengkapi NIB (minimal 3 karakter), tentukan koordinat (ambil GPS atau delineasi poligon batas), dan pilih foto terlebih dahulu.');
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setFeedback('');
    setProblem('');
    let uploadedPath = '';
    try {
      const pending = pendingUpload.current;
      if (pending?.nib === cleanNib && pending.blob === photo.blob) {
        uploadedPath = pending.path;
      } else {
        const path = createSurveyPhotoPath(cleanNib, photo.extension);
        // ArrayBuffer makes the SDK send Cache-Control: max-age=31536000, immutable.
        const { error } = await supabase.storage.from(BUCKET).upload(path, await photo.blob.arrayBuffer(), {
          contentType: photo.blob.type,
          cacheControl: '31536000, immutable',
          upsert: false,
        });
        if (error) throw error;
        uploadedPath = path;
        pendingUpload.current = { nib: cleanNib, blob: photo.blob, path };
      }

      // Tentukan koordinat lat/lng dan akurasi: prioritaskan GPS jika diambil, fallback ke centroid poligon
      const finalLat = (gps && validGps(gps)) ? gps.lat : surveyPolygon.centroid![0];
      const finalLng = (gps && validGps(gps)) ? gps.lng : surveyPolygon.centroid![1];
      const finalAccuracy = (gps && validGps(gps)) ? gps.accuracy : null;

      // Append-only storage: panggil RPC v2 dengan dukungan poligon GeoJSON & tagging program
      const { data, error } = await supabase.rpc('submit_survey_data_v2', {
        p_nib: cleanNib,
        p_lat: finalLat,
        p_lng: finalLng,
        p_accuracy: finalAccuracy,
        p_photo_path: uploadedPath,
        p_geojson: surveyPolygon.geojson || null,
        p_program_type: programType,
      });
      if (error) throw error;
      if (alive.current) {
        const savedUrl = URL.createObjectURL(photo.blob);
        if (savedPhotoRef.current) URL.revokeObjectURL(savedPhotoRef.current);
        savedPhotoRef.current = savedUrl;
        setSavedPhotoPreview(savedUrl);

        setReload((value) => value + 1);
        clearPhoto();
        setGps(null);
        setProgramType('Reguler');
        setSurveyPolygon({
          geojson: null,
          areaM2: null,
          points: [],
          centroid: null,
        });

        const polygonNote = (data as { has_polygon?: boolean; spatial_area_m2?: number })?.has_polygon
          ? ` lengkap dengan poligon batas (${(data as { spatial_area_m2?: number }).spatial_area_m2} m²)`
          : '';
        setFeedback(`Survei NIB ${cleanNib} berhasil disimpan${polygonNote}. Foto sebelumnya tetap tersimpan.`);
        window.alert(`Survei NIB ${cleanNib} berhasil disimpan${polygonNote}.`);
      }
    } catch (error) {
      if (alive.current) {
        const detail = messageOf(error);
        const retryNote = uploadedPath
          ? ' Foto sudah terunggah. Coba kirim lagi tanpa mengganti bidang atau foto; berkas yang sama akan digunakan.' : '';
        setProblem(detail + retryNote);
        // Preserve the server RAISE EXCEPTION message, including unknown NIB errors.
        window.alert(`Gagal menyimpan survei: ${detail}${retryNote}`);
      }
    } finally {
      submitLock.current = false;
      if (alive.current) setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:py-10">
      <div className="mx-auto max-w-xl">
        <Link 
          href="/" 
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-xs transition-all duration-150 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 mb-6"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Kembali ke peta
        </Link>
        <header className="mb-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100/80 border border-emerald-300/80 text-emerald-800 text-xs font-semibold uppercase tracking-wider mb-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
            GeoTanah Dairi · Mode Sensus
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Survei Lapangan</h1>
          <p className="mt-1.5 text-sm text-slate-600">Daftarkan NIB atau pilih bidang, ambil koordinat GPS terverifikasi, lalu simpan dokumentasi foto.</p>
        </header>
        <aside className="mb-6 rounded-2xl border border-amber-200/80 bg-amber-50/80 p-4 text-xs text-amber-900 space-y-1">
          <p className="font-semibold text-amber-950">Mode Demonstrasi Lapangan</p>
          <p className="leading-relaxed">
            Foto dan koordinat yang dikirim akan tersimpan di cloud storage demo publik. Mohon hindari memotret dokumen berdata pribadi atau wajah. Akurasi GPS ponsel bergantung pada visibilitas satelit.
          </p>
        </aside>

        {loading ? (
          <div className="space-y-4" role="status" aria-label="Memuat daftar bidang demo">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
              <div className="h-5 w-44 bg-slate-200 rounded-lg animate-pulse" />
              <div className="h-3.5 w-32 bg-slate-100 rounded-md animate-pulse" />
              <div className="h-12 w-full bg-slate-100 rounded-xl animate-pulse" />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
              <div className="h-5 w-36 bg-slate-200 rounded-lg animate-pulse" />
              <div className="h-3.5 w-60 bg-slate-100 rounded-md animate-pulse" />
              <div className="h-12 w-full bg-slate-100 rounded-xl animate-pulse" />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
              <div className="h-5 w-40 bg-slate-200 rounded-lg animate-pulse" />
              <div className="h-3.5 w-72 bg-slate-100 rounded-md animate-pulse" />
              <div className="h-12 w-full bg-slate-100 rounded-xl animate-pulse" />
            </div>
          </div>
        ) : loadError ? (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800 space-y-3">
            <p className="text-sm font-medium">{loadError}</p>
            <button 
              type="button" 
              onClick={() => { setLoading(true); setLoadError(''); setReload((value) => value + 1); }} 
              className={`${buttonClass} bg-white text-slate-800 border border-red-200 hover:bg-red-100/50`}
            >
              Coba muat lagi
            </button>
          </div>
        ) : (
          <form onSubmit={submitSurvey} className="space-y-5" aria-busy={submitting}>
            <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-3">
              <h2 className="text-base font-semibold text-slate-900">1. Identifikasi Bidang Tanah (NIB)</h2>
              <label htmlFor="survey-nib" className="block text-sm font-medium text-slate-700">Ketik atau pilih NIB</label>
              <input
                id="survey-nib"
                list="nib-list"
                value={nib}
                disabled={busy}
                onChange={handleNibChange}
                placeholder="Ketik atau pilih NIB..."
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all disabled:bg-slate-100 disabled:opacity-60"
                autoComplete="off"
              />
              <datalist id="nib-list">
                {parcels.map((p) => (
                  <option key={p.id} value={p.nib}>
                    {p.owner_name} · {p.village}
                  </option>
                ))}
              </datalist>

              {parcels.length === 0 && (
                <p className="text-xs text-amber-700">Tidak ada bidang demo tersedia. Anda tetap dapat mendaftarkan NIB baru.</p>
              )}

              {cleanNib.length >= 3 ? (
                matchedParcel ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs text-emerald-900 space-y-1">
                    <p className="font-semibold text-emerald-800 text-sm">Ditemukan: {matchedParcel.owner_name} - {matchedParcel.village}</p>
                    <p className="text-emerald-700">
                      {matchedParcel.surveyed_at
                        ? `Survei terakhir: ${new Date(matchedParcel.surveyed_at).toLocaleString('id-ID')}`
                        : 'Belum ada data survei tersimpan.'}
                    </p>
                    {oldPhotoUrl && (
                      <a
                        href={oldPhotoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-10 items-center font-semibold text-emerald-700 underline hover:text-emerald-800 pt-1"
                      >
                        Lihat foto tersimpan terdahulu ↗
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-3.5 text-xs text-blue-900 space-y-1">
                    <p className="font-semibold text-blue-800 text-sm">NIB baru - akan didaftarkan sebagai bidang demo</p>
                    <p className="text-blue-700">Bidang baru akan didaftarkan sebagai demo dairi saat survei disimpan.</p>
                  </div>
                )
              ) : cleanNib.length > 0 ? (
                <p className="text-xs text-amber-700">Ketik minimal 3 karakter untuk NIB.</p>
              ) : null}

              <div className="pt-3 border-t border-slate-100 space-y-1.5">
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
              />
            </section>

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

            <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-3">
              <h2 className="text-base font-semibold text-slate-900">4. Ambil Foto Lapangan</h2>
              <p className="text-xs text-slate-500">Foto dikompresi otomatis (maks. 1280px) menggunakan format WebP/JPEG hemat kuota.</p>
              <label htmlFor="survey-photo" className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
                <Camera className="h-4 w-4 text-emerald-600" aria-hidden="true" /> Buka kamera atau pilih berkas foto
              </label>
              <input 
                id="survey-photo" 
                type="file" 
                accept="image/*" 
                capture="environment" 
                disabled={busy}
                onChange={choosePhoto} 
                className="min-h-12 w-full rounded-xl border border-slate-300 p-2 text-xs file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:font-semibold file:text-emerald-800 hover:file:bg-emerald-100 disabled:opacity-50 transition-all cursor-pointer" 
              />
              <p role="status" className="text-xs text-slate-500">
                {processing ? 'Menyiapkan dan mengompresi foto...' : photo ? `${photo.extension.toUpperCase()} · ${photo.width} × ${photo.height} piksel · ${(photo.blob.size / 1024).toFixed(0)} KB` : 'Foto hasil kompresi maksimal 5 MB. Sumber maksimal 25 MB.'}
              </p>
              {previewUrl && photo && (
                <div className="relative mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                  <Image 
                    src={previewUrl} 
                    alt="Pratinjau foto lapangan yang akan dikirim" 
                    width={photo.width} 
                    height={photo.height} 
                    unoptimized 
                    className="max-h-80 w-full object-contain" 
                  />
                </div>
              )}
            </section>

            {problem && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-800">{problem}</p>}
            {feedback && <p role="status" className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-800"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />{feedback}</p>}
            
            <button 
              type="submit" 
              disabled={cleanNib.length < 3 || (!gps && !(surveyPolygon.geojson && surveyPolygon.points.length >= 3)) || !photo || busy}
              className={`${buttonClass} w-full bg-emerald-700 text-white shadow-md shadow-emerald-700/20 hover:bg-emerald-800 active:scale-[0.98]`}
            >
              {submitting && <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />}
              {submitting ? 'Mengunggah foto dan menyimpan data...' : 'Simpan Data Survei'}
            </button>

            {savedPhotoPreview && (
              <div role="status" className="flex items-center gap-3.5 rounded-2xl border border-emerald-200 bg-emerald-50/90 p-4 text-emerald-950 shadow-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={savedPhotoPreview}
                  alt="Foto yang baru tersimpan"
                  className="h-14 w-14 rounded-xl object-cover border border-emerald-300 shrink-0 bg-white"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 font-bold text-sm text-emerald-800">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Foto tersimpan ✓</span>
                  </div>
                  <p className="text-xs text-emerald-700 mt-0.5 truncate">
                    Foto lapangan berhasil disimpan untuk NIB <span className="font-mono font-semibold">{cleanNib}</span>
                  </p>
                </div>
              </div>
            )}

            <p className="pb-6 text-center text-xs text-slate-500">Pastikan NIB benar sebelum menyimpan. Foto lama tidak dihapus.</p>
          </form>
        )}
      </div>
    </main>
  );
}
