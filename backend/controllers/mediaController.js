const fs = require('fs');
const path = require('path');
const mediaStudioService = require('../services/mediaStudioService');
const supabaseStorageService = require('../services/supabaseStorageService');
const speechToTextService = require('../services/speechToTextService');

let activeProcessingJobs = 0;

function getMaxConcurrentJobs() {
  const configured = Number.parseInt(process.env.MEDIA_MAX_CONCURRENT_JOBS || '', 10);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 2;
}

function acquireProcessingSlot() {
  if (activeProcessingJobs >= getMaxConcurrentJobs()) {
    throw new mediaStudioService.MediaStudioError(
      'Hệ thống đang xử lý tối đa số tác vụ media. Vui lòng thử lại sau ít phút.',
      429,
      'MEDIA_BUSY'
    );
  }
  activeProcessingJobs += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeProcessingJobs = Math.max(0, activeProcessingJobs - 1);
  };
}

function createRequestAbortContext(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  const handleResponseClose = () => {
    if (!res.writableEnded) abort();
  };

  req.once?.('aborted', abort);
  res.once?.('close', handleResponseClose);
  return {
    signal: controller.signal,
    dispose() {
      req.off?.('aborted', abort);
      res.off?.('close', handleResponseClose);
    }
  };
}

function ownerFromRequest(req) {
  return mediaStudioService.sanitizeOwnerSegment(req.user?.username || 'admin');
}

function joinWarnings(...warnings) {
  const values = warnings
    .flat()
    .map(value => String(value || '').trim())
    .filter(Boolean);
  return values.length ? values.join(' ') : null;
}

function sendError(res, error, action) {
  const statusCode = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600
    ? error.statusCode
    : 500;
  const message = error?.message || 'Không thể xử lý media';
  console.error(`[MediaStudio] ${action}:`, message);
  if (res.destroyed || res.closed) return;
  if (!res.headersSent) {
    res.status(statusCode).json({
      success: false,
      error: message,
      code: error?.code || 'MEDIA_STUDIO_ERROR'
    });
  }
}

function decodeOriginalFileName(headerValue) {
  let value = String(headerValue || 'video.mp4').trim();
  try {
    value = decodeURIComponent(value);
  } catch {}
  value = value.replace(/\\/g, '/');
  value = Array.from(path.posix.basename(value))
    .filter(character => {
      const codePoint = character.codePointAt(0);
      return codePoint >= 32 && codePoint !== 127;
    })
    .join('')
    .trim();
  return value.slice(0, 240) || 'video.mp4';
}

function normalizeRawBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  return null;
}

async function writeRequestBodyToFile(req, destination, maxBytes) {
  const declaredLength = Number(req.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new mediaStudioService.MediaStudioError(
      `Video vượt quá giới hạn ${maxBytes} bytes`,
      413,
      'UPLOAD_TOO_LARGE'
    );
  }

  const parsedBody = normalizeRawBuffer(req.body);
  const fileHandle = await fs.promises.open(destination, 'wx');
  let totalBytes = 0;

  const writeChunk = async (rawChunk) => {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw new mediaStudioService.MediaStudioError(
        `Video vượt quá giới hạn ${maxBytes} bytes`,
        413,
        'UPLOAD_TOO_LARGE'
      );
    }

    let offset = 0;
    while (offset < chunk.length) {
      const { bytesWritten } = await fileHandle.write(chunk, offset, chunk.length - offset, null);
      if (!bytesWritten) throw new Error('Không thể ghi dữ liệu video tải lên');
      offset += bytesWritten;
    }
  };

  try {
    if (parsedBody) {
      await writeChunk(parsedBody);
    } else {
      for await (const chunk of req) {
        await writeChunk(chunk);
      }
    }
  } catch (error) {
    await fileHandle.close().catch(() => {});
    await fs.promises.unlink(destination).catch(() => {});
    throw error;
  }

  await fileHandle.close();
  if (totalBytes === 0) {
    await fs.promises.unlink(destination).catch(() => {});
    throw new mediaStudioService.MediaStudioError('Dữ liệu video tải lên đang rỗng');
  }
  return totalBytes;
}

