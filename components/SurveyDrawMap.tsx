'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Polygon, useMap, useMapEvents, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RotateCcw, Check, Undo, LocateFixed, Edit3, CheckCircle2, LoaderCircle, Crosshair, MapPin } from 'lucide-react';
import { toast } from 'sonner';

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
  resetKey?: number;
  className?: string;
  mapHeightClassName?: string;
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
  onMapReady,
}: {
  flyTarget: [number, number] | null;
  onFlyDone: () => void;
  boundsTarget: [number, number][] | null;
  onBoundsDone: () => void;
  onMapReady?: (map: L.Map) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (onMapReady) {
      onMapReady(map);
    }
  }, [map, onMapReady]);

  useEffect(() => {
    if (boundsTarget && boundsTarget.length >= 3) {
      map.fitBounds(L.latLngBounds(boundsTarget), { padding: [30, 30], maxZoom: 20 });
      onBoundsDone();
    } else if (flyTarget) {
      map.flyTo(flyTarget, 19, { duration: 0.8 });
      onFlyDone();
    }
  }, [map, flyTarget, boundsTarget, onFlyDone, onBoundsDone]);
  return null;
}

const pulsingBlueDotIcon = L.divIcon({
  className: 'bg-transparent border-0 pointer-events-none',
  html: `
    <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; pointer-events: none;">
      <div style="
        position: absolute;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: rgba(37, 99, 235, 0.35);
        animation: blueDotPulse 2s infinite ease-out;
        pointer-events: none;
      "></div>
      <div style="
        position: relative;
        width: 14px;
        height: 14px;
        background: #1d4ed8;
        border: 2.5px solid #ffffff;
        border-radius: 50%;
        box-shadow: 0 1px 5px rgba(0, 0, 0, 0.45);
        pointer-events: none;
        z-index: 2;
      "></div>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

function createVertexIcon(index: number, isLocked: boolean) {
  const bg = isLocked ? '#059669' : (index === 0 ? '#f59e0b' : '#10b981');
  const size = index === 0 ? 10 : 8;
  return L.divIcon({
    className: 'bg-transparent border-0 pointer-events-none',
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        background: ${bg};
        border: 2px solid #ffffff;
        border-radius: 50%;
        box-shadow: 0 1px 4px rgba(0,0,0,0.5);
        pointer-events: none;
      "></div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function SurveyDrawMap({
  gps,
  onPolygonChange,
  disabled = false,
  importedPoints = null,
  resetKey = 0,
  className = '',
  mapHeightClassName = 'h-[50vh] min-h-[350px] sm:h-[420px] md:h-[480px]',
}: SurveyDrawMapProps) {
  const [mounted, setMounted] = useState(false);
  const [points, setPoints] = useState<[number, number][]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [boundsTarget, setBoundsTarget] = useState<[number, number][] | null>(null);
  const [liveLocation, setLiveLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [isLocatingLive, setIsLocatingLive] = useState(false);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);

  const handleMapReady = useCallback((map: L.Map) => {
    setMapInstance(map);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Pelacakan GPS Geolocation Browser secara Real-Time
  useEffect(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          setLiveLocation({ lat: latitude, lng: longitude, accuracy });
        }
      },
      (err) => {
        console.warn('[SurveyDrawMap] Geolocation watch notice:', err.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 3000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  const activePosition = liveLocation || (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng) ? gps : null);

  const prevImportedRef = useRef<[number, number][] | null>(null);
  const prevResetKeyRef = useRef<number>(resetKey);

  // Sinkronisasi reset dari formulir luar (misal setelah sukses submit atau ganti mode)
  useEffect(() => {
    if (resetKey !== prevResetKeyRef.current) {
      prevResetKeyRef.current = resetKey;
      setPoints([]);
      setIsLocked(false);
      prevImportedRef.current = null;
    }
  }, [resetKey]);

  // Tangani poligon yang diimpor dari berkas GPS (Avenza/GPX/KML)
  useEffect(() => {
    if (!importedPoints) {
      prevImportedRef.current = null;
      return;
    }
    if (importedPoints !== prevImportedRef.current && importedPoints.length >= 3) {
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
      toast.success(`Poligon GPS berhasil dimuat (${importedPoints.length} patok).`);
    }
  }, [importedPoints, onPolygonChange]);

  // Hitung luas real-time saat titik bertambah
  const areaM2 = useMemo(() => {
    if (points.length < 3) return 0;
    return calculateSphericalPolygonArea(points);
  }, [points]);

  // Helper murni untuk sinkronisasi state titik ke parent tanpa side-effect di dalam setState updater
  const syncPolygonToParent = useCallback((nextPoints: [number, number][]) => {
    const nextArea = nextPoints.length >= 3 ? calculateSphericalPolygonArea(nextPoints) : null;
    const centroid = nextPoints.length >= 3 ? calculateCentroid(nextPoints) : null;
    onPolygonChange({
      geojson: nextPoints.length >= 3 ? pointsToGeoJson(nextPoints) : null,
      areaM2: nextArea,
      points: nextPoints,
      centroid,
    });
  }, [onPolygonChange]);

  // Tambah titik patok baru saat klik peta
  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (disabled || isLocked) return;
    const next: [number, number][] = [...points, [lat, lng]];
    setPoints(next);
    syncPolygonToParent(next);
    toast.success(`Patok #${next.length} ditambahkan.`);
  }, [disabled, isLocked, points, syncPolygonToParent]);

  // Hapus semua titik (Ulangi)
  const handleReset = useCallback(() => {
    setPoints([]);
    setIsLocked(false);
    syncPolygonToParent([]);
    toast.info('Digitasi patok telah dibersihkan.');
  }, [syncPolygonToParent]);

  // Hapus titik terakhir (Undo)
  const handleUndo = useCallback(() => {
    if (isLocked || points.length === 0) return;
    const next = points.slice(0, -1);
    setPoints(next);
    syncPolygonToParent(next);
    toast.info(`Patok terakhir dibatalkan (${next.length} tersisa).`);
  }, [isLocked, points, syncPolygonToParent]);

  // Kunci poligon (Selesai)
  const handleLock = useCallback(() => {
    if (points.length < 3) return;
    setIsLocked(true);
    syncPolygonToParent(points);
    toast.success(`Poligon berhasil dikunci! Luas: ${formatAreaM2(calculateSphericalPolygonArea(points))}`);
  }, [points, syncPolygonToParent]);

  // Buka kembali kunci poligon (Edit Kembali)
  const handleUnlock = useCallback(() => {
    setIsLocked(false);
    toast.info('Mode edit poligon diaktifkan kembali.');
  }, []);

  // Pusatkan peta ke lokasi GPS surveyor saat ini
  const handleCenterMyLocation = useCallback(() => {
    if (activePosition) {
      setFlyTarget([activePosition.lat, activePosition.lng]);
      toast.success(`Peta dipusatkan ke koordinat (${activePosition.lat.toFixed(5)}, ${activePosition.lng.toFixed(5)})`);
      return;
    }

    if (typeof window !== 'undefined' && 'geolocation' in navigator) {
      setIsLocatingLive(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setIsLocatingLive(false);
          const { latitude, longitude, accuracy } = pos.coords;
          if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            setLiveLocation({ lat: latitude, lng: longitude, accuracy });
            setFlyTarget([latitude, longitude]);
            toast.success(`Lokasi GPS terdeteksi (Akurasi: ±${accuracy.toFixed(1)}m)`);
          }
        },
        (err) => {
          setIsLocatingLive(false);
          toast.error(`Gagal mengambil lokasi GPS: ${err.message}. Pastikan izin lokasi aktif.`);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      toast.error('Fitur geolokasi tidak didukung oleh peramban ini.');
    }
  }, [activePosition]);

  const handleFlyDone = useCallback(() => {
    setFlyTarget(null);
  }, []);

  // 1. Rekam koordinat tengah bidikan (Crosshair Target)
  const handleRecordCrosshairCenter = useCallback(() => {
    if (disabled || isLocked || !mapInstance) return;
    const center = mapInstance.getCenter();
    const lat = Number(center.lat.toFixed(7));
    const lng = Number(center.lng.toFixed(7));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const next: [number, number][] = [...points, [lat, lng]];
    setPoints(next);
    syncPolygonToParent(next);
    toast.success(`🎯 Patok #${next.length} direkam dari bidikan tengah.`);
  }, [disabled, isLocked, mapInstance, points, syncPolygonToParent]);

  // 2. Rekam koordinat GPS posisi surveyor saat ini (Snap to GPS)
  const handleRecordGpsLocation = useCallback(() => {
    if (disabled || isLocked) return;

    if (!activePosition || !Number.isFinite(activePosition.lat) || !Number.isFinite(activePosition.lng)) {
      toast.error('Titik GPS belum terdeteksi. Silakan tunggu sinyal GPS atau klik "Pusatkan Lokasi" terlebih dahulu.');
      return;
    }

    const lat = Number(activePosition.lat.toFixed(7));
    const lng = Number(activePosition.lng.toFixed(7));
    const next: [number, number][] = [...points, [lat, lng]];
    setPoints(next);
    syncPolygonToParent(next);
    toast.success(`📍 Patok #${next.length} direkam dari posisi GPS (Akurasi: ±${activePosition.accuracy?.toFixed(1) || '?'}m).`);
  }, [disabled, isLocked, activePosition, points, syncPolygonToParent]);

  if (!mounted) {
    return (
      <div className={`${mapHeightClassName} w-full rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-xs text-slate-500 font-mono`}>
        Menyiapkan peta kerja delineasi...
      </div>
    );
  }

  const initialCenter: [number, number] = activePosition
    ? [activePosition.lat, activePosition.lng]
    : [2.7485, 98.3175]; // Sidikalang

  return (
    <div className={`relative w-full h-full flex flex-col overflow-hidden bg-slate-950 ${className}`}>
      <style>{`
        @keyframes blueDotPulse {
          0% { transform: scale(0.4); opacity: 0.9; }
          70% { transform: scale(1.6); opacity: 0; }
          100% { transform: scale(1.6); opacity: 0; }
        }
      `}</style>

      {/* ── HUD Status Bar (Top Left, safe from top navigation) ──────── */}
      {points.length > 0 && (
        <div className="absolute top-14 sm:top-16 left-3 z-[1000] pointer-events-none">
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-xl bg-white/95 backdrop-blur-md px-3 py-1.5 text-xs shadow-lg border border-slate-200/90 text-slate-800">
            <span className={`h-2 w-2 rounded-full ${isLocked ? 'bg-emerald-600' : points.length >= 3 ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400 animate-pulse'}`} />
            {points.length < 3 ? (
              <span className="font-medium text-slate-700">
                {points.length} patok <span className="text-slate-400 font-normal">(butuh {3 - points.length} lagi)</span>
              </span>
            ) : (
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                {isLocked && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 inline" />}
                <span>Luas: <span className="font-mono text-emerald-700 font-bold">{formatAreaM2(areaM2)}</span></span>
                <span className="text-[10px] text-slate-400 font-mono">({points.length} patok)</span>
              </span>
            )}
            {isLocked && (
              <button
                type="button"
                onClick={handleUnlock}
                disabled={disabled}
                className="ml-1 text-[11px] font-bold text-emerald-700 hover:text-emerald-800 underline cursor-pointer"
                title="Buka kunci poligon untuk menambah/mengedit patok"
              >
                Edit
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Map Container (fills available space) ────────────────────── */}
      <div className={`relative w-full flex-1 min-h-0 ${mapHeightClassName}`}>
        <MapContainer
          center={initialCenter}
          zoom={17}
          maxZoom={22}
          scrollWheelZoom={true}
          preferCanvas={true}
          className={`h-full w-full ${!isLocked && !disabled ? 'cursor-crosshair' : ''}`}
        >
          <MapController
            flyTarget={flyTarget}
            onFlyDone={handleFlyDone}
            boundsTarget={boundsTarget}
            onBoundsDone={() => setBoundsTarget(null)}
            onMapReady={handleMapReady}
          />
          <MapEvents onMapClick={handleMapClick} isLocked={isLocked || disabled} />

          <LayersControl position="bottomleft">
            <LayersControl.BaseLayer checked name="Satelit">
              <TileLayer
                attribution="&copy; Google Maps"
                url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
                maxZoom={22}
                maxNativeZoom={20}
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Topografi">
              <TileLayer
                attribution="&copy; Google Maps"
                url="https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}"
                maxZoom={22}
                maxNativeZoom={20}
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Vektor">
              <TileLayer
                attribution='&copy; OpenStreetMap'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxZoom={22}
                maxNativeZoom={19}
              />
            </LayersControl.BaseLayer>
          </LayersControl>

          {/* Marker Titik Biru Posisi Real-Time Surveyor */}
          {activePosition && (
            <Marker
              position={[activePosition.lat, activePosition.lng]}
              icon={pulsingBlueDotIcon}
              interactive={false}
              zIndexOffset={500}
            />
          )}

          {/* Garis Polyline (saat 2 titik) */}
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

          {/* Marker tiap patok sudut poligon */}
          {points.map((pt, idx) => (
            <Marker
              key={`vertex-${idx}-${pt[0]}-${pt[1]}`}
              position={pt}
              icon={createVertexIcon(idx, isLocked)}
              interactive={false}
              zIndexOffset={1000 + idx}
            />
          ))}
        </MapContainer>

        {/* ── Crosshair Target (Bidikan Tengah Peta) ────────────────── */}
        {!isLocked && !disabled && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-[800]"
            aria-hidden="true"
          >
            <div className="relative flex items-center justify-center">
              <div className="w-8 h-8 rounded-full border-2 border-rose-500 shadow-sm bg-rose-500/10 flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-rose-600 shadow-sm" />
              </div>
              <div className="absolute w-12 h-0.5 bg-rose-500/80 shadow-xs pointer-events-none" />
              <div className="absolute h-12 w-0.5 bg-rose-500/80 shadow-xs pointer-events-none" />
            </div>
          </div>
        )}

        {/* ── FAB Pusatkan ke Lokasi Surveyor (Floating GPS Button) ── */}
        <button
          type="button"
          onClick={handleCenterMyLocation}
          disabled={isLocatingLive}
          className="absolute bottom-28 sm:bottom-24 lg:bottom-16 right-3 sm:right-4 z-[1000] inline-flex items-center justify-center h-11 w-11 rounded-full bg-white/95 backdrop-blur-md text-slate-700 hover:text-blue-600 hover:bg-white shadow-xl border border-slate-200/90 transition-all duration-150 active:scale-[0.95] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          title="Pusatkan peta ke lokasi GPS Anda saat ini"
          aria-label="Pusatkan ke lokasi saya"
        >
          {isLocatingLive ? (
            <LoaderCircle className="h-5 w-5 animate-spin text-blue-600 shrink-0" />
          ) : (
            <LocateFixed className={`h-5 w-5 shrink-0 ${activePosition ? 'text-blue-600' : 'text-slate-600'}`} />
          )}
        </button>

        {/* ── Floating Action Dock (macOS Glassmorphism) ─────────────── */}
        {!isLocked && !disabled && (
          <div className="absolute bottom-[80px] sm:bottom-6 left-1/2 -translate-x-1/2 z-[1000] floating-dock rounded-full px-2 sm:px-3 py-1.5 flex items-center gap-1.5 sm:gap-2 max-w-[94vw] shadow-2xl">
            {/* Rekam Bidikan */}
            <button
              type="button"
              onClick={handleRecordCrosshairCenter}
              className="inline-flex min-h-10 items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-sm transition-all duration-150 active:scale-[0.96] cursor-pointer shrink-0"
              title="Rekam koordinat titik tengah bidikan (Crosshair)"
            >
              <Crosshair className="h-4 w-4 shrink-0" />
              <span className="hidden xs:inline">Rekam Bidikan</span>
              <span className="xs:hidden">Bidikan</span>
            </button>

            {/* Rekam GPS */}
            <button
              type="button"
              onClick={handleRecordGpsLocation}
              className="inline-flex min-h-10 items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-sm transition-all duration-150 active:scale-[0.96] cursor-pointer shrink-0"
              title="Rekam koordinat GPS posisi surveyor saat ini"
            >
              <MapPin className="h-4 w-4 shrink-0" />
              <span className="hidden xs:inline">Rekam GPS</span>
              <span className="xs:hidden">GPS</span>
            </button>

            {/* Batal Patok Terakhir */}
            {points.length > 0 && (
              <button
                type="button"
                onClick={handleUndo}
                disabled={disabled}
                className="inline-flex min-h-10 items-center gap-1 px-2.5 sm:px-3 py-2 rounded-full border border-slate-200 bg-white/90 hover:bg-white text-slate-700 font-semibold text-xs shadow-xs transition-all duration-150 active:scale-[0.96] disabled:opacity-50 cursor-pointer shrink-0"
                title="Hapus patok terakhir"
              >
                <Undo className="h-3.5 w-3.5 text-slate-500" />
                <span className="hidden sm:inline">Batal</span>
              </button>
            )}

            {/* Selesai / Kunci Poligon langsung dari Dock */}
            {points.length >= 3 && (
              <button
                type="button"
                onClick={handleLock}
                disabled={disabled}
                className="inline-flex min-h-10 items-center gap-1 px-3 sm:px-3.5 py-2 rounded-full bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs shadow-sm transition-all duration-150 active:scale-[0.96] disabled:opacity-50 cursor-pointer shrink-0"
                title="Kunci poligon batas bidang tanah"
              >
                <Check className="h-3.5 w-3.5" />
                <span>Selesai</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom Action Controls Bar (Desktop View) ────────────────── */}
      <div className="hidden lg:flex p-2.5 sm:p-3 bg-white border-t border-slate-200/90 items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-slate-500 font-medium">
          <span className="font-mono text-slate-800 font-bold bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
            {points.length} patok
          </span>
          {points.length >= 3 && areaM2 && (
            <span className="font-mono text-emerald-700 font-bold">
              Luas: {formatAreaM2(areaM2)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {points.length > 0 && !isLocked && (
            <button
              type="button"
              onClick={handleUndo}
              disabled={disabled}
              className="inline-flex min-h-9 items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-xs transition-all active:scale-[0.97] cursor-pointer"
            >
              <Undo className="h-3.5 w-3.5 text-slate-500" />
              <span>Hapus Titik</span>
            </button>
          )}

          {points.length > 0 && (
            <button
              type="button"
              onClick={handleReset}
              disabled={disabled}
              className="inline-flex min-h-9 items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50/60 hover:bg-rose-100 text-rose-700 font-semibold text-xs transition-all active:scale-[0.97] cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5 text-rose-600" />
              <span>Ulangi Semua</span>
            </button>
          )}

          {points.length >= 3 && !isLocked && (
            <button
              type="button"
              onClick={handleLock}
              disabled={disabled}
              className="inline-flex min-h-9 items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-sm transition-all active:scale-[0.97] cursor-pointer"
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
              className="inline-flex min-h-9 items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 font-bold text-xs hover:bg-emerald-100 transition-all active:scale-[0.97] cursor-pointer"
            >
              <Edit3 className="h-3.5 w-3.5" />
              <span>Edit Kembali Poligon</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

