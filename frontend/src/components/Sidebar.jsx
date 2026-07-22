import React from 'react';
import { Sparkles, LayoutDashboard, PlusCircle, Heart, Music2, Settings, LogOut } from 'lucide-react';

export default function Sidebar({ 
  currentView, 
  setView, 
  onOpenSettings, 
  onLogout, 
  isOpen, 
  onClose,
  username
}) {
  const menuItems = [
    { id: 'list', label: 'Danh sách Page', icon: LayoutDashboard },
    { id: 'create', label: 'Tạo Page', icon: PlusCircle },
    { id: 'react', label: 'Thả cảm xúc hàng loạt', icon: Heart },
    { id: 'download', label: 'Studio âm thanh & video', icon: Music2 },
  ];

  return (
    <>
      {/* Mobile Sidebar Overlay */}
      {isOpen && (
        <div 
          onClick={onClose}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-45 lg:hidden"
        ></div>
      )}

      <aside 
        className={`fixed left-0 top-0 h-full w-[300px] sm:w-[320px] bg-[var(--bg-sidebar)] border-r border-[var(--border-main)] flex flex-col p-4 gap-2 z-50 transition-all duration-300 ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* App Title */}
        <div className="flex items-center gap-3 px-3 py-4">
          <div className="w-10 h-10 rounded-lg bg-[var(--active-menu-bg)] border border-[var(--active-menu-border)] flex items-center justify-center text-[var(--text-main)] shrink-0 shadow-[0_0_15px_rgba(255,255,255,0.02)]">
            <Sparkles size={20} />
          </div>
          <div>
            <h1 className="text-sm font-bold text-[var(--text-main)] tracking-wide">Tool FaceBook</h1>
          </div>
        </div>
 
        {/* Navigation Menu */}
        <nav className="mt-4 flex-1 flex flex-col gap-1.5 px-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setView(item.id);
                  onClose();
                }}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left w-full border ${
                  isActive 
                    ? 'bg-[var(--active-menu-bg)] text-[var(--active-menu-text)] border-[var(--active-menu-border)] shadow-sm font-bold' 
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--text-main)]/5 border-transparent bg-transparent'
                }`}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
 
        {/* Footer Actions */}
        <div className="mt-auto px-2 flex flex-col gap-1 border-t border-[var(--border-main)] pt-4 pb-2">
          {/* User profile section */}
          {username && (
            <div className="flex items-center gap-3 px-3 py-2 mb-3 bg-[var(--active-menu-bg)] border border-[var(--active-menu-border)] rounded-xl mx-2">
              <div className="w-8 h-8 rounded-full bg-[var(--bg-main)] flex items-center justify-center text-[var(--text-main)] font-bold text-xs uppercase border border-[var(--border-main)]">
                {username.charAt(0)}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider">Đã đăng nhập</span>
                <span className="text-xs font-bold text-[var(--text-main)] truncate" title={username}>{username}</span>
              </div>
            </div>
          )}

          <button 
            type="button"
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--text-main)]/5 rounded-xl text-xs font-semibold transition-all bg-transparent border border-transparent text-left cursor-pointer"
          >
            <Settings size={16} />
            <span>Cài đặt hệ thống</span>
          </button>
          
          <button 
            type="button"
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-3 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 rounded-xl text-xs font-semibold transition-all bg-transparent border border-transparent text-left cursor-pointer"
          >
            <LogOut size={16} />
            <span>Đăng xuất</span>
          </button>
        </div>
      </aside>
    </>
  );
}
