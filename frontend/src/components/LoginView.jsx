import React, { useState } from 'react';
import { Eye, EyeOff, Lock, User, LogIn } from 'lucide-react';
import * as api from '../utils/api';

export default function LoginView({ onLoginSuccess, showToast }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    try {
      const result = await api.login(username, password);
      if (result.success && result.token) {
        localStorage.setItem('jwt_token', result.token);
        if (result.refreshToken) {
          localStorage.setItem('refresh_token', result.refreshToken);
        }
        if (result.user && result.user.username) {
          localStorage.setItem('username', result.user.username);
        } else {
          localStorage.setItem('username', username);
        }
        showToast('Đăng nhập hệ thống thành công!', 'success');
        onLoginSuccess();
      } else {
        setErrorMsg(result.error || 'Sai tên đăng nhập hoặc mật khẩu.');
        showToast(result.error || 'Đăng nhập thất bại.', 'error');
      }
    } catch {
      setErrorMsg('Lỗi kết nối đến máy chủ.');
      showToast('Lỗi kết nối máy chủ.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page-bg min-h-screen w-full flex items-center justify-center p-6 relative overflow-hidden select-none">
      {/* Glow Effects */}
      <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] bg-purple-600/10 rounded-full filter blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[600px] h-[600px] bg-blue-600/10 rounded-full filter blur-[120px] pointer-events-none"></div>

      <main className="max-w-[450px] w-full bg-slate-900/65 backdrop-blur-2xl border border-white/10 rounded-[28px] px-10 py-12 shadow-2xl flex flex-col gap-6 text-white text-center relative z-10">
        <div>
          <h2 className="text-4xl font-bold tracking-tight text-white">Đăng nhập</h2>
        </div>

        <form className="space-y-4 text-left" onSubmit={handleSubmit}>
          {/* Username */}
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
              <User size={18} />
            </span>
            <input
              type="text"
              className="w-full pl-12 pr-5 py-3 rounded-full border border-white/20 bg-white/5 text-white placeholder-white/40 focus:outline-none focus:border-white/40 focus:bg-white/10 transition-all text-sm outline-none"
              placeholder="Tên tài khoản"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={loading}
              autoComplete="username"
            />
          </div>

          {/* Password */}
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
              <Lock size={18} />
            </span>
            <input
              type={showPassword ? 'text' : 'password'}
              className="w-full pl-12 pr-12 py-3 rounded-full border border-white/20 bg-white/5 text-white placeholder-white/40 focus:outline-none focus:border-white/40 focus:bg-white/10 transition-all text-sm outline-none"
              placeholder="Mật khẩu"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {errorMsg && (
            <div className="text-red-400 text-xs px-2 font-medium">
              {errorMsg}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full py-3 rounded-full bg-white text-black font-semibold hover:bg-white/95 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg disabled:opacity-50"
            disabled={loading}
          >
            {loading ? (
              <span className="animate-spin rounded-full h-5 w-5 border-2 border-black border-t-transparent"></span>
            ) : (
              <>
                <LogIn size={18} />
                <span>Đăng nhập hệ thống</span>
              </>
            )}
          </button>
        </form>
      </main>
    </div>
  );
}
