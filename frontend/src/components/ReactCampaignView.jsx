import React, { useState, useEffect } from 'react';
import { Heart, Play, RefreshCw, Terminal, Layers } from 'lucide-react';
import * as api from '../utils/api';

export default function ReactCampaignView({ cookie, showToast, onOpenSettings }) {
  const [postUrl, setPostUrl] = useState('');
  const [reactionType, setReactionType] = useState('1635855486666999');
  const [pageLimit, setPageLimit] = useState('0');
  const [loading, setLoading] = useState(false);

  // Campaign stats & console output
  const [stats, setStats] = useState({ total: 0, success: 0, fail: 0 });
  const [logs, setLogs] = useState([]);
  const [showConsole, setShowConsole] = useState(false);

  // Restore session logs on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('session_react_campaign');
      if (saved) {
        const parsed = JSON.parse(saved);
        setStats({
          total: parsed.total || 0,
          success: parsed.success || 0,
          fail: parsed.fail || 0
        });
        if (parsed.logHtml) {
          // Parse HTML logs into text-based logs list
          // But to be safe and compatible, we can just save logs array in session too.
          // Or we can save parsed logs in sessionStorage. Let's do that!
        }
        const savedLogs = sessionStorage.getItem('session_react_campaign_logs');
        if (savedLogs) {
          setLogs(JSON.parse(savedLogs));
          setShowConsole(true);
        }
      }
    } catch (e) {
      console.error('Lỗi khôi phục react session:', e);
    }
  }, []);

  const handleStartCampaign = async (e) => {
    e.preventDefault();
    if (!cookie) {
      showToast('Vui lòng cấu hình Cookie trong Cài đặt trước!', 'error');
      onOpenSettings();
      return;
    }

    const url = postUrl.trim();
    if (!url) {
      showToast('Vui lòng nhập link bài viết!', 'error');
      return;
    }

    setLoading(true);
    setShowConsole(true);
    setLogs([{ text: '[System] Bắt đầu kết nối và trích xuất danh sách Page...', type: 'info' }]);
    setStats({ total: 0, success: 0, fail: 0 });

    try {
      const result = await api.reactPost({
        cookie,
        postUrl: url,
        reactionType,
        limit: parseInt(pageLimit, 10) || 0
      });

      if (result.success && result.results) {
        let successCount = 0;
        let failCount = 0;

        const campaignLogs = [];
        campaignLogs.push({ text: `[Post ID] ${result.postId}`, type: 'header' });

        result.results.forEach((res, index) => {
          const time = new Date().toLocaleTimeString('vi-VN');
          const statusText = res.success ? 'THÀNH CÔNG' : `THẤT BẠI - ${res.error || 'Lỗi không xác định'}`;
          const logText = `[${time}] ${index + 1}. Page ${res.name} (${res.pageId}): ${statusText}`;
          
          campaignLogs.push({ 
            text: logText, 
            type: res.success ? 'success' : 'error' 
          });

          if (res.success) successCount++;
          else failCount++;
        });

        setLogs(campaignLogs);
        
        const newStats = {
          total: result.totalRun,
          success: successCount,
          fail: failCount
        };
        setStats(newStats);

        // Save react session state
        sessionStorage.setItem('session_react_campaign', JSON.stringify({
          postId: result.postId,
          total: result.totalRun,
          success: successCount,
          fail: failCount
        }));
        sessionStorage.setItem('session_react_campaign_logs', JSON.stringify(campaignLogs));

        showToast(`Đã hoàn thành thả cảm xúc bài viết!`, 'success');
      } else {
        const errorText = `[Lỗi] ${result.error || 'Có lỗi xảy ra'}`;
        setLogs(prev => [...prev, { text: errorText, type: 'error' }]);
        showToast(`Lỗi: ${result.error}`, 'error');
      }

    } catch (error) {
      const errorText = `[Lỗi kết nối] ${error.message}`;
      setLogs(prev => [...prev, { text: errorText, type: 'error' }]);
      showToast(`Lỗi kết nối: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 flex flex-col gap-6 animate-in fade-in duration-300">
      
      {/* Horizontal Stats Card */}
      <div className="glass-effect rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-2 justify-center sm:justify-start pb-2 border-b border-[var(--border-main)] sm:pb-0 sm:border-none">
          <Layers className="text-pink-500" size={18} />
          <span className="text-xs font-semibold text-[var(--text-main)] uppercase tracking-wider">Thống kê chiến dịch</span>
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

      {/* React Form Card */}
      <div className="p-6 glass-effect rounded-2xl shadow-xl flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold text-[var(--text-main)]">Thả cảm xúc hàng loạt bằng Page</h2>
          <p className="text-xs text-[var(--text-muted)]">
            Tự động thả cảm xúc bài viết Facebook sử dụng toàn bộ danh sách Page hiện có.
          </p>
        </div>

        <form onSubmit={handleStartCampaign} className="space-y-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-[var(--text-muted)]" htmlFor="inputPostUrl">
              Link bài viết Facebook cần thả cảm xúc
            </label>
            <input
              type="text"
              id="inputPostUrl"
              placeholder="Ví dụ: https://www.facebook.com/username/posts/123456..."
              className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)] transition-all placeholder:text-[var(--text-muted)] outline-none"
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-[var(--text-muted)]" htmlFor="selectReaction">
                Chọn cảm xúc
              </label>
              <select
                id="selectReaction"
                className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)] transition-all outline-none"
                value={reactionType}
                onChange={(e) => setReactionType(e.target.value)}
                disabled={loading}
              >
                <option value="1635855486666999">👍 Thích (Like)</option>
                <option value="1678524932434102">❤️ Yêu thích (Love)</option>
                <option value="613557422527858">🥰 Thương thương (Care)</option>
                <option value="115940658764963">😆 Haha</option>
                <option value="478547315650144">😮 Wow</option>
                <option value="908563459236466">😢 Buồn (Sad)</option>
                <option value="444813342392137">😡 Phẫn nộ (Angry)</option>
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-[var(--text-muted)]" htmlFor="inputReactCount">
                Số lượng Page sử dụng (0 = Tất cả)
              </label>
              <input
                type="text"
                id="inputReactCount"
                className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--text-muted)] transition-all outline-none"
                value={pageLimit}
                onChange={(e) => setPageLimit(e.target.value)}
                disabled={loading}
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
                <span>Đang thả cảm xúc...</span>
              </>
            ) : (
              <>
                <Play size={18} />
                <span>Bắt đầu chiến dịch</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* Progress Console logs */}
      {showConsole && (
        <section className="flex flex-col gap-4 mt-2">
          <div className="flex items-center gap-2 px-1">
            <Terminal className="text-pink-500" size={18} />
            <h3 className="text-sm font-bold text-[var(--text-main)] uppercase tracking-wider">Bảng điều khiển Tiến độ</h3>
          </div>

          <div className="p-4 bg-black/85 font-mono text-xs rounded-xl border border-[var(--border-main)] min-h-[150px] max-h-[300px] overflow-y-auto space-y-1.5 shadow-inner">
            {logs.map((log, index) => {
              let colorClass = 'text-zinc-400';
              if (log.type === 'success') colorClass = 'text-emerald-400';
              if (log.type === 'error') colorClass = 'text-red-400';
              if (log.type === 'header') colorClass = 'text-sky-400 font-bold';
              if (log.type === 'info') colorClass = 'text-purple-400';

              return (
                <div key={index} className={colorClass}>
                  {log.text}
                </div>
              );
            })}
          </div>
        </section>
      )}

    </div>
  );
}
