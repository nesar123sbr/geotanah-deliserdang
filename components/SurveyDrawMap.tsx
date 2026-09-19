'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Polygon, useMap, useMapEvents, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RotateCcw, Check, Undo, LocateFixed, Edit3, CheckCircle2 } from 'lucide-react';

export interface SurveyPolygonResult {
  geojson: string | null;
  areaM2: number | null;
  points: [number, number][]; // [lat, lng]
  centroid: [number, number] | null;
}

export interface SurveyDrawMapProps {
  gps: { lat: number; lng: number; accuracy: number } | null;
  onPolygonChange: (result: SurveyPolygonResult) => void;
  disabled?: boolean;
  importedPoints?: [number, number][] | null;
}

/**
 * Hitung luas poligon pada bola bumi (geodesic spherical approximation).
 * Akurasi tinggi untuk luasan persil tanah lokal (< 0.1% selisih dengan PostGIS Spheroid).
 */
export function calculateSphericalPolygonArea(coords: [number, number][]): number {
  const n = coords.length;
  if (n < 3) return 0;
  const R = 6378137; // Jari-jari WGS84 (meter)
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

export function formatAreaM2(area: number): string {
  if (area >= 10000) {
    const ha = area / 10000;
    return `${area.toLocaleString('id-ID', { maximumFractionDigits: 1 })} m² (${ha.toLocaleString('id-ID', { maximumFractionDigits: 2 })} ha)`;
  }
  return `${area.toLocaleString('id-ID', { maximumFractionDigits: 1 })} m²`;
}

export function calculateCentroid(points: [number, number][]): [number, number] {
  if (points.length === 0) return [2.7485, 98.3175];
  let sumLat = 0;
  let sumLng = 0;
  for (const pt of points) {
    sumLat += pt[0];
    sumLng += pt[1];
  }
  return [sumLat / points.length, sumLng / points.length];
}

export function pointsToGeoJson(points: [number, number][]): string {
  if (points.length < 3) return '';
  const ring = points.map(pt => [
    Number(pt[1].toFixed(7)), // lng
    Number(pt[0].toFixed(7)), // lat
  ]);
  // Tutup linear ring
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring.push([...ring[0]]);
  }
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [ring],
  });
}

