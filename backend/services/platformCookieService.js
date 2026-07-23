const { getSupabase } = require('../utils/supabase');

const TABLE = 'platform_cookies';
const VALID_PLATFORMS = ['youtube', 'tiktok'];

let _writeFn = null; // Được inject từ ytdlpService để tránh circular dependency

/**
 * Inject hàm writePlatformCookiesToFile từ ytdlpService (gọi một lần khi khởi động).
 * Tránh circular dependency giữa hai module.
 */
function setWriteFn(fn) {
  _writeFn = fn;
}

/**
 * Lưu cookie của một nền tảng lên Supabase.
 * Đồng thời ghi vào temp file để yt-dlp có thể dùng ngay.
 * @param {'youtube'|'tiktok'} platform
 * @param {string} content - nội dung cookie (raw hoặc Netscape)
 */
async function savePlatformCookie(platform, content) {
  if (!VALID_PLATFORMS.includes(platform)) {
    throw new Error(`Nền tảng không hợp lệ: ${platform}`);
  }

  const supabase = getSupabase();
  let source = 'memory';

  if (supabase) {
    try {
      // Tìm dòng hiện tại theo platform trước
      const { data: existingRow, error: selectErr } = await supabase
        .from(TABLE)
        .select('id')
        .eq('platform', platform)
        .maybeSingle();

      if (selectErr) {
        console.warn(`[PlatformCookies] ⚠️ Lỗi khi kiểm tra cookie ${platform}:`, selectErr.message);
      }

      let dbError = null;
      if (existingRow && existingRow.id) {
        // Thực hiện update dòng cũ
        const { error } = await supabase
          .from(TABLE)
          .update({
            cookie_ciphertext: content,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingRow.id);
        dbError = error;
      } else {
        // Thực hiện insert dòng mới
        const { error } = await supabase
          .from(TABLE)
          .insert({
            platform,
            cookie_ciphertext: content,
            updated_at: new Date().toISOString()
          });
        dbError = error;
      }

      if (dbError) {
        console.warn(`[PlatformCookies] ⚠️ Không thể lưu ${platform} lên Supabase:`, dbError.message);
      } else {
        source = 'supabase';
        console.log(`[PlatformCookies] ✅ Đã lưu cookie ${platform} lên Supabase.`);
      }
    } catch (err) {
      console.warn(`[PlatformCookies] ⚠️ Lỗi Supabase:`, err.message);
    }
  }

  // Ghi temp file để dùng ngay
  if (_writeFn && content.trim()) {
    const { lineCount } = _writeFn(content, platform);
    return { success: true, source, lineCount };
  }

  return { success: true, source, lineCount: 0 };
}

/**
 * Đọc cookie của một nền tảng từ Supabase.
 * @param {'youtube'|'tiktok'} platform
 * @returns {string|null} nội dung cookie hoặc null nếu chưa có
 */
async function loadPlatformCookie(platform) {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('cookie_ciphertext')
      .eq('platform', platform)
      .maybeSingle();

    if (error || !data) return null;
    return data.cookie_ciphertext || null;
  } catch {
    return null;
  }
}

/**
 * Đọc tất cả cookie từ Supabase, ghi vào temp file để yt-dlp có thể dùng.
 * Gọi một lần khi server khởi động.
 */
async function initPlatformCookies() {
  const supabase = getSupabase();
  if (!supabase) {
    console.log('[PlatformCookies] Supabase chưa cấu hình, bỏ qua load cookies từ DB.');
    return;
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('platform, cookie_ciphertext');

    if (error) {
      console.warn('[PlatformCookies] ⚠️ Lỗi khởi chạy/đọc từ Supabase:', error.message);
      return;
    }

    let loaded = 0;
    for (const row of (data || [])) {
      if (row.cookie_ciphertext?.trim() && VALID_PLATFORMS.includes(row.platform) && _writeFn) {
        _writeFn(row.cookie_ciphertext, row.platform);
        loaded++;
        console.log(`[PlatformCookies] ✅ Đã load cookie ${row.platform} từ Supabase.`);
      }
    }
    if (loaded === 0) {
      console.log('[PlatformCookies] ℹ️ Chưa có cookie nào được lưu trong Supabase.');
    }
  } catch (err) {
    console.warn('[PlatformCookies] ⚠️ Lỗi khởi tạo:', err.message);
  }
}

module.exports = { savePlatformCookie, loadPlatformCookie, initPlatformCookies, setWriteFn };
