import React, { useState, useEffect } from 'react';
import { X, RefreshCw } from 'lucide-react';
import * as api from '../utils/api';

export default function SettingsModal({ isOpen, onClose, showToast, onCookieChange, initialCookie }) {
  const [activeTab, setActiveTab] = useState('cookie'); // 'cookie' | 'login' | 'password'
  
  // States for cookie tab
  const [cookieVal, setCookieVal] = useState(initialCookie || '');

  // States for FB Login tab
  const [fbUsername, setFbUsername] = useState('');
  const [fbPassword, setFbPassword] = useState('');
  const [fb2fa, setFb2fa] = useState('');
  const [fbLoginLoading, setFbLoginLoading] = useState(false);

  // States for system password tab
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passLoading, setPassLoading] = useState(false);

  useEffect(() => {
    setCookieVal(initialCookie || '');
  }, [initialCookie]);

  if (!isOpen) return null;

  // Save Cookie handler
  const handleSaveCookie = async () => {
    const val = cookieVal.trim();
    if (!val) {
      showToast('Vui lòng nhập cookie!', 'error');
      return;
    }

    try {
      const result = await api.saveConfig(val);
      if (result.success) {
        showToast('Đã lưu cấu hình cookie thành công!', 'success');
        onCookieChange(val);
      } else {
        showToast(`Không thể lưu cấu hình: ${result.error}`, 'error');
      }
    } catch (e) {
      showToast('Lỗi kết nối máy chủ.', 'error');
    }
  };

  // Clear Cookie handler
  const handleClearCookie = async () => {
    try {
      const result = await api.saveConfig('');
      if (result.success) {
        showToast('Đã xoá cấu hình cookie thành công!', 'success');
        setCookieVal('');
        onCookieChange('');
      } else {
        showToast(`Không thể xoá cấu hình: ${result.error}`, 'error');
      }
    } catch (e) {
      showToast('Lỗi kết nối máy chủ.', 'error');
    }
  };

  // FB Auto Login handler
  const handleFbLogin = async (e) => {
    e.preventDefault();
    const username = fbUsername.trim();
    const password = fbPassword.trim();
    const twofa = fb2fa.trim();

    if (!username || !password) {
      showToast('Vui lòng điền tài khoản và mật khẩu Facebook!', 'error');
      return;
    }

    setFbLoginLoading(true);
    showToast('Bắt đầu tiến trình đăng nhập Facebook giả lập...', 'success');

    try {
      const response = await fetch('/api/config/fb-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jwt_token')}`
        },
        body: JSON.stringify({ username, password, twofa })
      });
      const result = await response.json();

      if (result.success) {
        showToast(`Đăng nhập FB thành công! UID: ${result.c_user}`, 'success');
        // reload config from server
        const configRes = await api.fetchConfig();
        if (configRes.success && configRes.cookie) {
          setCookieVal(configRes.cookie);
          onCookieChange(configRes.cookie);
        }
      } else {
        showToast(result.error || 'Đăng nhập Facebook thất bại.', 'error');
      }
    } catch (error) {
      showToast(`Lỗi tiến trình: ${error.message}`, 'error');
    } finally {
      setFbLoginLoading(false);
    }
  };

  // Change password handler
  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      showToast('Mật khẩu mới nhập lại không khớp!', 'error');
      return;
    }

    setPassLoading(true);
    try {
      const result = await api.changePassword(currentPassword, newPassword);
      if (result.success) {
        showToast('Cập nhật mật khẩu hệ thống thành công!', 'success');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        onClose();
      } else {
        showToast(result.error || 'Cập nhật mật khẩu thất bại.', 'error');
      }
    } catch (error) {
      showToast(`Lỗi: ${error.message}`, 'error');
    } finally {
      setPassLoading(false);
    }
  };

  const activeTabClass = 'flex-1 pb-2 text-xs font-bold text-purple-400 border-b-2 border-purple-500 bg-transparent border-none cursor-pointer text-center outline-none transition-all duration-200';
  const inactiveTabClass = 'flex-1 pb-2 text-xs font-bold text-zinc-400 hover:text-zinc-200 bg-transparent border-none cursor-pointer text-center outline-none transition-all duration-200';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Overlay */}
      <div 
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      ></div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-[500px] bg-slate-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-zinc-800 bg-white/2">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Cấu hình hệ thống</h2>
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col">
          {/* Tabs */}
          <div className="flex border-b border-zinc-800 mb-4">
            <button 
              onClick={() => setActiveTab('cookie')}
              className={activeTab === 'cookie' ? activeTabClass : inactiveTabClass}
            >
              Dán Cookie thủ công
            </button>
            <button 
              onClick={() => setActiveTab('login')}
              className={activeTab === 'login' ? activeTabClass : inactiveTabClass}
            >
              Đăng nhập tài khoản
            </button>
            <button 
              onClick={() => setActiveTab('password')}
              className={activeTab === 'password' ? activeTabClass : inactiveTabClass}
            >
              Đổi mật khẩu hệ thống
            </button>
          </div>

          {/* Panel 1: Paste Cookie */}
          {activeTab === 'cookie' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400" htmlFor="inputCookie">Cookie Facebook</label>
                <textarea 
                  id="inputCookie" 
                  rows="3"
                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500 transition-all placeholder:text-zinc-600 outline-none"
                  placeholder="Dán cookie từ trình duyệt Facebook vào đây..."
                  value={cookieVal}
                  onChange={(e) => setCookieVal(e.target.value)}
                ></textarea>
                <p className="text-[11px] text-zinc-500 leading-normal">
                  Chỉ cần nhập cookie — các token sẽ được tự động trích xuất khi tiến hành các tác vụ tiếp theo.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSaveCookie}
                  className="bg-white hover:bg-white/95 text-black py-2 px-5 rounded-lg text-xs font-semibold transition-all active:scale-98 cursor-pointer border-none"
                >
                  Lưu cấu hình
                </button>
                <button
                  onClick={handleClearCookie}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 py-2 px-5 rounded-lg text-xs font-semibold transition-all active:scale-98 cursor-pointer border-none"
                >
                  Xoá cookie
                </button>
              </div>
            </div>
          )}

          {/* Panel 2: FB Auto Login */}
          {activeTab === 'login' && (
            <form onSubmit={handleFbLogin} className="space-y-4 animate-in fade-in duration-200">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400" htmlFor="inputFbUsername">Tài khoản Facebook (Email/SĐT/UID)</label>
                <input 
                  type="text" 
                  id="inputFbUsername"
                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500 transition-all outline-none"
                  placeholder="Nhập tài khoản Facebook..."
                  value={fbUsername}
                  onChange={(e) => setFbUsername(e.target.value)}
                  disabled={fbLoginLoading}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400" htmlFor="inputFbPassword">Mật khẩu Facebook</label>
                <input 
                  type="password" 
                  id="inputFbPassword"
                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500 transition-all outline-none"
                  placeholder="Nhập mật khẩu..."
                  value={fbPassword}
                  onChange={(e) => setFbPassword(e.target.value)}
                  disabled={fbLoginLoading}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400" htmlFor="inputFb2FA">Mã khóa 2FA (Secret Key)</label>
                <input 
                  type="text" 
                  id="inputFb2FA"
                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500 transition-all outline-none"
                  placeholder="Nhập mã bảo mật 2FA 16 hoặc 32 ký tự..."
                  value={fb2fa}
                  onChange={(e) => setFb2fa(e.target.value)}
                  disabled={fbLoginLoading}
                />
              </div>
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={fbLoginLoading}
                  className="bg-white hover:bg-white/95 text-black py-2 px-5 rounded-lg text-xs font-semibold transition-all active:scale-98 cursor-pointer border-none flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {fbLoginLoading ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Đang đăng nhập & lấy Cookie...</span>
                    </>
                  ) : (
                    <span>Đăng nhập &amp; Lấy Cookie</span>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Panel 3: Change Password */}
          {activeTab === 'password' && (
            <form onSubmit={handleChangePassword} className="space-y-4 animate-in fade-in duration-200">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400" htmlFor="currentPassword">Mật khẩu hiện tại</label>
                <input
                  id="currentPassword" 
                  type="password"
                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500 transition-all outline-none"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={passLoading}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400" htmlFor="newPassword">Mật khẩu mới</label>
                <input
                  id="newPassword" 
                  type="password"
                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500 transition-all outline-none"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={passLoading}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400" htmlFor="confirmPassword">Nhập lại mật khẩu mới</label>
                <input
                  id="confirmPassword" 
                  type="password"
                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500 transition-all outline-none"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={passLoading}
                  required
                />
              </div>
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={passLoading}
                  className="bg-white hover:bg-white/95 text-black py-2 px-5 rounded-lg text-xs font-semibold transition-all active:scale-98 cursor-pointer border-none flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {passLoading ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Đang cập nhật...</span>
                    </>
                  ) : (
                    <span>Cập nhật mật khẩu</span>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
