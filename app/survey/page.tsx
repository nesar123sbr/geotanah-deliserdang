'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { 
  ArrowLeft, Camera, CheckCircle2, LocateFixed, LoaderCircle, 
  FileUp, AlertCircle, Trash2, RefreshCw, X, ChevronUp, FileText
} from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { supabase, type ProgramType } from '@/lib/supabase';
import type { SurveyPolygonResult } from '@/components/SurveyDrawMap';
import { parseGeoFile, formatAreaM2 } from '@/lib/parseGeoFile';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const SurveyDrawMap = dynamic(() => import('@/components/SurveyDrawMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full min-h-[100dvh] w-full bg-slate-900 flex items-center justify-center text-xs text-slate-300 font-mono">
      <LoaderCircle className="h-5 w-5 animate-spin mr-2 text-emerald-400" />
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
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-semibold transition-all duration-200 hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2';

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
    console.warn('[compressPhotoToWebp] Web worker fallback to sync:', err);
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

  // Mobile Bottom Drawer Sheet state
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);

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

  // Deteksi sesi pengguna jika sudah login sebelumnya
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

      const notice = {
        type: 'success' as const,
        message: `Berhasil mengimpor poligon batas (${result.format.toUpperCase()})`,
        details: `${result.polygon.length} patok terpasang · Luas: ${formatAreaM2(result.areaM2)} ${filledNibText ? `· ${filledNibText}` : ''}`,
      };
      setImportNotice(notice);
      toast.success(notice.message, { description: notice.details });
    } catch (err) {
      const errMsg = messageOf(err);
      setImportNotice({
        type: 'error',
        message: errMsg,
      });
      toast.error(`Gagal impor berkas: ${errMsg}`);
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
      const msg = 'GPS memerlukan HTTPS (atau localhost) dan browser yang mendukung lokasi.';
      setProblem(msg);
      toast.error(msg);
      return;
    }
    const request = ++gpsRequest.current;
    setLocating(true);
    const toastId = toast.loading('Mencari sinyal GPS satelit...');

    navigator.geolocation.getCurrentPosition((position) => {
      if (!alive.current || request !== gpsRequest.current) return;
      const fix = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
      setLocating(false);
      if (!validGps(fix)) {
        const msg = 'Koordinat tidak valid atau akurasi melebihi 1000 meter. Pindah ke tempat terbuka dan ambil GPS lagi.';
        setProblem(msg);
        toast.error(msg, { id: toastId });
        return;
      }
      setGps(fix);
      toast.success(`GPS tercatat: ${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)} (Akurasi: ±${fix.accuracy.toFixed(1)}m)`, { id: toastId });
    }, (error) => {
      if (!alive.current || request !== gpsRequest.current) return;
      setLocating(false);
      const messages: Record<number, string> = {
        1: 'Izin lokasi ditolak. Izinkan akses lokasi pada pengaturan browser.',
        2: 'Lokasi belum tersedia. Aktifkan GPS dan pindah ke tempat terbuka.',
        3: 'GPS belum ditemukan dalam 15 detik. Pindah ke tempat terbuka dan coba lagi.',
      };
      const msg = messages[error.code] ?? error.message;
      setProblem(msg);
      toast.error(msg, { id: toastId });
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  async function handleAddPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0 || busy || submitLock.current) return;
    event.target.value = '';

    const remainingSlots = MAX_PHOTOS - photos.length;
    if (remainingSlots <= 0) {
      const msg = `Maksimal ${MAX_PHOTOS} foto diperbolehkan per survei.`;
      setProblem(msg);
      toast.error(msg);
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remainingSlots);
    setProcessing(true);
    setProblem('');
    setFeedback('');
    const toastId = toast.loading('Mengompresi foto ke format WebP...');

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
      toast.success(`${newItems.length} foto berhasil diproses dan dikompresi ke WebP`, { id: toastId });
    } catch (error) {
      const msg = messageOf(error);
      setProblem(msg);
      toast.error(`Peringatan Foto: ${msg}`, { id: toastId });
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
    toast.info(`Foto #${indexToRemove + 1} telah dihapus.`);
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
    const toastId = toast.loading(`Mengompresi foto baru pengganti #${targetIndex + 1}...`);

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
      toast.success(`Foto #${targetIndex + 1} berhasil diperbarui (${compressed.sizeKb} KB).`, { id: toastId });
    } catch (err) {
      const msg = messageOf(err);
      setProblem(`Gagal mengganti foto: ${msg}`);
      toast.error(`Gagal mengganti foto: ${msg}`, { id: toastId });
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
      toast.error(validationMsg);
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    setFeedback('');
    setProblem('');
    const toastId = toast.loading('Mengunggah foto & menyimpan data survei ke Cloud...');

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
          const detailMsg = `Gagal mengunggah foto #${i + 1} ke Storage (${uploadError.message}). Periksa koneksi dan RLS Storage.`;
          toast.error(detailMsg, { id: toastId });
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
        const detailMsg = `Gagal mengunggah berkas detail_lokasi.txt: ${txtError.message}`;
        toast.error(detailMsg, { id: toastId });
        throw new Error(detailMsg);
      }

      // 3. Panggil RPC submit_survey_data_v2
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
        const detailMsg = `Gagal menyimpan ke database: ${error.message}`;
        toast.error(detailMsg, { id: toastId });
        throw new Error(detailMsg);
      }

      if (alive.current) {
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
          ? ` (Poligon: ${(data as { spatial_area_m2?: number }).spatial_area_m2} m²)`
          : '';
        const successMsg = `Survei NIB ${cleanNib} (${uploadedPaths.length} foto) berhasil disimpan di folder "${folderName}"${polygonNote}.`;
        setFeedback(successMsg);
        toast.success(successMsg, { id: toastId, duration: 6000 });
        setIsMobileSheetOpen(false); // Tutup drawer di HP agar surveyor melihat peta
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

  // Render Form Input Data Tanah (Reused across Mobile Sheet & Desktop Sidebar)
  const renderFormContent = () => (
    <form onSubmit={submitSurvey} className="space-y-4" aria-busy={submitting}>
      {/* 1. Identifikasi Bidang & Pemilik */}
      <Card className="border-slate-200/90 shadow-xs">
        <CardHeader className="pb-3 pt-4 px-4 sm:px-5">
          <CardTitle className="text-sm sm:text-base font-semibold text-slate-900 flex items-center justify-between">
            <span>1. Identifikasi Bidang & Pemilik</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
              Wajib
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-4 sm:px-5 pb-4">
          <div className="space-y-1">
            <label htmlFor="survey-nib" className="block text-xs font-medium text-slate-700">
              Nomor Identifikasi Bidang (NIB) *
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
              placeholder="Contoh: 02.03.04.05.00123"
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all disabled:bg-slate-100 disabled:opacity-60"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <label htmlFor="survey-owner" className="block text-xs font-medium text-slate-700">
                Nama Pemilik
              </label>
              <input
                id="survey-owner"
                type="text"
                value={ownerName}
                disabled={busy}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Nama pemilik..."
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all disabled:bg-slate-100 disabled:opacity-60"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="survey-address" className="block text-xs font-medium text-slate-700">
                Alamat / Dusun / RT
              </label>
              <input
                id="survey-address"
                type="text"
                value={address}
                disabled={busy}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Lokasi tanah..."
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all disabled:bg-slate-100 disabled:opacity-60"
              />
            </div>
          </div>

          <div className="space-y-1 pt-1">
            <label htmlFor="survey-program" className="block text-xs font-medium text-slate-700">
              Klasifikasi Program
            </label>
            <select
              id="survey-program"
              value={programType}
              disabled={busy}
              onChange={(e) => setProgramType(e.target.value as ProgramType)}
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm text-slate-900 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all disabled:bg-slate-100 disabled:opacity-60 cursor-pointer"
            >
              <option value="Reguler">📋 Reguler (Rutin / Non-Target Khusus)</option>
              <option value="Wakaf">🕌 Wakaf (Tanah Wakaf Keagamaan)</option>
              <option value="Rumah Ibadah">🏛️ Rumah Ibadah (Gereja, Masjid, dll)</option>
              <option value="MBR">🏠 MBR (Masyarakat Berpenghasilan Rendah)</option>
              <option value="Hibah">🎁 Hibah (Pemerintah/Masyarakat)</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* 2. Ambil Lokasi GPS Presisi */}
      <Card className="border-slate-200/90 shadow-xs">
        <CardHeader className="pb-2 pt-4 px-4 sm:px-5">
          <CardTitle className="text-sm sm:text-base font-semibold text-slate-900 flex items-center justify-between">
            <span>2. Koordinat GPS Surveyor</span>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${gps ? 'bg-blue-100 text-blue-800 border border-blue-200' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
              {gps ? 'Tercatat ✓' : 'Opsional jika ada Poligon'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 px-4 sm:px-5 pb-4">
          <button 
            type="button" 
            onClick={captureGps} 
            disabled={busy}
            className={`${buttonClass} w-full bg-blue-600 hover:bg-blue-500 text-white shadow-xs cursor-pointer`}
          >
            {locating ? <LoaderCircle className="h-4 w-4 animate-spin text-white" /> : <LocateFixed className="h-4 w-4 text-white" />}
            <span>{locating ? 'Mencari sinyal GPS...' : gps ? 'Ambil Ulang Lokasi GPS' : 'Ambil Lokasi GPS Sekarang'}</span>
          </button>

          {gps ? (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 font-mono text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500 font-sans">Koordinat:</span>
                <span className="text-slate-800 font-semibold">{gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200/80 pt-1">
                <span className="text-slate-500 font-sans">Akurasi GPS:</span>
                <span className="text-emerald-700 font-bold">±{gps.accuracy.toFixed(1)} meter</span>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400 italic text-center">Belum ada titik GPS baru tercatat.</p>
          )}
        </CardContent>
      </Card>

      {/* 3. Dokumentasi Foto Lapangan */}
      <Card className="border-slate-200/90 shadow-xs">
        <CardHeader className="pb-2 pt-4 px-4 sm:px-5">
          <CardTitle className="text-sm sm:text-base font-semibold text-slate-900 flex items-center justify-between">
            <span>3. Dokumentasi Foto ({photos.length}/{MAX_PHOTOS})</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
              WebP &le;250 KB
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-4 sm:px-5 pb-4">
          {/* Tombol Ambil Foto jika < 3 */}
          {photos.length < MAX_PHOTOS && (
            <button
              type="button"
              disabled={busy}
              onClick={() => photoInputRef.current?.click()}
              className={`${buttonClass} w-full border border-dashed border-emerald-400 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100/80 hover:border-emerald-500 py-3 cursor-pointer`}
            >
              {processing ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin text-emerald-700" />
                  <span>Mengompresi ke WebP...</span>
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4 text-emerald-700" />
                  <span>
                    {photos.length === 0
                      ? 'Buka Kamera / Pilih Foto Lapangan'
                      : `+ Tambah Foto (${photos.length}/${MAX_PHOTOS})`}
                  </span>
                </>
              )}
            </button>
          )}

          {/* Grid Preview Foto */}
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((item, idx) => (
                <div key={item.id} className="relative rounded-xl border border-slate-200 bg-slate-50 p-1.5 space-y-1">
                  <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.previewUrl}
                      alt={`Foto ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleRemovePhoto(idx)}
                      title="Hapus foto ini"
                      className="absolute top-1 right-1 h-5 w-5 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center text-xs shadow-md cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <span className="absolute bottom-1 left-1 px-1.5 py-0.2 rounded bg-black/70 text-white text-[9px] font-mono">
                      {item.sizeKb} KB
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => triggerReplacePhoto(idx)}
                      className="py-1 px-1 rounded bg-blue-50 text-blue-700 text-[10px] font-medium hover:bg-blue-100 flex items-center justify-center cursor-pointer"
                      title="Ganti foto"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleRemovePhoto(idx)}
                      className="py-1 px-1 rounded bg-rose-50 text-rose-700 text-[10px] font-medium hover:bg-rose-100 flex items-center justify-center cursor-pointer"
                      title="Hapus foto"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Import GPS File Banner */}
          <div className="pt-1">
            <div className="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl">
              <div className="space-y-0.5 min-w-0">
                <p className="text-[11px] font-semibold text-slate-800 truncate">
                  File Batas Avenza/GPS?
                </p>
                <p className="text-[10px] text-slate-500">
                  GeoJSON/GPX/KML
                </p>
              </div>
              <button
                type="button"
                disabled={busy || importing}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 border border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50 text-[11px] font-medium py-1.5 px-2.5 rounded-lg shrink-0 shadow-2xs cursor-pointer"
              >
                {importing ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin text-emerald-700" />
                ) : (
                  <FileUp className="h-3.5 w-3.5 text-emerald-700" />
                )}
                <span>{importing ? 'Membaca...' : 'Impor File'}</span>
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Info Status Poligon */}
      {surveyPolygon.points.length > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-950 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>
              Poligon Batas: <strong>{surveyPolygon.points.length} patok</strong>
              {surveyPolygon.areaM2 ? ` (${formatAreaM2(surveyPolygon.areaM2)})` : ''}
            </span>
          </div>
        </div>
      )}

      {/* Warning/Error Banner */}
      {problem && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <div className="leading-relaxed">{problem}</div>
        </div>
      )}

      {/* Feedback Banner */}
      {feedback && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Submit Button */}
      <button 
        type="submit" 
        disabled={cleanNib.length < 3 || (!gps && !(surveyPolygon.geojson && surveyPolygon.points.length >= 3)) || photos.length === 0 || busy}
        className={`${buttonClass} w-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-950/20 py-3.5 text-sm cursor-pointer`}
      >
        {submitting ? (
          <>
            <LoaderCircle className="h-5 w-5 animate-spin text-white" />
            <span>Menyimpan ke Cloud Storage...</span>
          </>
        ) : (
          <>
            <CheckCircle2 className="h-5 w-5" />
            <span>Simpan Data Survei Lapangan</span>
          </>
        )}
      </button>

      {/* Saved Photos History */}
      {savedPhotos.length > 0 && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-emerald-950 space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-xs text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <span>Tersimpan di Cloud Storage ✓</span>
          </div>
          <p className="text-[11px] text-emerald-800 font-mono truncate">
            Folder: <span className="font-semibold bg-emerald-100 px-1 py-0.5 rounded">{savedFolder}</span>
          </p>
          <div className="flex items-center gap-2 overflow-x-auto pt-1">
            {savedPhotos.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={url}
                alt={`Foto tersimpan ${i + 1}`}
                className="h-12 w-12 rounded-lg object-cover border border-emerald-300 shrink-0 bg-white"
              />
            ))}
          </div>
        </div>
      )}
    </form>
  );

  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-900 flex flex-col lg:flex-row relative">
      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".geojson,.json,.gpx,.kml"
        disabled={busy || importing}
        onChange={handleImportGeoFile}
        className="hidden"
        id="survey-geo-file-input"
      />
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
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={handleReplacePhotoFile}
        className="hidden"
        id="survey-photo-replace-input"
      />

      {/* Peta Viewport Utama: Full-Screen di HP, Sebelah Kiri di Desktop */}
      <div className="relative flex-1 h-full w-full overflow-hidden">
        {/* Floating Top Nav Bar */}
        <div className="absolute top-3 left-3 right-3 z-[1000] flex items-center justify-between gap-2 pointer-events-none">
          <Link
            href="/"
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/90 backdrop-blur-md px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-md transition-all duration-200 hover:bg-white hover:text-slate-900 active:scale-[0.97]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Kembali ke Peta</span>
          </Link>

          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-white/90 backdrop-blur-md border border-slate-200/80 px-3.5 py-1.5 text-xs shadow-md text-slate-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-emerald-800">Mode Sensus</span>
            {currentUserEmail && (
              <span className="hidden md:inline font-mono text-[11px] text-slate-500 border-l border-slate-200 pl-2 max-w-[140px] truncate">
                {currentUserEmail}
              </span>
            )}
          </div>

          {/* Trigger Sheet di Mobile (Pojok Kanan Atas) */}
          <div className="pointer-events-auto lg:hidden">
            <Button
              type="button"
              onClick={() => setIsMobileSheetOpen(true)}
              className="rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-md text-xs font-semibold px-3.5 py-2 flex items-center gap-1.5 active:scale-[0.97]"
            >
              <FileText className="h-4 w-4" />
              <span>Isi Form</span>
              {photos.length > 0 && (
                <span className="h-4 w-4 rounded-full bg-white text-emerald-700 text-[10px] font-bold flex items-center justify-center">
                  {photos.length}
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Komponen Peta Leaflet Full-Screen */}
        <SurveyDrawMap
          gps={gps}
          onPolygonChange={setSurveyPolygon}
          disabled={busy}
          importedPoints={importedPoints}
          resetKey={mapResetKey}
          className="h-full w-full rounded-none border-none"
          mapHeightClassName="h-full min-h-[100dvh]"
        />

        {/* Floating Bottom Drawer Trigger di HP (Bar Ergonomis Bawah) */}
        <div className="lg:hidden absolute bottom-3 inset-x-3 z-[1000] pointer-events-auto">
          <button
            type="button"
            onClick={() => setIsMobileSheetOpen(true)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200/90 shadow-2xl text-slate-800 transition-all duration-200 hover:bg-white active:scale-[0.98] cursor-pointer"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-9 w-9 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0 shadow-xs">
                <FileText className="h-4 w-4" />
              </div>
              <div className="text-left min-w-0">
                <div className="text-xs font-bold text-slate-900 truncate">
                  {cleanNib ? `NIB: ${cleanNib}` : 'Formulir Data Bidang Tanah'}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {photos.length > 0 ? `${photos.length}/3 Foto` : 'Belum ada foto'} · {gps ? 'GPS ✓' : 'Belum GPS'} · {surveyPolygon.points.length > 0 ? `${surveyPolygon.points.length} patok` : 'Belum ada patok'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs font-semibold text-emerald-700 shrink-0 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200/80">
              <span>Buka Form</span>
              <ChevronUp className="h-4 w-4" />
            </div>
          </button>
        </div>
      </div>

      {/* Mobile Bottom Drawer (Shadcn Sheet) */}
      <div className="lg:hidden">
        <Sheet open={isMobileSheetOpen} onOpenChange={setIsMobileSheetOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[88vh] overflow-y-auto rounded-t-3xl border-t border-slate-200 bg-white p-4 sm:p-6 shadow-2xl"
          >
            <SheetHeader className="pb-3 border-b border-slate-100 text-left">
              <SheetTitle className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                <FileText className="h-5 w-5 text-emerald-600" />
                <span>Formulir Survei Lapangan</span>
              </SheetTitle>
              <SheetDescription className="text-xs text-slate-500">
                Lengkapi NIB, pemilik, koordinat GPS, dan foto dokumentasi lapangan.
              </SheetDescription>
            </SheetHeader>

            <div className="mt-3 pb-6">
              {renderFormContent()}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop Sidebar Panel: Form permanen di sisi kanan layar PC */}
      <aside className="hidden lg:flex lg:w-[440px] xl:w-[480px] h-full flex-col border-l border-slate-200 bg-slate-50 shadow-xl z-20 overflow-y-auto p-5 xl:p-6">
        <div className="pb-3 mb-3 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileText className="h-5 w-5 text-emerald-600" />
              <span>Formulir Survei Lapangan</span>
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
              Desktop View
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Isi data NIB, pemilik, koordinat, dan foto dokumentasi sembari mendigitasi batas tanah pada peta.
          </p>
        </div>
        {renderFormContent()}
      </aside>
    </main>
  );
}
