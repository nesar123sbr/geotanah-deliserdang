-- ==============================================================================
-- FASE 2: PERBAIKAN RPC submit_survey_data_v2
-- Memisahkan gps_lat/lng dari centroid_lat/lng, ST_MakeValid, & Konsistensi Status
-- File: supabase/migrations/20260725173000_remediasi_fase_2_rpc.sql
-- ==============================================================================

BEGIN;

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
    RAISE EXCEPTION 'Path foto wajib diisi, minimal 5 karakter.' USING ERRCODE = '22023';
  END IF;
  IF v_program_type NOT IN ('Reguler', 'Wakaf', 'Rumah Ibadah', 'MBR', 'Hibah') THEN
    RAISE EXCEPTION 'Jenis program tidak valid: %', v_program_type USING ERRCODE = '22023';
  END IF;

  -- 2. Parsing & Validasi Poligon GeoJSON jika ada
  IF p_geojson IS NOT NULL AND btrim(p_geojson) <> '' THEN
    BEGIN
      v_raw_geom := extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geojson), 4326);
      
      -- Pastikan geometri valid dan berorientasi poligon yang benar
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
  -- Perhatikan: gps_lat/lng tetap mencatat p_lat/p_lng asli dari juru ukur!
  UPDATE public.parcels AS p
  SET gps_lat = p_lat,
      gps_lng = p_lng,
      gps_accuracy_m = p_accuracy,
      centroid_lat = v_centroid_lat,
      centroid_lng = v_centroid_lng,
      photo_path = v_photo_path,
      geom = COALESCE(v_geom, p.geom),
      program_type = v_program_type,
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
      'Bidang Baru (Demo Survei)',
      'Sidikalang',
      'Sidikalang Kota',
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

REVOKE ALL ON FUNCTION public.submit_survey_data_v2(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_survey_data_v2(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT)
  TO anon, authenticated;

COMMIT;
