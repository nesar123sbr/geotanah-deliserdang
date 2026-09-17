-- ==============================================================================
-- Skrip RPC submit_survey_data_v2 & Trigger Auto Updated_At
-- Mendukung Delineasi Poligon GeoJSON dan Titik GPS Lapangan
-- File: supabase_rpc_fix_v2.sql
-- ==============================================================================

BEGIN;

-- 1. Trigger BEFORE UPDATE untuk auto-isi updated_at = NOW() pada public.parcels
CREATE OR REPLACE FUNCTION public.handle_parcels_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_parcels_updated_at ON public.parcels;
CREATE TRIGGER trg_parcels_updated_at
BEFORE UPDATE ON public.parcels
FOR EACH ROW
EXECUTE FUNCTION public.handle_parcels_updated_at();

-- 2. RPC BARU: submit_survey_data_v2
-- Signature: p_nib, p_lat, p_lng, p_accuracy, p_photo_path, p_geojson
CREATE OR REPLACE FUNCTION public.submit_survey_data_v2(
  p_nib TEXT,
  p_lat NUMERIC,
  p_lng NUMERIC,
  p_accuracy NUMERIC,
  p_photo_path TEXT,
  p_geojson TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_nib TEXT := btrim(p_nib);
  v_photo_path TEXT := btrim(p_photo_path);
  v_geom extensions.geography(Polygon, 4326) := NULL;
  v_spatial_area NUMERIC := NULL;
  v_centroid_lat NUMERIC := p_lat;
  v_centroid_lng NUMERIC := p_lng;
  v_result JSONB;
BEGIN
  -- 1. Validasi Input Parameter
  IF v_nib IS NULL OR char_length(v_nib) < 3 THEN
    RAISE EXCEPTION 'NIB wajib diisi, minimal 3 karakter.' USING ERRCODE = '22023';
  END IF;
  IF v_photo_path IS NULL OR char_length(v_photo_path) < 5 THEN
    RAISE EXCEPTION 'Path foto wajib diisi, minimal 5 karakter.' USING ERRCODE = '22023';
  END IF;

  -- 2. Parsing GeoJSON Poligon jika ada
  IF p_geojson IS NOT NULL AND btrim(p_geojson) <> '' THEN
    BEGIN
      -- Konversi GeoJSON ke geography(Polygon, 4326)
      v_geom := extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geojson), 4326)::geography;
      
      -- Hitung luas spasial poligon dalam meter persegi
      v_spatial_area := ROUND(extensions.ST_Area(v_geom, true)::numeric, 2);

      -- Jika p_lat / p_lng tidak diberikan atau bernilai 0, hitung centroid dari poligon
      IF (v_centroid_lat IS NULL OR v_centroid_lng IS NULL) THEN
        v_centroid_lat := extensions.ST_Y(extensions.ST_Centroid(v_geom::geometry))::numeric;
        v_centroid_lng := extensions.ST_X(extensions.ST_Centroid(v_geom::geometry))::numeric;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Format GeoJSON poligon tidak valid: %', SQLERRM USING ERRCODE = '22023';
    END;
  END IF;

  -- Validasi koordinat GPS (wajib ada lat/lng baik dari parameter maupun dari centroid poligon)
  IF v_centroid_lat IS NULL OR v_centroid_lat NOT BETWEEN -90 AND 90 THEN
    RAISE EXCEPTION 'Latitude harus berada antara -90 dan 90.' USING ERRCODE = '22023';
  END IF;
  IF v_centroid_lng IS NULL OR v_centroid_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Longitude harus berada antara -180 dan 180.' USING ERRCODE = '22023';
  END IF;
  IF p_accuracy IS NULL OR p_accuracy NOT BETWEEN 0 AND 1000 THEN
    RAISE EXCEPTION 'Akurasi GPS harus berada antara 0 dan 1000 meter.' USING ERRCODE = '22023';
  END IF;

  -- 3. Coba UPDATE jika NIB sudah terdaftar pada dataset demo
  UPDATE public.parcels AS p
  SET gps_lat = v_centroid_lat,
      gps_lng = v_centroid_lng,
      gps_accuracy_m = p_accuracy,
      photo_path = v_photo_path,
      -- Kategori KKP dipertahankan dari data yuridis KKP resmi; tidak otomatis diubah jadi KW 1
      kkp_category = COALESCE(p.kkp_category, 'KW 4'),
      -- Luas yuridis tidak boleh ditimpa luas spasial hasil digitasi
      legal_area_m2 = COALESCE(p.legal_area_m2, 0.01),
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
    'kkp_category', p.kkp_category,
    'legal_area_m2', p.legal_area_m2,
    'surveyed_at', p.surveyed_at,
    'has_polygon', (p.geom IS NOT NULL),
    'spatial_area_m2', CASE WHEN p.geom IS NOT NULL THEN ROUND(extensions.ST_Area(p.geom, true)::numeric, 2) ELSE NULL END,
    'is_new', false
  ) INTO v_result;

  -- 4. Jika NIB belum ada, INSERT sebagai bidang baru (demo Dairi)
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
      surveyed_at,
      created_at,
      updated_at
    ) VALUES (
      v_nib,
      'Bidang Baru (Demo Survei)',
      'Sidikalang',
      'Sidikalang Kota',
      0.01, -- Luas yuridis indikatif/minimal (belum ada Surat Ukur definitif dari warkah)
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
      'KW 4', -- Kategori KKP default konservatif: belum terdaftar di peta pendaftaran KKP resmi
      'Hak Milik',
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
      'has_polygon', (parcels.geom IS NOT NULL),
      'spatial_area_m2', CASE WHEN parcels.geom IS NOT NULL THEN ROUND(extensions.ST_Area(parcels.geom, true)::numeric, 2) ELSE NULL END,
      'is_new', true
    ) INTO v_result;
  END IF;

  RETURN v_result;
END;
$$;

-- Izin Eksekusi untuk anonymous dan authenticated users
REVOKE ALL ON FUNCTION public.submit_survey_data_v2(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_survey_data_v2(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT)
  TO anon, authenticated;

COMMIT;
