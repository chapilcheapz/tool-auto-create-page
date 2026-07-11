import React, { useState, useEffect, useRef } from 'react';
import { X, RefreshCw, ShieldCheck, Loader2 } from 'lucide-react';
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

  // States for verification modal
  const [verification, setVerification] = useState({ pending: false, screenshotUrl: null });
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [screenshotTs, setScreenshotTs] = useState(Date.now());
  const pollRef = useRef(null);


  useEffect(() => {
    setCookieVal(initialCookie || '');
  }, [initialCookie]);

  // Polling trạng thái xác minh FB khi đăng nhập
  const startVerificationPolling = () => {
    stopVerificationPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/config/fb-verification-status', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('jwt_token')}` }
        });
        const data = await res.json();
        if (data.pending) {
          setVerification({ pending: true, screenshotUrl: data.screenshotUrl });
          setScreenshotTs(Date.now());
        } else {
          setVerification({ pending: false, screenshotUrl: null });
        }
      } catch {}
    }, 2000);
  };

  const stopVerificationPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const handleSubmitVerifyCode = async () => {
    if (!verifyCode.trim()) return;
    setVerifyLoading(true);
    try {
      const res = await fetch('/api/config/fb-verification-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('jwt_token')}` },
        body: JSON.stringify({ code: verifyCode.trim() })
      });
      const result = await res.json();
      if (result.success) {
        showToast('Mã xác minh đã được gửi. Đang chờ Facebook xử lý...', 'success');
        setVerifyCode('');
        setScreenshotTs(Date.now());
      } else {
        showToast(result.error || 'Gửi mã thất bại.', 'error');
      }
    } catch {
      showToast('Lỗi kết nối máy chủ.', 'error');
    } finally {
      setVerifyLoading(false);
    }
  };

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
    startVerificationPolling();

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
        setVerification({ pending: false, screenshotUrl: null });
        // reload config from server
        const configRes = await api.fetchConfig();
        if (configRes.success && configRes.cookie) {
          setCookieVal(configRes.cookie);
          onCookieChange(configRes.cookie);
        }
      } else {
        showToast(result.error || 'Đăng nhập Facebook thất bại.', 'error');
        setVerification({ pending: false, screenshotUrl: null });
      }
    } catch (error) {
      showToast(`Lỗi tiến trình: ${error.message}`, 'error');
      setVerification({ pending: false, screenshotUrl: null });
    } finally {
      setFbLoginLoading(false);
      stopVerificationPolling();
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

  const activeTabClass = 'flex-1 pb-2 text-xs font-bold text-[var(--text-main)] border-b-2 border-[var(--text-main)] bg-transparent border-none cursor-pointer text-center outline-none transition-all duration-200';
  const inactiveTabClass = 'flex-1 pb-2 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] bg-transparent border-none cursor-pointer text-center outline-none transition-all duration-200';

  return (
    <>
      {/* Modal xác minh Facebook 2FA/Captcha */}
      {verification.pending && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div className="relative z-10 w-full max-w-[560px] mx-4 bg-[var(--bg-sidebar)] border border-[var(--border-main)] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="flex items-center gap-3 p-4 border-b border-[var(--border-main)] bg-blue-500/10">
              <ShieldCheck size={20} className="text-blue-400 shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-[var(--text-main)]">Facebook yêu cầu xác minh</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Nhập mã từ SMS / Authenticator / hoặc đáp án theo hình bên dưới</p>
              </div>
            </div>

            {/* Ảnh màn hình - click trực tiếp để tương tác */}
            <div className="p-4 border-b border-[var(--border-main)]">
              <div className="relative rounded-xl overflow-hidden border border-[var(--border-main)] bg-black/20">
                <img
                  key={screenshotTs}
                  src={`/api/config/fb-verification-screenshot?t=${screenshotTs}`}
                  alt="Màn hình xác minh Facebook"
                  className="w-full h-auto max-h-[400px] object-contain cursor-crosshair"
                  style={{ imageRendering: 'auto' }}
                  onClick={async (e) => {
                    const rect = e.target.getBoundingClientRect();
                    const imgW = e.target.naturalWidth;
                    const imgH = e.target.naturalHeight;
                    const displayW = rect.width;
                    const displayH = rect.height;
                    // Tính toạ độ thực trên viewport gốc (1280x900)
                    const clickX = ((e.clientX - rect.left) / displayW) * 1280;
                    const clickY = ((e.clientY - rect.top) / displayH) * 900;
                    try {
                      await fetch('/api/config/fb-verification-click', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('jwt_token')}` },
                        body: JSON.stringify({ x: clickX, y: clickY, viewportWidth: 1280, viewportHeight: 900 })
                      });
                      setTimeout(() => setScreenshotTs(Date.now()), 1500);
                    } catch {}
                  }}
                  onError={(e) => { e.target.style.display='none'; }}
                />
                <button
                  onClick={() => setScreenshotTs(Date.now())}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors"
                  title="Làm mới ảnh"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-2 text-center">
                💡 Click trực tiếp vào ảnh để tương tác (giải captcha). Hoặc nhập mã OTP bên dưới.
              </p>
            </div>

            {/* Ô nhập mã OTP */}
            <div className="p-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmitVerifyCode()}
                  placeholder="Nhập mã OTP / mã xác minh..."
                  className="flex-1 px-3 py-2.5 text-sm rounded-xl bg-[var(--bg-card)] border border-[var(--border-main)] text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-400 transition-colors"
                />
                <button
                  onClick={handleSubmitVerifyCode}
                  disabled={verifyLoading || !verifyCode.trim()}
                  className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white transition-colors flex items-center gap-2 shrink-0"
                >
                  {verifyLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                  Gửi mã
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Modal cài đặt chính */}
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Overlay */}
      <div 
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      ></div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-[500px] bg-[var(--bg-sidebar)] border border-[var(--border-main)] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}

        <div className="flex justify-between items-center p-4 border-b border-[var(--border-main)] bg-white/2">
          <h2 className="text-sm font-bold text-[var(--text-main)] uppercase tracking-wider">Cấu hình hệ thống</h2>
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--active-menu-bg)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer border-none bg-transparent"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col">
          {/* Tabs */}
          <div className="flex border-b border-[var(--border-main)] mb-4">
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
                <label className="text-xs font-semibold text-[var(--text-muted)]" htmlFor="inputCookie">Cookie Facebook</label>
                <textarea 
                  id="inputCookie" 
                  rows="3"
                  className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)] transition-all placeholder:text-[var(--text-muted)] outline-none"
                  placeholder="Dán cookie từ trình duyệt Facebook vào đây..."
                  value={cookieVal}
                  onChange={(e) => setCookieVal(e.target.value)}
                ></textarea>
                <p className="text-[11px] text-[var(--text-muted)] leading-normal">
                  Chỉ cần nhập cookie — các token sẽ được tự động trích xuất khi tiến hành các tác vụ tiếp theo.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSaveCookie}
                  className="bg-[var(--btn-cta-bg)] hover:bg-[var(--btn-cta-bg)]/90 text-[var(--btn-cta-text)] py-2 px-5 rounded-lg text-xs font-semibold transition-all active:scale-98 cursor-pointer border-none"
                >
                  Lưu cấu hình
                </button>
                <button
                  onClick={handleClearCookie}
                  className="bg-[var(--btn-sec-bg)] hover:bg-[var(--btn-sec-bg)]/90 text-[var(--btn-sec-text)] border border-[var(--btn-sec-border)] py-2 px-5 rounded-lg text-xs font-semibold transition-all active:scale-98 cursor-pointer"
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
                <label className="text-xs font-semibold text-[var(--text-muted)]" htmlFor="inputFbUsername">Tài khoản Facebook (Email/SĐT/UID)</label>
                <input 
                  type="text" 
                  id="inputFbUsername"
                  className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)] transition-all outline-none"
                  placeholder="Nhập tài khoản Facebook..."
                  value={fbUsername}
                  onChange={(e) => setFbUsername(e.target.value)}
                  disabled={fbLoginLoading}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-[var(--text-muted)]" htmlFor="inputFbPassword">Mật khẩu Facebook</label>
                <input 
                  type="password" 
                  id="inputFbPassword"
                  className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)] transition-all outline-none"
                  placeholder="Nhập mật khẩu..."
                  value={fbPassword}
                  onChange={(e) => setFbPassword(e.target.value)}
                  disabled={fbLoginLoading}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-[var(--text-muted)]" htmlFor="inputFb2FA">Mã khóa 2FA (Secret Key)</label>
                <input 
                  type="text" 
                  id="inputFb2FA"
                  className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)] transition-all outline-none"
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
                  className="bg-[var(--btn-cta-bg)] hover:bg-[var(--btn-cta-bg)]/90 text-[var(--btn-cta-text)] py-2 px-5 rounded-lg text-xs font-semibold transition-all active:scale-98 cursor-pointer border-none flex items-center justify-center gap-2 disabled:opacity-50"
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
                <label className="text-xs font-semibold text-[var(--text-muted)]" htmlFor="currentPassword">Mật khẩu hiện tại</label>
                <input
                  id="currentPassword" 
                  type="password"
                  className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)] transition-all outline-none"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={passLoading}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-[var(--text-muted)]" htmlFor="newPassword">Mật khẩu mới</label>
                <input
                  id="newPassword" 
                  type="password"
                  className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)] transition-all outline-none"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={passLoading}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-[var(--text-muted)]" htmlFor="confirmPassword">Nhập lại mật khẩu mới</label>
                <input
                  id="confirmPassword" 
                  type="password"
                  className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)] transition-all outline-none"
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
                  className="bg-[var(--btn-cta-bg)] hover:bg-[var(--btn-cta-bg)]/90 text-[var(--btn-cta-text)] py-2 px-5 rounded-lg text-xs font-semibold transition-all active:scale-98 cursor-pointer border-none flex items-center justify-center gap-2 disabled:opacity-50"
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
    </>
  );
}
