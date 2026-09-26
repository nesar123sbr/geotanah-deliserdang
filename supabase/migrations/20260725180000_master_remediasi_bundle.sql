-- ==============================================================================
-- GeoTanah Dairi — MASTER REMEDIASI DATABASE & RPC (Fase 1 s.d. Fase 3)
-- File: supabase/migrations/20260725180000_master_remediasi_bundle.sql
-- Keterangan: Skrip terpadu, idempotent, dan aman dieksekusi di Supabase SQL Editor.
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. SINKRONISASI CONSTRAINT & KEAMANAN PROFILES
-- ==============================================================================

-- Perbarui constraint role agar sinkron: admin, validator, surveyor, dan viewer
ALTER TABLE public.profiles 
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles 
  ADD CONSTRAINT profiles_role_check 
  CHECK (role IN ('admin', 'validator', 'surveyor', 'viewer'));

-- Tambahkan trigger proteksi eskalasi privilese (mencegah user biasa mengubah role-nya sendiri)
CREATE OR REPLACE FUNCTION public.handle_profiles_role_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_current_user_role TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN
    SELECT role INTO v_current_user_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_current_user_role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Pelanggaran Keamanan: Hanya admin yang diizinkan mengubah role pengguna.' 
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_profiles_role_guard ON public.profiles;
CREATE TRIGGER trg_profiles_role_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profiles_role_guard();

-- Perbarui fungsi auto-create profile dari auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_role TEXT;
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'surveyor');
  IF v_role NOT IN ('admin', 'validator', 'surveyor', 'viewer') THEN
    v_role := 'surveyor';
  END IF;

  INSERT INTO public.profiles (id, full_name, role, nip, phone, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    v_role,
    NEW.raw_user_meta_data->>'nip',
    NEW.raw_user_meta_data->>'phone',
    true
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    nip = COALESCE(EXCLUDED.nip, profiles.nip),
    phone = COALESCE(EXCLUDED.phone, profiles.phone),
    updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- ==============================================================================
-- 2. PENAMBAHAN & SINKRONISASI KOLOM CENTROID PADA PARCELS
-- ==============================================================================

ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS centroid_lat NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS centroid_lng NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS address TEXT;

-- Backfill data centroid untuk persil yang sudah memiliki geometri poligon
UPDATE public.parcels
SET centroid_lat = ROUND(extensions.ST_Y(extensions.ST_Centroid(geom::geometry))::numeric, 7),
    centroid_lng = ROUND(extensions.ST_X(extensions.ST_Centroid(geom::geometry))::numeric, 7)
WHERE geom IS NOT NULL 
  AND (centroid_lat IS NULL OR centroid_lng IS NULL);

-- Backfill fallback dari GPS jika poligon belum ada
UPDATE public.parcels
SET centroid_lat = gps_lat,
    centroid_lng = gps_lng
WHERE geom IS NULL 
  AND centroid_lat IS NULL 
  AND gps_lat IS NOT NULL;

-- Trigger otomatis agar centroid selalu terisi saat poligon dibuat/diperbarui
CREATE OR REPLACE FUNCTION public.handle_parcels_centroid()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.geom IS NOT NULL THEN
    NEW.centroid_lat := ROUND(extensions.ST_Y(extensions.ST_Centroid(NEW.geom::geometry))::numeric, 7);
    NEW.centroid_lng := ROUND(extensions.ST_X(extensions.ST_Centroid(NEW.geom::geometry))::numeric, 7);
  ELSIF NEW.centroid_lat IS NULL AND NEW.gps_lat IS NOT NULL THEN
    NEW.centroid_lat := NEW.gps_lat;
    NEW.centroid_lng := NEW.gps_lng;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_parcels_centroid ON public.parcels;
CREATE TRIGGER trg_parcels_centroid
  BEFORE INSERT OR UPDATE OF geom, gps_lat, gps_lng ON public.parcels
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_parcels_centroid();

-- ==============================================================================
-- 3. PERBAIKAN ROW LEVEL SECURITY (RLS) PADA PARCELS
-- ==============================================================================

ALTER TABLE public.parcels ENABLE ROW LEVEL SECURITY;

-- Berikan izin dasar pada tabel
GRANT SELECT ON public.parcels TO anon, authenticated;
GRANT ALL ON public.parcels TO authenticated;

-- Bersihkan policy lama jika ada
DROP POLICY IF EXISTS "Parcels are viewable by everyone" ON public.parcels;
DROP POLICY IF EXISTS "Admins have full access to parcels" ON public.parcels;
DROP POLICY IF EXISTS "Validators can update verification data" ON public.parcels;
DROP POLICY IF EXISTS "Surveyors can insert survey parcels" ON public.parcels;
DROP POLICY IF EXISTS "Surveyors can update demo or own parcels" ON public.parcels;
DROP POLICY IF EXISTS "Only admins can delete parcels" ON public.parcels;

-- A. SELECT: Publik dan pengguna login dapat melihat data persil
CREATE POLICY "Parcels are viewable by everyone"
  ON public.parcels FOR SELECT TO anon, authenticated
  USING (true);

-- B. INSERT: Admin dan Surveyor yang terautentikasi
CREATE POLICY "Surveyors and admins can insert parcels"
  ON public.parcels FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE profiles.id = auth.uid() 
        AND profiles.role IN ('admin', 'surveyor')
        AND profiles.is_active = true
    )
  );