async function extractAudio(req, res) {
  let workspace = '';
  let releaseSlot = () => {};
  const abortContext = createRequestAbortContext(req, res);
  const type = req.body?.type || 'audio'; // 'audio', 'video_silent', 'video_full'
  const downloadId = req.body?.downloadId;
  try {
    releaseSlot = acquireProcessingSlot();
    const sourceUrl = req.body?.url || req.body?.sourceUrl;
    const owner = ownerFromRequest(req);
    workspace = await mediaStudioService.createWorkspace();

    const onProgress = downloadId ? (line) => {
      const match = line.match(/\[download\]\s+([0-9.]+)(?:%|\s+percent)/i);
      if (match) {
        const percent = parseFloat(match[1]);
        if (!isNaN(percent)) {
          global.downloadProgressMap = global.downloadProgressMap || new Map();
          global.downloadProgressMap.set(downloadId, percent);
        }
      }
    } : undefined;

    if (type === 'audio') {
      const extracted = await mediaStudioService.extractAudioFromUrl(
        sourceUrl,
        workspace,
        onProgress,
        abortContext.signal
      );
      mediaStudioService.throwIfAborted(abortContext.signal);
      const fileName = mediaStudioService.makeSafeFileName(`audio_${owner}`, '.mp3');
      const persisted = await mediaStudioService.persistMediaFile(extracted.filePath, {
        folder: mediaStudioService.getOwnerFolder(owner, 'audio'),
        fileName,
        prefix: `audio_${owner}`,
        kind: 'audio',
        contentType: 'audio/mpeg',
        duration: extracted.probe.duration,
        signal: abortContext.signal,
        forceLocal: true
      });

      return res.json({
        success: true,
        audio: {
          ...persisted.asset,
          sourceUrl: extracted.sourceUrl
        },
        video: null,
        warning: persisted.warning
      });
    } else if (type === 'video_silent') {
      const extracted = await mediaStudioService.extractVideoNoAudioFromUrl(
        sourceUrl,
        workspace,
        onProgress,
        abortContext.signal
      );
      mediaStudioService.throwIfAborted(abortContext.signal);
      const fileName = mediaStudioService.makeSafeFileName(`video_${owner}_silent`, '.mp4');
      const persisted = await mediaStudioService.persistMediaFile(extracted.filePath, {
        folder: mediaStudioService.getOwnerFolder(owner, 'videos'),
        fileName,
        prefix: `video_${owner}`,
        kind: 'video',
        contentType: 'video/mp4',
        duration: extracted.probe.duration,
        signal: abortContext.signal,
        forceLocal: true
      });

      return res.json({
        success: true,
        audio: null,
        video: {
          ...persisted.asset,
          sourceUrl: extracted.sourceUrl
        },
        warning: persisted.warning
      });
    } else if (type === 'video_full') {
      const extracted = await mediaStudioService.extractFullVideoFromUrl(
        sourceUrl,
        workspace,
        onProgress,
        abortContext.signal
      );
      mediaStudioService.throwIfAborted(abortContext.signal);
      const fileName = mediaStudioService.makeSafeFileName(`video_${owner}_full`, '.mp4');
      const persisted = await mediaStudioService.persistMediaFile(extracted.filePath, {
        folder: mediaStudioService.getOwnerFolder(owner, 'videos'),
        fileName,
        prefix: `video_${owner}`,
        kind: 'video',
        contentType: 'video/mp4',
        duration: extracted.probe.duration,
        signal: abortContext.signal,
        forceLocal: true
      });

      return res.json({
        success: true,
        audio: null,
        video: {
          ...persisted.asset,
          sourceUrl: extracted.sourceUrl
        },
        warning: persisted.warning
      });
    } else {
      throw new Error('Loại trích xuất không hợp lệ');
    }
  } catch (error) {
    const actionLabel = type === 'audio' ? 'Tách âm thanh' : type === 'video_silent' ? 'Tách video câm' : 'Tải video';
    return sendError(res, error, `${actionLabel} thất bại`);
  } finally {
    if (downloadId && global.downloadProgressMap) {
      global.downloadProgressMap.delete(downloadId);
    }
    await mediaStudioService.cleanupWorkspace(workspace);
    abortContext.dispose();
    releaseSlot();
  }
}

