import { zipSync, strToU8, type Zippable } from 'fflate';
import { supabase, type ParcelData } from './supabase';

/**
 * Escapes values for RFC 4180 compliant CSV output.
 */
function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Concurrency runner with a worker limit.
 */
export async function asyncPool<T>(
  limit: number,
  items: T[],
  fn: (item: T) => Promise<void>
): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p: Promise<void> = Promise.resolve().then(() => fn(item));
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

/**
 * Robust fetch with exponential backoff for Supabase Image CDN.
 */
export async function fetchWithRetry(url: string, retries = 2): Promise<ArrayBuffer> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.arrayBuffer();
    } catch (err) {
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
  throw new Error('Gagal mengunduh berkas');
}

/**
 * Formats a clean photo filename for inside the ZIP archive:
 * e.g., 0206010100201_20260917.webp
 */
export function getPhotoZipFileName(nib: string, surveyedAt?: string | null): string {
  const cleanNib = nib.replace(/[^a-zA-Z0-9]/g, '');
  let datePart = '';
  if (surveyedAt) {
    const d = new Date(surveyedAt);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      datePart = `${yyyy}${mm}${dd}`;
    }
  }
  if (!datePart) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    datePart = `${yyyy}${mm}${dd}`;
  }
  return `${cleanNib}_${datePart}.webp`;
}

/**
 * Formats standard local timestamp string: YYYYMMDD-HHmm
 */
export function formatArchiveTimestamp(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}${m}${d}-${h}${min}`;
}

export interface PhotoErrorLog {
  nib: string;
  reason: string;
}

/**
 * Generates formatted README.txt documentation
 */
export function generateReadmeText(params: {
  wibDateStr: string;
  datasetKey: string;
  totalParcels: number;
  includePhotos: boolean;
  totalPhotosDownloaded: number;
  missingPhotos: PhotoErrorLog[];
}): string {
  const {
    wibDateStr,
    datasetKey,
    totalParcels,
    includePhotos,
    totalPhotosDownloaded,
    missingPhotos,
  } = params;

  let photoNotes = '';
  if (includePhotos) {
    if (missingPhotos.length > 0) {
      photoNotes = `Terdapat ${missingPhotos.length} foto yang tidak dapat diunduh (terlewat):\n` +
        missingPhotos.map((m) => `  - NIB ${m.nib}: ${m.reason}`).join('\n');
    } else {
      photoNotes = `Semua (${totalPhotosDownloaded}) foto dokumentasi sensus berhasil diunduh dan diarsipkan tanpa kendala.`;
    }
  } else {
    photoNotes = 'Ekspor dilakukan dalam mode "Data Tabular & Spasial Saja" (tanpa menyertakan foto lapangan sensus).';
  }

  return `================================================================================
GEOTANAH DAIRI - GEODATABASE EXPORT ARSIP RESMI
Unit Kerja: Seksi Survei dan Pemetaan Kantor Pertanahan Kab. Dairi
================================================================================

Waktu Ekspor      : ${wibDateStr}
Dataset Key       : ${datasetKey}
Total Persil      : ${totalParcels} bidang tanah
Status Unduhan    : ${includePhotos ? `Sensus Lengkap (${totalPhotosDownloaded} foto terlampir)` : 'Data Spasial & Tabular Saja'}

--------------------------------------------------------------------------------
DAFTAR ISI & STRUKTUR ARSIP:
--------------------------------------------------------------------------------
├── README.txt
│   Ringkasan metadata ekspor, dokumentasi teknis dataset, dan catatan integritas data.
│
├── geojson/
│   └── all_parcels.geojson
│       Geodatabase spasial (FeatureCollection) format GeoJSON WGS84 (EPSG:4326).
│       Dapat langsung diimpor ke QGIS, ArcGIS Pro, Google Earth, atau Avenza Maps.
│
├── csv/
│   ├── parcels_attributes.csv
│   │   Tabel data atribut lengkap seluruh bidang tanah hasil sensus & verifikasi
│   │   (NIB, Pemilik, Program, KKP, Hak, Luas Surat, Luas Spasial, Deviasi, GPS, dll).
│   │   Format UTF-8 with BOM (langsung kompatibel dengan Microsoft Excel tanpa mojibake).
│   ├── rekap_per_desa.csv
│   │   Tabel rekapitulasi jumlah bidang, total luas surat, total luas spasial,
│   │   dan rata-rata persentase deviasi per desa/kelurahan.
│   └── rekap_per_program.csv
│       Tabel rekapitulasi jumlah bidang dan total luas per klasifikasi program
│       (Wakaf, MBR, Rumah Ibadah, Hibah, Reguler).
│
└── photos/
    Foto dokumentasi patok / batas fisik sensus pertanahan (WebP terkompresi CDN).
    Pola penamaan berkas: photos/{NIB}_{YYYYMMDD}.webp

