const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Helper tìm vị trí thực tế của binary yt-dlp và ffprobe
 */
function findBinary(name) {
  // Ưu tiên Homebrew trước vì bin/ local có thể là Python package bị hỏng
  const commonPaths = [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    path.join(process.env.HOME || '', 'Library/Python/3.13/bin', name),
    path.join(process.env.HOME || '', '.local/bin', name),
    `/usr/bin/${name}`,
    name
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  return name;
}

const getDlpPath = () => process.env.YTDLP_PATH || findBinary('yt-dlp');
const getFfprobePath = () => process.env.FFPROBE_PATH || findBinary('ffprobe');
const getFfmpegPath = () => process.env.FFMPEG_PATH || findBinary('ffmpeg');

/**
 * Tạo các tham số cookie an toàn cho yt-dlp từ biến môi trường
 * Mặc định 'none': An toàn tuyệt đối, không đụng đến trình duyệt cá nhân hay Keychain của máy
 */
function buildCookieArgs() {
  const mode = process.env.YTDLP_COOKIE_MODE || 'none';
  const browser = process.env.YTDLP_BROWSER || 'chrome';
  const profile = process.env.YTDLP_BROWSER_PROFILE?.trim();
  const cookiesFile = process.env.YTDLP_COOKIES_FILE?.trim();

  if (mode === 'file') {
    if (!cookiesFile) {
      throw new Error('YTDLP_COOKIES_FILE chưa được cấu hình');
    }
    return ['--cookies', cookiesFile];
  }

  if (mode === 'browser') {
    const browserValue = profile ? `${browser}:${profile}` : browser;
    return ['--cookies-from-browser', browserValue];
  }

  return [];
}

/**
 * Tải video thật sử dụng yt-dlp với callback nhận tiến trình theo thời gian thực
 */
function downloadWithYtDlp(sourceUrl, outputTemplate, onProgress) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();
    const cookieArgs = buildCookieArgs();

    const isYoutube = sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be');
    const extraBypassArgs = isYoutube ? [
      '--extractor-args', 'youtube:player_client=ios,android,mweb',
      '--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
    ] : [];

    const args = [
      ...cookieArgs,
      ...extraBypassArgs,
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--restrict-filenames',
      '--ffmpeg-location', ffmpegPath,
      '-f', 'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--print', 'after_move:filepath',
      '-o', outputTemplate,
      sourceUrl
    ];

    const child = execFile(getDlpPath(), args, {
      timeout: 1800000,
      maxBuffer: 30 * 1024 * 1024
    });

    let stdoutData = '';
    let stderrData = '';

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdoutData += text;
        if (onProgress) {
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          lines.forEach(line => onProgress(line));
        }
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderrData += text;
        if (onProgress) {
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          lines.forEach(line => onProgress(line));
        }
      });
    }

    child.on('close', (code) => {
      const rawMessage = (stderrData || stdoutData || '').trim();

      if (code !== 0) {
        if (rawMessage.includes('Sign in to confirm you’re not a bot')) {
          return reject(new Error('YouTube bắt xác minh bot check. Hệ thống đang chuyển sang luồng giải mã Direct Stream...'));
        }
        if (
          rawMessage.includes('Could not copy Chrome cookie database') ||
          rawMessage.includes('Failed to decrypt with DPAPI') ||
          rawMessage.includes('Unable to get browser cookies')
        ) {
          return reject(new Error('Không đọc được cookie Chrome. Hãy đóng Chrome rồi thử lại, chọn đúng profile hoặc chuyển sang cookies.txt.'));
        }
        return reject(new Error(`yt-dlp kết thúc với mã lỗi ${code}. ${rawMessage}`));
      }

      const lines = stdoutData.split('\n').map(l => l.trim()).filter(Boolean);
      const filePath = lines[lines.length - 1];

      if (!filePath || !fs.existsSync(filePath)) {
        return reject(new Error('yt-dlp không tạo được file video.'));
      }

      const fileStat = fs.statSync(filePath);
      if (!fileStat.isFile() || fileStat.size <= 0) {
        return reject(new Error('File video tải về không hợp lệ (dung lượng 0 bytes).'));
      }

      resolve(filePath);
    });

    child.on('error', (err) => {
      reject(new Error(`yt-dlp lỗi: ${err.message}`));
    });
  });
}

/**
 * Tách luồng âm thanh từ URL và chuẩn hoá về MP3.
 * Dùng execFile với danh sách tham số cố định để URL không thể trở thành shell command.
 */
