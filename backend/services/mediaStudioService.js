const { execFile } = require('child_process');
const crypto = require('crypto');
const dns = require('dns').promises;
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const supabaseStorageService = require('./supabaseStorageService');
const ytdlpService = require('./ytdlpService');

const DEFAULT_MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const DEFAULT_PROCESS_TIMEOUT_MS = 30 * 60 * 1000;
const LOCAL_MEDIA_DIR = path.resolve(
  (process.env.MEDIA_DIR || path.join(__dirname, '../../storage/media')).replace(/^"|"$/g, '')
);

const VIDEO_EXTENSIONS = new Set(['.m4v', '.mkv', '.mov', '.mp4', '.webm']);
const AUDIO_EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.wav']);
const CONTENT_TYPES = {
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm'
};

class MediaStudioError extends Error {
  constructor(message, statusCode = 400, code = 'MEDIA_STUDIO_ERROR') {
    super(message);
    this.name = 'MediaStudioError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function getMaxUploadBytes() {
  const explicitBytes = Number.parseInt(process.env.MEDIA_MAX_UPLOAD_BYTES || '', 10);
  if (Number.isSafeInteger(explicitBytes) && explicitBytes > 0) return explicitBytes;

  const expressLimit = String(process.env.MEDIA_UPLOAD_LIMIT || '').trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/.exec(expressLimit);
  if (match) {
    const multipliers = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
    const bytes = Math.floor(Number(match[1]) * multipliers[match[2] || 'b']);
    if (Number.isSafeInteger(bytes) && bytes > 0) return bytes;
  }
  return DEFAULT_MAX_UPLOAD_BYTES;
}

function getProcessTimeoutMs() {
  const configured = Number.parseInt(process.env.MEDIA_PROCESS_TIMEOUT_MS || '', 10);
  return Number.isSafeInteger(configured) && configured >= 1000
    ? configured
    : DEFAULT_PROCESS_TIMEOUT_MS;
}

function sanitizeOwnerSegment(value) {
  const safe = String(value || 'admin')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+|[._-]+$/g, '')
    .slice(0, 80);
  return safe || 'admin';
}

function getOwnerFolder(owner, kind) {
  const safeOwner = sanitizeOwnerSegment(owner);
  const safeKind = kind === 'audio' ? 'audio' : 'videos';
  return `users/${safeOwner}/${safeKind}`;
}

function ensureLocalMediaDir() {
  const root = path.parse(LOCAL_MEDIA_DIR).root;
  if (LOCAL_MEDIA_DIR === root) {
    throw new MediaStudioError('MEDIA_DIR không được trỏ tới thư mục gốc', 500, 'UNSAFE_MEDIA_DIR');
  }
  fs.mkdirSync(LOCAL_MEDIA_DIR, { recursive: true });
  return LOCAL_MEDIA_DIR;
}

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    return true;
  }

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length);
    return net.isIP(mappedIpv4) !== 4 || isPrivateIpv4(mappedIpv4);
  }
  return false;
}

function validateSourceUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new MediaStudioError('Vui lòng dán liên kết video cần tách âm thanh');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new MediaStudioError('Liên kết video không hợp lệ');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new MediaStudioError('Chỉ hỗ trợ liên kết http hoặc https');
  }
  if (parsed.username || parsed.password) {
    throw new MediaStudioError('Liên kết có thông tin đăng nhập không được hỗ trợ');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new MediaStudioError('Không cho phép truy cập địa chỉ nội bộ');
  }

  const ipVersion = net.isIP(hostname);
  if ((ipVersion === 4 && isPrivateIpv4(hostname)) || (ipVersion === 6 && isPrivateIpv6(hostname))) {
    throw new MediaStudioError('Không cho phép truy cập địa chỉ IP nội bộ');
  }
  if (ipVersion === 0 && !hostname.includes('.')) {
    throw new MediaStudioError('Tên máy nội bộ không được hỗ trợ');
  }

  parsed.hash = '';
  return parsed.href;
}

async function validateResolvedSourceUrl(rawUrl) {
  const safeUrl = validateSourceUrl(rawUrl);
  const hostname = new URL(safeUrl).hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(hostname)) return safeUrl;

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (_) {
    throw new MediaStudioError('Không thể phân giải tên miền của liên kết nguồn', 422, 'SOURCE_DNS_FAILED');
  }

  if (!addresses.length || addresses.some(({ address, family }) => (
    (family === 4 && isPrivateIpv4(address)) ||
    (family === 6 && isPrivateIpv6(address))
  ))) {
    throw new MediaStudioError('Tên miền nguồn trỏ tới địa chỉ mạng nội bộ', 403, 'PRIVATE_SOURCE_ADDRESS');
  }
  return safeUrl;
}

