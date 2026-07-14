import React from 'react';
import { RefreshCw, ListFilter, AlertCircle } from 'lucide-react';

export default function RightSidebar({ 
  pages, 
  loading, 
  onRefresh, 
  hasCookie, 
  errorMsg, 
  isOpen, 
  onClose 
}) {
  return (
    <>
      {/* Mobile Drawer Overlay */}
      {isOpen && (
        <div 
          onClick={onClose}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-45 lg:hidden"
        ></div>
      )}

      <aside 
        className={`fixed right-0 top-0 h-full w-[300px] sm:w-[360px] bg-[#070707]/95 backdrop-blur-md border-l border-zinc-900 flex flex-col z-50 transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Sidebar Header */}
        <div className="p-4 flex items-center justify-between border-b border-zinc-900">
          <div className="flex items-center gap-2">
            <ListFilter className="text-zinc-400" size={18} />
            <h2 className="text-xs font-semibold text-white uppercase tracking-widest">Danh Sách Page</h2>
          </div>
          <button 
            onClick={onRefresh}
            disabled={loading}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50 border-none bg-transparent"
            title="Tải lại danh sách"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Sidebar Body */}
        <div className="flex-1 flex flex-col p-4 overflow-y-auto">
          {loading && (
            <div className="flex-grow flex flex-col items-center justify-center p-6 text-center">
              <RefreshCw className="animate-spin text-purple-500 mb-2" size={32} />
              <p className="text-xs text-zinc-400">Đang tải danh sách page...</p>
            </div>
          )}

          {!loading && !hasCookie && (
            <div className="flex-grow flex flex-col items-center justify-center p-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-zinc-800/50 flex items-center justify-center mb-4 border border-zinc-800">
                <AlertCircle className="text-zinc-600" size={36} />
              </div>
              <h3 className="text-sm font-semibold text-zinc-200 mb-1">Chưa cấu hình Cookie</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Nhập cookie trong cài đặt và bấm tải lại để cập nhật danh sách các trang hiện có.
              </p>
            </div>
          )}

          {!loading && hasCookie && pages.length === 0 && (
            <div className="flex-grow flex flex-col items-center justify-center p-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-zinc-800/50 flex items-center justify-center mb-4 border border-zinc-800">
                <AlertCircle className="text-zinc-600" size={36} />
              </div>
              <h3 className="text-sm font-semibold text-zinc-200 mb-1">Không tìm thấy Page nào</h3>
              <p className="text-xs text-red-400 leading-relaxed">
                {errorMsg || 'Không tìm thấy Page nào thuộc tài khoản này.'}
              </p>
            </div>
          )}

          {!loading && hasCookie && pages.length > 0 && (
            <ul className="space-y-1 w-full">
              {pages.map((page) => (
                <li 
                  key={page.id}
                  onClick={() => window.open(`https://www.facebook.com/${page.id}`, '_blank')}
                  className="flex items-center gap-3 p-2 rounded-xl cursor-pointer hover:bg-white/5 hover:border-white/5 border border-transparent transition-all group"
                  title={`Xem chi tiết Page: ${page.name}`}
                >
                  <div className="w-8 h-8 rounded-full bg-purple-500/10 text-purple-400 font-bold flex items-center justify-center text-xs overflow-hidden shrink-0">
                    {page.avatar ? (
                      <img 
                        src={page.avatar} 
                        alt={page.name} 
                        className="w-full h-full object-cover" 
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      page.name ? page.name.charAt(0).toUpperCase() : 'P'
                    )}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold text-zinc-200 text-xs truncate group-hover:text-white transition-colors">
                      {page.name}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-500">{page.id}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 bg-[#070707] border-t border-zinc-900">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full animate-pulse ${hasCookie ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
            <span className="text-xs text-zinc-400">
              {hasCookie ? 'Cookie đã được cấu hình' : 'Cookie chưa được cấu hình'}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
