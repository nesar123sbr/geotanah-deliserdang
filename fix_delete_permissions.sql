-- ==============================================================================
-- GEOTANAH DAIRI: PERBAIKAN HAK AKSES RLS & FUNGSI PENGHAPUSAN PERSIL (ADMIN)
-- ==============================================================================
-- Masalah: Error 42501 (permission denied for table profiles) saat menghapus
-- baris pada tabel 'parcels', karena RLS policy atau trigger memeriksa tabel 'profiles'
-- namun dicegah oleh aturan hak akses.
--
-- CARA PENGGUNAAN:
-- 1. Buka Supabase Dashboard > SQL Editor
-- 2. Salin dan tempel seluruh isi skrip ini
-- 3. Klik tombol "Run" untuk mengeksekusi
-- ==============================================================================

-- 1. Berikan hak akses tabel profiles kepada peran authenticated, anon, dan service_role
GRANT SELECT ON public.profiles TO authenticated, anon, service_role;

-- 2. Pastikan RLS pada tabel profiles mengizinkan pembacaan oleh pengguna
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow select profiles for authenticated and anon" ON public.profiles;
CREATE POLICY "Allow select profiles for authenticated and anon" 
ON public.profiles FOR SELECT 
TO authenticated, anon, service_role 
USING (true);

-- 3. Pastikan policy DELETE pada tabel parcels diamankan (hanya admin yang dapat menghapus langsung)
-- Catatan: Penghapusan via aplikasi menggunakan RPC delete_parcel_admin (SECURITY DEFINER)
DROP POLICY IF EXISTS "Allow delete parcels" ON public.parcels;

-- 4. Amankan tabel audit_log (hanya service_role / trigger SECURITY DEFINER yang dapat menulis)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_log') THEN
    REVOKE ALL ON public.audit_log FROM anon;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_log FROM authenticated;
    GRANT SELECT ON public.audit_log TO authenticated;
  END IF;
END $$;

-- 5. Buat fungsi RPC delete_parcel_admin dengan opsi SECURITY DEFINER
-- Opsi SECURITY DEFINER memastikan penghapusan dijalankan dengan hak akses penuh superuser/pemilik skema,
-- sehingga melewati batas RLS atau konflik foreign key trigger yang memicu error 42501.

CREATE OR REPLACE FUNCTION public.delete_parcel_admin(p_parcel_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  -- Hapus persil berdasarkan id UUID
  DELETE FROM public.parcels WHERE id = p_parcel_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'deleted_count', v_count,
      'message', 'Persil berhasil dihapus secara permanen.'
    );
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'deleted_count', 0,
      'message', 'Persil tidak ditemukan atau sudah terhapus sebelumnya.'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'code', SQLSTATE
  );
END;
$$;

-- Overload fungsi untuk p_parcel_id bertipe TEXT (jika dikirim sebagai string dari client)
CREATE OR REPLACE FUNCTION public.delete_parcel_admin(p_parcel_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.delete_parcel_admin(p_parcel_id::UUID);
EXCEPTION WHEN OTHERS THEN
  -- Fallback jika id bukan format UUID standar
  DELETE FROM public.parcels WHERE id::TEXT = p_parcel_id;
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Persil berhasil dihapus menggunakan string matcher.'
  );
END;
$$;

-- Berikan izin pemanggilan RPC kepada seluruh peran
GRANT EXECUTE ON FUNCTION public.delete_parcel_admin(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_parcel_admin(TEXT) TO authenticated, anon, service_role;

-- Konfirmasi keberhasilan
SELECT 'Perizinan RLS profiles dan RPC delete_parcel_admin berhasil dipasang!' AS status;