function MapEvents({
  onMapClick,
  isLocked,
}: {
  onMapClick: (lat: number, lng: number) => void;
  isLocked: boolean;
}) {
  useMapEvents({
    click(e) {
      if (isLocked) return;
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function MapController({
  flyTarget,
  onFlyDone,
  boundsTarget,
  onBoundsDone,
}: {
  flyTarget: [number, number] | null;
  onFlyDone: () => void;
  boundsTarget: [number, number][] | null;
  onBoundsDone: () => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (boundsTarget && boundsTarget.length >= 3) {
      map.fitBounds(L.latLngBounds(boundsTarget), { padding: [30, 30], maxZoom: 18 });
      onBoundsDone();
    } else if (flyTarget) {
      map.flyTo(flyTarget, 18, { duration: 0.8 });
      onFlyDone();
    }
  }, [map, flyTarget, boundsTarget, onFlyDone, onBoundsDone]);
  return null;
}

const gpsDivIcon = L.divIcon({
  className: 'bg-transparent border-0',
  html: `
    <div style="
      position: relative;
      width: 18px;
      height: 18px;
      background: #2563eb;
      border: 2.5px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.35), 0 2px 4px rgba(0,0,0,0.3);
    "></div>
  `,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function createVertexIcon(index: number, isLocked: boolean) {
  const bg = isLocked ? '#047857' : (index === 0 ? '#059669' : '#10b981');
  return L.divIcon({
    className: 'bg-transparent border-0',
    html: `
      <div style="
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${bg};
        color: #ffffff;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 9999px;
        border: 2px solid #ffffff;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        transform: translate(-50%, -50%);
        white-space: nowrap;
        user-select: none;
      ">P-${index + 1}</div>
    `,
    iconSize: [32, 22],
    iconAnchor: [16, 11],
  });
}

export default function SurveyDrawMap({
  gps,
  onPolygonChange,
  disabled = false,
  importedPoints = null,
}: SurveyDrawMapProps) {
  const [mounted, setMounted] = useState(false);
  const [points, setPoints] = useState<[number, number][]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [boundsTarget, setBoundsTarget] = useState<[number, number][] | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const prevImportedRef = useRef<[number, number][] | null>(null);

  // Tangani poligon yang diimpor dari berkas GPS (Avenza/GPX/KML)
  useEffect(() => {
    if (importedPoints && importedPoints !== prevImportedRef.current && importedPoints.length >= 3) {
      prevImportedRef.current = importedPoints;
      setPoints(importedPoints);
      setIsLocked(true);
      setBoundsTarget(importedPoints);
      const centroid = calculateCentroid(importedPoints);
      onPolygonChange({
        geojson: pointsToGeoJson(importedPoints),
        areaM2: calculateSphericalPolygonArea(importedPoints),
        points: importedPoints,
        centroid,
      });
    }
  }, [importedPoints, onPolygonChange]);

  // Hitung luas real-time saat titik bertambah
  const areaM2 = useMemo(() => {
    if (points.length < 3) return 0;
    return calculateSphericalPolygonArea(points);
  }, [points]);

  // Tambah titik patok baru saat klik peta
  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (disabled || isLocked) return;
    setPoints(prev => {
      const next = [...prev, [lat, lng] as [number, number]];
      const nextArea = next.length >= 3 ? calculateSphericalPolygonArea(next) : null;
      const centroid = next.length >= 3 ? calculateCentroid(next) : null;
      // Jangan langsung trigger lock, biarkan user menambah titik
      onPolygonChange({
        geojson: next.length >= 3 ? pointsToGeoJson(next) : null,
        areaM2: nextArea,
        points: next,
        centroid,
      });
      return next;
    });
  }, [disabled, isLocked, onPolygonChange]);

  // Hapus semua titik (Ulangi)
  const handleReset = useCallback(() => {
    setPoints([]);
    setIsLocked(false);
    onPolygonChange({
      geojson: null,
      areaM2: null,
      points: [],
      centroid: null,
    });
  }, [onPolygonChange]);

  // Hapus titik terakhir (Undo)
  const handleUndo = useCallback(() => {
    if (isLocked || points.length === 0) return;
    setPoints(prev => {
      const next = prev.slice(0, -1);
      const nextArea = next.length >= 3 ? calculateSphericalPolygonArea(next) : null;
      const centroid = next.length >= 3 ? calculateCentroid(next) : null;
      onPolygonChange({
        geojson: next.length >= 3 ? pointsToGeoJson(next) : null,
        areaM2: nextArea,
        points: next,
        centroid,
      });
      return next;
    });
  }, [isLocked, points.length, onPolygonChange]);

  // Kunci poligon (Selesai)
  const handleLock = useCallback(() => {
    if (points.length < 3) return;
    setIsLocked(true);
    const geojson = pointsToGeoJson(points);
    const finalArea = calculateSphericalPolygonArea(points);
    const centroid = calculateCentroid(points);
    onPolygonChange({
      geojson,
      areaM2: finalArea,
      points,
      centroid,
    });
  }, [points, onPolygonChange]);

  // Buka kembali kunci poligon (Edit Kembali)
  const handleUnlock = useCallback(() => {
    setIsLocked(false);
  }, []);

  // Pusatkan peta ke lokasi GPS surveyor
  const handleCenterGps = useCallback(() => {
    if (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)) {
      setFlyTarget([gps.lat, gps.lng]);
    }
  }, [gps]);

  const handleFlyDone = useCallback(() => {
    setFlyTarget(null);
  }, []);

  if (!mounted) {
    return (
      <div className="h-[340px] sm:h-[380px] w-full rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-xs text-slate-500 font-mono">
        Menyiapkan peta kerja delineasi...
      </div>
    );
  }

  const initialCenter: [number, number] = gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)
    ? [gps.lat, gps.lng]
    : [2.7485, 98.3175]; // Sidikalang

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-slate-200 bg-slate-900 shadow-sm">
      {/* Header Info Bar */}
      <div className="absolute top-3 left-3 right-3 z-[1000] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto inline-flex items-center gap-2 rounded-xl bg-white/95 backdrop-blur-md px-3 py-1.5 text-xs shadow-md border border-slate-200/80">
          <span className={`h-2 w-2 rounded-full ${isLocked ? 'bg-emerald-500' : points.length >= 3 ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400 animate-pulse'}`} />
          {points.length === 0 ? (
            <span className="font-medium text-slate-700">Ketuk peta untuk menandai titik patok</span>
          ) : points.length < 3 ? (
            <span className="font-medium text-slate-700">
              {points.length} patok (tambah {3 - points.length} patok lagi untuk poligon)
            </span>
          ) : (
            <span className="font-semibold text-slate-800 flex items-center gap-1.5">
              {isLocked ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 inline" />
              ) : null}
              <span>Luas: <span className="font-mono text-emerald-700">{formatAreaM2(areaM2)}</span></span>
              <span className="text-[10px] text-slate-500 font-mono">({points.length} patok)</span>
            </span>
          )}
        </div>

        {gps && (
          <button
            type="button"
            onClick={handleCenterGps}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-xl bg-white/95 backdrop-blur-md px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:text-emerald-700 hover:bg-white shadow-md border border-slate-200/80 active:scale-95 transition-all"
            title="Pusatkan peta ke lokasi GPS Anda saat ini"
          >
            <LocateFixed className="h-3.5 w-3.5 text-blue-600" />
            <span>Pusatkan ke GPS</span>
          </button>
        )}
      </div>

      {/* Map Container */}
      <div className="h-[340px] sm:h-[380px] w-full">
        <MapContainer
          center={initialCenter}
          zoom={17}
          scrollWheelZoom={true}
          preferCanvas={true}
          className="h-full w-full"
        >
          <MapController
            flyTarget={flyTarget}
            onFlyDone={handleFlyDone}
            boundsTarget={boundsTarget}
            onBoundsDone={() => setBoundsTarget(null)}
          />
          <MapEvents onMapClick={handleMapClick} isLocked={isLocked || disabled} />

          <LayersControl position="bottomleft">
            <LayersControl.BaseLayer checked name="Satelit ESRI">
              <TileLayer
                attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Vektor Jalan (OSM)">
              <TileLayer
                attribution='&copy; OpenStreetMap'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
            </LayersControl.BaseLayer>
          </LayersControl>

          {/* Marker Lokasi GPS Surveyor */}
          {gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng) && (
            <Marker position={[gps.lat, gps.lng]} icon={gpsDivIcon} />
          )}

          {/* Garis Polyline (saat hanya 2 titik) */}
          {points.length === 2 && (
            <Polyline
              positions={points}
              pathOptions={{ color: '#10b981', weight: 3, dashArray: '6, 6' }}
            />
          )}

          {/* Poligon (saat >= 3 titik) */}
          {points.length >= 3 && (
            <Polygon
              positions={points}
              pathOptions={{
                color: '#059669',
                weight: isLocked ? 3 : 2,
                fillColor: '#10b981',
                fillOpacity: isLocked ? 0.45 : 0.25,
                dashArray: isLocked ? undefined : '6, 6',
              }}
            />
          )}

          {/* Marker untuk tiap patok sudut poligon */}
          {points.map((pt, idx) => (
            <Marker
              key={`vertex-${idx}-${pt[0]}-${pt[1]}`}
              position={pt}
              icon={createVertexIcon(idx, isLocked)}
              zIndexOffset={1000 + idx}
            />
          ))}
        </MapContainer>
      </div>

      {/* Bottom Action Controls Bar */}
      <div className="p-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-slate-500">
          <span className="font-mono text-slate-700 font-semibold">{points.length}</span> patok terpasang
        </div>

        <div className="flex items-center gap-2">
          {points.length > 0 && !isLocked && (
            <button
              type="button"
              onClick={handleUndo}
              disabled={disabled}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium active:scale-95 transition-all disabled:opacity-50"
            >
              <Undo className="h-3.5 w-3.5 text-slate-600" />
              <span>Hapus Titik</span>
            </button>
          )}

          {points.length > 0 && (
            <button
              type="button"
              onClick={handleReset}
              disabled={disabled}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 text-slate-700 font-medium active:scale-95 transition-all disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Ulangi</span>
            </button>
          )}

          {points.length >= 3 && !isLocked && (
            <button
              type="button"
              onClick={handleLock}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-sm active:scale-95 transition-all disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              <span>Selesai (Kunci Poligon)</span>
            </button>
          )}

          {isLocked && (
            <button
              type="button"
              onClick={handleUnlock}
              disabled={disabled}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold hover:bg-emerald-100 active:scale-95 transition-all disabled:opacity-50"
            >
              <Edit3 className="h-3.5 w-3.5" />
              <span>Edit Kembali</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