-- C. UPDATE: Admin memiliki akses bebas mengubah apa pun
CREATE POLICY "Admins have full access to parcels"
  ON public.parcels FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE profiles.id = auth.uid() 
        AND profiles.role = 'admin'
        AND profiles.is_active = true
    )
  );

-- D. UPDATE: Validator dapat memverifikasi status persil
CREATE POLICY "Validators can update verification data"
  ON public.parcels FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE profiles.id = auth.uid() 
        AND profiles.role = 'validator'
        AND profiles.is_active = true
    )
  );

-- E. UPDATE: Surveyor dapat memperbarui persil demo atau persil buatannya sendiri
CREATE POLICY "Surveyors can update demo or own parcels"
  ON public.parcels FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE profiles.id = auth.uid() 
        AND profiles.role = 'surveyor'
        AND profiles.is_active = true
    ) AND (is_demo = true OR created_by_user = auth.uid())
  );

-- F. DELETE: Hanya Admin yang dapat menghapus bidang tanah
CREATE POLICY "Only admins can delete parcels"
  ON public.parcels FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE profiles.id = auth.uid() 
        AND profiles.role = 'admin'
        AND profiles.is_active = true
    )
  );

-- ==============================================================================
-- 4. INDEKS SPASIAL & TABULAR (OPTIMASI PERFORMA)
-- ==============================================================================

-- Spatial Index PostGIS (Geography & Geometry Functional Index)
CREATE INDEX IF NOT EXISTS idx_parcels_geom_gist 
  ON public.parcels USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_parcels_geom_geometry_gist 
  ON public.parcels USING GIST (((geom::extensions.geometry)));

-- Tabular Index untuk query filtering & sorting dashboard
CREATE INDEX IF NOT EXISTS idx_parcels_dataset_key 
  ON public.parcels (dataset_key);

CREATE INDEX IF NOT EXISTS idx_parcels_nib 
  ON public.parcels (nib);

CREATE INDEX IF NOT EXISTS idx_parcels_status 
  ON public.parcels (status);

CREATE INDEX IF NOT EXISTS idx_parcels_kkp_category 
  ON public.parcels (kkp_category);

CREATE INDEX IF NOT EXISTS idx_parcels_program_type 
  ON public.parcels (program_type);

CREATE INDEX IF NOT EXISTS idx_parcels_created_by 
  ON public.parcels (created_by_user);

CREATE INDEX IF NOT EXISTS idx_parcels_centroid 
  ON public.parcels (centroid_lat, centroid_lng) 
  WHERE centroid_lat IS NOT NULL;

-- Indeks pada tabel profiles & audit_log
CREATE INDEX IF NOT EXISTS idx_profiles_role 
  ON public.profiles (role);

