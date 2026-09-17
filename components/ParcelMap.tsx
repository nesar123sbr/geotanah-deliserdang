'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, LayersControl, useMap } from 'react-leaflet';
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

  useEffect(() => {
    if (!geojson) return;
    try {
      const data = JSON.parse(geojson);
      const bounds = L.geoJSON(data).getBounds();
      if (bounds.isValid()) {
        map.flyToBounds(bounds, { padding: [50, 50], duration: 0.8, maxZoom: 18 });
      }
    } catch {
      // Abaikan jika geometri tidak valid
    }
  }, [map, geojson, selectedParcel?.id]);

  return null;
}

export default function ParcelMap({ parcels, selectedParcel, onSelectParcel }: MapProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
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
      <MapContainer center={[2.7485, 98.3175]} zoom={16} scrollWheelZoom={true} className="h-full w-full rounded-2xl">
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

        {parcels.map((parcel) => {
          if (!parcel.geojson) return null;
          try {
            const geojsonObj = JSON.parse(parcel.geojson);
            return (
              <GeoJSON
                key={parcel.id}
                data={geojsonObj}
                style={() => getStyle(parcel)}
                eventHandlers={{ click: () => onSelectParcel(parcel) }}
              />
            );
          } catch {
            return null;
          }
        })}
      </MapContainer>
    </div>
  );
}