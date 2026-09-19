-- ==============================================================================
-- GeoTanah Dairi - Skrip Database & RPC Komprehensif (v2)
-- Sinkronisasi 100% dengan Live Database Supabase
-- File: supabase_rpc_fix_v2.sql
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. TABEL PROFILES & RLS POLICIES
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'surveyor' CHECK (role IN ('admin', 'surveyor', 'validator')),
  full_name TEXT NOT NULL,
  nip TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Profiles viewable by authenticated users'
  ) THEN
    CREATE POLICY "Profiles viewable by authenticated users"
      ON public.profiles FOR SELECT TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Users can update own profile'
  ) THEN
    CREATE POLICY "Users can update own profile"
      ON public.profiles FOR UPDATE TO authenticated
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);
  END IF;
END $$;

-- Trigger pembuatan profil otomatis saat user baru mendaftar di auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, nip, phone, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'surveyor'),
    NEW.raw_user_meta_data->>'nip',
    NEW.raw_user_meta_data->>'phone',
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 2. TABEL AUDIT LOG & RLS POLICIES
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data JSONB,
  new_data JSONB,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'audit_log' AND policyname = 'Audit log viewable by admin only'
  ) THEN
    CREATE POLICY "Audit log viewable by admin only"
      ON public.audit_log FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
      );
  END IF;
END $$;

-- ==============================================================================
-- 3. MODIFIKASI TABEL PARCELS (KOLOM, INDEKS & AUDIT TRAIL)
-- ==============================================================================
-- A. Kolom program_type
ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS program_type TEXT
  CHECK (program_type IS NULL OR program_type IN
    ('Reguler', 'Wakaf', 'Rumah Ibadah', 'MBR', 'Hibah'));

UPDATE public.parcels SET program_type = 'Reguler'
  WHERE program_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_parcels_program
  ON public.parcels (program_type);

-- B. Kolom audit relasi auth.users
ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS created_by_user UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- C. Trigger BEFORE UPDATE untuk auto-isi updated_at = NOW()
CREATE OR REPLACE FUNCTION public.handle_parcels_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_parcels_updated_at ON public.parcels;
CREATE TRIGGER trg_parcels_updated_at
  BEFORE UPDATE ON public.parcels
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_parcels_updated_at();

