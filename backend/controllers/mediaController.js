const fs = require('fs');
const path = require('path');
const mediaStudioService = require('../services/mediaStudioService');

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
  try {
    releaseSlot = acquireProcessingSlot();
    const sourceUrl = req.body?.url || req.body?.sourceUrl;
    const owner = ownerFromRequest(req);
    workspace = await mediaStudioService.createWorkspace();

    const extracted = await mediaStudioService.extractAudioFromUrl(
      sourceUrl,
      workspace,
      undefined,
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
      signal: abortContext.signal
    });

    return res.json({
      success: true,
      audio: {
        ...persisted.asset,
        sourceUrl: extracted.sourceUrl
      },
      warning: persisted.warning
    });
  } catch (error) {
    return sendError(res, error, 'Tách âm thanh thất bại');
  } finally {
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
      signal: abortContext.signal
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
      requireRemote: true,
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
    if (!req.body?.video || !req.body?.audio) {
      throw new mediaStudioService.MediaStudioError('Vui lòng chọn đủ video và âm thanh');
    }

    workspace = await mediaStudioService.createWorkspace();
    const videoInput = await mediaStudioService.materializeMediaReference(req.body.video, workspace, {
      allowedFolder: mediaStudioService.getOwnerFolder(owner, 'videos'),
      allowedLocalPrefixes: [`video_${owner}_`, `merged_${owner}_`],
      fallbackExtension: '.mp4'
    });
    const audioInput = await mediaStudioService.materializeMediaReference(req.body.audio, workspace, {
      allowedFolder: mediaStudioService.getOwnerFolder(owner, 'audio'),
      allowedLocalPrefixes: [`audio_${owner}_`, `audio_edit_${owner}_`],
      fallbackExtension: '.mp3'
    });
    mediaStudioService.throwIfAborted(abortContext.signal);

    const outputPath = path.join(workspace, mediaStudioService.makeSafeFileName('merged', '.mp4'));
    const merged = await mediaStudioService.mergeVideoWithAudio(
      videoInput.filePath,
      audioInput.filePath,
      outputPath,
      abortContext.signal
    );
    mediaStudioService.throwIfAborted(abortContext.signal);
    const fileName = mediaStudioService.makeSafeFileName(`merged_${owner}`, '.mp4');
    const persisted = await mediaStudioService.persistMediaFile(merged.filePath, {
      folder: mediaStudioService.getOwnerFolder(owner, 'videos'),
      fileName,
      prefix: `merged_${owner}`,
      kind: 'video',
      contentType: 'video/mp4',
      duration: merged.probe.duration,
      signal: abortContext.signal
    });

    return res.json({
      success: true,
      video: persisted.asset,
      warning: joinWarnings(videoInput.warning, audioInput.warning, persisted.warning)
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
    const generatedNamePattern = /^(?:audio|audio_edit|video|merged)_[\p{L}\p{N}._-]+_\d{10,}_[a-f0-9]{32}\.[a-z0-9]{1,8}$/iu;
    const allowedExtension = mediaStudioService.AUDIO_EXTENSIONS.has(extension) ||
      mediaStudioService.VIDEO_EXTENSIONS.has(extension);
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
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
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

module.exports = {
  extractAudio,
  removeAudioSegment,
  uploadVideo,
  listVideos,
  mergeMedia,
  serveLocalMedia
};