async function removeAudioSegment(req, res) {
  let workspace = '';
  let releaseSlot = () => {};
  const abortContext = createRequestAbortContext(req, res);
  try {
    releaseSlot = acquireProcessingSlot();
    const owner = ownerFromRequest(req);
    const audioReference = req.body?.audio || req.body?.audioRef || {
      storagePath: req.body?.storagePath,
      localFileName: req.body?.localFileName
    };
    const start = req.body?.start ?? req.body?.startTime;
    const end = req.body?.end ?? req.body?.endTime;
    workspace = await mediaStudioService.createWorkspace();

    const materialized = await mediaStudioService.materializeMediaReference(audioReference, workspace, {
      allowedFolder: mediaStudioService.getOwnerFolder(owner, 'audio'),
      allowedLocalPrefixes: [`audio_${owner}_`, `audio_edit_${owner}_`],
      fallbackExtension: '.mp3'
    });
    mediaStudioService.throwIfAborted(abortContext.signal);
    const outputPath = path.join(workspace, mediaStudioService.makeSafeFileName('edited', '.mp3'));
    const edited = await mediaStudioService.removeAudioSegment(
      materialized.filePath,
      outputPath,
      start,
      end,
      abortContext.signal
    );
    mediaStudioService.throwIfAborted(abortContext.signal);

    const fileName = mediaStudioService.makeSafeFileName(`audio_edit_${owner}`, '.mp3');
    const persisted = await mediaStudioService.persistMediaFile(edited.filePath, {
      folder: mediaStudioService.getOwnerFolder(owner, 'audio'),
      fileName,
      prefix: `audio_edit_${owner}`,
      kind: 'audio',
      contentType: 'audio/mpeg',
      duration: edited.probe.duration,
      signal: abortContext.signal,
      forceLocal: true
    });

    return res.json({
      success: true,
      audio: {
        ...persisted.asset,
        removedSegment: edited.removed
      },
      warning: joinWarnings(materialized.warning, persisted.warning)
    });
  } catch (error) {
    return sendError(res, error, 'Xoá đoạn âm thanh thất bại');
  } finally {
    await mediaStudioService.cleanupWorkspace(workspace);
    abortContext.dispose();
    releaseSlot();
  }
}

async function uploadVideo(req, res) {
  let workspace = '';
  let releaseSlot = () => {};
  const abortContext = createRequestAbortContext(req, res);
  try {
    releaseSlot = acquireProcessingSlot();
    const owner = ownerFromRequest(req);
    const originalName = decodeOriginalFileName(req.get('x-file-name'));
    const requestedContentType = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const extension = mediaStudioService.extensionForVideoUpload(originalName, requestedContentType);
    workspace = await mediaStudioService.createWorkspace();
    const inputPath = path.join(workspace, mediaStudioService.makeSafeFileName('upload', extension));
    await writeRequestBodyToFile(req, inputPath, mediaStudioService.getMaxUploadBytes());

    const probe = await mediaStudioService.probeMedia(inputPath, abortContext.signal);
    if (!probe.hasVideo || probe.duration <= 0) {
      throw new mediaStudioService.MediaStudioError(
        'File tải lên không chứa luồng video hợp lệ',
        422,
        'VIDEO_STREAM_MISSING'
      );
    }

    mediaStudioService.throwIfAborted(abortContext.signal);
    const contentType = requestedContentType.startsWith('video/')
      ? requestedContentType
      : mediaStudioService.inferContentType(`video${extension}`, 'video/mp4');
    const originalBaseName = path.parse(originalName).name || 'video';
    const fileName = mediaStudioService.makeSafeFileName(
      `video_${owner}_${originalBaseName}`,
      extension
    );
    const persisted = await mediaStudioService.persistMediaFile(inputPath, {
      folder: mediaStudioService.getOwnerFolder(owner, 'videos'),
      fileName,
      prefix: `video_${owner}`,
      kind: 'video',
      contentType,
      duration: probe.duration,
      originalName,
      forceLocal: true,
      signal: abortContext.signal
    });

    return res.status(201).json({
      success: true,
      video: persisted.asset,
      warning: persisted.warning
    });
  } catch (error) {
    return sendError(res, error, 'Tải video lên thất bại');
  } finally {
    await mediaStudioService.cleanupWorkspace(workspace);
    abortContext.dispose();
    releaseSlot();
  }
}

