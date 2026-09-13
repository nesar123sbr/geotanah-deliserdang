import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

export interface ParcelData {
  id: string;
  nib: string;
  owner_name: string;
  sub_district: string;
  village: string;
  legal_area_m2: number;
  spatial_area_m2: number;
  deviation_percent: number;
  is_overlapping: boolean;
  status: 'Terverifikasi' | 'Perlu Verifikasi' | 'Tumpang Tindih';
  surveyor_notes?: string | null;
  geojson: string;
}