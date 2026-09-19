/**
 * Parser file spasial GPS lapangan (Avenza Maps, Locus Map, GPS Handheld Garmin, dll).
 * Menggunakan 100% Web APIs native browser (file.text, DOMParser, JSON.parse) tanpa dependensi eksternal.
 */

export interface ParsedGeoResult {
  polygon: [number, number][]; // [lat, lng] array
  properties: Record<string, unknown>;
  format: 'geojson' | 'gpx' | 'kml';
  areaM2: number;
}

export type ParseResult = ParsedGeoResult;

export function formatAreaM2(area: number): string {
  if (area >= 10000) {
    const ha = area / 10000;
    return `${area.toLocaleString('id-ID', { maximumFractionDigits: 1 })} m² (${ha.toLocaleString('id-ID', { maximumFractionDigits: 2 })} ha)`;
  }
  return `${area.toLocaleString('id-ID', { maximumFractionDigits: 1 })} m²`;
}

/**
 * Menghitung luas poligon di permukaan bola bumi (WGS84).
 */
export function calculateSphericalArea(coords: [number, number][]): number {
  const n = coords.length;
  if (n < 3) return 0;
  const R = 6378137; // Jari-jari ekuatorial bumi dalam meter
  let total = 0;
  for (let i = 0; i < n; i++) {
    const prev = coords[(i - 1 + n) % n];
    const next = coords[(i + 1) % n];
    const lat = coords[i][0] * (Math.PI / 180);
    const lngDiff = (next[1] - prev[1]) * (Math.PI / 180);
    total += lngDiff * Math.sin(lat);
  }
  return Math.abs((total * R * R) / 2);
}

/**
 * Membersihkan dan mendeduplikasi titik-titik berturutan serta melepas titik penutup ganda.
 */
function cleanPolygonRing(rawPts: [number, number][]): [number, number][] {
  const pts: [number, number][] = [];
  for (const pt of rawPts) {
    if (isNaN(pt[0]) || isNaN(pt[1])) continue;
    if (pts.length === 0) {
      pts.push(pt);
      continue;
    }
    const prev = pts[pts.length - 1];
    // Abaikan jika koordinat persis sama dengan titik sebelumnya
    if (Math.abs(prev[0] - pt[0]) > 1e-8 || Math.abs(prev[1] - pt[1]) > 1e-8) {
      pts.push(pt);
    }
  }

  // Jika titik terakhir sama dengan titik pertama (closing ring), lepaskan agar tidak dobel marker di Leaflet
  if (
    pts.length > 3 &&
    Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-8 &&
    Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-8
  ) {
    pts.pop();
  }

  return pts;
}

/**
 * Ekstraksi poligon dari objek GeoJSON (FeatureCollection, Feature, atau Polygon/MultiPolygon).
 */