async function uploadWatermark(req, res) {
  let workspace = '';
  let releaseSlot = () => {};
  const abortContext = createRequestAbortContext(req, res);
  try {
    releaseSlot = acquireProcessingSlot();
    const owner = ownerFromRequest(req);
    const originalName = decodeOriginalFileName(req.get('x-file-name'));
    const requestedContentType = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = path.extname(originalName).toLowerCase() || '.png';

    const allowedImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
    if (!allowedImageExtensions.has(ext)) {
      throw new mediaStudioService.MediaStudioError(
        'File tải lên không phải là ảnh hợp lệ (chỉ hỗ trợ .png, .jpg, .jpeg, .webp)',
        422,
        'INVALID_IMAGE_TYPE'
      );
    }

    workspace = await mediaStudioService.createWorkspace();
    const inputPath = path.join(workspace, mediaStudioService.makeSafeFileName('watermark', ext));
    await writeRequestBodyToFile(req, inputPath, mediaStudioService.getMaxUploadBytes());

    mediaStudioService.throwIfAborted(abortContext.signal);
    const contentType = requestedContentType.startsWith('image/')
      ? requestedContentType
      : (ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg');

    const originalBaseName = path.parse(originalName).name || 'watermark';
    const fileName = mediaStudioService.makeSafeFileName(
      `watermark_${owner}_${originalBaseName}`,
      ext
    );
    const persisted = await mediaStudioService.persistMediaFile(inputPath, {
      folder: mediaStudioService.getOwnerFolder(owner, 'videos'),
      fileName,
      prefix: `watermark_${owner}`,
      kind: 'image',
      contentType,
      originalName,
      forceLocal: true,
      signal: abortContext.signal
    });

    return res.status(201).json({
      success: true,
      watermark: persisted.asset,
      warning: persisted.warning
    });
  } catch (error) {
    return sendError(res, error, 'Tải ảnh watermark thất bại');
  } finally {
    await mediaStudioService.cleanupWorkspace(workspace);
    abortContext.dispose();
    releaseSlot();
  }
}

async function listVideos(req, res) {
  try {
    const owner = ownerFromRequest(req);
    const result = await mediaStudioService.listVideoAssets(owner);
    return res.json({
      success: true,
      videos: result.videos,
      warning: result.warning
    });
  } catch (error) {
    return sendError(res, error, 'Không thể liệt kê video');
  }
}

async function mergeMedia(req, res) {
  let workspace = '';
  let releaseSlot = () => {};
  const abortContext = createRequestAbortContext(req, res);
  try {
    releaseSlot = acquireProcessingSlot();
    const owner = ownerFromRequest(req);
    const mode = req.body?.mode || 'replace';
    if (mode !== 'replace') {
      throw new mediaStudioService.MediaStudioError('Hiện tại chỉ hỗ trợ chế độ thay thế âm thanh');
    }

    // Hỗ trợ cả videos[] (mảng) lẫn video (đơn) - backward compatible
    const videosBody = req.body?.videos;
    const videoBody = req.body?.video;
    const isMultiVideo = Array.isArray(videosBody) && videosBody.length > 0;

    if (!isMultiVideo && !videoBody) {
      throw new mediaStudioService.MediaStudioError('Vui lòng chọn đủ video và âm thanh');
    }
    if (!req.body?.audio) {
      throw new mediaStudioService.MediaStudioError('Vui lòng chọn âm thanh trước khi ghép');
    }

    workspace = await mediaStudioService.createWorkspace();

    const audioInput = await mediaStudioService.materializeMediaReference(req.body.audio, workspace, {
      allowedFolder: mediaStudioService.getOwnerFolder(owner, 'audio'),
      allowedLocalPrefixes: [`audio_${owner}_`, `audio_edit_${owner}_`],
      fallbackExtension: '.mp3'
    });

    let watermarkInput = null;
    if (req.body?.watermark) {
      watermarkInput = await mediaStudioService.materializeMediaReference(req.body.watermark, workspace, {
        allowedFolder: mediaStudioService.getOwnerFolder(owner, 'videos'),
        allowedLocalPrefixes: [`watermark_${owner}_`],
        fallbackExtension: '.png'
      });
    }
    mediaStudioService.throwIfAborted(abortContext.signal);

    const outputPath = path.join(workspace, mediaStudioService.makeSafeFileName('merged', '.mp4'));
    let merged;
    const inputWarnings = [audioInput.warning, watermarkInput?.warning];

    if (isMultiVideo) {
      // --- MULTI VIDEO: concat + lặp theo thời lượng âm thanh ---
      const allowedLocalPrefixes = [
        `video_${owner}_`, `video_silent_${owner}_`,
        `merged_${owner}_`
      ];
      const videoInputs = await Promise.all(
        videosBody.map(ref =>
          mediaStudioService.materializeMediaReference(ref, workspace, {
            allowedFolder: mediaStudioService.getOwnerFolder(owner, 'videos'),
            allowedLocalPrefixes,
            fallbackExtension: '.mp4'
          })
        )
      );
      mediaStudioService.throwIfAborted(abortContext.signal);
      const videoPaths = videoInputs.map(v => v.filePath);
      videoInputs.forEach(v => inputWarnings.push(v.warning));

      merged = await mediaStudioService.mergeMultipleVideosWithAudio(
        videoPaths,
        audioInput.filePath,
        outputPath,
        watermarkInput ? watermarkInput.filePath : null,
        abortContext.signal
      );
    } else {
      // --- SINGLE VIDEO: luồng cũ ---
      const videoInput = await mediaStudioService.materializeMediaReference(videoBody, workspace, {
        allowedFolder: mediaStudioService.getOwnerFolder(owner, 'videos'),
        allowedLocalPrefixes: [
          `video_${owner}_`, `video_silent_${owner}_`,
          `merged_${owner}_`
        ],
        fallbackExtension: '.mp4'
      });
      inputWarnings.push(videoInput.warning);
      mediaStudioService.throwIfAborted(abortContext.signal);

      merged = await mediaStudioService.mergeVideoWithAudio(
        videoInput.filePath,
        audioInput.filePath,
        outputPath,
        watermarkInput ? watermarkInput.filePath : null,
        abortContext.signal
      );
    }

    mediaStudioService.throwIfAborted(abortContext.signal);
    const fileName = mediaStudioService.makeSafeFileName(`merged_${owner}`, '.mp4');
    const persisted = await mediaStudioService.persistMediaFile(merged.filePath, {
      folder: mediaStudioService.getOwnerFolder(owner, 'videos'),
      fileName,
      prefix: `merged_${owner}`,
      kind: 'video',
      contentType: 'video/mp4',
      duration: merged.probe.duration,
      signal: abortContext.signal,
      forceLocal: true  // Giữ local để user tải về máy trực tiếp; bấm "Lưu Supabase" nếu cần
    });

    return res.json({
      success: true,
      video: persisted.asset,
      warning: joinWarnings(...inputWarnings, persisted.warning)
    });
  } catch (error) {
    return sendError(res, error, 'Ghép video và âm thanh thất bại');
  } finally {
    await mediaStudioService.cleanupWorkspace(workspace);
    abortContext.dispose();
    releaseSlot();
  }
}

function parseByteRange(rangeHeader, fileSize) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!match || (!match[1] && !match[2])) return false;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : fileSize - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return false;
    end = Math.min(end, fileSize - 1);
  }

  if (start < 0 || start >= fileSize || end < start) return false;
  return { start, end };
}

