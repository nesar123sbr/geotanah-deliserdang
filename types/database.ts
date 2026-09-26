export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type KKPCategory = 'KW 1' | 'KW 4' | 'KW 5' | 'KW 6';
export type ParcelStatus = 'Terverifikasi' | 'Perlu Verifikasi' | 'Tumpang Tindih';
export type ProgramType = 'Reguler' | 'Wakaf' | 'Rumah Ibadah' | 'MBR' | 'Hibah';
export type UserRole = 'admin' | 'validator' | 'surveyor' | 'viewer';

export interface Database {
  public: {
    Tables: {
      parcels: {
        Row: {
          id: string;
          nib: string;
          owner_name: string;
          address: string | null;
          sub_district: string;
          village: string;
          legal_area_m2: number;
          geom: unknown | null;
          status: ParcelStatus;
          surveyor_notes: string | null;
          created_at: string;
          updated_at: string;
          kkp_category: KKPCategory | null;
          hak_type: string | null;
          dataset_key: string;
          is_demo: boolean;
          geometry_source: string | null;
          gps_lat: number | null;
          gps_lng: number | null;
          centroid_lat: number | null;
          centroid_lng: number | null;
          gps_accuracy_m: number | null;
          photo_path: string | null;
          surveyed_at: string | null;
          program_type: ProgramType | null;
          created_by_user: string | null;
          updated_by_user: string | null;
        };
        Insert: Partial<Database['public']['Tables']['parcels']['Row']> & {
          nib: string;
        };
        Update: Partial<Database['public']['Tables']['parcels']['Row']>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          role: UserRole;
          full_name: string;
          nip: string | null;
          phone: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & {
          id: string;
          full_name: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: string;
          table_name: string;
          record_id: string;
          action: 'INSERT' | 'UPDATE' | 'DELETE';
          old_data: Json | null;
          new_data: Json | null;
          changed_by: string | null;
          changed_at: string;
        };
        Insert: Partial<Database['public']['Tables']['audit_log']['Row']>;
        Update: Partial<Database['public']['Tables']['audit_log']['Row']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_parcels_with_metrics_v2: {
        Args: { p_dataset_key?: string };
        Returns: {
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
          surveyor_notes: string | null;
          gps_lat: number | null;
          gps_lng: number | null;
          centroid_lat: number | null;
          centroid_lng: number | null;
          gps_accuracy_m: number | null;
          photo_path: string | null;
          surveyed_at: string | null;
          program_type: ProgramType | null;
          geojson: string | null;
        }[];
      };
      submit_survey_data_v2: {
        Args: {
          p_nib: string;
          p_lat: number;
          p_lng: number;
          p_accuracy?: number | null;
          p_photo_path?: string;
          p_geojson?: string | null;
          p_program_type?: string;
          p_owner_name?: string | null;
          p_address?: string | null;
        };
        Returns: Json;
      };
    };
  };
}