CREATE INDEX IF NOT EXISTS idx_audit_log_record 
  ON public.audit_log (table_name, record_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at 
  ON public.audit_log (changed_at DESC);

-- ==============================================================================
-- 5. RPC submit_survey_data_v2 (PEMISAHAN GPS VS CENTROID & ST_MakeValid)
-- ==============================================================================

DROP FUNCTION IF EXISTS public.submit_survey_data_v2(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.submit_survey_data_v2(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.submit_survey_data_v2(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.submit_survey_data_v2(
  p_nib text,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric DEFAULT NULL::numeric,
  p_photo_path text DEFAULT ''::text,
  p_geojson text DEFAULT NULL::text,
  p_program_type text DEFAULT 'Reguler'::text,
  p_owner_name text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text
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
  v_owner_name TEXT := NULLIF(btrim(p_owner_name), '');
  v_address TEXT := NULLIF(btrim(p_address), '');
  v_geom extensions.geography(Polygon, 4326) := NULL;
  v_raw_geom extensions.geometry := NULL;
  v_spatial_area NUMERIC := NULL;
  v_centroid_lat NUMERIC := NULL;
  v_centroid_lng NUMERIC := NULL;
  v_effective_user UUID := auth.uid();
  v_result JSONB;
BEGIN
  -- 1. Validasi Input Dasar
  IF v_nib IS NULL OR char_length(v_nib) < 3 THEN
    RAISE EXCEPTION 'NIB wajib diisi, minimal 3 karakter.' USING ERRCODE = '22023';
  END IF;
  IF v_photo_path IS NULL OR char_length(v_photo_path) < 5 THEN
    RAISE EXCEPTION 'Minimal 1 foto dokumentasi survei wajib diunggah.' USING ERRCODE = '22023';
  END IF;
  IF v_program_type NOT IN ('Reguler', 'Wakaf', 'Rumah Ibadah', 'MBR', 'Hibah') THEN
    RAISE EXCEPTION 'Jenis program tidak valid: %', v_program_type USING ERRCODE = '22023';
  END IF;

  -- 2. Parsing & Validasi Poligon GeoJSON jika ada
  IF p_geojson IS NOT NULL AND btrim(p_geojson) <> '' THEN
    BEGIN
      v_raw_geom := extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geojson), 4326);
      
      IF NOT extensions.ST_IsValid(v_raw_geom) THEN
        v_raw_geom := extensions.ST_MakeValid(v_raw_geom);
      END IF;

      v_geom := extensions.ST_ForcePolygonCCW(v_raw_geom)::extensions.geography;
      v_spatial_area := ROUND(extensions.ST_Area(v_geom, true)::numeric, 2);

      v_centroid_lat := ROUND(extensions.ST_Y(extensions.ST_Centroid(v_raw_geom))::numeric, 7);
      v_centroid_lng := ROUND(extensions.ST_X(extensions.ST_Centroid(v_raw_geom))::numeric, 7);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Format GeoJSON poligon tidak valid atau korup: %', SQLERRM USING ERRCODE = '22023';
    END;
  END IF;

  -- Fallback centroid ke koordinat GPS jika poligon belum digambar
  IF v_centroid_lat IS NULL THEN
    v_centroid_lat := p_lat;
    v_centroid_lng := p_lng;
  END IF;

  -- 3. Validasi Rentang Koordinat
  IF p_lat IS NULL OR p_lat NOT BETWEEN -90 AND 90 THEN
    RAISE EXCEPTION 'Latitude GPS harus berada antara -90 dan 90.' USING ERRCODE = '22023';
  END IF;
  IF p_lng IS NULL OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Longitude GPS harus berada antara -180 dan 180.' USING ERRCODE = '22023';
  END IF;
  IF p_accuracy IS NOT NULL AND (p_accuracy < 0 OR p_accuracy > 1000) THEN
    RAISE EXCEPTION 'Akurasi GPS harus berada antara 0 dan 1000 meter atau kosong.' USING ERRCODE = '22023';
  END IF;

  -- 4. UPDATE untuk bidang tanah demo yang sudah ada
  UPDATE public.parcels AS p
  SET gps_lat = p_lat,
      gps_lng = p_lng,
      gps_accuracy_m = p_accuracy,
      centroid_lat = v_centroid_lat,
      centroid_lng = v_centroid_lng,
      photo_path = v_photo_path,
      geom = COALESCE(v_geom, p.geom),
      program_type = v_program_type,
      owner_name = COALESCE(v_owner_name, p.owner_name),
      address = COALESCE(v_address, p.address),
      village = COALESCE(v_address, p.village),
      kkp_category = COALESCE(p.kkp_category, 'KW 4'),
      legal_area_m2 = COALESCE(p.legal_area_m2, v_spatial_area, 100.00),
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
    'address', p.address,
    'village', p.village,
    'program_type', p.program_type,
    'gps_lat', p.gps_lat,
    'gps_lng', p.gps_lng,
    'centroid_lat', p.centroid_lat,
    'centroid_lng', p.centroid_lng,
    'gps_accuracy_m', p.gps_accuracy_m,
    'photo_path', p.photo_path,
    'kkp_category', p.kkp_category,
    'legal_area_m2', p.legal_area_m2,
    'surveyed_at', p.surveyed_at,
    'has_polygon', (p.geom IS NOT NULL),
    'spatial_area_m2', CASE WHEN p.geom IS NOT NULL THEN ROUND(extensions.ST_Area(p.geom, true)::numeric, 2) ELSE NULL END,
    'is_new', false
  ) INTO v_result;

  -- 5. INSERT sebagai bidang baru jika NIB belum pernah ada
  IF NOT FOUND THEN
    INSERT INTO public.parcels (
      nib,
      owner_name,
      address,
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
      centroid_lat,
      centroid_lng,
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
      COALESCE(v_owner_name, 'Bidang Baru (Demo Survei)'),
      v_address,
      'Sidikalang',
      COALESCE(v_address, 'Sidikalang Kota'),
      COALESCE(v_spatial_area, 100.00),
      v_geom,
      'Perlu Verifikasi',
      CASE 
        WHEN v_geom IS NOT NULL THEN 'Pendaftaran bidang baru dengan delineasi poligon batas' 
        ELSE 'Pendaftaran bidang baru dari survei lapangan' 
      END,
      'dairi-demo',
      true,
      'survei',
      p_lat,
      p_lng,
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
      'address', parcels.address,
      'village', parcels.village,
      'program_type', parcels.program_type,
      'gps_lat', parcels.gps_lat,
      'gps_lng', parcels.gps_lng,
      'centroid_lat', parcels.centroid_lat,
      'centroid_lng', parcels.centroid_lng,
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

REVOKE ALL ON FUNCTION public.submit_survey_data_v2(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_survey_data_v2(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO anon, authenticated;

-- ==============================================================================
-- 6. RPC get_parcels_with_metrics_v2 (OPTIMASI SINGLE-PASS CTE & EXPOSE CENTROID)
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
    centroid_lat numeric,
    centroid_lng numeric,
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
    WITH base_parcels AS (
      SELECT 
        p.*,
        CASE 
          WHEN p.geom IS NOT NULL THEN ROUND(extensions.ST_Area(p.geom, true)::numeric, 2)
          ELSE NULL::numeric 
        END AS calc_area_m2
      FROM public.parcels p
      WHERE p.dataset_key = p_dataset_key
    )
    SELECT 
        b.id,
        b.nib,
        b.owner_name,
        b.sub_district,
        b.village,
        b.legal_area_m2,
        b.calc_area_m2 AS spatial_area_m2,
        CASE 
            WHEN b.calc_area_m2 IS NOT NULL AND b.legal_area_m2 > 0 THEN 
                (ABS(b.calc_area_m2 - b.legal_area_m2) / b.legal_area_m2) * 100::numeric
            ELSE NULL::numeric 
        END AS deviation_percent,
        CASE 
            WHEN b.geom IS NOT NULL THEN EXISTS (
                SELECT 1 
                FROM public.parcels other 
                WHERE other.id != b.id 
                  AND other.dataset_key = b.dataset_key
                  AND other.geom IS NOT NULL
                  AND (other.geom::extensions.geometry && b.geom::extensions.geometry)
                  AND extensions.ST_Relate(other.geom::extensions.geometry, b.geom::extensions.geometry, '2********')
            )
            ELSE NULL::boolean 
        END AS is_overlapping,
        b.status,
        b.kkp_category,
        b.hak_type,
        b.dataset_key,
        b.is_demo,
        b.geometry_source,
        b.surveyor_notes,
        b.gps_lat,
        b.gps_lng,
        b.centroid_lat,
        b.centroid_lng,
        b.gps_accuracy_m,
        b.photo_path,
        b.surveyed_at,
        b.program_type,
        CASE 
            WHEN b.geom IS NOT NULL THEN 
                extensions.ST_AsGeoJSON(extensions.ST_ForcePolygonCCW(b.geom::extensions.geometry))
            ELSE NULL::text 
        END AS geojson
    FROM base_parcels b
    ORDER BY b.nib ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_parcels_with_metrics_v2(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_parcels_with_metrics_v2(text) TO anon, authenticated;

COMMIT;