async function serveLocalMedia(req, res) {
  try {
    const requestedName = req.params?.filename || req.query?.filename;
    let decodedName = String(requestedName || '');
    try {
      decodedName = decodeURIComponent(decodedName);
    } catch (_) {}
    const extension = mediaStudioService.safeExtension(decodedName, '');
    const generatedNamePattern = /^(?:audio|audio_edit|video|merged|watermark)_[\p{L}\p{N}._-]+_\d{10,}_[a-f0-9]{32}\.[a-z0-9]{1,8}$/iu;
    const allowedExtension = mediaStudioService.AUDIO_EXTENSIONS.has(extension) ||
      mediaStudioService.VIDEO_EXTENSIONS.has(extension) ||
      ['.png', '.jpg', '.jpeg', '.webp'].includes(extension);
    if (!generatedNamePattern.test(decodedName) || !allowedExtension) {
      return res.status(403).send('Tên file media không được phép truy cập');
    }
    const filePath = await mediaStudioService.resolveLocalMediaPath(decodedName);
    const stat = await fs.promises.stat(filePath);
    if (stat.size <= 0) {
      return res.status(404).send('File media rỗng');
    }

    const fileName = path.basename(filePath);
    const contentType = mediaStudioService.inferContentType(fileName);
    const range = parseByteRange(req.headers.range, stat.size);

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const asciiName = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    // ?dl=1 → attachment (tải về máy); không có → inline (cho video player preview)
    const disposition = req.query?.dl === '1' ? 'attachment' : 'inline';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );

    if (range === false) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.end();
    }

    const streamOptions = {};
    if (range) {
      streamOptions.start = range.start;
      streamOptions.end = range.end;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
      res.setHeader('Content-Length', range.end - range.start + 1);
    } else {
      res.status(200);
      res.setHeader('Content-Length', stat.size);
    }

    if (req.method === 'HEAD') return res.end();

    const stream = fs.createReadStream(filePath, streamOptions);
    stream.on('error', (error) => {
      console.error('[MediaStudio] Lỗi stream file local:', error.message);
      if (!res.headersSent) res.status(500).end();
      else res.destroy(error);
    });
    res.on('close', () => stream.destroy());
    return stream.pipe(res);
  } catch (error) {
    if (error?.statusCode === 404) return res.status(404).send(error.message);
    if (error?.statusCode === 400 || error?.statusCode === 403) return res.status(error.statusCode).send(error.message);
    console.error('[MediaStudio] Không thể phục vụ file local:', error.message);
    return res.status(500).send('Không thể đọc file media');
  }
}