export function extractPolygonFromGeoJSON(json: unknown): {
  polygon: [number, number][];
  properties: Record<string, unknown>;
} {
  if (!json || typeof json !== 'object') {
    throw new Error('File JSON tidak valid');
  }

  const obj = json as Record<string, unknown>;
  let targetFeature: Record<string, unknown> | null = null;
  let properties: Record<string, unknown> = {};
  let rawRing: [number, number][] = [];

  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    // Cari feature pertama yang bertipe Polygon atau MultiPolygon
    for (const f of obj.features) {
      const feat = f as Record<string, unknown>;
      const geom = feat?.geometry as Record<string, unknown> | undefined;
      if (geom?.type === 'Polygon' || geom?.type === 'MultiPolygon') {
        targetFeature = feat;
        break;
      }
    }
    if (!targetFeature) {
      throw new Error('File GeoJSON tidak berisi feature polygon');
    }
    properties = (targetFeature.properties as Record<string, unknown>) || {};
    const geom = targetFeature.geometry as { type: string; coordinates: unknown };
    if (geom.type === 'Polygon' && Array.isArray(geom.coordinates) && Array.isArray(geom.coordinates[0])) {
      rawRing = (geom.coordinates[0] as unknown[]).map((c) => {
        const arr = c as number[];
        return [Number(arr[1]), Number(arr[0])]; // [lat, lng]
      });
    } else if (
      geom.type === 'MultiPolygon' &&
      Array.isArray(geom.coordinates) &&
      Array.isArray(geom.coordinates[0]) &&
      Array.isArray(geom.coordinates[0][0])
    ) {
      rawRing = (geom.coordinates[0][0] as unknown[]).map((c) => {
        const arr = c as number[];
        return [Number(arr[1]), Number(arr[0])];
      });
    }
  } else if (obj.type === 'Feature') {
    properties = (obj.properties as Record<string, unknown>) || {};
    const geom = obj.geometry as { type: string; coordinates: unknown } | undefined;
    if (geom?.type === 'Polygon' && Array.isArray(geom.coordinates) && Array.isArray(geom.coordinates[0])) {
      rawRing = (geom.coordinates[0] as unknown[]).map((c) => {
        const arr = c as number[];
        return [Number(arr[1]), Number(arr[0])];
      });
    } else if (
      geom?.type === 'MultiPolygon' &&
      Array.isArray(geom.coordinates) &&
      Array.isArray(geom.coordinates[0]) &&
      Array.isArray(geom.coordinates[0][0])
    ) {
      rawRing = (geom.coordinates[0][0] as unknown[]).map((c) => {
        const arr = c as number[];
        return [Number(arr[1]), Number(arr[0])];
      });
    } else {
      throw new Error('Feature GeoJSON tidak berisi geometri Polygon');
    }
  } else if (obj.type === 'Polygon' && Array.isArray(obj.coordinates) && Array.isArray(obj.coordinates[0])) {
    properties = (obj.properties as Record<string, unknown>) || {};
    rawRing = (obj.coordinates[0] as unknown[]).map((c) => {
      const arr = c as number[];
      return [Number(arr[1]), Number(arr[0])];
    });
  } else {
    throw new Error('File GeoJSON tidak berisi polygon yang dikenali');
  }

  const polygon = cleanPolygonRing(rawRing);
  return { polygon, properties };
}

/**
 * Ekstraksi koordinat poligon dari dokumen GPX (trkpt, rtept, atau wpt).
 */
export function extractPolygonFromGPX(xmlDoc: Document): {
  polygon: [number, number][];
  properties: Record<string, unknown>;
} {
  const properties: Record<string, unknown> = {};

  // Cari nama/metadata
  const nameEl = xmlDoc.querySelector('trk > name, rte > name, metadata > name, gpx > name');
  if (nameEl?.textContent) {
    properties.name = nameEl.textContent.trim();
  }
  const descEl = xmlDoc.querySelector('trk > desc, rte > desc, metadata > desc');
  if (descEl?.textContent) {
    properties.description = descEl.textContent.trim();
  }

  // Cari elemen titik GPS: prioritaskan trkpt, lalu rtept, lalu wpt
  const trkpts = Array.from(xmlDoc.querySelectorAll('trkpt'));
  const rtepts = Array.from(xmlDoc.querySelectorAll('rtept'));
  const wpts = Array.from(xmlDoc.querySelectorAll('wpt'));

  const ptEls = trkpts.length >= 3 ? trkpts : rtepts.length >= 3 ? rtepts : wpts;

  if (ptEls.length < 3) {
    throw new Error('File GPX tidak berisi polygon atau titik koordinat minimal 3');
  }

  const rawPts: [number, number][] = [];
  for (const el of ptEls) {
    const latStr = el.getAttribute('lat');
    const lonStr = el.getAttribute('lon');
    if (latStr && lonStr) {
      const lat = parseFloat(latStr);
      const lng = parseFloat(lonStr);
      if (!isNaN(lat) && !isNaN(lng)) {
        rawPts.push([lat, lng]);
      }
    }
  }

  const polygon = cleanPolygonRing(rawPts);
  return { polygon, properties };
}

/**
 * Ekstraksi koordinat poligon dari dokumen KML (Polygon, LinearRing, coordinates, ExtendedData).
 */
