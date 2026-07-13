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
  const [pageCount, setPageCount] = useState('1');
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

    const names = pageName.split('\n').map(n => n.trim()).filter(Boolean);
    const pageNames = names.length > 0 ? names : [''];
    const totalTarget = names.length > 1 ? names.length : (parseInt(pageCount, 10) || 1);

    setLoading(true);
    setLogs([]);
    setStats({ total: totalTarget, success: 0, fail: 0 });

    try {
      const body = {
        cookie,
        pageNames,
        customBio: pageBio.trim() || undefined,
        category: category.trim() || undefined,
        count: totalTarget
      };

      const result = await api.createPage(body);

      if (result.success && result.campaignId) {
        const campaignId = result.campaignId;
        
        // Khởi tạo luồng Server-Sent Events (SSE) để nhận log thời gian thực
        const eventSource = new EventSource(`/api/campaigns/${campaignId}/stream`);

        eventSource.onmessage = (event) => {
          const data = JSON.parse(event.data);

          if (data.type === 'log') {
            setLogs(prev => {
              const updated = [...prev, data.log];
              sessionStorage.setItem('session_creator_logs', JSON.stringify(updated));
              return updated;
            });
            setStats(data.stats);
            sessionStorage.setItem('session_creator_stats', JSON.stringify(data.stats));
          } else if (data.type === 'history') {
            setLogs(data.logs);
            setStats(data.stats);
            sessionStorage.setItem('session_creator_logs', JSON.stringify(data.logs));
            sessionStorage.setItem('session_creator_stats', JSON.stringify(data.stats));
          } else if (data.type === 'done') {
            eventSource.close();
            setLoading(false);
            showToast('Đã hoàn thành tạo page hàng loạt!', 'success');
            if (onPageCreated) onPageCreated();
          }
        };

        eventSource.onerror = (err) => {
          eventSource.close();
          setLoading(false);
          showToast('Mất kết nối với luồng logs chiến dịch.', 'error');
        };

      } else {
        showToast(result.error || 'Khởi tạo chiến dịch thất bại.', 'error');
        setLoading(false);
      }

    } catch (error) {
      showToast(`Lỗi khởi tạo: ${error.message}`, 'error');
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
      <div className="glass-effect rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-2 justify-center sm:justify-start pb-2 border-b border-[var(--border-main)] sm:pb-0 sm:border-none">
          <Layers className="text-purple-400" size={18} />
          <span className="text-xs font-semibold text-[var(--text-main)] uppercase tracking-wider">Thống kê phiên làm việc</span>
        </div>
        <div className="grid grid-cols-3 gap-2 w-full sm:flex sm:w-auto sm:items-center sm:gap-6">
          <div className="flex flex-col sm:flex-row items-center gap-1.5 justify-center text-center">
            <span className="text-[10px] sm:text-[11px] font-bold text-[var(--text-muted)] uppercase">TỔNG</span>
            <span className="text-lg font-bold text-purple-400">{stats.total}</span>
          </div>
          <div className="hidden sm:block h-4 w-px bg-[var(--border-main)]"></div>
          <div className="flex flex-col sm:flex-row items-center gap-1.5 justify-center text-center">
            <span className="text-[10px] sm:text-[11px] font-bold text-[var(--text-muted)] uppercase">THÀNH CÔNG</span>
            <span className="text-lg font-bold text-emerald-400">{stats.success}</span>
          </div>
          <div className="hidden sm:block h-4 w-px bg-[var(--border-main)]"></div>
          <div className="flex flex-col sm:flex-row items-center gap-1.5 justify-center text-center">
            <span className="text-[10px] sm:text-[11px] font-bold text-[var(--text-muted)] uppercase">THẤT BẠI</span>
            <span className="text-lg font-bold text-red-500">{stats.fail}</span>
          </div>
        </div>
      </div>

      {/* Create Page Form Card */}
      <div className="p-6 glass-effect rounded-2xl shadow-xl flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold text-[var(--text-main)]">Tạo Page Mới</h2>
          <p className="text-xs text-[var(--text-muted)]">
            Nhập các tuỳ chỉnh bên dưới. Để trống để hệ thống tự động tạo tên &amp; bio ngẫu nhiên.
          </p>
        </div>

        <form onSubmit={handleCreatePage} className="space-y-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-[var(--text-muted)]" htmlFor="inputPageName">
              Danh sách tên page (mỗi dòng 1 tên, để trống = random)
            </label>
            <textarea
              id="inputPageName"
              placeholder="Ví dụ:&#10;Page Đồ gia dụng&#10;Page Thời trang nam&#10;Để trống để tự tạo ngẫu nhiên..."
              rows="4"
              className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)] transition-all placeholder:text-[var(--text-muted)] outline-none resize-none"
              value={pageName}
              onChange={(e) => setPageName(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-[var(--text-muted)]" htmlFor="inputPageBio">
              Bio (để trống = random)
            </label>
            <input
              type="text"
              id="inputPageBio"
              placeholder="Để trống để tự tạo ngẫu nhiên..."
              className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)] transition-all placeholder:text-[var(--text-muted)] outline-none"
              value={pageBio}
              onChange={(e) => setPageBio(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-[var(--text-muted)]" htmlFor="inputCategory">
                Category ID
              </label>
              <input
                type="text"
                id="inputCategory"
                className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)] transition-all outline-none"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={loading}
                required
              />
            </div>
            
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-[var(--text-muted)]" htmlFor="inputPageCount">
                Số lượng page muốn tạo
              </label>
              <input
                type="number"
                id="inputPageCount"
                min="1"
                className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)] transition-all outline-none"
                value={pageCount}
                onChange={(e) => setPageCount(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="bg-[var(--btn-cta-bg)] hover:bg-[var(--btn-cta-bg)]/90 text-[var(--btn-cta-text)] py-3 px-6 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] w-full mt-4 cursor-pointer border-none shadow-lg disabled:opacity-50"
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
            <h3 className="text-sm font-bold text-[var(--text-main)] uppercase tracking-wider">Nhật Ký Tạo Page</h3>
          </div>
          {logs.length > 0 && (
            <button
              onClick={handleClearLogs}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-main)] text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-400 hover:border-transparent transition-all active:scale-95 bg-transparent cursor-pointer text-xs"
            >
              <Trash2 size={14} />
              <span>Xoá nhật ký</span>
            </button>
          )}
        </div>

        {/* Empty log state */}
        {logs.length === 0 && (
          <div className="min-h-[180px] flex flex-col items-center justify-center text-center p-6 glass-effect rounded-2xl">
            <div className="w-12 h-12 rounded-full bg-[var(--input-bg)] flex items-center justify-center mb-3 border border-[var(--border-main)]">
              <History className="text-[var(--text-muted)]" size={20} />
            </div>
            <p className="text-sm font-semibold text-[var(--text-main)]">Chưa có nhật ký hoạt động</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Các logs tạo page trong phiên làm việc sẽ được liệt kê tại đây.</p>
          </div>
        )}

        {/* Logs Table */}
        {logs.length > 0 && (
          <div className="border border-[var(--border-main)] rounded-xl overflow-hidden bg-[var(--table-bg)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--active-menu-bg)] border-b border-[var(--border-main)] text-[var(--text-muted)] font-semibold text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4 w-12 text-center">#</th>
                    <th className="py-3 px-4 w-24">Thời gian</th>
                    <th className="py-3 px-4">Tên Page</th>
                    <th className="py-3 px-4">Bio</th>
                    <th className="py-3 px-4">Page ID</th>
                    <th className="py-3 px-4 w-32">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-main)] text-xs text-[var(--text-main)]">
                  {logs.map((log, index) => (
                    <tr key={index} className="hover:bg-[var(--table-row-hover)] transition-colors">
                      <td className="py-3 px-4 text-center text-[var(--text-muted)] font-mono">{index + 1}</td>
                      <td className="py-3 px-4 text-[var(--text-muted)]">{log.time}</td>
                      <td className="py-3 px-4 font-semibold text-[var(--text-main)]">{log.pageName}</td>
                      <td className="py-3 px-4 text-[var(--text-muted)] max-w-[200px] truncate" title={log.pageBio}>{log.pageBio}</td>
                      <td className="py-3 px-4 font-mono text-[var(--text-muted)] select-all">{log.pageId || '-'}</td>
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
