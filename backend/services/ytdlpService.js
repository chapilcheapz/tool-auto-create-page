const { execFile, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_BIN_DIR = path.resolve(__dirname, '../../vendor/bin');

// Đường dẫn file cookies tạm được decode từ YTDLP_COOKIES_BASE64
let _decodedCookiesFilePath = null;
// Cookie riêng cho từng nền tảng (upload thủ công qua UI)
let _youtubeCookiesFilePath = null;
let _tiktokCookiesFilePath = null;
const binaryValidationCache = new Map();

class MediaToolMissingError extends Error {
  constructor(toolName, configuredPath = '') {
    const configuredHint = configuredPath
      ? ` Giá trị đang cấu hình: ${configuredPath}.`
      : '';
    const recoveryHint = toolName === 'yt-dlp'
      ? 'Hãy chạy lại npm install (không dùng --ignore-scripts) hoặc rebuild bằng Dockerfile mới.'
      : 'Hãy rebuild bằng Dockerfile mới hoặc cài gói ffmpeg trên hệ điều hành của server.';
    super(
      `Server đang thiếu executable ${toolName}.${configuredHint} ` +
      recoveryHint
    );
    this.name = 'MediaToolMissingError';
    this.statusCode = 503;
    this.code = 'MEDIA_TOOL_MISSING';
    this.tool = toolName;
  }
}

class MediaDownloadError extends Error {
  constructor(message, statusCode = 422, code = 'MEDIA_DOWNLOAD_FAILED') {
    super(message);
    this.name = 'MediaDownloadError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeConfiguredPath(value) {
  return String(value || '').trim().replace(/^(["'])(.*)\1$/, '$2');
}

function executableNames(name) {
  if (process.platform !== 'win32' || path.extname(name)) return [name];
  return [name, `${name}.exe`];
}

function isExecutableFile(candidate) {
  if (!candidate) return false;
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return false;
    fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isRunnableBinary(candidate, toolName) {
  let stat;
  try {
    stat = fs.statSync(candidate);
  } catch {
    return false;
  }
  const cacheKey = `${toolName}:${candidate}:${stat.size}:${stat.mtimeMs}`;
  if (binaryValidationCache.has(cacheKey)) return binaryValidationCache.get(cacheKey);

  const versionArgs = toolName === 'yt-dlp' ? ['--ignore-config', '--version'] : ['-version'];
  const result = spawnSync(candidate, versionArgs, {
    shell: false,
    stdio: 'ignore',
    timeout: 5_000,
    windowsHide: true
  });
  const runnable = result.status === 0;
  if (binaryValidationCache.size >= 100) binaryValidationCache.clear();
  binaryValidationCache.set(cacheKey, runnable);
  return runnable;
}

function pathCandidates(command) {
  if (!command) return [];
  const hasPathSeparator = command.includes('/') || command.includes('\\');
  if (path.isAbsolute(command) || hasPathSeparator) {
    const resolved = path.isAbsolute(command) ? command : path.resolve(process.cwd(), command);
    return executableNames(resolved);
  }

  const pathEntries = String(process.env.PATH || '')
    .split(path.delimiter)
    .map(entry => entry.trim())
    .filter(Boolean);
  return pathEntries.flatMap(entry => executableNames(path.join(entry, command)));
}

function findBinary(name, configuredPath, bundledName = name) {
  const configured = normalizeConfiguredPath(configuredPath);
  const configuredIsExplicitPath = path.isAbsolute(configured) ||
    configured.includes('/') ||
    configured.includes('\\');
  const homeDirectory = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = [
    ...(configuredIsExplicitPath ? pathCandidates(configured) : []),
    ...executableNames(path.join(PROJECT_BIN_DIR, bundledName)),
    ...(!configuredIsExplicitPath ? pathCandidates(configured) : []),
    ...executableNames(`/opt/homebrew/bin/${name}`),
    ...executableNames(`/usr/local/bin/${name}`),
    ...(homeDirectory ? executableNames(path.join(homeDirectory, '.local/bin', name)) : []),
    ...executableNames(`/usr/bin/${name}`),
    ...pathCandidates(name)
  ];

  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (isExecutableFile(normalized) && isRunnableBinary(normalized, name)) return normalized;
  }
  return null;
}

function requireBinary(name, configuredPath, bundledName = name) {
  const resolved = findBinary(name, configuredPath, bundledName);
  if (resolved) return resolved;
  throw new MediaToolMissingError(name, normalizeConfiguredPath(configuredPath));
}

const getDlpPath = () => requireBinary(
  'yt-dlp',
  process.env.YTDLP_PATH,
  process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
);
const getFfprobePath = () => requireBinary('ffprobe', process.env.FFPROBE_PATH);
const getFfmpegPath = () => requireBinary('ffmpeg', process.env.FFMPEG_PATH);

function getMediaToolStatus() {
  const tools = [
    ['yt-dlp', process.env.YTDLP_PATH, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'],
    ['ffmpeg', process.env.FFMPEG_PATH, 'ffmpeg'],
    ['ffprobe', process.env.FFPROBE_PATH, 'ffprobe']
  ];
  const entries = tools.map(([name, configuredPath, bundledName]) => {
    const resolvedPath = findBinary(name, configuredPath, bundledName);
    return { name, available: Boolean(resolvedPath), path: resolvedPath };
  });
  return {
    ready: entries.every(entry => entry.available),
    tools: entries
  };
}

function buildJavaScriptRuntimeArgs(sourceUrl) {
  const isYouTube = sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be');
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  return isYouTube && nodeMajor >= 22
    ? ['--js-runtimes', `node:${process.execPath}`]
    : [];
}

/**
 * Decode YTDLP_COOKIES_BASE64 ra file tạm và trả về đường dẫn.
 * File được tạo một lần rồi cache; gọi lại sẽ trả về cùng đường dẫn.
 */
function decodeBase64CookiesToFile() {
  if (_decodedCookiesFilePath && fs.existsSync(_decodedCookiesFilePath)) {
    return _decodedCookiesFilePath;
  }

  const base64Content = (process.env.YTDLP_COOKIES_BASE64 || '').trim();
  if (!base64Content) return null;

  try {
    const decoded = Buffer.from(base64Content, 'base64').toString('utf-8');
    if (!decoded.includes('# Netscape HTTP Cookie File') && !decoded.includes('\t')) {
      console.warn('[yt-dlp] YTDLP_COOKIES_BASE64 không có vẻ là file cookies Netscape hợp lệ.');
    }
    const tmpPath = path.join(os.tmpdir(), `ytdlp-cookies-${process.pid}.txt`);
    fs.writeFileSync(tmpPath, decoded, { mode: 0o600 });
    _decodedCookiesFilePath = tmpPath;
    console.log('[yt-dlp] Đã decode YTDLP_COOKIES_BASE64 → ' + tmpPath);
    return tmpPath;
  } catch (err) {
    console.error('[yt-dlp] Không thể decode YTDLP_COOKIES_BASE64:', err.message);
    return null;
  }
}

/**
 * Ghi nội dung cookies.txt mới vào biến cache (dùng sau khi upload qua API).
 * Nội dung sẽ được ghi ra file tạm để yt-dlp có thể đọc ngay.
 */
function writeCookiesToTempFile(content) {
  const tmpPath = path.join(os.tmpdir(), `ytdlp-cookies-${process.pid}.txt`);
  fs.writeFileSync(tmpPath, content, { mode: 0o600 });
  _decodedCookiesFilePath = tmpPath;
  return tmpPath;
}

/**
 * Trả về trạng thái cấu hình cookies hiện tại để hiển thị trên UI.
 */
function getCookiesStatus() {
  const mode = process.env.YTDLP_COOKIE_MODE || 'none';
  const hasBase64 = Boolean((process.env.YTDLP_COOKIES_BASE64 || '').trim());
  const explicitFile = (process.env.YTDLP_COOKIES_FILE || '').trim();
  const tempFileExists = Boolean(_decodedCookiesFilePath && fs.existsSync(_decodedCookiesFilePath));

  let active = false;
  let source = 'none';

  if (mode === 'file') {
    if (explicitFile && fs.existsSync(explicitFile)) {
      active = true; source = 'file';
    } else if (tempFileExists) {
      active = true; source = 'base64';
    } else if (hasBase64) {
      // Chưa decode — thử decode ngay
      const f = decodeBase64CookiesToFile();
      active = Boolean(f); source = active ? 'base64' : 'none';
    }
  } else if (mode === 'browser') {
    active = true; source = 'browser';
  } else if (hasBase64) {
    // mode=none nhưng có base64 — gợi ý người dùng bật mode=file
    source = 'base64_inactive';
  }

  return { mode, active, source, hasBase64, tempFileExists };
}

/**
 * Chuyển đổi raw cookie string (name=value; name=value) sang định dạng Netscape cookies.txt
 */
function rawCookieStringToNetscape(cookieStr, domain) {
  const cookies = cookieStr.split(';').map(c => c.trim()).filter(Boolean);
  const lines = ['# Netscape HTTP Cookie File', `# Generated for ${domain}`];
  cookies.forEach(cookie => {
    const eqIdx = cookie.indexOf('=');
    if (eqIdx > 0) {
      const name = cookie.substring(0, eqIdx).trim();
      const value = cookie.substring(eqIdx + 1).trim();
      // domain\tincludeSubdomains\tpath\tsecure\texpiry\tname\tvalue
      lines.push(`${domain}\tTRUE\t/\tTRUE\t0\t${name}\t${value}`);
    }
  });
  return lines.join('\n');
}

/**
 * Lưu cookie thủ công (raw string hoặc Netscape) vào file tạm cho từng nền tảng.
 * platform: 'youtube' | 'tiktok'
 */
function writePlatformCookiesToFile(content, platform) {
  const tmpPath = path.join(os.tmpdir(), `ytdlp-${platform}-cookies-${process.pid}.txt`);
  const trimmed = content.trim();

  // Phát hiện định dạng: Netscape có header hoặc tab-separated, raw string thì không
  const isNetscape = trimmed.includes('# Netscape HTTP Cookie File') ||
    trimmed.split('\n').some(line => !line.startsWith('#') && line.includes('\t'));

  let fileContent = trimmed;
  if (!isNetscape) {
    const domainMap = { youtube: '.youtube.com', tiktok: '.tiktok.com' };
    fileContent = rawCookieStringToNetscape(trimmed, domainMap[platform] || `.${platform}.com`);
  }

  fs.writeFileSync(tmpPath, fileContent, { mode: 0o600 });

  if (platform === 'youtube') {
    _youtubeCookiesFilePath = tmpPath;
  } else if (platform === 'tiktok') {
    _tiktokCookiesFilePath = tmpPath;
  }

  const lineCount = fileContent.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
  console.log(`[yt-dlp] Cookies ${platform} đã được lưu → ${tmpPath} (${lineCount} dòng)`);
  return { tmpPath, lineCount };
}

/**
 * Lấy trạng thái cookie của từng nền tảng.
 * platform: 'youtube' | 'tiktok'
 */
function getPlatformCookiesStatus(platform) {
  const filePath = platform === 'youtube' ? _youtubeCookiesFilePath : _tiktokCookiesFilePath;
  const active = Boolean(filePath && fs.existsSync(filePath));
  let lineCount = 0;
  if (active) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      lineCount = content.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
    } catch {}
  }
  return { platform, active, lineCount };
}

/**
 * Tạo các tham số cookie an toàn cho yt-dlp từ biến môi trường.
 * Ưu tiên: platform-specific → YTDLP_COOKIES_FILE → YTDLP_COOKIES_BASE64 → browser → none
 * @param {string} sourceUrl - URL nguồn để xác định platform
 */
function buildCookieArgs(sourceUrl = '') {
  // Ưu tiên 0: Cookie riêng theo nền tảng (upload thủ công qua tab YT & TikTok)
  if (sourceUrl) {
    const isYouTube = sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be');
    const isTikTok = sourceUrl.includes('tiktok.com');

    if (isYouTube && _youtubeCookiesFilePath && fs.existsSync(_youtubeCookiesFilePath)) {
      return ['--cookies', _youtubeCookiesFilePath];
    }
    if (isTikTok && _tiktokCookiesFilePath && fs.existsSync(_tiktokCookiesFilePath)) {
      return ['--cookies', _tiktokCookiesFilePath];
    }
  }

  const mode = process.env.YTDLP_COOKIE_MODE || 'none';
  const browser = process.env.YTDLP_BROWSER || 'chrome';
  const profile = process.env.YTDLP_BROWSER_PROFILE?.trim();
  const explicitFile = (process.env.YTDLP_COOKIES_FILE || '').trim();

  if (mode === 'file') {
    // Ưu tiên 1: File được chỉ định rõ ràng
    if (explicitFile) {
      if (!fs.existsSync(explicitFile)) {
        throw new Error(`YTDLP_COOKIES_FILE không tồn tại: ${explicitFile}`);
      }
      return ['--cookies', explicitFile];
    }
    // Ưu tiên 2: Decode từ Base64 env var
    const base64File = decodeBase64CookiesToFile();
    if (base64File) {
      return ['--cookies', base64File];
    }
    // Ưu tiên 3: File đã upload qua API còn trong cache
    if (_decodedCookiesFilePath && fs.existsSync(_decodedCookiesFilePath)) {
      return ['--cookies', _decodedCookiesFilePath];
    }
    throw new Error('YTDLP_COOKIE_MODE=file nhưng chưa có cookies. Hãy cấu hình YTDLP_COOKIES_FILE hoặc YTDLP_COOKIES_BASE64.');
  }

  if (mode === 'browser') {
    const browserValue = profile ? `${browser}:${profile}` : browser;
    return ['--cookies-from-browser', browserValue];
  }

  // mode === 'none': Kiểm tra có file temp từ upload API không
  if (_decodedCookiesFilePath && fs.existsSync(_decodedCookiesFilePath)) {
    return ['--cookies', _decodedCookiesFilePath];
  }

  return [];
}

/**
 * Tải video thật sử dụng yt-dlp với callback nhận tiến trình theo thời gian thực
 */
function downloadWithYtDlp(sourceUrl, outputTemplate, onProgress) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();
    const dlpPath = getDlpPath();
    const cookieArgs = buildCookieArgs(sourceUrl);
    const javascriptRuntimeArgs = buildJavaScriptRuntimeArgs(sourceUrl);

    const isYoutube = sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be');
    const extraBypassArgs = isYoutube ? [
      '--extractor-args', 'youtube:player_client=ios,android,mweb',
      '--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
    ] : [];

    const args = [
      '--ignore-config',
      ...cookieArgs,
      ...extraBypassArgs,
      ...javascriptRuntimeArgs,
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

    const child = execFile(dlpPath, args, {
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
          return reject(new MediaDownloadError(
            'YouTube yêu cầu xác minh. Hãy cấu hình cookies.txt rồi thử lại.',
            422,
            'SOURCE_AUTH_REQUIRED'
          ));
        }
        if (
          rawMessage.includes('Could not copy Chrome cookie database') ||
          rawMessage.includes('Failed to decrypt with DPAPI') ||
          rawMessage.includes('Unable to get browser cookies')
        ) {
          return reject(new MediaDownloadError(
            'Không đọc được cookie Chrome. Hãy đóng Chrome rồi thử lại, chọn đúng profile hoặc chuyển sang cookies.txt.',
            422,
            'MEDIA_COOKIE_ERROR'
          ));
        }
        return reject(new MediaDownloadError(`yt-dlp kết thúc với mã lỗi ${code}. ${rawMessage}`));
      }

      const lines = stdoutData.split('\n').map(l => l.trim()).filter(Boolean);
      const filePath = lines[lines.length - 1];

      if (!filePath || !fs.existsSync(filePath)) {
        return reject(new MediaDownloadError('yt-dlp không tạo được file video.', 502));
      }

      const fileStat = fs.statSync(filePath);
      if (!fileStat.isFile() || fileStat.size <= 0) {
        return reject(new MediaDownloadError('File video tải về không hợp lệ (dung lượng 0 bytes).', 502));
      }

      resolve(filePath);
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT' || err.code === 'EACCES') {
        return reject(new MediaToolMissingError('yt-dlp', dlpPath));
      }
      reject(new MediaDownloadError(`yt-dlp lỗi: ${err.message}`, 502));
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
    const dlpPath = getDlpPath();
    const cookieArgs = buildCookieArgs(sourceUrl);
    const javascriptRuntimeArgs = buildJavaScriptRuntimeArgs(sourceUrl);
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
      '--ignore-config',
      ...cookieArgs,
      ...extraBypassArgs,
      ...javascriptRuntimeArgs,
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

    const child = execFile(dlpPath, args, {
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
          return reject(new MediaDownloadError(
            'YouTube yêu cầu xác minh. Hãy cấu hình cookies.txt rồi thử lại.',
            422,
            'SOURCE_AUTH_REQUIRED'
          ));
        }
        if (
          rawMessage.includes('Could not copy Chrome cookie database') ||
          rawMessage.includes('Failed to decrypt with DPAPI') ||
          rawMessage.includes('Unable to get browser cookies')
        ) {
          return reject(new MediaDownloadError(
            'Không đọc được cookie trình duyệt. Hãy dùng cookies.txt hoặc kiểm tra lại profile.',
            422,
            'MEDIA_COOKIE_ERROR'
          ));
        }
        return reject(new MediaDownloadError(
          `Không thể tách âm thanh. ${rawMessage || `yt-dlp kết thúc với mã ${code}`}`
        ));
      }

      const lines = stdoutData.split('\n').map(line => line.trim()).filter(Boolean);
      const filePath = lines[lines.length - 1];
      if (!filePath || !fs.existsSync(filePath)) {
        return reject(new MediaDownloadError('yt-dlp không tạo được file MP3.', 502));
      }

      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size <= 0) {
        return reject(new MediaDownloadError('File MP3 được tạo không hợp lệ.', 502));
      }
      resolve(filePath);
    });

    child.on('error', (error) => {
      if (signal?.aborted || error.name === 'AbortError' || error.code === 'ABORT_ERR') {
        return reject(abortError());
      }
      if (error.code === 'ENOENT' || error.code === 'EACCES') {
        return reject(new MediaToolMissingError('yt-dlp', dlpPath));
      }
      reject(new MediaDownloadError(`Không thể chạy yt-dlp: ${error.message}`, 502));
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
  MediaDownloadError,
  MediaToolMissingError,
  buildCookieArgs,
  buildJavaScriptRuntimeArgs,
  downloadWithYtDlp,
  downloadAudioWithYtDlp,
  verifyHeaderNotHtml,
  verifyWithFfprobe,
  findBinary,
  getMediaToolStatus,
  getDlpPath,
  getFfprobePath,
  getFfmpegPath,
  getCookiesStatus,
  writeCookiesToTempFile,
  decodeBase64CookiesToFile,
  writePlatformCookiesToFile,
  getPlatformCookiesStatus
};
