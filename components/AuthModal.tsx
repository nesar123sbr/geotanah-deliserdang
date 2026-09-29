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
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-200">
      {/* Modal Card */}
      <div className="relative w-full max-w-md rounded-3xl bg-white border border-slate-200/80 shadow-2xl shadow-slate-900/25 overflow-hidden">
        {/* Decorative top accent strip */}
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-400" />

        {/* Content */}
        <div className="p-6 sm:p-7">
          {/* Close Button */}
          <button
            onClick={handleClose}
            type="button"
            aria-label="Tutup dialog autentikasi"
            className="absolute top-5 right-5 h-8 w-8 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Header */}
          <div className="flex items-center gap-3.5 mb-5">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white shadow-lg shadow-emerald-900/30 shrink-0">
              {isForgotPassword ? <KeyRound className="h-5 w-5" /> : <Shield className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                {isForgotPassword ? 'Pemulihan Kata Sandi' : 'Login Pengguna'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {isForgotPassword ? 'Kirim tautan reset ke email terdaftar' : 'Kantah Kabupaten Dairi · Akses Kolaborasi'}
              </p>
            </div>
          </div>

          {/* Error Alert */}
          {errorMsg && (
            <div className="mb-4 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Success Alert */}
          {successMsg && (
            <div className="mb-4 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block mb-1.5 text-xs font-semibold text-slate-700">Alamat Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@dairi.go.id atau email Anda"
                className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all duration-150"
              />
            </div>

            {!isForgotPassword && (
              <div>
                <label className="block mb-1.5 text-xs font-semibold text-slate-700">Kata Sandi (Password)</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan kata sandi akun"
                  className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all duration-150"
                />
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsForgotPassword(true);
                      setErrorMsg('');
                      setSuccessMsg('');
                    }}
                    className="text-[11px] text-emerald-600 hover:text-emerald-700 font-semibold hover:underline transition-all cursor-pointer"
                  >
                    Lupa Kata Sandi?
                  </button>
                </div>
              </div>
            )}

            {isForgotPassword && (
              <p className="text-slate-500 text-[11.5px] leading-relaxed bg-slate-50 border border-slate-200 p-3.5 rounded-2xl">
                Kami akan mengirimkan instruksi dan tautan pemulihan untuk mengatur ulang kata sandi ke alamat email Anda.
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-11 mt-2 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all cursor-pointer shadow-lg shadow-emerald-900/25 disabled:opacity-50 disabled:cursor-not-allowed"
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
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsForgotPassword(false);
                    setErrorMsg('');
                    setSuccessMsg('');
                  }}
                  className="text-xs text-slate-500 hover:text-slate-800 transition-all cursor-pointer flex items-center gap-1.5 font-medium"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Kembali ke Halaman Login</span>
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
