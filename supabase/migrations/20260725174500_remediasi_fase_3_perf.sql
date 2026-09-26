-- ==============================================================================
-- FASE 3: OPTIMASI KINERJA DATABASE & POSTGIS RPC
-- Single-pass ST_Area CTE, Functional Geometry GiST Index, & Expose Centroid
-- File: supabase/migrations/20260725174500_remediasi_fase_3_perf.sql
-- ==============================================================================

BEGIN;

-- 1. Tambahkan Indeks Fungsional GiST pada kasting geometri
-- Mempercepat evaluasi bounding box (&&) dan ST_Relate pada deteksi overlap
CREATE INDEX IF NOT EXISTS idx_parcels_geom_geometry_gist 
  ON public.parcels USING GIST (((geom::extensions.geometry)));

-- 2. Perbarui RPC get_parcels_with_metrics_v2 dengan Single-Pass CTE & Centroid
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