function safeExtension(fileName, fallback = '.bin') {
  const extension = path.extname(String(fileName || '')).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : fallback;
}

function extensionForVideoUpload(fileName, contentType) {
  const candidate = safeExtension(fileName, '');
  if (VIDEO_EXTENSIONS.has(candidate)) return candidate;

  const mime = String(contentType || '').toLowerCase().split(';')[0].trim();
  const byMime = {
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
    'video/x-matroska': '.mkv',
    'video/x-m4v': '.m4v'
  };
  return byMime[mime] || '.mp4';
}

function inferContentType(fileName, fallback = 'application/octet-stream') {
  return CONTENT_TYPES[safeExtension(fileName, '')] || fallback;
}

function makeSafeFileName(prefix, extension) {
  const safePrefix = String(prefix || 'media')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 100) || 'media';
  const safeExt = /^\.[a-z0-9]{1,8}$/i.test(extension || '') ? extension.toLowerCase() : '.bin';
  return `${safePrefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, '')}${safeExt}`;
}

async function createWorkspace() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'media-studio-'));
}

async function cleanupWorkspace(workspace) {
  if (!workspace) return;
  const resolved = path.resolve(workspace);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${tempRoot}${path.sep}`) || !path.basename(resolved).startsWith('media-studio-')) {
    return;
  }
  await fs.promises.rm(resolved, { recursive: true, force: true }).catch(() => {});
}

function conciseProcessMessage(stdout, stderr, fallback) {
  const raw = String(stderr || stdout || fallback || '').trim();
  if (!raw) return fallback;
  return raw.slice(-2500);
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new MediaStudioError('Tác vụ đã bị hủy vì kết nối phía người dùng đã đóng', 499, 'OPERATION_ABORTED');
  }
}

function runBinary(binary, args, label, signal) {
  return new Promise((resolve, reject) => {
    try {
      throwIfAborted(signal);
    } catch (error) {
      reject(error);
      return;
    }

    execFile(binary, args, {
      timeout: getProcessTimeoutMs(),
      maxBuffer: 10 * 1024 * 1024,
      signal
    }, (error, stdout, stderr) => {
      if (error) {
        if (signal?.aborted || error.name === 'AbortError' || error.code === 'ABORT_ERR') {
          return reject(new MediaStudioError(
            'Tác vụ đã bị hủy vì kết nối phía người dùng đã đóng',
            499,
            'OPERATION_ABORTED'
          ));
        }
        const detail = conciseProcessMessage(stdout, stderr, error.message);
        const timeoutText = error.killed ? ' (quá thời gian xử lý)' : '';
        return reject(new MediaStudioError(
          `${label} thất bại${timeoutText}: ${detail}`,
          422,
          'MEDIA_PROCESS_FAILED'
        ));
      }
      resolve({ stdout, stderr });
    });
  });
}

async function probeMedia(filePath, signal) {
  throwIfAborted(signal);
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    throw new MediaStudioError('File media không tồn tại', 404, 'MEDIA_NOT_FOUND');
  }
  if (!stat.isFile() || stat.size <= 0) {
    throw new MediaStudioError('File media rỗng hoặc không hợp lệ', 422, 'INVALID_MEDIA');
  }

  const { stdout } = await runBinary(ytdlpService.getFfprobePath(), [
    '-v', 'error',
    '-show_entries', 'format=duration,format_name,size:stream=index,codec_type,codec_name,duration,width,height,sample_rate,channels',
    '-of', 'json',
    filePath
  ], 'Không thể đọc thông tin media', signal);

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new MediaStudioError('ffprobe trả về dữ liệu không hợp lệ', 422, 'INVALID_PROBE_DATA');
  }

  const streams = Array.isArray(data.streams) ? data.streams : [];
  const streamDurations = streams
    .map(stream => Number(stream.duration))
    .filter(Number.isFinite);
  const formatDuration = Number(data.format?.duration);
  const duration = Number.isFinite(formatDuration)
    ? formatDuration
    : (streamDurations.length ? Math.max(...streamDurations) : 0);

  return {
    duration: Math.max(0, duration),
    size: stat.size,
    formatName: data.format?.format_name || '',
    streams,
    hasAudio: streams.some(stream => stream.codec_type === 'audio'),
    hasVideo: streams.some(stream => stream.codec_type === 'video')
  };
}

async function extractAudioFromUrl(sourceUrl, workspace, onProgress, signal) {
  throwIfAborted(signal);
  const safeUrl = await validateResolvedSourceUrl(sourceUrl);
  throwIfAborted(signal);
  const outputTemplate = path.join(workspace, 'source_audio.%(ext)s');
  const outputPath = await ytdlpService.downloadAudioWithYtDlp(
    safeUrl,
    outputTemplate,
    onProgress,
    { signal }
  );
  const probe = await probeMedia(outputPath, signal);
  if (!probe.hasAudio) {
    throw new MediaStudioError('Nguồn không chứa luồng âm thanh', 422, 'AUDIO_STREAM_MISSING');
  }
  return { filePath: outputPath, probe, sourceUrl: safeUrl };
}

function formatTimestamp(value) {
  return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

async function removeAudioSegment(inputPath, outputPath, start, end, signal) {
  const probe = await probeMedia(inputPath, signal);
  if (!probe.hasAudio || probe.duration <= 0) {
    throw new MediaStudioError('File không có luồng âm thanh hợp lệ', 422, 'AUDIO_STREAM_MISSING');
  }

  const requestedStart = Number(start);
  const requestedEnd = Number(end);
  if (!Number.isFinite(requestedStart) || !Number.isFinite(requestedEnd)) {
    throw new MediaStudioError('Mốc bắt đầu và kết thúc phải là số');
  }

  const cutStart = Math.max(0, requestedStart);
  const cutEnd = Math.min(probe.duration, requestedEnd);
  if (cutStart >= cutEnd || cutEnd - cutStart < 0.01) {
    throw new MediaStudioError('Đoạn âm thanh cần xoá phải dài ít nhất 0,01 giây');
  }

  const epsilon = 0.005;
  const keptRanges = [];
  if (cutStart > epsilon) keptRanges.push([0, cutStart]);
  if (cutEnd < probe.duration - epsilon) keptRanges.push([cutEnd, probe.duration]);
  if (keptRanges.length === 0) {
    throw new MediaStudioError('Không thể xoá toàn bộ bản âm thanh');
  }

  let filterComplex;
  if (keptRanges.length === 1) {
    const [rangeStart, rangeEnd] = keptRanges[0];
    filterComplex = `[0:a:0]atrim=start=${formatTimestamp(rangeStart)}:end=${formatTimestamp(rangeEnd)},asetpts=PTS-STARTPTS[outa]`;
  } else {
    const trimFilters = keptRanges.map(([rangeStart, rangeEnd], index) => (
      `[0:a:0]atrim=start=${formatTimestamp(rangeStart)}:end=${formatTimestamp(rangeEnd)},asetpts=PTS-STARTPTS[a${index}]`
    ));
    const inputs = keptRanges.map((_, index) => `[a${index}]`).join('');
    filterComplex = `${trimFilters.join(';')};${inputs}concat=n=${keptRanges.length}:v=0:a=1[outa]`;
  }

  await runBinary(ytdlpService.getFfmpegPath(), [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', inputPath,
    '-filter_complex', filterComplex,
    '-map', '[outa]',
    '-vn',
    '-c:a', 'libmp3lame',
    '-q:a', '2',
    '-id3v2_version', '3',
    outputPath
  ], 'Không thể cắt âm thanh', signal);

  const outputProbe = await probeMedia(outputPath, signal);
  return {
    filePath: outputPath,
    probe: outputProbe,
    removed: { start: cutStart, end: cutEnd }
  };
}

async function mergeVideoWithAudio(videoPath, audioPath, outputPath, signal) {
  const [videoProbe, audioProbe] = await Promise.all([
    probeMedia(videoPath, signal),
    probeMedia(audioPath, signal)
  ]);
  if (!videoProbe.hasVideo || videoProbe.duration <= 0) {
    throw new MediaStudioError('File đã chọn không có luồng video hợp lệ', 422, 'VIDEO_STREAM_MISSING');
  }
  if (!audioProbe.hasAudio) {
    throw new MediaStudioError('File đã chọn không có luồng âm thanh', 422, 'AUDIO_STREAM_MISSING');
  }

  const commonArgs = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', videoPath,
    '-i', audioPath,
    '-filter_complex', '[1:a:0]apad[outa]',
    '-map', '0:v:0',
    '-map', '[outa]',
    '-map_metadata', '0',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-t', formatTimestamp(videoProbe.duration),
    '-movflags', '+faststart'
  ];

  try {
    await runBinary(ytdlpService.getFfmpegPath(), [
      ...commonArgs,
      '-c:v', 'copy',
      outputPath
    ], 'Không thể ghép video và âm thanh', signal);
  } catch (copyError) {
    if (copyError?.code === 'OPERATION_ABORTED') throw copyError;
    await fs.promises.unlink(outputPath).catch(() => {});
    try {
      await runBinary(ytdlpService.getFfmpegPath(), [
        ...commonArgs,
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        outputPath
      ], 'Không thể mã hoá lại video sau khi ghép âm thanh', signal);
    } catch (encodeError) {
      encodeError.message = `${encodeError.message}. Lỗi ghép nhanh ban đầu: ${copyError.message}`;
      throw encodeError;
    }
  }

  const outputProbe = await probeMedia(outputPath, signal);
  if (!outputProbe.hasVideo || !outputProbe.hasAudio) {
    throw new MediaStudioError('File sau khi ghép không có đủ luồng video và âm thanh', 422, 'INVALID_MERGED_MEDIA');
  }
  return { filePath: outputPath, probe: outputProbe, videoProbe, audioProbe };
}

function storageIsConfigured() {
  try {
    return typeof supabaseStorageService.isConfigured === 'function' && supabaseStorageService.isConfigured();
  } catch {
    return false;
  }
}

function assertStoragePathInFolder(storagePath, allowedFolder) {
  const normalized = String(storagePath || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/');
  if (!normalized || parts.some(part => !part || part === '.' || part === '..')) {
    throw new MediaStudioError('Đường dẫn Supabase không hợp lệ');
  }
  if (allowedFolder && !normalized.startsWith(`${allowedFolder}/`)) {
    throw new MediaStudioError('File media không thuộc tài khoản hiện tại', 403, 'MEDIA_OWNER_MISMATCH');
  }
  return normalized;
}

async function resolveLocalMediaPath(localFileName, allowedPrefixes = []) {
  ensureLocalMediaDir();
  let decodedName = String(localFileName || '').trim();
  try {
    decodedName = decodeURIComponent(decodedName);
  } catch {}

  if (
    !decodedName ||
    decodedName.startsWith('.') ||
    decodedName.includes('/') ||
    decodedName.includes('\\') ||
    path.basename(decodedName) !== decodedName
  ) {
    throw new MediaStudioError('Tên file local không hợp lệ');
  }
  if (allowedPrefixes.length && !allowedPrefixes.some(prefix => decodedName.startsWith(prefix))) {
    throw new MediaStudioError('File local không thuộc tài khoản hiện tại', 403, 'MEDIA_OWNER_MISMATCH');
  }

  const candidate = path.join(LOCAL_MEDIA_DIR, decodedName);
  let stat;
  try {
    stat = await fs.promises.stat(candidate);
  } catch {
    throw new MediaStudioError('File media local không tồn tại', 404, 'MEDIA_NOT_FOUND');
  }
  if (!stat.isFile()) {
    throw new MediaStudioError('Đường dẫn media local không phải file', 404, 'MEDIA_NOT_FOUND');
  }

  const [realDirectory, realCandidate] = await Promise.all([
    fs.promises.realpath(LOCAL_MEDIA_DIR),
    fs.promises.realpath(candidate)
  ]);
  if (path.dirname(realCandidate) !== realDirectory) {
    throw new MediaStudioError('Truy cập file media bị từ chối', 403, 'UNSAFE_MEDIA_PATH');
  }
  return realCandidate;
}

async function materializeMediaReference(reference, workspace, options = {}) {
  const ref = reference && typeof reference === 'object' ? reference : {};
  const allowedFolder = options.allowedFolder || '';
  const allowedLocalPrefixes = options.allowedLocalPrefixes || [];
  let remoteError = null;

  if (ref.storagePath) {
    const storagePath = assertStoragePathInFolder(ref.storagePath, allowedFolder);
    if (storageIsConfigured() && typeof supabaseStorageService.downloadMediaFile === 'function') {
      const extension = safeExtension(storagePath, options.fallbackExtension || '.bin');
      const destination = path.join(workspace, makeSafeFileName('input', extension));
      const result = await supabaseStorageService.downloadMediaFile(storagePath, destination);
      if (result?.success && fs.existsSync(destination)) {
        return { filePath: destination, source: 'supabase', storagePath, warning: null };
      }
      remoteError = result?.error || 'Không thể tải file từ Supabase';
    } else {
      remoteError = 'Supabase chưa được cấu hình';
    }
  }

  if (ref.localFileName) {
    const filePath = await resolveLocalMediaPath(ref.localFileName, allowedLocalPrefixes);
    return {
      filePath,
      source: 'local',
      localFileName: path.basename(filePath),
      warning: remoteError ? `Không đọc được Supabase; đã dùng file local. ${remoteError}` : null
    };
  }

  if (remoteError) {
    throw new MediaStudioError(remoteError, 502, 'STORAGE_DOWNLOAD_FAILED');
  }
  throw new MediaStudioError('Thiếu storagePath hoặc localFileName của media');
}

function localMediaUrl(fileName) {
  return `/api/media/local/${encodeURIComponent(fileName)}`;
}

async function persistMediaFile(localPath, options = {}) {
  throwIfAborted(options.signal);
  const stat = await fs.promises.stat(localPath);
  const extension = safeExtension(options.fileName || localPath, options.fallbackExtension || '.bin');
  const fileName = options.fileName || makeSafeFileName(options.prefix || options.kind || 'media', extension);
  const contentType = options.contentType || inferContentType(fileName);
  const commonAsset = {
    type: options.kind || 'media',
    fileName,
    name: fileName,
    originalName: options.originalName || null,
    contentType,
    mimeType: contentType,
    size: stat.size,
    duration: Number.isFinite(options.duration) ? options.duration : null
  };

  let uploadWarning = '';
  if (storageIsConfigured() && typeof supabaseStorageService.uploadMediaFile === 'function') {
    try {
      const result = await supabaseStorageService.uploadMediaFile(localPath, {
        folder: options.folder || '',
        fileName,
        contentType
      });
      if (result?.success && result.storagePath) {
        if (options.signal?.aborted) {
          if (typeof supabaseStorageService.deleteMediaFile === 'function') {
            await supabaseStorageService.deleteMediaFile(result.storagePath).catch(() => {});
          }
          throwIfAborted(options.signal);
        }
        const publicUrl = result.publicUrl || result.public_url || result.signedUrl || result.url || null;
        return {
          asset: {
            ...commonAsset,
            storageProvider: 'supabase',
            fileName: result.fileName || fileName,
            name: result.fileName || fileName,
            storagePath: result.storagePath,
            localFileName: null,
            publicUrl,
            url: publicUrl,
            downloadUrl: result.downloadUrl || publicUrl,
            size: Number.isFinite(result.size) ? result.size : commonAsset.size,
            contentType: result.mimeType || commonAsset.contentType,
            mimeType: result.mimeType || commonAsset.mimeType
          },
          warning: null
        };
      }
      uploadWarning = result?.error || 'Supabase không trả về storagePath';
    } catch (error) {
      if (error?.code === 'OPERATION_ABORTED') throw error;
      uploadWarning = error.message;
    }
  } else {
    uploadWarning = 'Supabase chưa được cấu hình';
  }

  if (options.requireRemote) {
    throw new MediaStudioError(
      `Không thể lưu file lên Supabase: ${uploadWarning}`,
      502,
      'SUPABASE_UPLOAD_FAILED'
    );
  }

  throwIfAborted(options.signal);
  ensureLocalMediaDir();
  const requestedLocalName = path.basename(fileName) === fileName &&
    !fileName.startsWith('.') &&
    !/[\\/\u0000-\u001f\u007f]/.test(fileName)
    ? fileName
    : '';
  const localFileName = requestedLocalName ||
    makeSafeFileName(options.prefix || options.kind || 'media', extension);
  const destination = path.join(LOCAL_MEDIA_DIR, localFileName);
  await fs.promises.copyFile(localPath, destination, fs.constants.COPYFILE_EXCL);
  if (options.signal?.aborted) {
    await fs.promises.unlink(destination).catch(() => {});
    throwIfAborted(options.signal);
  }
  const url = localMediaUrl(localFileName);
  return {
    asset: {
      ...commonAsset,
      storageProvider: 'local',
      fileName: localFileName,
      name: localFileName,
      storagePath: null,
      localFileName,
      publicUrl: null,
      url,
      downloadUrl: url
    },
    warning: `Không thể lưu Supabase; đã giữ file local. ${uploadWarning}`
  };
}

function normalizeRemoteVideo(item, folder) {
  if (!item || typeof item !== 'object') return null;
  const fileName = item.fileName || item.name || path.posix.basename(item.storagePath || '');
  if (!fileName) return null;
  const contentType = item.mimeType || item.contentType || inferContentType(fileName);
  if (!String(contentType).startsWith('video/') && !VIDEO_EXTENSIONS.has(safeExtension(fileName, ''))) {
    return null;
  }
  const storagePath = item.storagePath || `${folder}/${fileName}`;
  const publicUrl = item.publicUrl || item.public_url || item.signedUrl || item.url || null;
  return {
    ...item,
    type: 'video',
    storageProvider: 'supabase',
    fileName,
    name: fileName,
    storagePath,
    localFileName: null,
    publicUrl,
    url: publicUrl,
    downloadUrl: item.downloadUrl || item.download_url || publicUrl,
    contentType,
    mimeType: contentType,
    duration: Number.isFinite(item.duration) ? item.duration : null
  };
}

async function listLocalVideos(allowedPrefixes = []) {
  ensureLocalMediaDir();
  const entries = await fs.promises.readdir(LOCAL_MEDIA_DIR, { withFileTypes: true });
  const videos = [];
  for (const entry of entries) {
    if (!entry.isFile() || !VIDEO_EXTENSIONS.has(safeExtension(entry.name, ''))) continue;
    if (allowedPrefixes.length && !allowedPrefixes.some(prefix => entry.name.startsWith(prefix))) continue;
    const filePath = path.join(LOCAL_MEDIA_DIR, entry.name);
    const stat = await fs.promises.stat(filePath);
    const url = localMediaUrl(entry.name);
    videos.push({
      type: 'video',
      storageProvider: 'local',
      fileName: entry.name,
      name: entry.name,
      storagePath: null,
      localFileName: entry.name,
      publicUrl: null,
      url,
      downloadUrl: url,
      size: stat.size,
      duration: null,
      contentType: inferContentType(entry.name, 'video/mp4'),
      mimeType: inferContentType(entry.name, 'video/mp4'),
      createdAt: stat.birthtime.toISOString()
    });
  }
  return videos.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function listVideoAssets(owner) {
  const safeOwner = sanitizeOwnerSegment(owner);
  const folder = getOwnerFolder(safeOwner, 'videos');
  const localPrefixes = [`video_${safeOwner}_`, `merged_${safeOwner}_`];
  let remoteVideos = [];
  let warning = '';

  if (storageIsConfigured() && typeof supabaseStorageService.listMediaFiles === 'function') {
    try {
      const result = await supabaseStorageService.listMediaFiles(folder);
      if (result?.success) {
        remoteVideos = (result.items || result.files || [])
          .map(item => normalizeRemoteVideo(item, folder))
          .filter(Boolean);
      } else {
        warning = result?.error || 'Không thể liệt kê video trên Supabase';
      }
    } catch (error) {
      warning = error.message;
    }
  } else {
    warning = 'Supabase chưa được cấu hình';
  }

  const localVideos = await listLocalVideos(localPrefixes);
  return {
    videos: [...remoteVideos, ...localVideos],
    warning: warning ? `${warning}. Danh sách vẫn bao gồm các file local.` : null
  };
}

module.exports = {
  AUDIO_EXTENSIONS,
  CONTENT_TYPES,
  LOCAL_MEDIA_DIR,
  MediaStudioError,
  VIDEO_EXTENSIONS,
  cleanupWorkspace,
  createWorkspace,
  ensureLocalMediaDir,
  extensionForVideoUpload,
  extractAudioFromUrl,
  getMaxUploadBytes,
  getOwnerFolder,
  inferContentType,
  listVideoAssets,
  makeSafeFileName,
  materializeMediaReference,
  mergeVideoWithAudio,
  persistMediaFile,
  probeMedia,
  removeAudioSegment,
  resolveLocalMediaPath,
  safeExtension,
  sanitizeOwnerSegment,
  storageIsConfigured,
  throwIfAborted,
  validateResolvedSourceUrl,
  validateSourceUrl
};
