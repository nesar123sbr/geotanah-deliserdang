-- ==============================================================================
-- FASE 1: REMEDIASI SECURITY & DATA INTEGRITY (GeoTanah Dairi)
-- Target: RLS parcels, Constraint profiles.role, Kolom Centroid, & Indexing
-- File: supabase/migrations/20260725172326_remediasi_fase_1.sql
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. SINKRONISASI CONSTRAINT & KEAMANAN PROFILES
-- ------------------------------------------------------------------------------

-- Perbarui constraint role agar sinkron antara admin, validator, surveyor, dan viewer
ALTER TABLE public.profiles 
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles 
  ADD CONSTRAINT profiles_role_check 
  CHECK (role IN ('admin', 'validator', 'surveyor', 'viewer'));

-- Tambahkan trigger proteksi eskalasi privilese (mencegah user mengubah role-nya sendiri)
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

-- ------------------------------------------------------------------------------
-- 2. PENAMBAHAN & SINKRONISASI KOLOM CENTROID PADA PARCELS
-- ------------------------------------------------------------------------------

ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS centroid_lat NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS centroid_lng NUMERIC(10, 7);

-- Backfill data centroid untuk data bidang yang sudah memiliki geometri poligon
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

-- ------------------------------------------------------------------------------
-- 3. PERBAIKAN ROW LEVEL SECURITY (RLS) PADA PARCELS
-- ------------------------------------------------------------------------------

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

-- A. SELECT: Publik dan pengguna login dapat melihat data persil
CREATE POLICY "Parcels are viewable by everyone"
  ON public.parcels FOR SELECT TO anon, authenticated
  USING (true);

-- B. INSERT: Hanya Admin dan Surveyor yang terautentikasi
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

-- ------------------------------------------------------------------------------
-- 4. INDEKS SPASIAL DAN TABULAR YANG HILANG
-- ------------------------------------------------------------------------------

-- Spatial Index PostGIS (Wajib untuk performa query ST_Relate, ST_Intersects, bounding box)
CREATE INDEX IF NOT EXISTS idx_parcels_geom_gist 
  ON public.parcels USING GIST (geom);

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

COMMIT;
