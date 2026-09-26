import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[GeoTanah Supabase Client] Warning: NEXT_PUBLIC_SUPABASE_URL atau NEXT_PUBLIC_SUPABASE_ANON_KEY belum terdefinisi. Periksa berkas .env.local Anda.'
  );
}

export const supabase = createClient<Database>(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseKey || 'placeholder-key'
);

export type KKPCategory = 'KW 1' | 'KW 4' | 'KW 5' | 'KW 6';
export type ParcelStatus = 'Terverifikasi' | 'Perlu Verifikasi' | 'Tumpang Tindih';
export type ProgramType = 'Reguler' | 'Wakaf' | 'Rumah Ibadah' | 'MBR' | 'Hibah';

export interface ParcelData {
  id: string;
  nib: string;
  owner_name: string;
  address?: string | null;
  sub_district: string;
  village: string;
  legal_area_m2: number;
  spatial_area_m2: number | null;
  deviation_percent: number | null;
  is_overlapping: boolean | null;
  status: ParcelStatus;
  kkp_category: KKPCategory | null;
  hak_type: string | null;
  dataset_key: string;
  is_demo: boolean;
  geometry_source: string | null;
  surveyor_notes?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  centroid_lat?: number | null;
  centroid_lng?: number | null;
  gps_accuracy_m?: number | null;
  photo_path?: string | null;
  surveyed_at?: string | null;
  program_type?: ProgramType | null;
  geojson: string | null;
}

/**
 * Parsing path foto survei dari database.
 * Mendukung format single-path, comma-separated ('path1,path2'), dan JSON array string.
 */
export function parsePhotoPaths(raw?: string | null): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {}
  }
  return trimmed.split(',').map((p) => p.trim()).filter(Boolean);
}