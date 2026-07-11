import React, { useState, useEffect } from 'react';
import { Sparkles, Menu, ListFilter, AlertCircle, RefreshCw } from 'lucide-react';
import * as api from './utils/api';
import LoginView from './components/LoginView';
import Sidebar from './components/Sidebar';
import RightSidebar from './components/RightSidebar';
import SettingsModal from './components/SettingsModal';
import ListPageView from './components/ListPageView';
import CreatePageView from './components/CreatePageView';
import ReactCampaignView from './components/ReactCampaignView';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('jwt_token'));
  const [currentView, setView] = useState('list'); // 'list' | 'create' | 'react'
  
  // Settings & Cookie Configuration
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [cookie, setCookie] = useState('');
  
  // Page list and details states
  const [pages, setPages] = useState([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState('');

  // Toast notifications list
  const [toasts, setToasts] = useState([]);

  // Mobile sidebar states
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);

  // showToast helper
  const showToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  };

  // Fetch initial config and page list on auth
  useEffect(() => {
    if (isAuthenticated) {
      loadConfigAndPages();
    }
  }, [isAuthenticated]);

  // Auth Expired listener
  useEffect(() => {
    const handleExpired = () => {
      setIsAuthenticated(false);
      showToast('Phiên làm việc hết hạn. Vui lòng đăng nhập lại.', 'error');
    };
    window.addEventListener('auth-expired', handleExpired);
    return () => window.removeEventListener('auth-expired', handleExpired);
  }, []);

  const loadConfigAndPages = async () => {
    try {
      const configRes = await api.fetchConfig();
      if (configRes.success && configRes.cookie) {
        setCookie(configRes.cookie);
        // Load pages list
        fetchPagesList(configRes.cookie);
      }
    } catch (e) {
      console.error('Lỗi tải cấu hình ban đầu:', e);
    }
  };

  const fetchPagesList = async (cookieVal) => {
    const val = cookieVal || cookie;
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
  };

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
    <div className="bg-[#0d0e15] text-[#e3e1ec] min-h-screen flex overflow-hidden">
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
      />

      {/* Main Content Canvas */}
      <main className="lg:ml-[320px] lg:mr-[360px] ml-0 mr-0 flex-1 flex flex-col h-screen overflow-y-auto">
        {/* Top Header Bar */}
        <header className="flex justify-between items-center px-4 sm:px-6 py-4 w-full sticky top-0 bg-[#0d0e15]/80 backdrop-blur-md z-40 border-b border-zinc-800/40">
          <div className="flex items-center gap-2">
            {/* Mobile Left Menu Toggle */}
            <button 
              onClick={() => setIsLeftSidebarOpen(true)}
              className="lg:hidden w-10 h-10 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-white transition-colors cursor-pointer bg-transparent border-none"
            >
              <Menu size={20} />
            </button>
            <span className="text-sm font-bold text-white truncate uppercase tracking-wider">Trình quản lý</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Ready Status Badge */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-zinc-900 rounded-full border border-zinc-800">
              <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              <span className="text-xs font-semibold text-zinc-300">Sẵn sàng</span>
            </div>

            {/* Mobile Right Menu Toggle */}
            <button 
              onClick={() => setIsRightSidebarOpen(true)}
              className="lg:hidden w-10 h-10 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-white transition-colors cursor-pointer bg-transparent border-none"
              title="Danh sách Page"
            >
              <ListFilter size={20} />
            </button>
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
        </div>
      </main>

      {/* Right Sidebar list of Facebook pages */}
      <RightSidebar 
        pages={pages}
        loading={pagesLoading}
        onRefresh={() => fetchPagesList(cookie)}
        hasCookie={!!cookie}
        errorMsg={pagesError}
        isOpen={isRightSidebarOpen}
        onClose={() => setIsRightSidebarOpen(false)}
      />

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