async function persistRemoteMedia(req, res) {
  const abortContext = createRequestAbortContext(req, res);
  try {
    const owner = ownerFromRequest(req);
    const { localFileName, kind } = req.body;
    if (!localFileName || !kind) {
      throw new mediaStudioService.MediaStudioError('Thiếu thông tin tệp tin cần lưu', 400);
    }
    if (!['audio', 'video'].includes(kind)) {
      throw new mediaStudioService.MediaStudioError('Loại tệp tin không hợp lệ', 400);
    }

    const localFilePath = path.join(mediaStudioService.LOCAL_MEDIA_DIR, localFileName);
    if (!fs.existsSync(localFilePath)) {
      throw new mediaStudioService.MediaStudioError('Không tìm thấy tệp tin cục bộ trên server', 404);
    }

    const probe = await mediaStudioService.probeMedia(localFilePath, abortContext.signal);
    mediaStudioService.throwIfAborted(abortContext.signal);

    const folderMap = { audio: 'audio', video: 'videos' };
    const prefixMap = { audio: `audio_${owner}`, video: `video_silent_${owner}` };
    const contentTypeMap = { audio: 'audio/mpeg', video: 'video/mp4' };

    const persisted = await mediaStudioService.persistMediaFile(localFilePath, {
      folder: mediaStudioService.getOwnerFolder(owner, folderMap[kind]),
      fileName: localFileName,
      prefix: prefixMap[kind],
      kind,
      contentType: contentTypeMap[kind],
      duration: probe.duration,
      signal: abortContext.signal,
      requireRemote: true
    });

    await fs.promises.unlink(localFilePath).catch(() => {});

    return res.json({
      success: true,
      asset: persisted.asset
    });
  } catch (error) {
    return sendError(res, error, 'Lưu tệp lên Supabase thất bại');
  } finally {
    abortContext.dispose();
  }
}

