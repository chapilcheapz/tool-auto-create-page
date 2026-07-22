const { getSupabase } = require('../utils/supabase');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

/**
 * Supabase Storage gateway for videos, extracted audio and rendered media.
 *
 * The service-role key stays on the backend. Callers are responsible for
 * passing an owner-scoped folder such as users/<username>/videos.
 */

const DEFAULT_BUCKET_NAME = 'videos';
const DEFAULT_STORAGE_MAX_BYTES = 500 * 1024 * 1024;
const DEFAULT_SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;
const LIST_PAGE_SIZE = 100;

const configuredBucketName = (process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET_NAME).trim();
const BUCKET_NAME = /^[a-zA-Z0-9._-]+$/.test(configuredBucketName)
  ? configuredBucketName
  : DEFAULT_BUCKET_NAME;

let bucketIsPublic = null;

const MIME_TYPES_BY_EXTENSION = {
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm'
};

function isConfigured() {
  return Boolean(
    process.env.SUPABASE_URL?.trim() &&
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

function getStorageMaxBytes() {
  const configuredValue = Number.parseInt(process.env.SUPABASE_STORAGE_MAX_BYTES || '', 10);
  return Number.isSafeInteger(configuredValue) && configuredValue > 0
    ? configuredValue
    : DEFAULT_STORAGE_MAX_BYTES;
}

function getConfiguredBucketLimitBytes() {
  const rawValue = String(process.env.SUPABASE_BUCKET_FILE_SIZE_LIMIT_BYTES || '').trim();
  if (!rawValue) return null;

  const configuredValue = Number.parseInt(rawValue, 10);
  return Number.isSafeInteger(configuredValue) && configuredValue > 0
    ? configuredValue
    : null;
}

function isProviderLimitError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('maximum allowed size') ||
    message.includes('exceeded the maximum') ||
    message.includes('file size limit')
  );
}

function isAlreadyExistsError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('already exists') ||
    message.includes('duplicate') ||
    error?.statusCode === '409' ||
    error?.status === 409
  );
}

function getSignedUrlTtlSeconds() {
  const configuredValue = Number.parseInt(process.env.SUPABASE_SIGNED_URL_TTL_SECONDS || '', 10);
  return Number.isSafeInteger(configuredValue) && configuredValue >= 60
    ? configuredValue
    : DEFAULT_SIGNED_URL_TTL_SECONDS;
}

function sanitizeSegment(value, fallback = '') {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .replace(/[._-]+$/, '');

  const limited = Array.from(normalized).slice(0, 180).join('');
  if (!limited || limited === '.' || limited === '..') return fallback;
  return limited;
}

function sanitizeFolder(folder = '') {
  const rawFolder = String(folder ?? '').trim().replace(/\\/g, '/');
  if (!rawFolder) return '';

  const segments = rawFolder.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Đường dẫn thư mục Supabase không hợp lệ');
  }

  const sanitizedSegments = segments.map((segment) => sanitizeSegment(segment));
  if (sanitizedSegments.some((segment) => !segment)) {
    throw new Error('Tên thư mục Supabase không hợp lệ');
  }

  return sanitizedSegments.join('/');
}

function sanitizeFileName(fileName, fallback = `media_${Date.now()}`) {
  const safeName = sanitizeSegment(fileName, fallback);
  if (!safeName) throw new Error('Tên file Supabase không hợp lệ');
  return safeName;
}

function sanitizeStoragePath(storagePath) {
  const rawPath = String(storagePath ?? '').trim();
  if (!rawPath) throw new Error('Thiếu đường dẫn file trên Supabase Storage');

  if (
    rawPath.startsWith('/') ||
    rawPath.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(rawPath)
  ) {
    throw new Error('Đường dẫn file Supabase không hợp lệ');
  }

  const segments = rawPath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Đường dẫn file Supabase không hợp lệ');
  }

  // Preserve existing object names (including spaces/parentheses). Rewriting a
  // listed key would point to a different object and make old uploads unusable.
  return rawPath;
}

function buildStoragePath(folder, fileName) {
  const safeFolder = sanitizeFolder(folder);
  const safeFileName = sanitizeFileName(fileName);
  return safeFolder ? `${safeFolder}/${safeFileName}` : safeFileName;
}

