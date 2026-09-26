-- ==============================================================================
-- GeoTanah Dairi — Migrasi RLS Storage Bucket parcel-photos
-- File: supabase/migrations/20260726180000_storage_rls_policies.sql
-- ==============================================================================

BEGIN;

-- 1. Pastikan bucket parcel-photos terdaftar dan berstatus publik
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'parcel-photos',
  'parcel-photos',
  true,
  26214400, -- 25 MB
  ARRAY['image/webp', 'image/jpeg', 'image/png', 'text/plain']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 26214400,
  allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/png', 'text/plain'];

-- 2. Policy SELECT: Siapa saja (public & authenticated) dapat melihat/mengunduh foto persil
DROP POLICY IF EXISTS "Public and authenticated can read parcel-photos" ON storage.objects;
CREATE POLICY "Public and authenticated can read parcel-photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'parcel-photos');

-- 3. Policy INSERT: Pengguna authenticated dan anon surveyor dapat mengunggah foto WebP & TXT
DROP POLICY IF EXISTS "Surveyors can upload to parcel-photos" ON storage.objects;
CREATE POLICY "Surveyors can upload to parcel-photos"
  ON storage.objects FOR INSERT
  TO authenticated, anon
  WITH CHECK (bucket_id = 'parcel-photos');

-- 4. Policy UPDATE: Pengguna dapat menimpa/memperbarui file dalam parcel-photos
DROP POLICY IF EXISTS "Surveyors can update files in parcel-photos" ON storage.objects;
CREATE POLICY "Surveyors can update files in parcel-photos"
  ON storage.objects FOR UPDATE
  TO authenticated, anon
  USING (bucket_id = 'parcel-photos')
  WITH CHECK (bucket_id = 'parcel-photos');

-- 5. Policy DELETE: Admin & authenticated users dapat menghapus berkas foto untuk pembersihan storage
DROP POLICY IF EXISTS "Admins and authenticated can delete parcel-photos" ON storage.objects;
CREATE POLICY "Admins and authenticated can delete parcel-photos"
  ON storage.objects FOR DELETE
  TO authenticated, anon
  USING (bucket_id = 'parcel-photos');

COMMIT;