async function deleteMedia(req, res) {
  try {
    const owner = ownerFromRequest(req);
    const { localFileName, storagePath } = req.body;
    let { storageProvider } = req.body;

    // Tự động suy luận storageProvider nếu thiếu
    if (!storageProvider) {
      if (storagePath) {
        storageProvider = 'supabase';
      } else if (localFileName) {
        storageProvider = 'local';
      }
    }

    if (storageProvider === 'local') {
      if (!localFileName) {
        throw new mediaStudioService.MediaStudioError('Thiếu tên file cần xoá', 400);
      }
      const ownerSegment = mediaStudioService.sanitizeOwnerSegment(owner);
      if (!localFileName.includes(`_${ownerSegment}_`) && !localFileName.startsWith(`audio_${ownerSegment}`) && !localFileName.startsWith(`video_silent_${ownerSegment}`)) {
        throw new mediaStudioService.MediaStudioError('Không có quyền xoá file này', 403);
      }
      const filePath = path.join(mediaStudioService.LOCAL_MEDIA_DIR, localFileName);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      return res.json({ success: true, message: 'Đã xoá file cục bộ trên server' });
    } else if (storageProvider === 'supabase') {
      if (!storagePath) {
        throw new mediaStudioService.MediaStudioError('Thiếu đường dẫn lưu trữ Supabase', 400);
      }
      const allowedFolder = mediaStudioService.getOwnerFolder(owner, 'videos');
      const audioFolder = mediaStudioService.getOwnerFolder(owner, 'audio');
      
      const normalizedPath = String(storagePath).trim().replace(/\\/g, '/').replace(/^\/+/, '');
      if (!normalizedPath.startsWith(`${allowedFolder}/`) && !normalizedPath.startsWith(`${audioFolder}/`)) {
        throw new mediaStudioService.MediaStudioError('Không có quyền xoá file này', 403);
      }
      
      const result = await supabaseStorageService.deleteMediaFile(storagePath);
      if (!result?.success) {
        throw new mediaStudioService.MediaStudioError(result?.error || 'Không thể xoá file trên Supabase', 502);
      }

      // Dọn dẹp cả file local nếu có tồn tại đĩa cục bộ để tránh bị load lại
      if (localFileName) {
        const filePath = path.join(mediaStudioService.LOCAL_MEDIA_DIR, localFileName);
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath).catch(() => {});
        }
      }

      return res.json({ success: true, message: 'Đã xoá file trên Supabase thành công' });
    } else {
      throw new mediaStudioService.MediaStudioError('Nhà cung cấp lưu trữ không hợp lệ', 400);
    }
  } catch (error) {
    return sendError(res, error, 'Xoá file thất bại');
  }
}

async function transcribeAudio(req, res) {
  let workspace = '';
  let releaseSlot = () => {};
  const abortContext = createRequestAbortContext(req, res);
  try {
    releaseSlot = acquireProcessingSlot();
    const owner = ownerFromRequest(req);
    const audioReference = req.body?.audio || req.body?.audioRef || {
      storagePath: req.body?.storagePath,
      localFileName: req.body?.localFileName
    };
    workspace = await mediaStudioService.createWorkspace();

    const materialized = await mediaStudioService.materializeMediaReference(audioReference, workspace, {
      allowedFolder: mediaStudioService.getOwnerFolder(owner, 'audio'),
      allowedLocalPrefixes: [`audio_${owner}_`, `audio_edit_${owner}_`],
      fallbackExtension: '.mp3'
    });
    mediaStudioService.throwIfAborted(abortContext.signal);

    const transcript = await speechToTextService.transcribeAudioFile(materialized.filePath);

    return res.json({
      success: true,
      transcript,
      warning: materialized.warning
    });
  } catch (error) {
    return sendError(res, error, 'Chuyển đổi giọng nói thành văn bản thất bại');
  } finally {
    await mediaStudioService.cleanupWorkspace(workspace);
    abortContext.dispose();
    releaseSlot();
  }
}