function inferContentType(fileName, fallback = 'application/octet-stream') {
  return MIME_TYPES_BY_EXTENSION[path.extname(fileName || '').toLowerCase()] || fallback;
}

function sanitizeContentType(contentType, fileName = '') {
  const candidate = String(contentType || inferContentType(fileName)).trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(candidate)
    ? candidate
    : inferContentType(fileName);
}

function publicUrlFor(supabase, storagePath) {
  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
  return data?.publicUrl || '';
}

function downloadUrlFor(supabase, storagePath, fileName) {
  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath, {
    download: fileName || path.posix.basename(storagePath)
  });
  return data?.publicUrl || '';
}

async function urlsForStorageObject(supabase, storagePath, fileName) {
  if (bucketIsPublic !== false) {
    return {
      publicUrl: publicUrlFor(supabase, storagePath),
      downloadUrl: downloadUrlFor(supabase, storagePath, fileName)
    };
  }

  const storage = supabase.storage.from(BUCKET_NAME);
  const expiresIn = getSignedUrlTtlSeconds();
  const [previewResult, downloadResult] = await Promise.all([
    storage.createSignedUrl(storagePath, expiresIn),
    storage.createSignedUrl(storagePath, expiresIn, {
      download: fileName || path.posix.basename(storagePath)
    })
  ]);

  if (previewResult.error) throw previewResult.error;
  if (downloadResult.error) throw downloadResult.error;

  return {
    publicUrl: previewResult.data?.signedUrl || '',
    downloadUrl: downloadResult.data?.signedUrl || previewResult.data?.signedUrl || ''
  };
}

/**
 * Ensure that the configured media bucket exists. Public buckets use public
 * URLs; private buckets remain private and receive short-lived signed URLs.
 */
async function ensureBucketExists() {
  if (!isConfigured()) return false;

  const supabase = getSupabase();
  if (!supabase) return false;

  try {
    const { data: buckets, error: getError } = await supabase.storage.listBuckets();
    if (getError) {
      console.warn('⚠️ Không thể liệt kê Supabase storage buckets:', getError.message);
      return false;
    }

    const existingBucket = buckets?.find((bucket) => bucket.name === BUCKET_NAME);
    const configuredFileSizeLimit = getConfiguredBucketLimitBytes();

    if (!existingBucket) {
      console.log(`[SupabaseStorage] Tạo mới bucket '${BUCKET_NAME}'...`);
      const createOptions = { public: true };
      if (configuredFileSizeLimit) {
        createOptions.fileSizeLimit = configuredFileSizeLimit;
      }

      let { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, createOptions);

      // A project's Storage plan can impose a lower global object limit than the
      // application default. The bucket can still be created safely by inheriting
      // that project limit instead of making every media upload fall back to disk.
      if (createError && configuredFileSizeLimit && isProviderLimitError(createError)) {
        console.warn(
          `⚠️ Supabase không chấp nhận fileSizeLimit=${configuredFileSizeLimit}; ` +
          'đang tạo bucket theo giới hạn mặc định của project.'
        );
        ({ error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
          public: true
        }));
      }

      if (createError) {
        // Another request may have created the bucket after listBuckets().
        if (isAlreadyExistsError(createError)) {
          const { data: racedBucket, error: refetchError } = await supabase.storage.getBucket(BUCKET_NAME);
          if (!refetchError && racedBucket) {
            bucketIsPublic = racedBucket.public === true;
            return true;
          }
        }
        console.warn(`⚠️ Không thể tạo bucket '${BUCKET_NAME}':`, createError.message);
        return false;
      }
      bucketIsPublic = true;
      return true;
    }

    bucketIsPublic = existingBucket.public === true;
    if (existingBucket.public !== true) {
      console.warn(
        `⚠️ Bucket '${BUCKET_NAME}' đang ở chế độ private. ` +
        'Backend sẽ dùng signed URL để phát và tải media.'
      );
    }

    return true;
  } catch (error) {
    console.warn('⚠️ Lỗi kiểm tra Supabase bucket:', error.message);
    return false;
  }
}