export function extractPolygonFromKML(xmlDoc: Document): {
  polygon: [number, number][];
  properties: Record<string, unknown>;
} {
  const properties: Record<string, unknown> = {};

  // Ekstraksi metadata placemark
  const placemark = xmlDoc.querySelector('Placemark');
  if (placemark) {
    const nameEl = placemark.querySelector('name');
    if (nameEl?.textContent) {
      properties.name = nameEl.textContent.trim();
    }
    const descEl = placemark.querySelector('description');
    if (descEl?.textContent) {
      properties.description = descEl.textContent.trim();
    }

    // Ekstraksi ExtendedData / SimpleData jika ada (format standar Avenza / GIS KML)
    const simpleDataList = placemark.querySelectorAll('SimpleData');
    simpleDataList.forEach((el) => {
      const key = el.getAttribute('name');
      if (key && el.textContent) {
        properties[key] = el.textContent.trim();
      }
    });

    const dataList = placemark.querySelectorAll('Data');
    dataList.forEach((el) => {
      const key = el.getAttribute('name');
      const valEl = el.querySelector('value');
      if (key && valEl?.textContent) {
        properties[key] = valEl.textContent.trim();
      }
    });
  }

  // Cari elemen coordinates di dalam Polygon atau LinearRing
  const coordEls = Array.from(xmlDoc.querySelectorAll('Polygon coordinates, LinearRing coordinates, coordinates'));
  let rawPts: [number, number][] = [];

  for (const el of coordEls) {
    const text = el.textContent || '';
    const tuples = text.trim().split(/\s+/).filter(Boolean);
    const candidate: [number, number][] = [];

    for (const tuple of tuples) {
      const parts = tuple.split(',');
      if (parts.length >= 2) {
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lng)) {
          candidate.push([lat, lng]);
        }
      }
    }

    if (candidate.length >= 3) {
      rawPts = candidate;
      break;
    }
  }

  if (rawPts.length < 3) {
    throw new Error('File KML tidak berisi polygon atau koordinat yang valid');
  }

  const polygon = cleanPolygonRing(rawPts);
  return { polygon, properties };
}

/**
 * Parser utama untuk membaca dan mengekstrak berkas spasial GPS lapangan (.geojson, .json, .gpx, .kml).
 */
export async function parseGeoFile(file: File): Promise<ParsedGeoResult> {
  // 1. Batas ukuran berkas: maksimal 5 MB
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('File terlalu besar, maksimal 5 MB');
  }

  // 2. Baca isi teks berkas
  let text = '';
  try {
    text = await file.text();
  } catch {
    throw new Error('Gagal membaca isi berkas');
  }

  // 3. Validasi berkas teks (tolak binary bytes)
  if (/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 1024))) {
    throw new Error('Hanya file teks GeoJSON/GPX/KML yang didukung (bukan format biner)');
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Berkas kosong');
  }

  let result: { polygon: [number, number][]; properties: Record<string, unknown> };
  let format: 'geojson' | 'gpx' | 'kml';

  // 4. Deteksi format
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    format = 'geojson';
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      throw new Error('File JSON rusak atau tidak valid');
    }
    result = extractPolygonFromGeoJSON(parsedJson);
  } else if (/<gpx[\s>]/i.test(text)) {
    format = 'gpx';
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      throw new Error('File XML rusak atau tidak lengkap');
    }
    result = extractPolygonFromGPX(doc);
  } else if (/<kml[\s>]/i.test(text)) {
    format = 'kml';
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      throw new Error('File XML rusak atau tidak lengkap');
    }
    result = extractPolygonFromKML(doc);
  } else {
    throw new Error('Format tidak dikenal. Gunakan berkas .geojson, .json, .gpx, atau .kml');
  }

  // 5. Validasi hasil poligon
  if (!result.polygon || result.polygon.length < 3) {
    throw new Error('Polygon butuh minimal 3 titik koordinat unik');
  }

  const areaM2 = calculateSphericalArea(result.polygon);
  if (areaM2 < 1) {
    throw new Error('Luas poligon terlalu kecil (minimal 1 m²)');
  }

  return {
    polygon: result.polygon,
    properties: result.properties,
    format,
    areaM2,
  };
}
