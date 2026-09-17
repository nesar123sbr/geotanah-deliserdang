-- Run as the database owner in the Supabase SQL Editor.
-- Demo-only writer; intentionally does not change geom or the existing metrics RPC.
BEGIN;

ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS gps_lat NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS gps_lng NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS gps_accuracy_m NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS photo_path TEXT,
  ADD COLUMN IF NOT EXISTS surveyed_at TIMESTAMPTZ;

-- Also upgrades a previously installed NUMERIC(5,2) column; no rounding/clamping.
ALTER TABLE public.parcels
  ALTER COLUMN gps_accuracy_m TYPE NUMERIC(6,2);

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
  IF v_nib IS NULL OR char_length(v_nib) < 3 THEN
    RAISE EXCEPTION 'NIB wajib diisi, minimal 3 karakter.' USING ERRCODE = '22023';
  END IF;
  -- PostgreSQL numeric NaN compares above finite values; NOT BETWEEN rejects it.
  -- Infinite values, nulls, and out-of-range values are rejected before storage.
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
    'id', p.id, 'nib', p.nib,
    'gps_lat', p.gps_lat, 'gps_lng', p.gps_lng,
    'gps_accuracy_m', p.gps_accuracy_m, 'photo_path', p.photo_path,
    'surveyed_at', p.surveyed_at
  ) INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NIB % tidak ditemukan pada dataset demo Dairi.', v_nib
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_survey_data(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_survey_data(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT)
  TO anon, authenticated;

COMMIT;
