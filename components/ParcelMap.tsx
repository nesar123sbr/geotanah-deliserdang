'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, LayersControl, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ParcelData } from '@/lib/supabase';

interface MapProps {
  parcels: ParcelData[];
  selectedParcel: ParcelData | null;
  onSelectParcel: (parcel: ParcelData) => void;
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
          map.flyToBounds(bounds, { padding: [50, 50], duration: 0.8, maxZoom: 18 });
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
        map.flyTo([numLat, numLng], 18, { duration: 0.8 });
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

export default function ParcelMap({ parcels, selectedParcel, onSelectParcel }: MapProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-900 text-slate-400 font-mono text-xs">
        Menyiapkan layer peta spasial Sidikalang...
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
        scrollWheelZoom={true} 
        preferCanvas={true}
        className="h-full w-full rounded-2xl"
      >
        <MapUpdater selectedParcel={selectedParcel} />
        
        <LayersControl position="topright">
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

        {/* Layer 1: Poligon GeoJSON */}
        {parcels.map((parcel) => {
          if (!parcel.geojson) return null;
          try {
            const geojsonObj = JSON.parse(parcel.geojson);
            return (
              <GeoJSON
                key={`poly-${parcel.id}`}
                data={geojsonObj}
                style={() => getStyle(parcel)}
                eventHandlers={{ click: () => onSelectParcel(parcel) }}
              />
            );
          } catch {
            return null;
          }
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
            />
          );
        })}
      </MapContainer>
    </div>
  );
}