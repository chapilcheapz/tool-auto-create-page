import React from 'react';
import { Sparkles, LayoutDashboard, PlusCircle, Heart, Settings, LogOut, Menu } from 'lucide-react';

export default function Sidebar({ 
  currentView, 
  setView, 
  onOpenSettings, 
  onLogout, 
  isOpen, 
  onClose 
}) {
  const menuItems = [
    { id: 'list', label: 'Quản lý Page', icon: LayoutDashboard },
    { id: 'create', label: 'Tạo Page', icon: PlusCircle },
    { id: 'react', label: 'Thả cảm xúc hàng loạt', icon: Heart },
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
        className={`fixed left-0 top-0 h-full w-[300px] sm:w-[320px] bg-slate-900 border-r border-zinc-800 flex flex-col p-4 gap-2 z-50 transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* App Title */}
        <div className="flex items-center gap-3 px-3 py-4">
          <div className="w-10 h-10 rounded-lg bg-purple-600 flex items-center justify-center text-white shrink-0">
            <Sparkles size={20} />
          </div>
          <div>
            <h1 className="text-sm font-bold text-purple-400">Quản Lý FaceBook</h1>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="mt-4 flex-1 flex flex-col gap-1 px-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setView(item.id);
                  onClose();
                }}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left w-full border-none ${
                  isActive 
                    ? 'bg-white text-black shadow-lg font-bold' 
                    : 'text-zinc-400 hover:text-white hover:bg-white/5 bg-transparent'
                }`}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer Actions */}
        <div className="mt-auto px-2 flex flex-col gap-1 border-t border-zinc-800 pt-4">
          <button 
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl text-xs font-semibold transition-all bg-transparent border-none text-left cursor-pointer"
          >
            <Settings size={16} />
            <span>Cài đặt hệ thống</span>
          </button>
          
          <button 
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-3 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl text-xs font-semibold transition-all bg-transparent border-none text-left cursor-pointer"
          >
            <LogOut size={16} />
            <span>Đăng xuất</span>
          </button>
        </div>
      </aside>
    </>
  );
}
