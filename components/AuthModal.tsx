'use client';

import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { X, LogIn, UserPlus, LoaderCircle, AlertCircle, CheckCircle2, Shield } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'surveyor' | 'admin'>('surveyor');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      if (isRegister) {
        // Register akun baru
        const cleanEmail = email.trim();
        const cleanName = fullName.trim() || cleanEmail.split('@')[0];
        
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              full_name: cleanName,
              role: role,
            },
          },
        });
        if (error) throw error;

        // Sinkronkan ke tabel public.profiles jika user dibuat
        if (data.user) {
          try {
            await supabase.from('profiles').upsert({
              id: data.user.id,
              full_name: cleanName,
              role: role,
              is_active: true,
            });
          } catch (profileErr) {
            console.warn('Auto profile trigger akan menyinkronkan profil:', profileErr);
          }
        }

        setSuccessMsg('Pendaftaran akun berhasil! Anda kini sudah masuk.');
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 1200);
      } else {
        // Login akun yang sudah ada
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;

        setSuccessMsg('Login berhasil! Selamat datang kembali.');
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 800);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100">
        <button
          onClick={onClose}
          type="button"
          aria-label="Tutup dialog autentikasi"
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-all cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-400 shadow-inner">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">
              {isRegister ? 'Daftar Akun GeoTanah' : 'Login Pengguna'}
            </h2>
            <p className="text-xs text-slate-400">Kantah Kabupaten Dairi · Akses Kolaborasi</p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800 mb-4 text-xs font-semibold">
          <button
            type="button"
            onClick={() => { setIsRegister(false); setErrorMsg(''); setSuccessMsg(''); }}
            className={`py-2 rounded-lg transition-all cursor-pointer ${!isRegister ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Masuk (Login)
          </button>
          <button
            type="button"
            onClick={() => { setIsRegister(true); setErrorMsg(''); setSuccessMsg(''); }}
            className={`py-2 rounded-lg transition-all cursor-pointer ${isRegister ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Daftar Akun Baru
          </button>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-xs flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          {isRegister && (
            <>
              <div>
                <label className="block mb-1 text-slate-300 font-medium">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Contoh: Budi Sibarani (Magang)"
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                />
              </div>
              <div>
                <label className="block mb-1 text-slate-300 font-medium">Peran / Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'surveyor' | 'admin')}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-slate-100 focus:outline-none focus:border-emerald-500 transition-all cursor-pointer"
                >
                  <option value="surveyor">👷 Surveyor (Tambah & Unggah Data Lapangan)</option>
                  <option value="admin">👑 Admin / Super User (Ekspor & Hapus Storage)</option>
                </select>
              </div>
            </>
          )}

          <div>
            <label className="block mb-1 text-slate-300 font-medium">Alamat Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@dairi.go.id atau email Anda"
              className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
            />
          </div>

          <div>
            <label className="block mb-1 text-slate-300 font-medium">Kata Sandi (Password)</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimal 6 karakter"
              className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-11 mt-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-2 active:scale-[0.98] transition-all cursor-pointer shadow-md shadow-emerald-950/40 disabled:opacity-50"
          >
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : isRegister ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
            <span>{loading ? 'Memproses...' : isRegister ? 'Daftar & Masuk' : 'Masuk ke Aplikasi'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
