-- ==============================================================================
-- Skrip Perbaikan RPC submit_survey_data
-- Mendukung UPDATE untuk NIB existing dan INSERT untuk NIB baru pada dataset dairi-demo
-- Jalankan skrip ini di Supabase Dashboard > SQL Editor
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.submit_survey_data(
  p_nib TEXT,
  p_lat NUMERIC,
  p_lng NUMERIC,
  p_accuracy NUMERIC,
  p_photo_path TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_nib TEXT := btrim(p_nib);
  v_photo_path TEXT := btrim(p_photo_path);
  v_result JSONB;
BEGIN
  -- 1. Validasi Input Parameter
  IF v_nib IS NULL OR char_length(v_nib) < 3 THEN
    RAISE EXCEPTION 'NIB wajib diisi, minimal 3 karakter.' USING ERRCODE = '22023';
  END IF;
  IF p_lat IS NULL OR p_lat NOT BETWEEN -90 AND 90 THEN
    RAISE EXCEPTION 'Latitude harus berada antara -90 dan 90.' USING ERRCODE = '22023';
  END IF;
  IF p_lng IS NULL OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Longitude harus berada antara -180 dan 180.' USING ERRCODE = '22023';
  END IF;
  IF p_accuracy IS NULL OR p_accuracy NOT BETWEEN 0 AND 1000 THEN
    RAISE EXCEPTION 'Akurasi GPS harus berada antara 0 dan 1000 meter.' USING ERRCODE = '22023';
  END IF;
  IF v_photo_path IS NULL OR char_length(v_photo_path) < 5 THEN
    RAISE EXCEPTION 'Path foto wajib diisi, minimal 5 karakter.' USING ERRCODE = '22023';
  END IF;

  -- 2. Coba UPDATE jika NIB sudah terdaftar pada dataset demo
  UPDATE public.parcels AS p
  SET gps_lat = p_lat,
      gps_lng = p_lng,
      gps_accuracy_m = p_accuracy,
      photo_path = v_photo_path,
      geometry_source = 'survei',
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
    'gps_lat', p.gps_lat,
    'gps_lng', p.gps_lng,
    'gps_accuracy_m', p.gps_accuracy_m,
    'photo_path', p.photo_path,
    'surveyed_at', p.surveyed_at,
    'is_new', false
  ) INTO v_result;

  -- 3. Jika NIB belum ada, INSERT sebagai bidang baru (demo Dairi)
  IF NOT FOUND THEN
    INSERT INTO public.parcels (
      nib,
      owner_name,
      sub_district,
      village,
      legal_area_m2,
      status,
      surveyor_notes,
      dataset_key,
      is_demo,
      geometry_source,
      gps_lat,
      gps_lng,
      gps_accuracy_m,
      photo_path,
      surveyed_at,
      created_at,
      updated_at
    ) VALUES (
      v_nib,
      'Bidang Baru (Demo Survei)',
      'Sidikalang',
      'Sidikalang Kota',
      100.00,
      'Perlu Verifikasi',
      'Pendaftaran bidang baru dari survei lapangan',
      'dairi-demo',
      true,
      'survei',
      p_lat,
      p_lng,
      p_accuracy,
      v_photo_path,
      NOW(),
      NOW(),
      NOW()
    )
    RETURNING jsonb_build_object(
      'id', parcels.id,
      'nib', parcels.nib,
      'owner_name', parcels.owner_name,
      'village', parcels.village,
      'gps_lat', parcels.gps_lat,
      'gps_lng', parcels.gps_lng,
      'gps_accuracy_m', parcels.gps_accuracy_m,
      'photo_path', parcels.photo_path,
      'surveyed_at', parcels.surveyed_at,
      'is_new', true
    ) INTO v_result;
  END IF;

  RETURN v_result;
END;
$$;

-- Izin Eksekusi untuk anonymous dan authenticated users
REVOKE ALL ON FUNCTION public.submit_survey_data(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_survey_data(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT)
  TO anon, authenticated;

COMMIT;