--------------------------------------------------------------------------------
CATATAN TEKNIS & OPTIMASI BANDWIDTH:
--------------------------------------------------------------------------------
- Sistem Koordinat Referensi: WGS 84 (EPSG:4326).
- Format CSV menggunakan karakter pemisah koma (RFC 4180) dengan awalan UTF-8 BOM
  (\\uFEFF) untuk menjamin akurasi aksen karakter nama daerah / pemilik.
- Foto lapangan dioptimasi secara adaptif melalui Supabase Image CDN (maksimal 800px,
  kualitas 55% WebP) guna menghemat kuota transmisi dan memori perangkat mobile.

--------------------------------------------------------------------------------
STATUS PENGUNDUHAN FOTO LAPANGAN:
--------------------------------------------------------------------------------
${photoNotes}
`;
}

/**
 * Generates minified GeoJSON FeatureCollection
 */
export function generateGeoJsonText(parcels: ParcelData[]): string {
  const features = parcels
    .filter((p) => !!p.geojson)
    .map((p) => {
      let geometry: unknown = null;
      try {
        geometry = typeof p.geojson === 'string' ? JSON.parse(p.geojson) : p.geojson;
      } catch {
        geometry = null;
      }
      if (!geometry) return null;

      return {
        type: 'Feature',
        id: p.id,
        geometry,
        properties: {
          nib: p.nib,
          owner_name: p.owner_name,
          village: p.village,
          sub_district: p.sub_district,
          program_type: p.program_type || 'Reguler',
          kkp_category: p.kkp_category,
          hak_type: p.hak_type,
          legal_area_m2: p.legal_area_m2,
          spatial_area_m2: p.spatial_area_m2,
          deviation_percent: p.deviation_percent,
          is_overlapping: p.is_overlapping,
          status: p.status,
          geometry_source: p.geometry_source,
          gps_lat: p.gps_lat,
          gps_lng: p.gps_lng,
          gps_accuracy_m: p.gps_accuracy_m,
          photo_path: p.photo_path,
          surveyed_at: p.surveyed_at,
        },
      };
    })
    .filter(Boolean);

  const fc = {
    type: 'FeatureCollection',
    features,
  };

  return JSON.stringify(fc);
}

/**
 * Generates parcels_attributes.csv with UTF-8 BOM
 */
export function generateParcelsAttributesCsv(
  parcels: ParcelData[],
  photoMap: Map<string, string>
): string {
  const header = [
    'NIB',
    'Owner',
    'Desa',
    'Kecamatan',
    'Program',
    'KKP',
    'Hak',
    'LuasSurat',
    'LuasSpasial',
    'Deviasi',
    'Status',
    'Lat',
    'Lng',
    'Akurasi',
    'TanggalSurvei',
    'Foto',
  ].join(',');

  const rows = parcels.map((p) => {
    const photoFileName = p.photo_path ? (photoMap.get(p.id) || p.photo_path) : '';
    const deviasiStr =
      p.deviation_percent !== null && p.deviation_percent !== undefined
        ? `${p.deviation_percent}%`
        : '';

    return [
      escapeCsv(p.nib),
      escapeCsv(p.owner_name),
      escapeCsv(p.village),
      escapeCsv(p.sub_district),
      escapeCsv(p.program_type || 'Reguler'),
      escapeCsv(p.kkp_category || ''),
      escapeCsv(p.hak_type || ''),
      escapeCsv(p.legal_area_m2 != null ? p.legal_area_m2 : ''),
      escapeCsv(p.spatial_area_m2 != null ? p.spatial_area_m2 : ''),
      escapeCsv(deviasiStr),
      escapeCsv(p.status || ''),
      escapeCsv(p.gps_lat != null ? p.gps_lat : ''),
      escapeCsv(p.gps_lng != null ? p.gps_lng : ''),
      escapeCsv(p.gps_accuracy_m != null ? p.gps_accuracy_m : ''),
      escapeCsv(p.surveyed_at || ''),
      escapeCsv(photoFileName),
    ].join(',');
  });

  return '\uFEFF' + [header, ...rows].join('\r\n');
}

/**
 * Generates rekap_per_desa.csv with UTF-8 BOM
 */
export function generateRekapDesaCsv(parcels: ParcelData[]): string {
  const header = ['Desa', 'TotalPersil', 'TotalLuasSurat', 'TotalLuasSpasial', 'RataDeviasi'].join(',');

  interface DesaSummary {
    totalPersil: number;
    totalLuasSurat: number;
    totalLuasSpasial: number;
    sumDeviasi: number;
    countDeviasi: number;
  }

  const map = new Map<string, DesaSummary>();

  for (const p of parcels) {
    const desa = p.village || 'Tidak Diketahui';
    const cur = map.get(desa) || {
      totalPersil: 0,
      totalLuasSurat: 0,
      totalLuasSpasial: 0,
      sumDeviasi: 0,
      countDeviasi: 0,
    };

    cur.totalPersil += 1;
    cur.totalLuasSurat += Number(p.legal_area_m2) || 0;
    cur.totalLuasSpasial += Number(p.spatial_area_m2) || 0;
    if (p.deviation_percent !== null && p.deviation_percent !== undefined) {
      cur.sumDeviasi += Number(p.deviation_percent);
      cur.countDeviasi += 1;
    }

    map.set(desa, cur);
  }

  const rows: string[] = [];
  map.forEach((cur, desa) => {
    const rataDeviasi =
      cur.countDeviasi > 0 ? `${(cur.sumDeviasi / cur.countDeviasi).toFixed(2)}%` : '0.00%';

    rows.push(
      [
        escapeCsv(desa),
        escapeCsv(cur.totalPersil),
        escapeCsv(cur.totalLuasSurat.toFixed(2)),
        escapeCsv(cur.totalLuasSpasial.toFixed(2)),
        escapeCsv(rataDeviasi),
      ].join(',')
    );
  });

  return '\uFEFF' + [header, ...rows].join('\r\n');
}

/**
 * Generates rekap_per_program.csv with UTF-8 BOM
 */
export function generateRekapProgramCsv(parcels: ParcelData[]): string {
  const header = ['Program', 'TotalPersil', 'TotalLuas'].join(',');

  interface ProgramSummary {
    totalPersil: number;
    totalLuas: number;
  }

  const map = new Map<string, ProgramSummary>();

  for (const p of parcels) {
    const program = p.program_type || 'Reguler';
    const cur = map.get(program) || {
      totalPersil: 0,
      totalLuas: 0,
    };

    cur.totalPersil += 1;
    const luas = Number(p.spatial_area_m2) || Number(p.legal_area_m2) || 0;
    cur.totalLuas += luas;

    map.set(program, cur);
  }

  const rows: string[] = [];
  map.forEach((cur, program) => {
    rows.push(
      [
        escapeCsv(program),
        escapeCsv(cur.totalPersil),
        escapeCsv(cur.totalLuas.toFixed(2)),
      ].join(',')
    );
  });

  return '\uFEFF' + [header, ...rows].join('\r\n');
}

export interface ExportGeodatabaseOptions {
  includePhotos: boolean;
  onProgress?: (text: string, percent: number) => void;
  triggerDownload?: boolean;
}

export interface ExportGeodatabaseResult {
  zippedBlob: Blob;
  fileName: string;
  totalParcels: number;
  totalPhotos: number;
  missingPhotos: PhotoErrorLog[];
}

/**
 * Main export geodatabase function handling Step 1 through Step 5.
 */
export async function executeExportGeodatabase(
  options: ExportGeodatabaseOptions
): Promise<ExportGeodatabaseResult> {
  const { includePhotos, onProgress, triggerDownload = true } = options;

  // STEP 1 — Fetch data
  onProgress?.('Mengambil data sensus geodatabase...', 10);
  const { data, error } = await supabase.rpc('get_parcels_with_metrics_v2', {
    p_dataset_key: 'dairi-demo',
  });

  if (error || !data) {
    const msg = error ? error.message : 'Data persil tidak ditemukan';
    throw new Error(`Gagal fetch data: ${msg}`);
  }

  const parcels: ParcelData[] = data as ParcelData[];
  const totalParcels = parcels.length;

  onProgress?.('Menyiapkan berkas atribut dan spasial...', 25);

  // STEP 2 — Format dates & names
  const now = new Date();
  const wibDateStr =
    new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'Asia/Jakarta',
    }).format(now) + ' WIB';

  const zipContents: Zippable = {};
  const photoMap = new Map<string, string>(); // parcel.id -> photo relative path
  const photoBufferMap = new Map<string, ArrayBuffer>();
  const missingPhotos: PhotoErrorLog[] = [];

  // STEP 3 — Download photos if includePhotos is true
  if (includePhotos) {
    const parcelsWithPhoto = parcels.filter((p) => !!p.photo_path);
    const totalPhotos = parcelsWithPhoto.length;

    if (totalPhotos > 0) {
      let completedPhotos = 0;
      onProgress?.(`Memulai pengunduhan foto (0/${totalPhotos})...`, 30);

      // Pre-assign photo names to map
      for (const p of parcelsWithPhoto) {
        const photoFileName = getPhotoZipFileName(p.nib, p.surveyed_at);
        photoMap.set(p.id, `photos/${photoFileName}`);
      }

      await asyncPool(3, parcelsWithPhoto, async (p) => {
        const photoRelPath = photoMap.get(p.id)!;
        try {
          const { data: urlData } = supabase.storage
            .from('parcel-photos')
            .getPublicUrl(p.photo_path!, {
              transform: {
                width: 800,
                quality: 55,
              },
            });

          const buffer = await fetchWithRetry(urlData.publicUrl, 2);
          photoBufferMap.set(photoRelPath, buffer);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[ExportGeodatabase] Gagal mengunduh foto NIB ${p.nib}:`, errMsg);
          missingPhotos.push({
            nib: p.nib,
            reason: errMsg,
          });
        } finally {
          completedPhotos++;
          const photoPercent = 30 + Math.round((completedPhotos / totalPhotos) * 50);
          onProgress?.(
            `Mengunduh foto lapangan (${completedPhotos}/${totalPhotos})...`,
            photoPercent
          );
        }
      });
    }
  }

  // STEP 4 — Generate all text content
  onProgress?.('Menyusun struktur berkas GeoJSON dan CSV...', 82);

  const readmeText = generateReadmeText({
    wibDateStr,
    datasetKey: 'dairi-demo',
    totalParcels,
    includePhotos,
    totalPhotosDownloaded: photoBufferMap.size,
    missingPhotos,
  });

  const geojsonText = generateGeoJsonText(parcels);
  const csvWithBom = generateParcelsAttributesCsv(parcels, photoMap);
  const rekapDesaCsv = generateRekapDesaCsv(parcels);
  const rekapProgramCsv = generateRekapProgramCsv(parcels);

  zipContents['README.txt'] = strToU8(readmeText);
  zipContents['geojson/all_parcels.geojson'] = strToU8(geojsonText);
  zipContents['csv/parcels_attributes.csv'] = strToU8(csvWithBom);
  zipContents['csv/rekap_per_desa.csv'] = strToU8(rekapDesaCsv);
  zipContents['csv/rekap_per_program.csv'] = strToU8(rekapProgramCsv);

  // Add photos to zipContents
  photoBufferMap.forEach((buffer, path) => {
    zipContents[path] = new Uint8Array(buffer);
  });

  // STEP 5 — Compress with fflate zipSync level 6
  onProgress?.('Mengompresi seluruh berkas ke format ZIP...', 90);
  const zipped = zipSync(zipContents, { level: 6 });

  const fileName = `geotanah-dairi-${formatArchiveTimestamp(now)}.zip`;
  const zippedBlob = new Blob([zipped as unknown as BlobPart], { type: 'application/zip' });

  // STEP 6 — Trigger browser download if applicable
  if (triggerDownload && typeof window !== 'undefined' && typeof document !== 'undefined') {
    onProgress?.('Menyimpan berkas arsip ZIP ke perangkat...', 96);
    const url = URL.createObjectURL(zippedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  onProgress?.('Ekspor geodatabase selesai!', 100);

  return {
    zippedBlob,
    fileName,
    totalParcels,
    totalPhotos: photoBufferMap.size,
    missingPhotos,
  };
}
