#!/usr/bin/env node

const { createHash } = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_VERSION = '2026.07.04';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BINARY_DIR = path.join(PROJECT_ROOT, 'vendor', 'bin');
const BINARY_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const BINARY_PATH = path.join(BINARY_DIR, BINARY_NAME);
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

function isDisabled(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());
}

function isMuslLinux() {
  if (process.platform !== 'linux') return false;
  const report = process.report?.getReport?.();
  return !report?.header?.glibcVersionRuntime;
}

function releaseAsset() {
  if (process.platform === 'darwin' && ['x64', 'arm64'].includes(process.arch)) {
    return 'yt-dlp_macos';
  }

  if (process.platform === 'win32') {
    if (process.arch === 'x64') return 'yt-dlp.exe';
    if (process.arch === 'arm64') return 'yt-dlp_arm64.exe';
  }

  if (process.platform === 'linux') {
    const musl = isMuslLinux();
    if (process.arch === 'x64') return musl ? 'yt-dlp_musllinux' : 'yt-dlp_linux';
    if (process.arch === 'arm64') return musl ? 'yt-dlp_musllinux_aarch64' : 'yt-dlp_linux_aarch64';
  }

  throw new Error(`Chưa hỗ trợ tự cài yt-dlp cho ${process.platform}/${process.arch}`);
}

function commandVersion(command) {
  const result = spawnSync(command, ['--ignore-config', '--version'], {
    encoding: 'utf8',
    shell: false,
    timeout: 15_000,
    windowsHide: true
  });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function assertSafeVersion(version) {
  if (!/^[A-Za-z0-9._@-]+$/.test(version)) {
    throw new Error('YTDLP_VERSION chứa ký tự không hợp lệ');
  }
}

function download(url, redirectCount = 0) {
  if (redirectCount > 8) {
    return Promise.reject(new Error('Quá nhiều lần chuyển hướng khi tải yt-dlp'));
  }

  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:') {
    return Promise.reject(new Error('Chỉ cho phép tải yt-dlp qua HTTPS'));
  }

  return new Promise((resolve, reject) => {
    const request = https.get(parsedUrl, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'tool-auto-create-page-installer'
      }
    }, (response) => {
      const statusCode = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
        response.resume();
        const redirectedUrl = new URL(response.headers.location, parsedUrl).href;
        download(redirectedUrl, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`GitHub trả về HTTP ${statusCode} cho ${parsedUrl.pathname}`));
        return;
      }

      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
        response.resume();
        reject(new Error('File yt-dlp vượt quá giới hạn tải xuống'));
        return;
      }

      const chunks = [];
      let totalBytes = 0;
      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_DOWNLOAD_BYTES) {
          response.destroy(new Error('File yt-dlp vượt quá giới hạn tải xuống'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });

    request.setTimeout(60_000, () => {
      request.destroy(new Error('Hết thời gian tải yt-dlp từ GitHub'));
    });
    request.on('error', reject);
  });
}

function expectedChecksum(checksumText, asset) {
  for (const rawLine of checksumText.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(rawLine);
    if (match && match[2] === asset) return match[1].toLowerCase();
  }
  throw new Error(`Không tìm thấy checksum chính thức cho ${asset}`);
}

async function install() {
  if (isDisabled(process.env.YTDLP_AUTO_INSTALL)) {
    console.log('[yt-dlp] Bỏ qua tự cài đặt vì YTDLP_AUTO_INSTALL đã tắt.');
    return;
  }

  const configuredPath = String(process.env.YTDLP_PATH || '')
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2');
  const configuredIsExplicitPath = path.isAbsolute(configuredPath) ||
    configuredPath.includes('/') ||
    configuredPath.includes('\\');
  if (configuredIsExplicitPath && commandVersion(configuredPath)) {
    console.log(`[yt-dlp] Dùng binary đã cấu hình tại ${configuredPath}.`);
    return;
  }

  const version = String(process.env.YTDLP_VERSION || DEFAULT_VERSION).trim();
  assertSafeVersion(version);

  const installedVersion = commandVersion(BINARY_PATH);
  const forceDownload = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.YTDLP_FORCE_DOWNLOAD || '').trim().toLowerCase()
  );
  if (!forceDownload && installedVersion === version) {
    console.log(`[yt-dlp] Đã có phiên bản ${installedVersion} tại vendor/bin.`);
    return;
  }

  const asset = releaseAsset();
  const releaseBaseUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}`;
  console.log(`[yt-dlp] Đang tải ${asset} phiên bản ${version}...`);

  const [checksumBuffer, binaryBuffer] = await Promise.all([
    download(`${releaseBaseUrl}/SHA2-256SUMS`),
    download(`${releaseBaseUrl}/${asset}`)
  ]);
  const wantedHash = expectedChecksum(checksumBuffer.toString('utf8'), asset);
  const actualHash = createHash('sha256').update(binaryBuffer).digest('hex');
  if (actualHash !== wantedHash) {
    throw new Error(`Checksum của ${asset} không khớp với bản phát hành chính thức`);
  }

  fs.mkdirSync(BINARY_DIR, { recursive: true });
  const temporaryName = process.platform === 'win32'
    ? `yt-dlp.${process.pid}.tmp.exe`
    : `yt-dlp.${process.pid}.tmp`;
  const temporaryPath = path.join(BINARY_DIR, temporaryName);
  try {
    fs.writeFileSync(temporaryPath, binaryBuffer, { mode: 0o755 });
    fs.chmodSync(temporaryPath, 0o755);

    const verifiedVersion = commandVersion(temporaryPath);
    if (verifiedVersion !== version) {
      throw new Error(`Binary vừa cài trả về phiên bản không đúng: ${verifiedVersion || 'không chạy được'}`);
    }

    if (process.platform === 'win32' && fs.existsSync(BINARY_PATH)) {
      const backupPath = path.join(BINARY_DIR, `yt-dlp.${process.pid}.backup.exe`);
      fs.rmSync(backupPath, { force: true });
      fs.renameSync(BINARY_PATH, backupPath);
      try {
        fs.renameSync(temporaryPath, BINARY_PATH);
      } catch (error) {
        if (!fs.existsSync(BINARY_PATH) && fs.existsSync(backupPath)) {
          fs.renameSync(backupPath, BINARY_PATH);
        }
        throw error;
      }
      try { fs.rmSync(backupPath, { force: true }); } catch {}
    } else {
      fs.renameSync(temporaryPath, BINARY_PATH);
    }
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }

  console.log(`[yt-dlp] Đã cài và xác minh ${version} tại ${BINARY_PATH}.`);
}

install().catch((error) => {
  console.error(`[yt-dlp] Cài đặt thất bại: ${error.message}`);
  console.error('[yt-dlp] Nếu server tự quản lý binary, đặt YTDLP_PATH chính xác hoặc YTDLP_AUTO_INSTALL=0.');
  process.exitCode = 1;
});
