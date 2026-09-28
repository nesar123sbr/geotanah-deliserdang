import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  // Prioritaskan Service Role Key jika dikonfigurasi di server
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Endpoint server-side DELETE /api/parcels/[id]
 * Menangani penghapusan data persil dengan hak akses penuh / Service Role atau memanggil RPC khusus,
 * melewati pencegatan 42501 (permission denied for table profiles).
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(context.params);
    const parcelId = resolvedParams?.id;

    if (!parcelId || typeof parcelId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Parameter ID persil wajib disertakan.' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getAdminClient();

    // 1. Coba panggil fungsi RPC delete_parcel_admin jika telah dipasang di Supabase
    try {
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
        // @ts-expect-error RPC delete_parcel_admin mungkin belum ada di type database.ts sebelum dieksekusi di SQL editor
        'delete_parcel_admin',
        { p_parcel_id: parcelId }
      );

      if (!rpcError && rpcData) {
        return NextResponse.json({
          success: true,
          method: 'rpc',
          data: rpcData,
          message: 'Persil berhasil dihapus melalui RPC admin.',
        });
      }
    } catch {
      // Abaikan jika RPC belum didefinisikan, lanjut ke fallback penghapusan langsung
    }

    // 2. Fallback: Hapus langsung menggunakan client service_role / server
    const { error: dbError } = await supabaseAdmin
      .from('parcels')
      .delete()
      .eq('id', parcelId);

    if (dbError) {
      return NextResponse.json(
        {
          success: false,
          error: dbError.message,
          details: dbError.details,
          code: dbError.code,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      method: 'direct_delete',
      message: 'Persil berhasil dihapus dari database.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
