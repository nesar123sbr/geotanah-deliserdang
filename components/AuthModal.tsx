'use client';

import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { X, LogIn, LoaderCircle, AlertCircle, CheckCircle2, Shield, KeyRound, Mail, ArrowLeft } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  function handleClose() {
    setIsForgotPassword(false);
    setErrorMsg('');
    setSuccessMsg('');
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const cleanEmail = email.trim();
      if (!cleanEmail) {
        throw new Error('Alamat email wajib diisi.');
      }

      if (isForgotPassword) {
        // Logika pemulihan kata sandi (Forgot Password)
        const redirectUrl = typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : '';
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: redirectUrl,
        });
        if (error) throw error;

        setSuccessMsg('Tautan pemulihan kata sandi telah dikirim ke email Anda! Silakan periksa kotak masuk atau spam.');
      } else {
        // Login akun terdaftar
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error) throw error;

        setSuccessMsg('Login berhasil! Selamat datang kembali.');
        setTimeout(() => {
          onSuccess?.();
          handleClose();
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
          onClick={handleClose}
          type="button"
          aria-label="Tutup dialog autentikasi"
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-all cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-400 shadow-inner">
            {isForgotPassword ? <KeyRound className="h-5 w-5" /> : <Shield className="h-5 w-5" />}
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">
              {isForgotPassword ? 'Pemulihan Kata Sandi' : 'Login Pengguna'}
            </h2>
            <p className="text-xs text-slate-400">
              {isForgotPassword ? 'Kirim tautan reset ke email terdaftar' : 'Kantah Kabupaten Dairi · Akses Kolaborasi'}
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-xs flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-200 text-xs flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-400" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block mb-1.5 text-slate-300 font-medium">Alamat Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@dairi.go.id atau email Anda"
              className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
            />
          </div>

          {!isForgotPassword && (
            <div>
              <label className="block mb-1.5 text-slate-300 font-medium">Kata Sandi (Password)</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan kata sandi akun"
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
              />
              <div className="flex justify-end pt-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsForgotPassword(true);
                    setErrorMsg('');
                    setSuccessMsg('');
                  }}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 hover:underline transition-all cursor-pointer font-medium"
                >
                  Lupa Kata Sandi?
                </button>
              </div>
            </div>
          )}

          {isForgotPassword && (
            <p className="text-slate-400 text-[11.5px] leading-relaxed bg-slate-950/60 border border-slate-800/80 p-3 rounded-xl">
              Kami akan mengirimkan instruksi dan tautan pemulihan untuk mengatur ulang kata sandi ke alamat email Anda.
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-11 mt-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-2 active:scale-[0.98] transition-all cursor-pointer shadow-md shadow-emerald-950/40 disabled:opacity-50"
          >
            {loading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : isForgotPassword ? (
              <Mail className="h-4 w-4" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            <span>
              {loading
                ? 'Memproses...'
                : isForgotPassword
                ? 'Kirim Tautan Reset'
                : 'Masuk ke Aplikasi'}
            </span>
          </button>

          {isForgotPassword && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsForgotPassword(false);
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
                className="text-xs text-slate-400 hover:text-white transition-all cursor-pointer flex items-center gap-1.5"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Kembali ke Halaman Login</span>
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
