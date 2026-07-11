import React, { useState, useEffect } from 'react';
import { History, Trash2, PlusCircle, RefreshCw, Layers } from 'lucide-react';
import * as api from '../utils/api';

export default function CreatePageView({ cookie, showToast, onPageCreated }) {
  // Stats state
  const [stats, setStats] = useState({ total: 0, success: 0, fail: 0 });
  const [logs, setLogs] = useState([]);

  // Form inputs
  const [pageName, setPageName] = useState('');
  const [pageBio, setPageBio] = useState('');
  const [category, setCategory] = useState('2347428775505624');
  const [loading, setLoading] = useState(false);

  // Restore session logs on mount
  useEffect(() => {
    try {
      const savedStats = sessionStorage.getItem('session_creator_stats');
      if (savedStats) {
        setStats(JSON.parse(savedStats));
      }
      const savedLogs = sessionStorage.getItem('session_creator_logs');
      if (savedLogs) {
        setLogs(JSON.parse(savedLogs));
      }
    } catch (e) {
      console.error('Lỗi khôi phục session creator:', e);
    }
  }, []);

  const handleCreatePage = async (e) => {
    e.preventDefault();
    if (!cookie) {
      showToast('Vui lòng cấu hình Cookie trong Cài đặt trước!', 'error');
      return;
    }

    setLoading(true);
    try {
      const body = {
        cookie,
        customName: pageName.trim() || undefined,
        customBio: pageBio.trim() || undefined,
        category: category.trim() || undefined,
      };

      const result = await api.createPage(body);

      const time = new Date().toLocaleTimeString('vi-VN', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });

      const logItem = {
        success: result.success,
        pageName: result.name || pageName.trim() || 'Tên ngẫu nhiên',
        pageBio: result.bio || pageBio.trim() || 'Bio ngẫu nhiên',
        pageId: result.pageId || '',
        error: result.error || '',
        time
      };

      // Update states
      const newStats = {
        total: stats.total + 1,
        success: stats.success + (result.success ? 1 : 0),
        fail: stats.fail + (result.success ? 0 : 1)
      };
      setStats(newStats);

      const newLogs = [...logs, logItem];
      setLogs(newLogs);

      // Save to sessionStorage
      sessionStorage.setItem('session_creator_stats', JSON.stringify(newStats));
      sessionStorage.setItem('session_creator_logs', JSON.stringify(newLogs));

      if (result.success) {
        showToast(`Tạo page thành công: ${result.name}`, 'success');
        if (onPageCreated) onPageCreated(); // Trigger reload pages list
      } else {
        showToast(`Tạo page thất bại: ${result.error}`, 'error');
      }

    } catch (error) {
      const time = new Date().toLocaleTimeString('vi-VN', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
      const errLogItem = {
        success: false,
        pageName: 'Lỗi kết nối',
        pageBio: error.message,
        pageId: '',
        error: error.message,
        time
      };

      const newStats = {
        total: stats.total + 1,
        success: stats.success,
        fail: stats.fail + 1
      };
      setStats(newStats);

      const newLogs = [...logs, errLogItem];
      setLogs(newLogs);

      sessionStorage.setItem('session_creator_stats', JSON.stringify(newStats));
      sessionStorage.setItem('session_creator_logs', JSON.stringify(newLogs));

      showToast(`Lỗi kết nối: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
    setStats({ total: 0, success: 0, fail: 0 });
    sessionStorage.removeItem('session_creator_stats');
    sessionStorage.removeItem('session_creator_logs');
    showToast('Đã xóa nhật ký tạo page.', 'success');
  };

  return (
    <div className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 flex flex-col gap-6 animate-in fade-in duration-300">
      
      {/* Horizontal Stats Card */}
      <div className="bg-slate-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-2 justify-center sm:justify-start pb-2 border-b border-zinc-800/40 sm:pb-0 sm:border-none">
          <Layers className="text-purple-400" size={18} />
          <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">Thống kê phiên làm việc</span>
        </div>
        <div className="grid grid-cols-3 gap-2 w-full sm:flex sm:w-auto sm:items-center sm:gap-6">
          <div className="flex flex-col sm:flex-row items-center gap-1.5 justify-center text-center">
            <span className="text-[10px] sm:text-[11px] font-bold text-zinc-400 uppercase">TỔNG</span>
            <span className="text-lg font-bold text-purple-400">{stats.total}</span>
          </div>
          <div className="hidden sm:block h-4 w-px bg-zinc-800"></div>
          <div className="flex flex-col sm:flex-row items-center gap-1.5 justify-center text-center">
            <span className="text-[10px] sm:text-[11px] font-bold text-zinc-400 uppercase">THÀNH CÔNG</span>
            <span className="text-lg font-bold text-emerald-400">{stats.success}</span>
          </div>
          <div className="hidden sm:block h-4 w-px bg-zinc-800"></div>
          <div className="flex flex-col sm:flex-row items-center gap-1.5 justify-center text-center">
            <span className="text-[10px] sm:text-[11px] font-bold text-zinc-400 uppercase">THẤT BẠI</span>
            <span className="text-lg font-bold text-red-500">{stats.fail}</span>
          </div>
        </div>
      </div>

      {/* Create Page Form Card */}
      <div className="p-6 bg-slate-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl shadow-xl flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold text-white">Tạo Page Mới</h2>
          <p className="text-xs text-zinc-400">
            Nhập các tuỳ chỉnh bên dưới. Để trống để hệ thống tự động tạo tên &amp; bio ngẫu nhiên.
          </p>
        </div>

        <form onSubmit={handleCreatePage} className="space-y-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-zinc-400" htmlFor="inputPageName">
              Tên page (để trống = random)
            </label>
            <input
              type="text"
              id="inputPageName"
              placeholder="Để trống để tự tạo ngẫu nhiên..."
              className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500 transition-all placeholder:text-zinc-600 outline-none"
              value={pageName}
              onChange={(e) => setPageName(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-zinc-400" htmlFor="inputPageBio">
              Bio (để trống = random)
            </label>
            <input
              type="text"
              id="inputPageBio"
              placeholder="Để trống để tự tạo ngẫu nhiên..."
              className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500 transition-all placeholder:text-zinc-600 outline-none"
              value={pageBio}
              onChange={(e) => setPageBio(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-zinc-400" htmlFor="inputCategory">
              Category ID
            </label>
            <input
              type="text"
              id="inputCategory"
              className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500 transition-all outline-none"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="bg-white hover:bg-white/95 text-black py-3 px-6 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] w-full mt-4 cursor-pointer border-none shadow-lg disabled:opacity-50"
          >
            {loading ? (
              <>
                <RefreshCw className="animate-spin" size={18} />
                <span>Đang tạo page...</span>
              </>
            ) : (
              <>
                <PlusCircle size={18} />
                <span>Tạo Page</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* Log Section */}
      <section className="flex flex-col gap-4 mt-2">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <History className="text-purple-400" size={18} />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Nhật Ký Tạo Page</h3>
          </div>
          {logs.length > 0 && (
            <button
              onClick={handleClearLogs}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:bg-red-500/10 hover:text-red-400 hover:border-transparent transition-all active:scale-95 bg-transparent cursor-pointer text-xs"
            >
              <Trash2 size={14} />
              <span>Xoá nhật ký</span>
            </button>
          )}
        </div>

        {/* Empty log state */}
        {logs.length === 0 && (
          <div className="min-h-[180px] flex flex-col items-center justify-center text-center p-6 bg-slate-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl">
            <div className="w-12 h-12 rounded-full bg-zinc-800/50 flex items-center justify-center mb-3 border border-zinc-800">
              <History className="text-zinc-600" size={20} />
            </div>
            <p className="text-sm font-semibold text-zinc-400">Chưa có nhật ký hoạt động</p>
            <p className="text-xs text-zinc-500 mt-1">Các logs tạo page trong phiên làm việc sẽ được liệt kê tại đây.</p>
          </div>
        )}

        {/* Logs Table */}
        {logs.length > 0 && (
          <div className="border border-zinc-800 rounded-xl overflow-hidden bg-black/20">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/2 border-b border-zinc-800 text-zinc-400 font-semibold text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4 w-12 text-center">#</th>
                    <th className="py-3 px-4 w-24">Thời gian</th>
                    <th className="py-3 px-4">Tên Page</th>
                    <th className="py-3 px-4">Bio</th>
                    <th className="py-3 px-4">Page ID</th>
                    <th className="py-3 px-4 w-32">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-xs text-zinc-300">
                  {logs.map((log, index) => (
                    <tr key={index} className="hover:bg-white/2 transition-colors">
                      <td className="py-3 px-4 text-center text-zinc-500 font-mono">{index + 1}</td>
                      <td className="py-3 px-4 text-zinc-400">{log.time}</td>
                      <td className="py-3 px-4 font-semibold text-zinc-200">{log.pageName}</td>
                      <td className="py-3 px-4 text-zinc-400 max-w-[200px] truncate" title={log.pageBio}>{log.pageBio}</td>
                      <td className="py-3 px-4 font-mono text-zinc-500 select-all">{log.pageId || '-'}</td>
                      <td className="py-3 px-4">
                        {log.success ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
                            Thành công
                          </span>
                        ) : (
                          <span 
                            className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400"
                            title={log.error}
                          >
                            Lỗi
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