-- D. Trigger Audit Log trg_parcels_audit_log pada public.parcels
CREATE OR REPLACE FUNCTION public.handle_parcels_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_record_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  IF TG_OP = 'INSERT' THEN
    v_record_id := NEW.id;
    IF v_user_id IS NULL THEN
      v_user_id := NEW.created_by_user;
    END IF;
    
    INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
    VALUES (
      TG_TABLE_NAME,
      v_record_id,
      'INSERT',
      NULL,
      to_jsonb(NEW) - 'geom',
      v_user_id,
      NOW()
    );
    RETURN NEW;
    
  ELSIF TG_OP = 'UPDATE' THEN
    v_record_id := NEW.id;
    IF v_user_id IS NULL THEN
      v_user_id := NEW.updated_by_user;
    END IF;

    INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
    VALUES (
      TG_TABLE_NAME,
      v_record_id,
      'UPDATE',
      to_jsonb(OLD) - 'geom',
      to_jsonb(NEW) - 'geom',
      v_user_id,
      NOW()
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    v_record_id := OLD.id;
    INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_at)
    VALUES (
      TG_TABLE_NAME,
      v_record_id,
      'DELETE',
      to_jsonb(OLD) - 'geom',
      NULL,
      v_user_id,
      NOW()
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_parcels_audit_log ON public.parcels;
CREATE TRIGGER trg_parcels_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public.parcels
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_parcels_audit_log();

-- ==============================================================================
-- 4. RPC get_parcels_with_metrics_v2
-- ==============================================================================
DROP FUNCTION IF EXISTS public.get_parcels_with_metrics_v2(text);

CREATE OR REPLACE FUNCTION public.get_parcels_with_metrics_v2(p_dataset_key text DEFAULT 'dairi-demo'::text)
 RETURNS TABLE(
    id uuid,
    nib character varying,
    owner_name character varying,
    sub_district character varying,
    village character varying,
    legal_area_m2 numeric,
    spatial_area_m2 numeric,
    deviation_percent numeric,
    is_overlapping boolean,
    status parcel_status,
    kkp_category text,
    hak_type character varying,
    dataset_key text,
    is_demo boolean,
    geometry_source text,
    surveyor_notes text,
    gps_lat numeric,
    gps_lng numeric,
    gps_accuracy_m numeric,
    photo_path text,
    surveyed_at timestamp with time zone,
    program_type text,
    geojson text
 )
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.nib,
        p.owner_name,
        p.sub_district,
        p.village,
        p.legal_area_m2,
        CASE 
            WHEN p.geom IS NOT NULL THEN 
                ROUND(extensions.ST_Area(p.geom, true)::numeric, 2)
            ELSE NULL::numeric 
        END AS spatial_area_m2,
        CASE 
            WHEN p.geom IS NOT NULL AND p.legal_area_m2 > 0 THEN 
                (ABS(extensions.ST_Area(p.geom, true)::numeric - p.legal_area_m2) / NULLIF(p.legal_area_m2, 0)) * 100::numeric
            ELSE NULL::numeric 
        END AS deviation_percent,
        CASE 
            WHEN p.geom IS NOT NULL THEN EXISTS (
                SELECT 1 
                FROM public.parcels other 
                WHERE other.id != p.id 
                  AND other.dataset_key = p.dataset_key
                  AND other.geom IS NOT NULL
                  AND (other.geom::extensions.geometry && p.geom::extensions.geometry)
                  AND extensions.ST_Relate(other.geom::extensions.geometry, p.geom::extensions.geometry, '2********')
            )
            ELSE NULL::boolean 
        END AS is_overlapping,
        p.status,
        p.kkp_category,
        p.hak_type,
        p.dataset_key,
        p.is_demo,
        p.geometry_source,
        p.surveyor_notes,
        p.gps_lat,
        p.gps_lng,
        p.gps_accuracy_m,
        p.photo_path,
        p.surveyed_at,
        p.program_type,
        CASE 
            WHEN p.geom IS NOT NULL THEN 
                extensions.ST_AsGeoJSON(extensions.ST_ForcePolygonCCW(p.geom::extensions.geometry))
            ELSE NULL::text 
        END AS geojson
    FROM public.parcels p
    WHERE p.dataset_key = p_dataset_key
    ORDER BY p.nib ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_parcels_with_metrics_v2(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_parcels_with_metrics_v2(text) TO anon, authenticated;

-- ==============================================================================
-- 5. RPC submit_survey_data_v2
-- ==============================================================================
DROP FUNCTION IF EXISTS public.submit_survey_data_v2(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.submit_survey_data_v2(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.submit_survey_data_v2(
  p_nib text,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric DEFAULT NULL::numeric,
  p_photo_path text DEFAULT ''::text,
  p_geojson text DEFAULT NULL::text,
  p_program_type text DEFAULT 'Reguler'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_nib TEXT := btrim(p_nib);
  v_photo_path TEXT := btrim(p_photo_path);
  v_program_type TEXT := COALESCE(NULLIF(btrim(p_program_type), ''), 'Reguler');
  v_geom extensions.geography(Polygon, 4326) := NULL;
  v_spatial_area NUMERIC := NULL;
  v_centroid_lat NUMERIC := NULL;
  v_centroid_lng NUMERIC := NULL;
  v_effective_user UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_nib IS NULL OR char_length(v_nib) < 3 THEN
    RAISE EXCEPTION 'NIB wajib diisi, minimal 3 karakter.' USING ERRCODE = '22023';
  END IF;
  IF v_photo_path IS NULL OR char_length(v_photo_path) < 5 THEN
    RAISE EXCEPTION 'Path foto wajib diisi, minimal 5 karakter.' USING ERRCODE = '22023';
  END IF;
  IF v_program_type NOT IN ('Reguler', 'Wakaf', 'Rumah Ibadah', 'MBR', 'Hibah') THEN
    RAISE EXCEPTION 'Jenis program tidak valid: %', v_program_type USING ERRCODE = '22023';
  END IF;

  IF p_geojson IS NOT NULL AND btrim(p_geojson) <> '' THEN
    BEGIN
      v_geom := extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geojson), 4326)::geography;
      v_spatial_area := ROUND(extensions.ST_Area(v_geom, true)::numeric, 2);

      IF (v_centroid_lat IS NULL OR v_centroid_lng IS NULL) THEN
        v_centroid_lat := extensions.ST_Y(extensions.ST_Centroid(v_geom::geometry))::numeric;
        v_centroid_lng := extensions.ST_X(extensions.ST_Centroid(v_geom::geometry))::numeric;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Format GeoJSON poligon tidak valid: %', SQLERRM USING ERRCODE = '22023';
    END;
  END IF;

  -- Kalau polygon tidak ada tapi GPS ada, pakai GPS
  IF v_centroid_lat IS NULL THEN
    v_centroid_lat := p_lat;
    v_centroid_lng := p_lng;
  END IF;

  IF v_centroid_lat IS NULL OR v_centroid_lat NOT BETWEEN -90 AND 90 THEN
    RAISE EXCEPTION 'Latitude harus berada antara -90 dan 90.' USING ERRCODE = '22023';
  END IF;
  IF v_centroid_lng IS NULL OR v_centroid_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Longitude harus berada antara -180 dan 180.' USING ERRCODE = '22023';
  END IF;
  IF p_accuracy IS NOT NULL AND (p_accuracy < 0 OR p_accuracy > 1000) THEN
    RAISE EXCEPTION 'Akurasi GPS harus berada antara 0 dan 1000 meter atau kosong.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.parcels AS p
  SET gps_lat = v_centroid_lat,
      gps_lng = v_centroid_lng,
      gps_accuracy_m = p_accuracy,
      photo_path = v_photo_path,
      geom = COALESCE(v_geom, p.geom),
      program_type = v_program_type,
      kkp_category = COALESCE(p.kkp_category, 'KW 4'),
      legal_area_m2 = COALESCE(p.legal_area_m2, 0.01),
      geometry_source = 'survei',
      updated_by_user = v_effective_user,
      surveyed_at = NOW(),
      updated_at = NOW()
  WHERE p.nib = v_nib
    AND p.dataset_key = 'dairi-demo'
    AND p.is_demo = true
  RETURNING jsonb_build_object(
    'id', p.id,
    'nib', p.nib,
    'owner_name', p.owner_name,
    'village', p.village,
    'program_type', p.program_type,
    'gps_lat', p.gps_lat,
    'gps_lng', p.gps_lng,
    'gps_accuracy_m', p.gps_accuracy_m,
    'photo_path', p.photo_path,
    'kkp_category', p.kkp_category,
    'legal_area_m2', p.legal_area_m2,
    'surveyed_at', p.surveyed_at,
    'has_polygon', (p.geom IS NOT NULL),
    'spatial_area_m2', CASE WHEN p.geom IS NOT NULL THEN ROUND(extensions.ST_Area(p.geom, true)::numeric, 2) ELSE NULL END,
    'is_new', false
  ) INTO v_result;

  IF NOT FOUND THEN
    INSERT INTO public.parcels (
      nib,
      owner_name,
      sub_district,
      village,
      legal_area_m2,
      geom,
      status,
      surveyor_notes,
      dataset_key,
      is_demo,
      geometry_source,
      gps_lat,
      gps_lng,
      gps_accuracy_m,
      photo_path,
      kkp_category,
      hak_type,
      program_type,
      created_by_user,
      updated_by_user,
      surveyed_at,
      created_at,
      updated_at
    ) VALUES (
      v_nib,
      'Bidang Baru (Demo Survei)',
      'Sidikalang',
      'Sidikalang Kota',
      0.01,
      v_geom,
      'Perlu Verifikasi',
      CASE 
        WHEN v_geom IS NOT NULL THEN 'Pendaftaran bidang baru dengan delineasi poligon batas' 
        ELSE 'Pendaftaran bidang baru dari survei lapangan' 
      END,
      'dairi-demo',
      true,
      'survei',
      v_centroid_lat,
      v_centroid_lng,
      p_accuracy,
      v_photo_path,
      'KW 4',
      'Hak Milik',
      v_program_type,
      v_effective_user,
      v_effective_user,
      NOW(),
      NOW(),
      NOW()
    )
    RETURNING jsonb_build_object(
      'id', parcels.id,
      'nib', parcels.nib,
      'owner_name', parcels.owner_name,
      'village', parcels.village,
      'program_type', parcels.program_type,
      'gps_lat', parcels.gps_lat,
      'gps_lng', parcels.gps_lng,
      'gps_accuracy_m', parcels.gps_accuracy_m,
      'photo_path', parcels.photo_path,
      'surveyed_at', parcels.surveyed_at,
      'has_polygon', (parcels.geom IS NOT NULL),
      'spatial_area_m2', CASE WHEN parcels.geom IS NOT NULL THEN ROUND(extensions.ST_Area(parcels.geom, true)::numeric, 2) ELSE NULL END,
      'is_new', true
    ) INTO v_result;
  END IF;

  RETURN v_result;
END;
$function$;

-- Izin Eksekusi untuk anonymous dan authenticated users
REVOKE ALL ON FUNCTION public.submit_survey_data_v2(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_survey_data_v2(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT)
  TO anon, authenticated;

COMMIT;

