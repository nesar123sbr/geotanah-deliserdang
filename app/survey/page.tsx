'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { 
  ArrowLeft, Camera, CheckCircle2, LocateFixed, LoaderCircle, 
  FileUp, AlertCircle, Trash2, RefreshCw, X, ChevronUp, FileText,
  Download, Package, NotebookPen, UserCheck
} from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { zipSync, strToU8 } from 'fflate';
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
  extension: string;
  mimeType: string;
}

const BUCKET = 'parcel-photos';
const MAX_PHOTOS = 7;
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

function createSurveyFolder(owner: string, nibVal: string, surveyorVal?: string): string {
  const sanitize = (str: string) =>
    str
      .trim()
      .replace(/[\/\\?%*:|"<>]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_');

  const cleanOwner = sanitize(owner) || 'Tanpa_Nama';
  const cleanNib = sanitize(nibVal) || 'Tanpa_NIB';
  const cleanSurveyor = surveyorVal ? `_${sanitize(surveyorVal)}` : '';
  return `${cleanOwner}_${cleanNib}${cleanSurveyor}`;
}

/**
 * Ekstrak ekstensi berkas asli secara aman
 */
function getFileExtension(file: File): string {
  const parts = file.name.split('.');
  if (parts.length > 1) {
    const ext = parts.pop()?.toLowerCase();
    if (ext && ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext)) {
      return ext === 'jpeg' ? 'jpg' : ext;
    }
  }
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

/**
 * Kompresi foto secara client-side menggunakan browser-image-compression
 * - Menjaga dimensi & rasio asli tanpa batasan kaku (maxWidthOrHeight dihapus)
 * - Mempertahankan format & MIME type asli foto (fileType paksa WebP dihapus)
 * - Opsi kompresi murni mengecilkan ukuran: { maxSizeMB: 0.5, useWebWorker: true }
 * - Jika kompresi gagal, fallback menggunakan berkas asli agar tidak freeze/gagal upload
 */
async function compressPhoto(file: File): Promise<{ blob: Blob; extension: string; mimeType: string; sizeKb: number }> {
  const originalExt = getFileExtension(file);
  const originalMime = file.type || (originalExt === 'png' ? 'image/png' : originalExt === 'webp' ? 'image/webp' : 'image/jpeg');

  // Opsi kompresi murni untuk mengecilkan ukuran tanpa mengubah dimensi & format
  const options = {
    maxSizeMB: 0.5, // Target kompresi <= 0.5 MB (500 KB)
    useWebWorker: true,
  };

  try {
    let compressedFile: File;
    try {
      compressedFile = await imageCompression(file, options);
    } catch (workerErr) {
      console.warn('[compressPhoto] Web worker gagal/timeout, mencoba mode sinkron:', workerErr);
      compressedFile = await imageCompression(file, { ...options, useWebWorker: false });
    }

    const effectiveMime = compressedFile.type || originalMime;
    const effectiveExt = getFileExtension(compressedFile) || originalExt;
    const sizeKb = Math.max(1, Math.round(compressedFile.size / 1024));

    return {
      blob: compressedFile,
      extension: effectiveExt,
      mimeType: effectiveMime,
      sizeKb,
    };
  } catch (err) {
    console.error('[compressPhoto] Kompresi gagal, menggunakan berkas asli sebagai fallback:', err);
    const fallbackSizeKb = Math.max(1, Math.round(file.size / 1024));
    // Jika berkas asli masih dalam batas wajar (< 20 MB), gunakan langsung berkas aslinya
    if (file.size > 20 * 1024 * 1024) {
      throw new Error(`Ukuran foto terlalu besar (${fallbackSizeKb} KB > 20 MB). Pilih foto dengan resolusi lebih wajar.`);
    }

    return {
      blob: file,
      extension: originalExt,
      mimeType: originalMime,
      sizeKb: fallbackSizeKb,
    };
  }
}

// ─── Geo Export Helpers ──────────────────────────────────────────────────────

/**
 * Build KML string dari titik-titik poligon
 */
function buildKML(points: [number, number][], name: string): string {
  const coords = points.map(([lat, lng]) => `${lng},${lat},0`).join('\n          ');
  const first = points[0];
  const closingCoord = first ? `${first[1]},${first[0]},0` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark>
    <name>${name}</name>
    <Polygon>
      <outerBoundaryIs>
        <LinearRing>
          <coordinates>
          ${coords}
          ${closingCoord}
          </coordinates>
        </LinearRing>
      </outerBoundaryIs>
    </Polygon>
  </Placemark>
</kml>`;
}

/**
 * Build GPX string dari titik-titik poligon (sebagai waypoints & track)
 */
function buildGPX(points: [number, number][], name: string): string {
  const wpts = points.map(([lat, lng], i) =>
    `  <wpt lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}"><name>P${i + 1}</name></wpt>`
  ).join('\n');
  const trkpts = points.map(([lat, lng]) =>
    `      <trkpt lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}"/>`
  ).join('\n');
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GeoTanah Dairi" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${name}</name><time>${now}</time></metadata>
${wpts}
  <trk>
    <name>${name}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

/**
 * Build CSV patok batas (format AutoCAD-friendly: NO, LAT, LNG, DESC)
 */
function buildCSV(points: [number, number][], name: string): string {
  const header = 'NO,LATITUDE,LONGITUDE,DESKRIPSI';
  const rows = points.map(([lat, lng], i) =>
    `${i + 1},${lat.toFixed(7)},${lng.toFixed(7)},Patok_${i + 1}_${name}`
  );
  return [header, ...rows].join('\r\n');
}

/**
 * Build GeoJSON FeatureCollection dari polygon points
 */
function buildGeoJSON(points: [number, number][], name: string, props: Record<string, unknown>): string {
  // GeoJSON koordinat: [lng, lat]
  const coordinates = [
    [...points.map(([lat, lng]) => [lng, lat]), [points[0][1], points[0][0]]],
  ];
  const feature = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates },
      properties: { name, ...props },
    }],
  };
  return JSON.stringify(feature, null, 2);
}

