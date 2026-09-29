'use client';

import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, GeoJSON, LayersControl, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ParcelData } from '@/lib/supabase';

interface MapProps {
  parcels: ParcelData[];
  selectedParcel: ParcelData | null;
  onSelectParcel: (parcel: ParcelData) => void;
  isAdmin?: boolean;
  onDeleteParcel?: (parcel: ParcelData) => void;
}

function MapUpdater({ selectedParcel }: Pick<MapProps, 'selectedParcel'>) {
  const map = useMap();
  const geojson = selectedParcel?.geojson;
  const lat = selectedParcel?.gps_lat;
  const lng = selectedParcel?.gps_lng;

  useEffect(() => {
    if (geojson) {
      try {
        const data = JSON.parse(geojson);
        const bounds = L.geoJSON(data).getBounds();
        if (bounds.isValid()) {
          map.flyToBounds(bounds, { padding: [50, 50], duration: 0.8, maxZoom: 20 });
          return;
        }
      } catch {
        // Abaikan jika geometri tidak valid
      }
    }

    if (lat !== null && lat !== undefined && lng !== null && lng !== undefined) {
      const numLat = Number(lat);
      const numLng = Number(lng);
      if (Number.isFinite(numLat) && Number.isFinite(numLng)) {
        map.flyTo([numLat, numLng], 19, { duration: 0.8 });
      }
    }
  }, [map, geojson, lat, lng, selectedParcel?.id]);

  return null;
}

