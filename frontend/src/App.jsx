import React, { useCallback, useState, useEffect, useRef } from 'react';
import { Menu, Sun, Moon } from 'lucide-react';
import * as api from './utils/api';
import LoginView from './components/LoginView';
import Sidebar from './components/Sidebar';
import SettingsModal from './components/SettingsModal';
import ListPageView from './components/ListPageView';
import CreatePageView from './components/CreatePageView';
import ReactCampaignView from './components/ReactCampaignView';
import VideoDownloadView from './components/VideoDownloadView';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('jwt_token'));
  const [currentView, setView] = useState('list'); // 'list' | 'create' | 'react' | 'download'
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  
  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);
  
  // Settings & Cookie Configuration
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [cookie, setCookie] = useState('');
  // Timestamp chỉ thay đổi khi uid đổi, tránh re-request avatar mỗi lần render
  const [avatarTs, setAvatarTs] = useState(Date.now());
  const prevUidRef = useRef(null);

  
  // Page list and details states
  const [pages, setPages] = useState([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState('');

  // Toast notifications list
  const [toasts, setToasts] = useState([]);

  // Mobile sidebar states
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);

  // showToast helper
  const showToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  // Auth Expired listener
  useEffect(() => {
    const handleExpired = () => {
      setIsAuthenticated(false);
      showToast('Phiên làm việc hết hạn. Vui lòng đăng nhập lại.', 'error');
    };
    window.addEventListener('auth-expired', handleExpired);
    return () => window.removeEventListener('auth-expired', handleExpired);
  }, [showToast]);

  const fetchPagesList = useCallback(async (cookieVal) => {
    const val = cookieVal;
    if (!val) return;

    setPagesLoading(true);
    setPagesError('');
    try {
      const result = await api.getPages(val);
      if (result.success && result.pages) {
        setPages(result.pages);
      } else {
        setPagesError(result.error || 'Hãy kiểm tra lại cookie.');
        setPages([]);
      }
    } catch (err) {
      setPagesError(err.message);
      setPages([]);
    } finally {
      setPagesLoading(false);
    }
  }, []);

  const loadConfigAndPages = useCallback(async () => {
    try {
      const configRes = await api.fetchConfig();
      if (configRes.success && configRes.cookie) {
        setCookie(configRes.cookie);
        await fetchPagesList(configRes.cookie);
      }
    } catch (e) {
      console.error('Lỗi tải cấu hình ban đầu:', e);
    }
  }, [fetchPagesList]);

  // Fetch initial config and page list on auth
  useEffect(() => {
    if (isAuthenticated) {
      loadConfigAndPages();
    }
  }, [isAuthenticated, loadConfigAndPages]);

  const handleCookieChange = (newCookie) => {
    setCookie(newCookie);
    if (newCookie) {
      fetchPagesList(newCookie);
    } else {
      setPages([]);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('username');
    setIsAuthenticated(false);
    showToast('Đã đăng xuất hệ thống!', 'success');
  };

  if (!isAuthenticated) {
    return (
      <>
        <LoginView 
          onLoginSuccess={() => setIsAuthenticated(true)} 
          showToast={showToast} 
        />
        {/* Render Toast notifications */}
        <ToastContainer toasts={toasts} />
      </>
    );
  }

  return (
    <div className="bg-[var(--bg-main)] text-[var(--text-main)] min-h-screen flex overflow-hidden transition-colors duration-300">
      {/* Background glow effects */}
      <div className="bg-grid"></div>
      <div className="bg-glow glow-1"></div>
      <div className="bg-glow glow-2"></div>

      {/* Left Navigation Sidebar */}
      <Sidebar 
        currentView={currentView} 
        setView={setView} 
        onOpenSettings={() => setIsSettingsOpen(true)}
        onLogout={handleLogout}
        isOpen={isLeftSidebarOpen}
        onClose={() => setIsLeftSidebarOpen(false)}
        username={localStorage.getItem('username') || 'Admin'}
      />

      {/* Main Content Canvas */}
      <main className="lg:ml-[320px] ml-0 flex-1 flex flex-col h-screen overflow-y-auto">
        {/* Top Header Bar */}
        <header className="flex justify-between items-center px-4 sm:px-6 py-4 w-full sticky top-0 bg-[var(--header-bg)] backdrop-blur-md z-40 border-b border-[var(--border-main)] transition-colors duration-300">
          <div className="flex items-center gap-2">
            {/* Mobile Left Menu Toggle */}
            <button 
              onClick={() => setIsLeftSidebarOpen(true)}
              className="lg:hidden w-10 h-10 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-[var(--text-main)] transition-colors cursor-pointer bg-transparent border-none"
            >
              <Menu size={20} />
            </button>
            <span className="text-sm font-bold text-[var(--text-main)] truncate uppercase tracking-wider">Trình quản lý</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Light / Dark Mode Toggle */}
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--active-menu-bg)] border border-[var(--active-menu-border)] text-[var(--text-main)] hover:bg-[var(--text-main)]/5 transition-all cursor-pointer outline-none shrink-0"
              title={theme === 'dark' ? 'Bật chế độ sáng' : 'Bật chế độ tối'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* User Profile Avatars */}
            {(() => {
              const getFbUids = (cookieString) => {
                if (!cookieString) return [];
                const lines = cookieString.split('\n').map(c => c.trim()).filter(Boolean);
                const uids = [];
                for (const line of lines) {
                  const match = line.match(/c_user=(\d+)/);
                  if (match && match[1]) {
                    uids.push(match[1]);
                  }
                }
                return [...new Set(uids)];
              };
              const fbUids = getFbUids(cookie);
              
              // Reset avatarTs khi danh sách các uid thay đổi để force reload đúng avatar
              const uidsJoined = fbUids.join(',');
              if (uidsJoined && uidsJoined !== prevUidRef.current) {
                prevUidRef.current = uidsJoined;
                // Dùng setTimeout để tránh setState trong render
                setTimeout(() => setAvatarTs(Date.now()), 0);
              }
              
              if (fbUids.length === 0) return null; // Ẩn hoàn toàn nếu chưa có tài khoản Facebook
              
              return (
                <div className="flex items-center -space-x-3 hover:-space-x-1 transition-all duration-300">
                  {fbUids.map((uid) => (
                    <div 
                      key={uid}
                      className="w-10 h-10 rounded-full bg-[var(--active-menu-bg)] border-2 border-[var(--active-menu-border)] flex items-center justify-center overflow-hidden shrink-0 transition-transform duration-200 hover:scale-110 hover:z-10 shadow-md"
                      title={`UID Facebook: ${uid}`}
                    >
                      <img 
                        src={`/api/config/fb-avatar?uid=${uid}&t=${avatarTs}`} 
                        alt={`FB Profile ${uid}`} 
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = `https://api.dicebear.com/7.x/initials/svg?seed=${uid}`;
                        }}
                      />
                    </div>
                  ))}
                </div>
              );
            })()}


            {/* Ready Status Badge */}
            {(() => {
              const hasFbAccount = (() => {
                if (!cookie) return false;
                return /c_user=\d+/.test(cookie);
              })();
              
              return (
                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-[var(--active-menu-bg)] rounded-full border border-[var(--active-menu-border)]">
                  <div className={`w-2 h-2 rounded-full ${hasFbAccount ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
                  <span className="text-xs font-semibold text-[var(--text-main)]">
                    {hasFbAccount ? 'Sẵn sàng' : 'Chưa cấu hình'}
                  </span>
                </div>
              );
            })()}

          </div>
        </header>

        {/* View Switch */}
        <div className="flex-1 w-full pb-10">
          {currentView === 'list' && (
            <ListPageView 
              pages={pages}
              loading={pagesLoading}
              hasCookie={!!cookie}
              errorMsg={pagesError}
              showToast={showToast}
            />
          )}

          {currentView === 'create' && (
            <CreatePageView 
              cookie={cookie}
              showToast={showToast}
              onPageCreated={() => fetchPagesList(cookie)}
            />
          )}

          {currentView === 'react' && (
            <ReactCampaignView 
              cookie={cookie}
              showToast={showToast}
              onOpenSettings={() => setIsSettingsOpen(true)}
            />
          )}

          {currentView === 'download' && (
            <VideoDownloadView showToast={showToast} />
          )}
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        showToast={showToast}
        onCookieChange={handleCookieChange}
        initialCookie={cookie}
      />

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}

// Internal Toast Container Component
function ToastContainer({ toasts }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div 
          key={toast.id}
          className={`flex items-center gap-2.5 px-4 py-3 bg-[#1e1f26]/90 border border-zinc-800 rounded-xl shadow-2xl font-semibold text-xs text-zinc-200 backdrop-blur-md animate-in slide-in-from-top-3 duration-200 pointer-events-auto ${
            toast.type === 'success' ? 'border-l-[3px] border-l-emerald-500' : 'border-l-[3px] border-l-red-500'
          }`}
        >
          {toast.type === 'success' ? (
            <svg className="w-4 h-4 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          ) : (
            <svg className="w-4 h-4 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          )}
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
