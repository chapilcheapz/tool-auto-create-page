import React, { useState } from 'react';
import { Search, Copy, ExternalLink, RefreshCw, AlertCircle, FileText } from 'lucide-react';

export default function ListPageView({ 
  pages, 
  loading, 
  hasCookie, 
  errorMsg, 
  showToast 
}) {
  const [searchTerm, setSearchTerm] = useState('');

  const handleCopyId = (id) => {
    navigator.clipboard.writeText(id).then(() => {
      showToast('Đã sao chép ID page!', 'success');
    });
  };

  const filteredPages = pages.filter(page => {
    const nameMatch = page.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const idMatch = page.id?.toLowerCase().includes(searchTerm.toLowerCase());
    return nameMatch || idMatch;
  });

  return (
    <div className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 flex flex-col gap-6 animate-in fade-in duration-300">
      <div className="p-6 bg-slate-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl shadow-xl flex flex-col gap-6">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
          <div className="flex-grow">
            <h2 className="text-xl font-bold text-white">Danh Sách Page Trong Tài Khoản</h2>
            <p className="text-xs text-zinc-400 mt-1">
              Quản lý các trang Facebook hiện có. Tổng số trang:{' '}
              <span className="font-bold text-purple-400">{filteredPages.length}</span>
            </p>
          </div>

          {/* Search bar */}
          <div className="relative w-full md:w-[300px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Tìm kiếm page..."
              className="w-full bg-black/40 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-xs text-zinc-200 focus:outline-none focus:border-purple-500 transition-all placeholder:text-zinc-600 outline-none"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="min-h-[250px] flex flex-col items-center justify-center text-center">
            <RefreshCw className="animate-spin text-purple-500 mb-2" size={32} />
            <p className="text-xs text-zinc-400">Đang tải danh sách page...</p>
          </div>
        )}

        {/* Not Logged In FB / No Cookie State */}
        {!loading && !hasCookie && (
          <div className="min-h-[250px] flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-800/50 flex items-center justify-center mb-4 border border-zinc-800">
              <FileText className="text-zinc-600" size={32} />
            </div>
            <h3 className="text-sm font-semibold text-zinc-200">Chưa có danh sách Page</h3>
            <p className="text-xs text-zinc-400 mt-1 max-w-sm leading-relaxed">
              Vui lòng cấu hình Cookie trong phần cài đặt hoặc tự động đăng nhập để hiển thị danh sách trang.
            </p>
          </div>
        )}

        {/* Empty Search/List State */}
        {!loading && hasCookie && filteredPages.length === 0 && (
          <div className="min-h-[250px] flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-800/50 flex items-center justify-center mb-4 border border-zinc-800">
              <AlertCircle className="text-zinc-600" size={32} />
            </div>
            <h3 className="text-sm font-semibold text-zinc-200">Không tìm thấy Page nào</h3>
            <p className="text-xs text-zinc-400 mt-1">
              {searchTerm ? 'Không tìm thấy Page nào phù hợp với tìm kiếm.' : (errorMsg || 'Không tìm thấy trang nào trên tài khoản này.')}
            </p>
          </div>
        )}

        {/* Table Page list */}
        {!loading && hasCookie && filteredPages.length > 0 && (
          <div className="overflow-hidden border border-zinc-800 rounded-xl bg-black/20">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/2 border-b border-zinc-800 text-zinc-400 font-semibold text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4 w-12 text-center">#</th>
                    <th className="py-3 px-4">Page</th>
                    <th className="py-3 px-4">Page ID</th>
                    <th className="py-3 px-4 text-right w-48">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-xs text-zinc-300">
                  {filteredPages.map((page, index) => (
                    <tr key={page.id} className="hover:bg-white/2 transition-colors">
                      <td className="py-3 px-4 text-center text-zinc-500 font-mono">{index + 1}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-purple-500/10 text-purple-400 font-bold flex items-center justify-center text-xs overflow-hidden shrink-0">
                            {page.avatar ? (
                              <img src={page.avatar} alt={page.name} className="w-full h-full object-cover" />
                            ) : (
                              page.name ? page.name.charAt(0).toUpperCase() : 'P'
                            )}
                          </div>
                          <span className="font-semibold text-zinc-200">{page.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-zinc-500 select-all">{page.id}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleCopyId(page.id)}
                            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 py-1.5 px-3 rounded-lg text-[10px] font-semibold transition-all cursor-pointer border-none flex items-center gap-1"
                          >
                            <Copy size={12} />
                            <span>Sao chép ID</span>
                          </button>
                          <a
                            href={`https://www.facebook.com/${page.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="bg-white hover:bg-white/95 text-black py-1.5 px-3 rounded-lg text-[10px] font-semibold transition-all inline-flex items-center gap-1 border-none cursor-pointer no-underline"
                          >
                            <ExternalLink size={12} />
                            <span>Xem trên FB</span>
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