function getMarkerIcon(parcel: ParcelData, isSelected: boolean) {
  let pinColor = '#10b981'; // Hijau (Terverifikasi)
  let strokeColor = '#059669';

  if (parcel.is_overlapping || parcel.status === 'Tumpang Tindih') {
    pinColor = '#ef4444'; // Merah (Overlap)
    strokeColor = '#dc2626';
  } else if (parcel.status === 'Perlu Verifikasi' || (parcel.deviation_percent !== null && Number(parcel.deviation_percent) > 2.0)) {
    pinColor = '#f59e0b'; // Kuning/Amber (Perlu Verifikasi)
    strokeColor = '#d97706';
  }

  const width = isSelected ? 34 : 26;
  const height = isSelected ? 42 : 32;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="${width}" height="${height}" style="filter: drop-shadow(0 3px 5px rgba(0,0,0,0.45));">
      <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 20 12 20s12-11 12-20c0-6.627-5.373-12-12-12z" fill="${pinColor}" stroke="${strokeColor}" stroke-width="${isSelected ? 2 : 1.5}"/>
      <circle cx="12" cy="11" r="${isSelected ? 5 : 4}" fill="#ffffff"/>
      ${isSelected ? `<circle cx="12" cy="11" r="2.5" fill="${strokeColor}"/>` : ''}
    </svg>
  `;

  return L.divIcon({
    className: 'bg-transparent border-0 outline-none',
    html: `<div style="width: ${width}px; height: ${height}px; display: flex; align-items: center; justify-content: center;">${svg}</div>`,
    iconSize: [width, height],
    iconAnchor: [width / 2, height],
  });
}

export default function ParcelMap({ parcels, selectedParcel, onSelectParcel, isAdmin, onDeleteParcel }: MapProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Memoize hasil parsing string GeoJSON agar tidak di-parse ulang di setiap frame/re-render
  const parsedGeoJsonMap = useMemo(() => {
    const map = new Map<string, GeoJSON.GeoJsonObject>();
    for (const parcel of parcels) {
      if (parcel.geojson) {
        try {
          map.set(parcel.id, JSON.parse(parcel.geojson));
        } catch {
          // Abaikan geometri tidak valid
        }
      }
    }
    return map;
  }, [parcels]);

  if (!mounted) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-slate-50 to-slate-100 text-slate-400 font-mono text-xs rounded-2xl">
        <div className="h-6 w-6 rounded-full border-2 border-slate-200 border-t-emerald-600 animate-spin" />
        <span>Memuat Layer Spasial...</span>
      </div>
    );
  }

  const getStyle = (parcel: ParcelData) => {
    const isSelected = selectedParcel?.id === parcel.id;
    if (parcel.is_overlapping || parcel.status === 'Tumpang Tindih') {
      return { fillColor: '#ef4444', weight: isSelected ? 3.5 : 1.5, opacity: 1, color: '#dc2626', fillOpacity: isSelected ? 0.65 : 0.4 };
    }
    if (parcel.status === 'Perlu Verifikasi' || (parcel.deviation_percent !== null && Number(parcel.deviation_percent) > 2.0)) {
      return { fillColor: '#f59e0b', weight: isSelected ? 3.5 : 1.5, opacity: 1, color: '#d97706', fillOpacity: isSelected ? 0.65 : 0.4 };
    }
    return { fillColor: '#10b981', weight: isSelected ? 3.5 : 1.5, opacity: 1, color: '#059669', fillOpacity: isSelected ? 0.65 : 0.4 };
  };

  return (
    <div className="h-full w-full relative z-0">
      <MapContainer 
        center={[2.7485, 98.3175]} 
        zoom={16} 
        maxZoom={22}
        scrollWheelZoom={true} 
        preferCanvas={true}
        className="h-full w-full rounded-2xl"
      >
        <MapUpdater selectedParcel={selectedParcel} />
        
        <LayersControl position="topright">
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

        {/* Layer 1: Poligon GeoJSON */}
        {parcels.map((parcel) => {
          const geojsonObj = parsedGeoJsonMap.get(parcel.id);
          if (!geojsonObj) return null;
          return (
            <GeoJSON
              key={`poly-${parcel.id}`}
              data={geojsonObj}
              style={() => getStyle(parcel)}
              eventHandlers={{ click: () => onSelectParcel(parcel) }}
              onEachFeature={(_feature, layer) => {
                if (isAdmin && onDeleteParcel) {
                  const div = document.createElement('div');
                  div.style.cssText = 'padding: 4px 2px; min-width: 160px;';
                  div.innerHTML = `
                    <div style="font-size: 12px; font-weight: 700; color: #0f172a; font-family: 'GeistMono', 'Courier New', monospace; letter-spacing: 0.02em; margin-bottom: 2px;">${parcel.nib}</div>
                    <div style="font-size: 11px; font-weight: 500; color: #334155; margin-bottom: 1px;">${parcel.owner_name}</div>
                    <div style="font-size: 10px; color: #64748b;">${parcel.village}</div>
                    <div style="height: 1px; background: #e2e8f0; margin: 8px 0 6px;"></div>
                  `;
                  const btn = document.createElement('button');
                  btn.textContent = '🗑️ Hapus Data (Admin)';
                  btn.style.cssText = 'width: 100%; padding: 7px 12px; background: #f43f5e; color: white; border: none; border-radius: 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; cursor: pointer;';
                  btn.onmouseenter = () => { btn.style.background = '#e11d48'; };
                  btn.onmouseleave = () => { btn.style.background = '#f43f5e'; };
                  btn.onclick = (e) => {
                    e.stopPropagation();
                    onDeleteParcel(parcel);
                  };
                  div.appendChild(btn);
                  layer.bindPopup(div);
                }
              }}
            />
          );
        })}

        {/* Layer 2: Pin Marker untuk persil sensus (geojson kosong tapi koordinat GPS ada) */}
        {parcels.map((parcel) => {
          if (parcel.geojson) return null;
          if (parcel.gps_lat === null || parcel.gps_lat === undefined || parcel.gps_lng === null || parcel.gps_lng === undefined) return null;

          const lat = Number(parcel.gps_lat);
          const lng = Number(parcel.gps_lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

          const isSelected = selectedParcel?.id === parcel.id;

          return (
            <Marker
              key={`marker-${parcel.id}`}
              position={[lat, lng]}
              icon={getMarkerIcon(parcel, isSelected)}
              zIndexOffset={isSelected ? 2000 : 1000}
              eventHandlers={{
                click: () => onSelectParcel(parcel),
              }}
            >
              <Popup>
                <div className="py-1 text-xs" style={{ minWidth: '160px' }}>
                  <div className="font-bold text-slate-900 font-mono tracking-wide text-[12px]">{parcel.nib}</div>
                  <div className="text-slate-600 text-[11px] font-medium mt-0.5">{parcel.owner_name}</div>
                  <div className="text-slate-400 text-[10px] mt-0.5">{parcel.village}</div>
                  {isAdmin && onDeleteParcel && (
                    <>
                      <div className="my-2 h-px bg-slate-100" />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteParcel(parcel);
                        }}
                        className="w-full py-1.5 px-3 bg-rose-500 hover:bg-rose-600 text-white rounded-[10px] text-[11px] font-bold tracking-wide flex items-center justify-center gap-1.5 cursor-pointer transition-colors duration-150"
                      >
                        <span>🗑️ Hapus Data (Admin)</span>
                      </button>
                    </>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}