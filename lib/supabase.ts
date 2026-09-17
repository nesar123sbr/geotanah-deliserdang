import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

export type KKPCategory = 'KW 1' | 'KW 4' | 'KW 5' | 'KW 6';
export type ParcelStatus = 'Terverifikasi' | 'Perlu Verifikasi' | 'Tumpang Tindih';

export interface ParcelData {
  id: string;
  nib: string;
  owner_name: string;
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
  gps_accuracy_m?: number | null;
  photo_path?: string | null;
  surveyed_at?: string | null;
  geojson: string | null;
}