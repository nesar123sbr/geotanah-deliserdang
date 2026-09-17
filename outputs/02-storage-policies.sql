-- First create parcel-photos in Supabase Dashboard > Storage:
-- Public bucket; maximum file size 5 MB;
-- allowed MIME types: image/webp, image/jpeg.
-- Public files are not confidential. Use synthetic/demo photos only.
-- Existing photos are retained; intentionally no UPDATE or DELETE policy.
-- Inspect existing permissive policies separately: policies are additive.
BEGIN;

DROP POLICY IF EXISTS "Parcel Photos Public Read" ON storage.objects;
CREATE POLICY "Parcel Photos Public Read"
  ON storage.objects FOR SELECT TO PUBLIC
  USING (bucket_id = 'parcel-photos');

DROP POLICY IF EXISTS "Parcel Photos Demo Upload" ON storage.objects;
CREATE POLICY "Parcel Photos Demo Upload"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'parcel-photos');

COMMIT;