function downloadAudioWithYtDlp(sourceUrl, outputTemplate, onProgress, options = {}) {
  return new Promise((resolve, reject) => {
    const signal = options?.signal;
    const abortError = () => {
      const error = new Error('Tác vụ tách âm thanh đã bị hủy');
      error.name = 'AbortError';
      error.code = 'ABORT_ERR';
      return error;
    };
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const ffmpegPath = getFfmpegPath();
    const cookieArgs = buildCookieArgs();
    const isYoutube = sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be');
    const extraBypassArgs = isYoutube ? [
      '--extractor-args', 'youtube:player_client=ios,android,mweb',
      '--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
    ] : [];
    const configuredMaxSize = process.env.MEDIA_MAX_SOURCE_SIZE || '250M';
    const maxFileSize = /^\d+(?:\.\d+)?[KMG]?$/i.test(configuredMaxSize)
      ? configuredMaxSize
      : '250M';

    const args = [
      ...cookieArgs,
      ...extraBypassArgs,
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--restrict-filenames',
      '--socket-timeout', '30',
      '--retries', '3',
      '--fragment-retries', '3',
      '--max-filesize', maxFileSize,
      '--ffmpeg-location', ffmpegPath,
      '-f', 'bestaudio/best',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--print', 'after_move:filepath',
      '-o', outputTemplate,
      sourceUrl
    ];

    const child = execFile(getDlpPath(), args, {
      timeout: 1800000,
      maxBuffer: 30 * 1024 * 1024,
      signal
    });

    let stdoutData = '';
    let stderrData = '';

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdoutData += text;
        if (onProgress) {
          text.split('\n').map(line => line.trim()).filter(Boolean).forEach(onProgress);
        }
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderrData += text;
        if (onProgress) {
          text.split('\n').map(line => line.trim()).filter(Boolean).forEach(onProgress);
        }
      });
    }

    child.on('close', (code) => {
      if (signal?.aborted) return reject(abortError());
      const rawMessage = (stderrData || stdoutData || '').trim();
      if (code !== 0) {
        if (rawMessage.includes('Sign in to confirm you’re not a bot')) {
          return reject(new Error('YouTube yêu cầu xác minh. Hãy cấu hình cookies.txt rồi thử lại.'));
        }
        if (
          rawMessage.includes('Could not copy Chrome cookie database') ||
          rawMessage.includes('Failed to decrypt with DPAPI') ||
          rawMessage.includes('Unable to get browser cookies')
        ) {
          return reject(new Error('Không đọc được cookie trình duyệt. Hãy dùng cookies.txt hoặc kiểm tra lại profile.'));
        }
        return reject(new Error(`Không thể tách âm thanh. ${rawMessage || `yt-dlp kết thúc với mã ${code}`}`));
      }

      const lines = stdoutData.split('\n').map(line => line.trim()).filter(Boolean);
      const filePath = lines[lines.length - 1];
      if (!filePath || !fs.existsSync(filePath)) {
        return reject(new Error('yt-dlp không tạo được file MP3.'));
      }

      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size <= 0) {
        return reject(new Error('File MP3 được tạo không hợp lệ.'));
      }
      resolve(filePath);
    });

    child.on('error', (error) => {
      if (signal?.aborted || error.name === 'AbortError' || error.code === 'ABORT_ERR') {
        return reject(abortError());
      }
      reject(new Error(`Không thể chạy yt-dlp: ${error.message}`));
    });
  });
}

/**
 * Kiểm tra 512 bytes đầu tiên để ngăn HTML bị lưu nhầm thành MP4
 */
function verifyHeaderNotHtml(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(512);
  const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
  fs.closeSync(fd);

  const headerStr = buffer.slice(0, bytesRead).toString('utf8').trim().toLowerCase();
  if (headerStr.startsWith('<!doctype html') || headerStr.startsWith('<html')) {
    try { fs.unlinkSync(filePath); } catch {}
    throw new Error('Nguồn trả về trang HTML thay vì dữ liệu video.');
  }
}

/**
 * Kiểm tra file bằng ffprobe để đảm bảo chứa luồng video MP4 hợp lệ
 */
function verifyWithFfprobe(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height',
      '-of', 'json',
      filePath
    ];

    execFile(getFfprobePath(), args, { timeout: 30000 }, (error, stdout) => {
      if (error) {
        try { fs.unlinkSync(filePath); } catch {}
        return reject(new Error('File tải xuống không phải video MP4 hợp lệ.'));
      }

      try {
        const probeData = JSON.parse(stdout);
        if (!probeData || !probeData.streams || probeData.streams.length === 0) {
          try { fs.unlinkSync(filePath); } catch {}
          return reject(new Error('File tải xuống không chứa luồng video.'));
        }
        resolve(probeData);
      } catch {
        try { fs.unlinkSync(filePath); } catch {}
        reject(new Error('Không thể phân tích dữ liệu luồng video.'));
      }
    });
  });
}

module.exports = {
  buildCookieArgs,
  downloadWithYtDlp,
  downloadAudioWithYtDlp,
  verifyHeaderNotHtml,
  verifyWithFfprobe,
  getDlpPath,
  getFfprobePath,
  getFfmpegPath
};
