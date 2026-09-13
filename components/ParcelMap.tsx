'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, LayersControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { ParcelData } from '@/lib/supabase';

interface MapProps {
  parcels: ParcelData[];
  selectedParcel: ParcelData | null;
  onSelectParcel: (parcel: ParcelData) => void;
}

export default function ParcelMap({ parcels, selectedParcel, onSelectParcel }: MapProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-900 text-slate-400 font-mono text-xs">
        Menyiapkan layer peta spasial Deli Serdang...
      </div>
    );
  }

  const getStyle = (parcel: ParcelData) => {
    const isSelected = selectedParcel?.id === parcel.id;
    if (parcel.is_overlapping || parcel.status === 'Tumpang Tindih') {
      return {
        fillColor: '#ef4444',
        weight: isSelected ? 3.5 : 1.5,
        opacity: 1,
        color: '#dc2626',
        fillOpacity: isSelected ? 0.65 : 0.4,
      };
    }
    if (parcel.status === 'Perlu Verifikasi' || parcel.deviation_percent > 2.0) {
      return {
        fillColor: '#f59e0b',
        weight: isSelected ? 3.5 : 1.5,
        opacity: 1,
        color: '#d97706',
        fillOpacity: isSelected ? 0.65 : 0.4,
      };
    }
    return {
      fillColor: '#10b981',
      weight: isSelected ? 3.5 : 1.5,
      opacity: 1,
      color: '#059669',
      fillOpacity: isSelected ? 0.65 : 0.4,
    };
  };

  return (
    <div className="h-full w-full relative z-0">
      <MapContainer
        center={[3.5585, 98.8755]} // Sentral Lubuk Pakam
        zoom={16}
        scrollWheelZoom={true}
        className="h-full w-full rounded-2xl"
      >
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
          try {
            const geojsonObj = JSON.parse(parcel.geojson);
            return (
              <GeoJSON
                key={parcel.id}
                data={geojsonObj}
                style={() => getStyle(parcel)}
                eventHandlers={{
                  click: () => onSelectParcel(parcel),
                }}
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