export default function SurveyPage() {
  const [nib, setNib] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [address, setAddress] = useState('');
  const [surveyorName, setSurveyorName] = useState('');
  const [notes, setNotes] = useState('');
  const [gps, setGps] = useState<GpsFix | null>(null);
  const [locating, setLocating] = useState(false);
  const [programType, setProgramType] = useState<ProgramType>('Reguler');

  // Sesi pengguna terdeteksi (opsional untuk metadata surveyor)
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  // Multi-photo state (hingga 7 foto)
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
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0 || busy || submitLock.current) return;

    // 1. Ekstrak array File SEBELUM mereset event.target.value agar data File tidak hilang di browser
    const remainingSlots = MAX_PHOTOS - photos.length;
    if (remainingSlots <= 0) {
      toast.error(`Maksimal ${MAX_PHOTOS} foto diperbolehkan per survei.`);
      event.target.value = '';
      return;
    }

    const filesToProcess = Array.from(fileList).slice(0, remainingSlots);
    // Reset nilai input agar pengguna bisa mengambil ulang foto yang sama jika diinginkan
    event.target.value = '';

    // 2. Beri indikator processing dan toast loading
    setProcessing(true);
    setProblem('');
    setFeedback('');
    const toastId = toast.loading('Mengompresi foto...');

    // 3. Jeda singkat (60ms) agar browser event loop merender loading state dan toast (mencegah UI freeze)
    await new Promise((r) => setTimeout(r, 60));

    try {
      const newItems: PhotoItem[] = [];
      for (let i = 0; i < filesToProcess.length; i++) {
        const file = filesToProcess[i];
        if (filesToProcess.length > 1) {
          toast.loading(`Mengompresi foto ${i + 1} dari ${filesToProcess.length}...`, { id: toastId });
        }
        const compressed = await compressPhoto(file);
        const previewUrl = URL.createObjectURL(compressed.blob);
        objectUrlsRef.current.add(previewUrl);
        newItems.push({
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          blob: compressed.blob,
          previewUrl,
          sizeKb: compressed.sizeKb,
          extension: compressed.extension,
          mimeType: compressed.mimeType,
        });
      }

      setPhotos((prev) => [...prev, ...newItems]);
      const totalKb = newItems.reduce((acc, p) => acc + p.sizeKb, 0);
      toast.success(
        `${newItems.length} foto berhasil diproses (${totalKb} KB)`,
        { id: toastId }
      );
    } catch (error) {
      console.error('[handleAddPhotos] Error saat kompresi foto:', error);
      const msg = messageOf(error);
      setProblem(msg);
      toast.error(`Gagal memproses foto: ${msg}`, { id: toastId });
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
    const fileList = event.target.files;
    const targetIndex = replaceIndexRef.current;
    if (!fileList || fileList.length === 0 || targetIndex === null || targetIndex >= photos.length || busy) {
      if (event.target) event.target.value = '';
      replaceIndexRef.current = null;
      return;
    }

    // 1. Ekstrak berkas SEBELUM mereset input
    const file = fileList[0];
    event.target.value = '';
    replaceIndexRef.current = null;

    setProcessing(true);
    setProblem('');
    const toastId = toast.loading(`Mengompresi foto baru pengganti #${targetIndex + 1}...`);

    // Jeda singkat agar browser event loop merender loading state
    await new Promise((r) => setTimeout(r, 60));

    try {
      const compressed = await compressPhoto(file);
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
          mimeType: compressed.mimeType,
        };
        return next;
      });
      toast.success(
        `Foto #${targetIndex + 1} berhasil diganti (${compressed.sizeKb} KB, ${compressed.extension.toUpperCase()})`,
        { id: toastId }
      );
    } catch (err) {
      console.error('[handleReplacePhotoFile] Error saat ganti foto:', err);
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
    const cleanSurveyor = surveyorName.trim();

    if (cleanNib.length < 3 || !hasCoordinates || photos.length === 0) {
      const validationMsg = 'Lengkapi NIB (minimal 3 karakter), tentukan koordinat (ambil GPS atau delineasi poligon), dan ambil minimal 1 foto dokumentasi.';
      setProblem(validationMsg);
      toast.error(validationMsg);
      return;
    }
    if (!cleanSurveyor) {
      const msg = 'Nama Surveyor wajib diisi.';
      setProblem(msg);
      toast.error(msg);
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    setFeedback('');
    setProblem('');
    const toastId = toast.loading('Mengunggah foto & menyimpan data survei ke Cloud...');

    const uploadedPaths: string[] = [];
    try {
      const folderName = createSurveyFolder(ownerName, cleanNib, cleanSurveyor);

      // 1. Unggah semua foto terkompresi ke folder [nama_pemilik]_[NIB]_[surveyor]/photo_N.[ext]
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const photoPath = `${folderName}/photo_${i + 1}.${p.extension}`;
        
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(
          photoPath,
          await p.blob.arrayBuffer(),
          {
            contentType: p.mimeType || p.blob.type || 'image/jpeg',
            cacheControl: '31536000, immutable',
            upsert: true,
          }
        );
        
        if (uploadError) {
          console.error(`[submitSurvey] Upload error foto #${i + 1}:`, uploadError);
          const detailMsg = `Gagal mengunggah foto #${i + 1} ke Storage (${uploadError.message}). Periksa koneksi dan RLS Storage.`;
          toast.error(detailMsg, { id: toastId });
          throw new Error(detailMsg);
        }
        
        uploadedPaths.push(photoPath);
      }

      // Simpan array path foto dalam format JSON string agar tidak menempel dengan koma
      const combinedPhotoPath = JSON.stringify(uploadedPaths);

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
        `Klasifikasi Program / MBR       : ${programType}`,
        `Nama Surveyor Lapangan          : ${cleanSurveyor}`,
        `Akun Pengunggah                 : ${currentUserEmail || 'Anonim / Belum Login'}`,
        `Waktu Perekaman                 : ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`,
        ...(notes.trim() ? ['', `Catatan Tambahan                : ${notes.trim()}`] : []),
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
        `Total Berkas Foto               : ${photos.length} berkas`,
        ...photos.map((p, idx) => `  - Foto #${idx + 1} : photo_${idx + 1}.${p.extension} (${p.sizeKb} KB, ${p.mimeType})`),
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
        setSurveyorName('');
        setNotes('');
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

  /**
   * Export ZIP bundle: GeoJSON + KML + GPX + CSV + semua foto
   * Folder name: [Nama_Pemilik]_[NIB]_[Nama_Surveyor]
   */
  async function handleExportZip() {
    const hasPolygon = surveyPolygon.points.length >= 3;
    if (!hasPolygon) {
      toast.error('Poligon batas minimal 3 patok diperlukan untuk ekspor bundle.');
      return;
    }

    const toastId = toast.loading('Menyiapkan bundle ZIP...');
    try {
      const folderName = createSurveyFolder(ownerName, cleanNib, surveyorName.trim());
      const pts = surveyPolygon.points as [number, number][];
      const geoProps: Record<string, unknown> = {
        nib: cleanNib,
        owner_name: ownerName.trim() || null,
        address: address.trim() || null,
        program_type: programType,
        surveyor_name: surveyorName.trim() || null,
        notes: notes.trim() || null,
        area_m2: surveyPolygon.areaM2 ?? null,
        exported_at: new Date().toISOString(),
      };

      const geojsonStr = buildGeoJSON(pts, folderName, geoProps);
      const kmlStr = buildKML(pts, folderName);
      const gpxStr = buildGPX(pts, folderName);
      const csvStr = buildCSV(pts, folderName);

      // Kumpulkan file ke dalam objek zipSync
      const zipFiles: Record<string, Uint8Array> = {
        [`${folderName}/data.geojson`]: strToU8(geojsonStr),
        [`${folderName}/data.kml`]: strToU8(kmlStr),
        [`${folderName}/data.gpx`]: strToU8(gpxStr),
        [`${folderName}/data.csv`]: strToU8(csvStr),
      };

      // Tambahkan semua foto ke dalam sub-folder photos/
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const arr = new Uint8Array(await p.blob.arrayBuffer());
        zipFiles[`${folderName}/photos/photo_${i + 1}.${p.extension}`] = arr;
      }

      const zipped = zipSync(zipFiles, { level: 6 });
      const blob = new Blob([zipped], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${folderName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      toast.success(
        `Bundle ZIP berhasil diunduh: ${folderName}.zip (GeoJSON, KML, GPX, CSV + ${photos.length} foto)`,
        { id: toastId, duration: 6000 }
      );
    } catch (err) {
      console.error('[handleExportZip]', err);
      toast.error(`Gagal membuat bundle ZIP: ${messageOf(err)}`, { id: toastId });
    }
  }

  // Render Form Input Data Tanah (Reused across Mobile Sheet & Desktop Sidebar)
  const renderFormContent = () => (
    <form onSubmit={submitSurvey} className="space-y-4" aria-busy={submitting}>
      {/* 1. Identifikasi Bidang & Pemilik */}
      <Card className="border-slate-200/90 shadow-xs">
        <CardHeader className="pb-3 pt-4 px-4 sm:px-5">
          <CardTitle className="text-sm sm:text-base font-semibold text-slate-900 flex items-center justify-between">
            <span>1. Identifikasi Bidang &amp; Pemilik</span>
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

          {/* ── BARU: Nama Surveyor (Wajib) ── */}
          <div className="space-y-1 pt-0.5">
            <label htmlFor="survey-surveyor" className="block text-xs font-medium text-slate-700 flex items-center gap-1">
              <UserCheck className="h-3 w-3 text-emerald-600" />
              Nama Surveyor *
            </label>
            <input
              id="survey-surveyor"
              type="text"
              value={surveyorName}
              disabled={busy}
              onChange={(e) => setSurveyorName(e.target.value)}
              placeholder="Nama petugas lapangan..."
              required
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all disabled:bg-slate-100 disabled:opacity-60"
            />
          </div>

          {/* ── BARU: Klasifikasi MBR (Dropdown, opsional) ── */}
          <div className="space-y-1 pt-0.5">
            <label htmlFor="survey-program" className="block text-xs font-medium text-slate-700">
              Klasifikasi MBR / Program
            </label>
            <select
              id="survey-program"
              value={programType}
              disabled={busy}
              onChange={(e) => setProgramType(e.target.value as ProgramType)}
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm text-slate-900 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all disabled:bg-slate-100 disabled:opacity-60 cursor-pointer"
            >
              <option value="Reguler">📋 Bersedia (Reguler)</option>
              <option value="MBR">🏠 MBR (Masyarakat Berpenghasilan Rendah)</option>
              <option value="Wakaf">🕌 Wakaf (Tanah Wakaf Keagamaan)</option>
              <option value="Rumah Ibadah">🏛️ Rumah Ibadah (Gereja, Masjid, dll)</option>
              <option value="Hibah">🎁 Hibah (Pemerintah/Masyarakat)</option>
            </select>
          </div>

          {/* ── BARU: Catatan Tambahan (Textarea, opsional) ── */}
          <div className="space-y-1 pt-0.5">
            <label htmlFor="survey-notes" className="block text-xs font-medium text-slate-700 flex items-center gap-1">
              <NotebookPen className="h-3 w-3 text-slate-500" />
              Catatan Tambahan
              <span className="text-slate-400 font-normal">(opsional)</span>
            </label>
            <textarea
              id="survey-notes"
              value={notes}
              disabled={busy}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Kondisi khusus bidang, hambatan akses, catatan tim..."
              rows={3}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none transition-all disabled:bg-slate-100 disabled:opacity-60 resize-none"
            />
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
              Maks. 500 KB/foto
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-4 sm:px-5 pb-4">
          {/* Tombol Ambil Foto jika < MAX_PHOTOS */}
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
                  <span>Mengompresi foto...</span>
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

          {/* Preview: thumbnail foto pertama + badge count */}
          {photos.length > 0 && (
            <div className="flex items-center gap-3 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
              {/* Thumbnail foto pertama */}
              <div className="relative h-16 w-16 shrink-0 rounded-lg overflow-hidden bg-slate-200 border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photos[0].previewUrl}
                  alt="Pratinjau foto pertama"
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleRemovePhoto(0)}
                  title="Hapus foto pertama"
                  className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-md cursor-pointer"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>

              {/* Deskripsi & badge */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-semibold border border-emerald-200">
                    {photos.length} dari {MAX_PHOTOS} foto dipilih
                  </span>
                  {photos.length < MAX_PHOTOS && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => photoInputRef.current?.click()}
                      className="text-[10px] text-emerald-700 font-medium hover:underline cursor-pointer"
                    >
                      + Tambah lagi
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 mt-1 truncate">
                  {photos[0].sizeKb} KB · {photos[0].extension.toUpperCase()}
                  {photos.length > 1 && ` + ${photos.length - 1} foto lainnya`}
                </p>
                {/* Tombol hapus / ganti per foto (scrollable chips) */}
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {photos.map((p, idx) => (
                    <div key={p.id} className="inline-flex items-center gap-0.5 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[9px] font-mono text-slate-600">
                      <span>#{idx + 1}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => triggerReplacePhoto(idx)}
                        title={`Ganti foto #${idx + 1}`}
                        className="text-blue-600 hover:text-blue-800 cursor-pointer"
                      >
                        <RefreshCw className="h-2.5 w-2.5" />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRemovePhoto(idx)}
                        title={`Hapus foto #${idx + 1}`}
                        className="text-rose-600 hover:text-rose-800 cursor-pointer"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
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
        disabled={cleanNib.length < 3 || (!gps && !(surveyPolygon.geojson && surveyPolygon.points.length >= 3)) || photos.length === 0 || busy || !surveyorName.trim()}
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

      {/* ZIP Bundle Export Button */}
      <button
        type="button"
        disabled={surveyPolygon.points.length < 3 || busy}
        onClick={handleExportZip}
        title={surveyPolygon.points.length < 3 ? 'Tersedia setelah poligon batas minimal 3 patok dibuat' : 'Unduh bundle GeoJSON + KML + GPX + CSV + Foto dalam satu ZIP'}
        className={`${buttonClass} w-full bg-slate-700 hover:bg-slate-600 disabled:bg-slate-300 text-white py-3 text-sm cursor-pointer`}
      >
        <Package className="h-4 w-4" />
        <span>
          {surveyPolygon.points.length < 3
            ? 'Export Bundle ZIP (Butuh Poligon)'
            : `Export Bundle ZIP (GeoJSON, KML, GPX, CSV${photos.length > 0 ? ` + ${photos.length} Foto` : ''})`}
        </span>
        <Download className="h-4 w-4 opacity-70" />
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
                  {photos.length > 0 ? `${photos.length}/${MAX_PHOTOS} Foto` : 'Belum ada foto'} · {gps ? 'GPS ✓' : 'Belum GPS'} · {surveyPolygon.points.length > 0 ? `${surveyPolygon.points.length} patok` : 'Belum ada patok'}
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