async function uploadBody(body, { folder = '', fileName, contentType, size }) {
  if (!isConfigured()) {
    return { success: false, error: 'Chưa cấu hình Supabase Client' };
  }

  if (!Number.isFinite(size) || size <= 0) {
    return { success: false, error: 'File media có kích thước 0 byte' };
  }

  if (size > getStorageMaxBytes()) {
    return {
      success: false,
      error: `File media vượt quá giới hạn ${getStorageMaxBytes()} bytes`
    };
  }

  try {
    const storagePath = buildStoragePath(folder, fileName);
    const safeFileName = path.posix.basename(storagePath);
    const safeContentType = sanitizeContentType(contentType, safeFileName);

    if (!await ensureBucketExists()) {
      return { success: false, error: `Không thể khởi tạo bucket '${BUCKET_NAME}'` };
    }

    const supabase = getSupabase();
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, body, {
        contentType: safeContentType,
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      return { success: false, error: error.message };
    }

    const urls = await urlsForStorageObject(supabase, data.path, safeFileName);
    return {
      success: true,
      storagePath: data.path,
      fileName: safeFileName,
      publicUrl: urls.publicUrl,
      downloadUrl: urls.downloadUrl,
      size,
      mimeType: safeContentType
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function uploadMediaFile(localFilePath, options = {}) {
  let fileStream = null;

  try {
    const resolvedFilePath = path.resolve(String(localFilePath || ''));
    const stat = await fs.promises.stat(resolvedFilePath);
    if (!stat.isFile()) {
      return { success: false, error: 'Đường dẫn media không phải là file' };
    }

    const fileName = options.fileName || path.basename(resolvedFilePath);
    fileStream = fs.createReadStream(resolvedFilePath);
    return await uploadBody(fileStream, {
      folder: options.folder,
      fileName,
      contentType: options.contentType || inferContentType(fileName),
      size: stat.size
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { success: false, error: 'File media cục bộ không tồn tại' };
    }
    return { success: false, error: error.message };
  } finally {
    if (fileStream && !fileStream.destroyed) fileStream.destroy();
  }
}

async function uploadMediaBuffer(buffer, options = {}) {
  let mediaBuffer;
  if (Buffer.isBuffer(buffer)) {
    mediaBuffer = buffer;
  } else if (buffer instanceof ArrayBuffer || ArrayBuffer.isView(buffer)) {
    mediaBuffer = Buffer.from(buffer.buffer || buffer, buffer.byteOffset || 0, buffer.byteLength);
  } else {
    return { success: false, error: 'Dữ liệu media phải là Buffer hoặc ArrayBuffer' };
  }

  if (!options.fileName) {
    return { success: false, error: 'Thiếu tên file media' };
  }

  return uploadBody(mediaBuffer, {
    folder: options.folder,
    fileName: options.fileName,
    contentType: options.contentType || inferContentType(options.fileName),
    size: mediaBuffer.byteLength
  });
}

async function listMediaFiles(folder = '') {
  if (!isConfigured()) {
    return { success: false, items: [], error: 'Chưa cấu hình Supabase Client' };
  }

  try {
    const safeFolder = sanitizeFolder(folder);
    if (!await ensureBucketExists()) {
      return {
        success: false,
        items: [],
        error: `Không thể khởi tạo bucket '${BUCKET_NAME}'`
      };
    }

    const supabase = getSupabase();
    const items = [];
    let offset = 0;

    while (true) {
      const { data, error } = await supabase.storage.from(BUCKET_NAME).list(safeFolder, {
        limit: LIST_PAGE_SIZE,
        offset,
        sortBy: { column: 'created_at', order: 'desc' }
      });

      if (error) {
        return { success: false, items: [], error: error.message };
      }

      const pageItems = data || [];
      const mediaItems = pageItems.filter((item) => item.id || item.metadata);
      const normalizedItems = await Promise.all(mediaItems.map(async (item) => {
        // Supabase represents subfolders as rows without object metadata.
        const storagePath = safeFolder ? `${safeFolder}/${item.name}` : item.name;
        const rawSize = Number(item.metadata?.size);
        const urls = await urlsForStorageObject(supabase, storagePath, item.name);
        return {
          storagePath,
          fileName: item.name,
          publicUrl: urls.publicUrl,
          downloadUrl: urls.downloadUrl,
          size: Number.isFinite(rawSize) ? rawSize : null,
          mimeType: item.metadata?.mimetype || item.metadata?.contentType || inferContentType(item.name),
          createdAt: item.created_at || item.updated_at || null
        };
      }));
      items.push(...normalizedItems);

      if (pageItems.length < LIST_PAGE_SIZE) break;
      offset += LIST_PAGE_SIZE;
    }

    return { success: true, items };
  } catch (error) {
    return { success: false, items: [], error: error.message };
  }
}

async function toNodeReadable(data) {
  if (data && typeof data.pipe === 'function') return data;
  if (data && typeof data.getReader === 'function' && typeof Readable.fromWeb === 'function') {
    return Readable.fromWeb(data);
  }
  if (data && typeof data.arrayBuffer === 'function') {
    return Readable.from(Buffer.from(await data.arrayBuffer()));
  }
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) return Readable.from(data);
  throw new Error('Supabase không trả về stream media hợp lệ');
}

async function downloadMediaFile(storagePath, destinationPath) {
  if (!isConfigured()) {
    return { success: false, error: 'Chưa cấu hình Supabase Client' };
  }

  let temporaryPath = '';
  try {
    const safeStoragePath = sanitizeStoragePath(storagePath);
    if (!destinationPath || typeof destinationPath !== 'string') {
      return { success: false, error: 'Thiếu đường dẫn lưu file media' };
    }

    const resolvedDestination = path.resolve(destinationPath);
    await fs.promises.mkdir(path.dirname(resolvedDestination), { recursive: true });

    const supabase = getSupabase();
    const downloadBuilder = supabase.storage.from(BUCKET_NAME).download(safeStoragePath);
    const { data, error } = typeof downloadBuilder.asStream === 'function'
      ? await downloadBuilder.asStream()
      : await downloadBuilder;

    if (error) {
      return { success: false, error: error.message };
    }

    temporaryPath = `${resolvedDestination}.part-${process.pid}-${Date.now()}`;
    const readable = await toNodeReadable(data);
    await pipeline(readable, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
    await fs.promises.rename(temporaryPath, resolvedDestination);
    temporaryPath = '';

    const stat = await fs.promises.stat(resolvedDestination);
    return {
      success: true,
      storagePath: safeStoragePath,
      destinationPath: resolvedDestination,
      filePath: resolvedDestination,
      size: stat.size
    };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    if (temporaryPath) {
      await fs.promises.unlink(temporaryPath).catch(() => {});
    }
  }
}

async function deleteMediaFile(storagePath) {
  if (!isConfigured()) {
    return { success: false, error: 'Chưa cấu hình Supabase Client' };
  }
  try {
    const safeStoragePath = sanitizeStoragePath(storagePath);
    const supabase = getSupabase();
    const { error } = await supabase.storage.from(BUCKET_NAME).remove([safeStoragePath]);
    if (error) return { success: false, error: error.message };
    return { success: true, storagePath: safeStoragePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Backwards-compatible MP4 uploader used by the Facebook posting flow.
 */
async function uploadVideoToSupabase(localFilePath, customFilename = '') {
  if (!isConfigured()) {
    return { success: false, error: 'Chưa cấu hình Supabase Client' };
  }

  try {
    const stat = await fs.promises.stat(localFilePath);
    if (!stat.isFile()) {
      return { success: false, error: 'File video cục bộ không tồn tại' };
    }
    if (stat.size <= 0) {
      return { success: false, error: 'File video cục bộ có kích thước 0 byte' };
    }

    const requestedName = customFilename || `video_${Date.now()}_${path.basename(localFilePath)}`;
    const normalizedName = String(requestedName).replace(/\\/g, '/');
    const rawFolder = path.posix.dirname(normalizedName);
    const result = await uploadMediaFile(localFilePath, {
      folder: rawFolder === '.' ? '' : rawFolder,
      fileName: path.posix.basename(normalizedName),
      contentType: 'video/mp4'
    });

    if (!result.success) {
      console.error('❌ Upload lên Supabase Storage thất bại:', result.error);
      return result;
    }

    console.log(`[SupabaseStorage] ✅ Upload thành công lên Supabase! Public URL: ${result.publicUrl}`);
    return {
      ...result,
      // Historically this field contained the complete object key.
      fileName: result.storagePath
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { success: false, error: 'File video cục bộ không tồn tại' };
    }
    console.error('❌ Lỗi upload video lên Supabase:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  isConfigured,
  uploadMediaFile,
  uploadMediaBuffer,
  listMediaFiles,
  downloadMediaFile,
  deleteMediaFile,
  uploadVideoToSupabase,
  ensureBucketExists,
  BUCKET_NAME
};