async function removeAudioSegments(req, res) {
  let workspace = '';
  let releaseSlot = () => {};
  const abortContext = createRequestAbortContext(req, res);
  try {
    releaseSlot = acquireProcessingSlot();
    const owner = ownerFromRequest(req);
    const audioReference = req.body?.audio || req.body?.audioRef || {
      storagePath: req.body?.storagePath,
      localFileName: req.body?.localFileName
    };
    const deletedRanges = req.body?.deletedRanges || [];
    workspace = await mediaStudioService.createWorkspace();

    const materialized = await mediaStudioService.materializeMediaReference(audioReference, workspace, {
      allowedFolder: mediaStudioService.getOwnerFolder(owner, 'audio'),
      allowedLocalPrefixes: [`audio_${owner}_`, `audio_edit_${owner}_`],
      fallbackExtension: '.mp3'
    });
    mediaStudioService.throwIfAborted(abortContext.signal);

    const outputPath = path.join(workspace, mediaStudioService.makeSafeFileName('edited', '.mp3'));
    const edited = await mediaStudioService.removeAudioSegments(
      materialized.filePath,
      outputPath,
      deletedRanges,
      abortContext.signal
    );
    mediaStudioService.throwIfAborted(abortContext.signal);

    const fileName = mediaStudioService.makeSafeFileName(`audio_edit_${owner}`, '.mp3');
    const persisted = await mediaStudioService.persistMediaFile(edited.filePath, {
      folder: mediaStudioService.getOwnerFolder(owner, 'audio'),
      fileName,
      prefix: `audio_edit_${owner}`,
      kind: 'audio',
      contentType: 'audio/mpeg',
      duration: edited.probe.duration,
      signal: abortContext.signal,
      forceLocal: true
    });

    return res.json({
      success: true,
      audio: {
        ...persisted.asset,
        removedSegments: edited.deletedRanges
      },
      warning: joinWarnings(materialized.warning, persisted.warning)
    });
  } catch (error) {
    return sendError(res, error, 'Cắt các đoạn âm thanh thất bại');
  } finally {
    await mediaStudioService.cleanupWorkspace(workspace);
    abortContext.dispose();
    releaseSlot();
  }
}

async function getDownloadProgress(req, res) {
  const { downloadId } = req.params;
  global.downloadProgressMap = global.downloadProgressMap || new Map();
  const progress = global.downloadProgressMap.get(downloadId) ?? null;
  return res.json({ success: true, progress });
}

module.exports = {
  extractAudio,
  getDownloadProgress,
  removeAudioSegment,
  removeAudioSegments,
  transcribeAudio,
  uploadVideo,
  uploadWatermark,
  listVideos,
  mergeMedia,
  serveLocalMedia,
  persistRemoteMedia,
  deleteMedia,
  saveToLocalComputer
};

async function saveToLocalComputer(req, res) {
  try {
    const { localFileName } = req.body;
    if (!localFileName) {
      return res.status(400).json({ success: false, error: 'Thiếu tên file' });
    }
    const sourcePath = path.join(mediaStudioService.LOCAL_MEDIA_DIR, localFileName);
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy file nguồn trên server' });
    }

    const os = require('os');
    const { exec } = require('child_process');
    const homeDir = os.homedir();
    let destDir = path.join(homeDir, 'Downloads');
    if (!fs.existsSync(destDir)) {
      destDir = path.join(homeDir, 'Desktop');
    }

    const destPath = path.join(destDir, localFileName);
    await fs.promises.copyFile(sourcePath, destPath);

    // Mở và bôi đen file trong Finder trên macOS
    exec(`open -R "${destPath}"`, (err) => {
      if (err) console.error('[LocalSave] Lỗi open -R:', err);
    });

    return res.json({
      success: true,
      message: `Đã sao chép trực tiếp vào thư mục Downloads`,
      destPath
    });
  } catch (error) {
    console.error('[LocalSave] Lỗi:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

