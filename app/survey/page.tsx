'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Camera, CheckCircle2, LocateFixed, LoaderCircle } from 'lucide-react';
import { supabase, type ParcelData } from '@/lib/supabase';

type SurveyParcel = Pick<ParcelData,
  'id' | 'nib' | 'owner_name' | 'village' | 'dataset_key' | 'is_demo'
  | 'gps_lat' | 'gps_lng' | 'gps_accuracy_m' | 'photo_path' | 'surveyed_at'>;
type GpsFix = { lat: number; lng: number; accuracy: number };
type SurveyPhoto = { blob: Blob; extension: 'webp' | 'jpg'; width: number; height: number };
type PendingUpload = { nib: string; blob: Blob; path: string };

const BUCKET = 'parcel-photos';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const buttonClass = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600';

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

    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    let supportsWebP = false;
    try {
      supportsWebP = canvas.toDataURL('image/webp').startsWith('data:image/webp');
    } catch {
      // Some browsers restrict WebP encoding; JPEG remains available.
    }
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Browser tidak mendukung pemrosesan foto.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type, quality);
    });
    let blob: Blob | null = null;
    if (supportsWebP) {
      try { blob = await encode('image/webp', 0.72); } catch { /* Try JPEG below. */ }
    }
    // Check actual MIME too: an unsupported encoder may silently produce PNG.
    if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', 0.75);
    if (!blob || !['image/webp', 'image/jpeg'].includes(blob.type)) {
      throw new Error('Kompresi foto gagal. Gunakan browser yang mendukung JPEG atau WebP.');
    }
    if (blob.size === 0 || blob.size > MAX_UPLOAD_BYTES) {
      throw new Error('Foto hasil kompresi harus berukuran lebih dari 0 dan maksimal 5 MB.');
    }
    return { blob, extension: blob.type === 'image/webp' ? 'webp' : 'jpg', width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export default function SurveyPage() {
  const [parcels, setParcels] = useState<SurveyParcel[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [gps, setGps] = useState<GpsFix | null>(null);
  const [locating, setLocating] = useState(false);
  const [photo, setPhoto] = useState<SurveyPhoto | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [problem, setProblem] = useState('');
  const alive = useRef(true);
  const previewRef = useRef('');
  const gpsRequest = useRef(0);
  const photoRequest = useRef(0);
  const submitLock = useRef(false);
  const pendingUpload = useRef<PendingUpload | null>(null);

  const selectedParcel = parcels.find((parcel) => parcel.id === selectedId) ?? null;
  const normalizedQuery = query.trim().toLowerCase();
  const choices = parcels.filter((parcel) => parcel.id === selectedId
    || parcel.nib.toLowerCase().includes(normalizedQuery)
    || parcel.owner_name.toLowerCase().includes(normalizedQuery));
  const busy = locating || processing || submitting;
  const oldPhotoUrl = selectedParcel?.photo_path
    ? supabase.storage.from(BUCKET).getPublicUrl(selectedParcel.photo_path).data.publicUrl : '';

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      gpsRequest.current += 1;
      photoRequest.current += 1;
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadParcels() {
      try {
        const rows: SurveyParcel[] = [];
        const pageSize = 500;
        // Read the new columns directly; do not change get_parcels_with_metrics_v2.
        for (let start = 0; ; start += pageSize) {
          const { data, error } = await supabase.from('parcels')
            .select('id,nib,owner_name,village,dataset_key,is_demo,gps_lat,gps_lng,gps_accuracy_m,photo_path,surveyed_at')
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

  function selectParcel(id: string) {
    if (submitLock.current) return;
    gpsRequest.current += 1;
    setSelectedId(id);
    setGps(null);
    setLocating(false);
    setProcessing(false);
    setFeedback('');
    setProblem('');
    clearPhoto();
  }

  function captureGps() {
    if (!selectedParcel || busy || submitLock.current) return;
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
    if (!file || !selectedParcel || submitLock.current) return;
    clearPhoto();
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
    if (!selectedParcel || selectedParcel.dataset_key !== 'dairi-demo' || !selectedParcel.is_demo) {
      setProblem('Pilih bidang dari dataset demo Dairi terlebih dahulu.');
      return;
    }
    const nib = selectedParcel.nib.trim();
    if (nib.length < 3 || !gps || !validGps(gps) || !photo) {
      setProblem('Lengkapi NIB, ambil GPS yang valid, dan pilih foto terlebih dahulu.');
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setFeedback('');
    setProblem('');
    let uploadedPath = '';
    try {
      const pending = pendingUpload.current;
      if (pending?.nib === nib && pending.blob === photo.blob) {
        uploadedPath = pending.path;
      } else {
        const path = `surveys/${nib.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}.${photo.extension}`;
        // ArrayBuffer makes the SDK send Cache-Control: max-age=31536000, immutable.
        const { error } = await supabase.storage.from(BUCKET).upload(path, await photo.blob.arrayBuffer(), {
          contentType: photo.blob.type,
          cacheControl: '31536000, immutable',
          upsert: false,
        });
        if (error) throw error;
        uploadedPath = path;
        pendingUpload.current = { nib, blob: photo.blob, path };
      }
      // Append-only storage: never remove selectedParcel.photo_path.
      const { data, error } = await supabase.rpc('submit_survey_data', {
        p_nib: nib, p_lat: gps.lat, p_lng: gps.lng,
        p_accuracy: gps.accuracy, p_photo_path: uploadedPath,
      });
      if (error) throw error;
      if (alive.current) {
        setParcels((current) => current.map((parcel) => parcel.id === selectedParcel.id
          ? { ...parcel, gps_lat: Number(data.gps_lat), gps_lng: Number(data.gps_lng),
            gps_accuracy_m: Number(data.gps_accuracy_m), photo_path: uploadedPath, surveyed_at: data.surveyed_at }
          : parcel));
        clearPhoto();
        setGps(null);
        setFeedback(`Survei NIB ${nib} berhasil disimpan. Foto sebelumnya tetap tersimpan.`);
        window.alert(`Survei NIB ${nib} berhasil disimpan.`);
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
        <Link href="/" className={`${buttonClass} mb-4 border border-slate-200 bg-white text-slate-700 hover:bg-slate-100`}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" /> Kembali ke peta
        </Link>
        <header className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-wider text-emerald-700">GeoTanah Dairi</p>
          <h1 className="mt-1 text-3xl font-bold">Mode Sensus</h1>
          <p className="mt-2 text-base text-slate-600">Pilih bidang, ambil lokasi GPS, lalu foto kondisi lapangan.</p>
        </header>
        <aside className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Khusus demo.</strong> Foto dan lokasi yang dikirim dapat dibaca publik.
          Jangan gunakan foto wajah, dokumen pribadi, atau lokasi pribadi.
          GPS ponsel bukan pengukuran batas kadastral yang sah; poligon bidang tidak diubah.
        </aside>

        {loading ? (
          <p role="status" className="rounded-2xl border border-slate-200 bg-white p-6">Memuat daftar bidang demo...</p>
        ) : loadError ? (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">
            <p>{loadError}</p>
            <button type="button" onClick={() => { setLoading(true); setLoadError(''); setReload((value) => value + 1); }} className={`${buttonClass} mt-3 bg-white`}>Coba muat lagi</button>
          </div>
        ) : parcels.length === 0 ? (
          <p role="status" className="rounded-2xl border border-slate-200 bg-white p-6">Tidak ada bidang demo yang dapat disurvei. Hubungi pengelola data.</p>
        ) : (
          <form onSubmit={submitSurvey} className="space-y-5" aria-busy={submitting}>
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 text-lg font-bold">1. Pilih bidang tanah</h2>
              <label htmlFor="survey-search" className="mb-2 block text-sm font-medium">Cari NIB atau nama pemilik</label>
              <input id="survey-search" type="search" value={query} disabled={busy}
                onChange={(event) => setQuery(event.target.value)} placeholder="Ketik NIB atau nama..."
                className="mb-4 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base focus:border-emerald-600 focus:outline-none" />
              <label htmlFor="survey-parcel" className="mb-2 block text-sm font-medium">Bidang yang akan disurvei</label>
              <select id="survey-parcel" value={selectedId} disabled={busy} required
                onChange={(event) => selectParcel(event.target.value)}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-emerald-600 focus:outline-none">
                <option value="">Pilih satu bidang...</option>
                {choices.map((parcel) => <option key={parcel.id} value={parcel.id}>{parcel.nib} — {parcel.owner_name}</option>)}
              </select>
              {choices.length === 0 && <p className="mt-2 text-sm text-slate-600">Tidak ditemukan. Coba kata pencarian lain.</p>}
              {selectedParcel && (
                <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                  <p className="font-semibold">{selectedParcel.owner_name} · {selectedParcel.village}</p>
                  <p className="mt-1">NIB: {selectedParcel.nib}</p>
                  <p className="mt-1">{selectedParcel.surveyed_at ? `Survei terakhir: ${new Date(selectedParcel.surveyed_at).toLocaleString('id-ID')}` : 'Belum ada survei tersimpan.'}</p>
                  {oldPhotoUrl && <a href={oldPhotoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-12 items-center font-semibold text-emerald-700 underline">Lihat foto tersimpan (tetap disimpan)</a>}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-lg font-bold">2. Ambil lokasi GPS</h2>
              <p className="mb-4 text-sm text-slate-600">Berdiri di lokasi bidang pada tempat terbuka, lalu izinkan akses lokasi.</p>
              <button type="button" onClick={captureGps} disabled={!selectedParcel || busy}
                className={`${buttonClass} w-full border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>
                {locating ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> : <LocateFixed className="h-5 w-5" aria-hidden="true" />}
                {locating ? 'Mencari GPS (maks. 15 detik)...' : gps ? 'Ambil ulang lokasi GPS' : 'Ambil lokasi GPS'}
              </button>
              <div aria-live="polite" className="mt-3 text-sm text-slate-700">
                {gps ? <><p>Latitude: {gps.lat.toFixed(7)} · Longitude: {gps.lng.toFixed(7)}</p><p className="mt-1 font-semibold">Akurasi: ±{gps.accuracy.toFixed(2)} meter</p>{gps.accuracy > 50 && <p className="mt-2 text-amber-800">Akurasi masih rendah. Disarankan mengambil ulang GPS.</p>}</> : <p>Belum ada lokasi GPS baru.</p>}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-2 text-lg font-bold">3. Ambil foto lapangan</h2>
              <p className="mb-4 text-sm text-slate-600">Foto diperkecil otomatis hingga sisi terpanjang 1280 piksel. WebP digunakan jika tersedia; jika tidak, JPEG.</p>
              <label htmlFor="survey-photo" className="mb-2 flex items-center gap-2 text-sm font-semibold"><Camera className="h-5 w-5" aria-hidden="true" /> Buka kamera atau pilih foto</label>
              <input id="survey-photo" type="file" accept="image/*" capture="environment" disabled={!selectedParcel || busy}
                onChange={choosePhoto} className="min-h-12 w-full rounded-xl border border-slate-300 p-2 text-sm file:mr-3 file:min-h-12 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:font-semibold file:text-emerald-800 disabled:opacity-50" />
              <p role="status" className="mt-2 text-sm text-slate-600">{processing ? 'Menyiapkan foto...' : photo ? `${photo.extension.toUpperCase()} · ${photo.width} × ${photo.height} piksel · ${(photo.blob.size / 1024).toFixed(0)} KB` : 'Foto hasil kompresi maksimal 5 MB. Sumber maksimal 25 MB.'}</p>
              {previewUrl && photo && <Image src={previewUrl} alt="Pratinjau foto lapangan yang akan dikirim" width={photo.width} height={photo.height} unoptimized className="mt-4 max-h-80 w-full rounded-xl bg-slate-100 object-contain" />}
            </section>

            {problem && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{problem}</p>}
            {feedback && <p role="status" className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />{feedback}</p>}
            <button type="submit" disabled={!selectedParcel || !gps || !photo || busy}
              className={`${buttonClass} w-full bg-emerald-700 text-white hover:bg-emerald-800`}>
              {submitting && <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />}
              {submitting ? 'Mengunggah dan menyimpan...' : 'Simpan data survei'}
            </button>
            <p className="pb-6 text-center text-xs text-slate-600">Pastikan NIB benar sebelum menyimpan. Foto lama tidak dihapus.</p>
          </form>
        )}
      </div>
    </main>
  );
}
