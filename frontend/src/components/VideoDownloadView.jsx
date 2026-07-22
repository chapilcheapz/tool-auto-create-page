import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Clock,
  Download,
  Edit3,
  FileAudio,
  FolderOpen,
  GitMerge,
  Link2,
  Loader2,
  Music,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Scissors,
  Search,
  Sparkles,
  Upload,
  Video,
  X
} from 'lucide-react';
import * as api from '../utils/api';

const MIN_SEGMENT_SECONDS = 0.05;
const MAX_VIDEO_UPLOAD_BYTES = 500 * 1024 * 1024;

function getAssetPath(asset) {
  return asset?.storagePath || asset?.storage_path || asset?.path || '';
}

function getAssetUrl(asset) {
  return asset?.publicUrl || asset?.public_url || asset?.signedUrl || asset?.url || asset?.downloadUrl || '';
}

function getAssetDownloadUrl(asset) {
  return asset?.downloadUrl || asset?.download_url || getAssetUrl(asset);
}

function getAssetName(asset) {
  const path = getAssetPath(asset);
  const rawName = asset?.originalName || asset?.fileName || asset?.localFileName || asset?.name || path.split('/').pop();
  if (!rawName) return 'Tệp media';
  return rawName.replace(/_\d{10,}_[a-f0-9]{32}(?=\.[a-z0-9]{1,8}$)/i, '');
}

function getAssetKey(asset) {
  return getAssetPath(asset) || getAssetUrl(asset) || getAssetName(asset);
}

function toMediaPointer(asset) {
  const storagePath = getAssetPath(asset);
  return {
    storagePath,
    localFileName: asset?.localFileName || (!storagePath ? asset?.fileName || asset?.name || '' : '')
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function defaultDeleteEnd(duration) {
  const total = Math.max(0, Number(duration) || 0);
  if (total <= MIN_SEGMENT_SECONDS * 2) return total;
  return Math.min(5, total / 4);
}

function formatTime(value) {
  const total = Math.max(0, Number(value) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  const decimal = Math.floor((total % 1) * 10);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${decimal}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}.${decimal}`;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes <= 0) return 'Không rõ dung lượng';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** unitIndex)).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value) {
  if (!value) return 'Vừa cập nhật';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Vừa cập nhật';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/https?:\/\/[^\s<>"']+/i);
  const candidate = (match?.[0] || raw).replace(/[),.;]+$/, '');

  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function StepHeader({ number, icon, title, description, complete, busy }) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--border-main)] pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
          complete
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
            : 'border-indigo-500/25 bg-indigo-500/10 text-indigo-400'
        }`}>
          {complete ? <CheckCircle2 size={20} /> : icon}
        </div>
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-400">Bước {number}</span>
            {busy && <Loader2 size={13} className="animate-spin text-indigo-400" />}
          </div>
          <h2 className="text-base font-bold text-[var(--text-main)] sm:text-lg">{title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>
        </div>
      </div>
      {complete && (
        <span className="ml-13 inline-flex w-fit items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold text-emerald-400 sm:ml-0">
          <CheckCircle2 size={12} /> Hoàn tất
        </span>
      )}
    </div>
  );
}

function ErrorNotice({ message }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-xs font-medium leading-relaxed text-rose-400">
      <AlertCircle size={17} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function WarningNotice({ message }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs font-medium leading-relaxed text-amber-400">
      <AlertCircle size={17} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function EmptyState({ icon, title, description }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--input-border)] bg-[var(--input-bg)] px-5 py-10 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--active-menu-bg)] text-[var(--text-muted)]">
        {icon}
      </div>
      <h3 className="text-sm font-bold text-[var(--text-main)]">{title}</h3>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>
    </div>
  );
}

export default function VideoDownloadView({ showToast }) {
  const [url, setUrl] = useState('');
  const [audioAsset, setAudioAsset] = useState(null);
  const [originalAudioAsset, setOriginalAudioAsset] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [extractWarning, setExtractWarning] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [deleteStart, setDeleteStart] = useState(0);
  const [deleteEnd, setDeleteEnd] = useState(0);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [previewingSelection, setPreviewingSelection] = useState(false);
  const [editingAudio, setEditingAudio] = useState(false);
  const [editError, setEditError] = useState('');
  const [editWarning, setEditWarning] = useState('');

  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoSearch, setVideoSearch] = useState('');
  const [videosLoading, setVideosLoading] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [videoWarning, setVideoWarning] = useState('');
  const [uploadName, setUploadName] = useState('');

  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const [mergeWarning, setMergeWarning] = useState('');
  const [mergedVideo, setMergedVideo] = useState(null);

  const audioRef = useRef(null);
  const fileInputRef = useRef(null);
  const extractSequenceRef = useRef(0);
  const extractAbortRef = useRef(null);
  const audioAssetRef = useRef(audioAsset);
  const selectedVideoRef = useRef(selectedVideo);
  audioAssetRef.current = audioAsset;
  selectedVideoRef.current = selectedVideo;

  const currentAudioKey = getAssetKey(audioAsset);
  const originalAudioKey = getAssetKey(originalAudioAsset);
  const selectedVideoKey = getAssetKey(selectedVideo);
  const mergedVideoUrl = getAssetUrl(mergedVideo);
  const mergedVideoDownloadUrl = getAssetDownloadUrl(mergedVideo);
  const currentAudioUrl = getAssetUrl(audioAsset);
  const selectionLength = Math.max(0, deleteEnd - deleteStart);
  const isEditedAudio = Boolean(currentAudioKey && originalAudioKey && currentAudioKey !== originalAudioKey);

  const filteredVideos = useMemo(() => {
    const term = videoSearch.trim().toLowerCase();
    if (!term) return videos;
    return videos.filter((item) => {
      const searchable = `${getAssetName(item)} ${getAssetPath(item)}`.toLowerCase();
      return searchable.includes(term);
    });
  }, [videoSearch, videos]);

  const loadVideos = useCallback(async (signal) => {
    setVideosLoading(true);
    setVideoError('');

    try {
      const result = await api.getSupabaseVideos(signal);
      if (signal?.aborted) return;
      if (!result?.success || !Array.isArray(result.videos)) {
        throw new Error(result?.error || 'Không thể tải danh sách video từ Supabase.');
      }

      setVideos(result.videos);
      setVideoWarning(result.warning || '');
      setSelectedVideo((current) => {
        if (!current) return null;
        return result.videos.find((item) => getAssetKey(item) === getAssetKey(current)) || null;
      });
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) return;
      setVideoWarning('');
      setVideoError(error.message || 'Không thể tải danh sách video từ Supabase.');
    } finally {
      if (!signal?.aborted) setVideosLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadVideos(controller.signal);
    return () => controller.abort();
  }, [loadVideos]);

  useEffect(() => {
    const nextDuration = Math.max(0, Number(audioAsset?.duration) || 0);
    setAudioDuration(nextDuration);
    setDeleteStart(0);
    setDeleteEnd(defaultDeleteEnd(nextDuration));
    setPlaybackTime(0);
    setPreviewingSelection(false);
    setEditError('');
  }, [audioAsset]);

  useEffect(() => () => {
    extractAbortRef.current?.abort();
  }, []);

  const runExtraction = async (inputValue) => {
    const targetUrl = normalizeUrl(inputValue);
    if (!targetUrl) {
      setExtractWarning('');
      setExtractError('Đường dẫn không hợp lệ. Vui lòng dùng link bắt đầu bằng http:// hoặc https://.');
      return;
    }

    const requestId = extractSequenceRef.current + 1;
    extractSequenceRef.current = requestId;
    extractAbortRef.current?.abort();
    const controller = new AbortController();
    extractAbortRef.current = controller;

    setUrl(targetUrl);
    setExtracting(true);
    setExtractError('');
    setExtractWarning('');
    setEditError('');
    setEditWarning('');
    setMergeError('');
    setMergeWarning('');
    setAudioAsset(null);
    setOriginalAudioAsset(null);
    setMergedVideo(null);
    setEditorOpen(false);

    try {
      const result = await api.extractAudio(targetUrl, controller.signal);
      if (requestId !== extractSequenceRef.current) return;
      if (!result?.success || !result.audio) {
        throw new Error(result?.error || 'Máy chủ không trả về file âm thanh hợp lệ.');
      }

      setAudioAsset(result.audio);
      setOriginalAudioAsset(result.audio);
      setExtractWarning(result.warning || '');
      if (showToast) showToast('Đã trích xuất âm thanh thành công!', 'success');
    } catch (error) {
      if (error?.name === 'AbortError' || requestId !== extractSequenceRef.current) return;
      const message = error.message || 'Không thể trích xuất âm thanh từ liên kết này.';
      setExtractError(message);
      if (showToast) showToast(message, 'error');
    } finally {
      if (requestId === extractSequenceRef.current) {
        setExtracting(false);
        extractAbortRef.current = null;
      }
    }
  };

  const handleLinkSubmit = (event) => {
    event.preventDefault();
    runExtraction(url);
  };

  const handleInputPaste = (event) => {
    const pastedText = event.clipboardData.getData('text');
    if (!pastedText) return;
    event.preventDefault();
    const normalized = normalizeUrl(pastedText);
    setUrl(normalized || pastedText.trim());
    runExtraction(pastedText);
  };

  const handleClipboardPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text?.trim()) throw new Error('Clipboard không có đường dẫn.');
      const normalized = normalizeUrl(text);
      setUrl(normalized || text.trim());
      runExtraction(text);
    } catch (error) {
      const message = error.message || 'Không thể đọc clipboard. Hãy dán link trực tiếp vào ô nhập.';
      setExtractError(message);
      if (showToast) showToast(message, 'error');
    }
  };

  const clearSource = () => {
    extractSequenceRef.current += 1;
    extractAbortRef.current?.abort();
    extractAbortRef.current = null;
    setUrl('');
    setExtracting(false);
    setExtractError('');
    setExtractWarning('');
    setAudioAsset(null);
    setOriginalAudioAsset(null);
    setEditorOpen(false);
    setMergedVideo(null);
    setMergeError('');
    setMergeWarning('');
  };

  const handleAudioMetadata = (event) => {
    const duration = Number(event.currentTarget.duration);
    if (!Number.isFinite(duration) || duration <= 0) return;
    setAudioDuration(duration);
    setDeleteStart((current) => clamp(current, 0, duration));
    setDeleteEnd((current) => current > 0 ? clamp(current, 0, duration) : defaultDeleteEnd(duration));
  };

  const handleAudioTimeUpdate = (event) => {
    const current = Number(event.currentTarget.currentTime) || 0;
    setPlaybackTime(current);
    if (previewingSelection && current >= deleteEnd) {
      event.currentTarget.pause();
      event.currentTarget.currentTime = deleteStart;
      setPlaybackTime(deleteStart);
      setPreviewingSelection(false);
    }
  };

  const updateDeleteStart = (value) => {
    const upperBound = Math.max(0, deleteEnd - MIN_SEGMENT_SECONDS);
    setDeleteStart(clamp(value, 0, upperBound));
    setEditError('');
    setEditWarning('');
  };

  const updateDeleteEnd = (value) => {
    const lowerBound = Math.min(audioDuration, deleteStart + MIN_SEGMENT_SECONDS);
    setDeleteEnd(clamp(value, lowerBound, audioDuration));
    setEditError('');
    setEditWarning('');
  };

  const setStartFromPlayback = () => {
    updateDeleteStart(playbackTime);
  };

  const setEndFromPlayback = () => {
    updateDeleteEnd(playbackTime);
  };

  const previewSelectedSegment = async () => {
    if (!audioRef.current || selectionLength < MIN_SEGMENT_SECONDS) return;
    audioRef.current.currentTime = deleteStart;
    setPlaybackTime(deleteStart);
    setPreviewingSelection(true);
    try {
      await audioRef.current.play();
    } catch {
      setPreviewingSelection(false);
      setEditError('Trình duyệt chưa cho phép phát âm thanh. Hãy nhấn Play trên trình phát rồi thử lại.');
    }
  };

  const stopSelectionPreview = () => {
    if (audioRef.current) audioRef.current.pause();
    setPreviewingSelection(false);
  };

  const removeSelectedSegment = async () => {
    if (!audioAsset) return;
    if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
      setEditError('Chưa đọc được thời lượng âm thanh. Vui lòng chờ trình phát tải xong.');
      return;
    }
    if (selectionLength < MIN_SEGMENT_SECONDS) {
      setEditError('Đoạn cần xóa phải dài ít nhất 0,05 giây.');
      return;
    }
    if (deleteStart <= MIN_SEGMENT_SECONDS && deleteEnd >= audioDuration - MIN_SEGMENT_SECONDS) {
      setEditError('Không thể xóa toàn bộ file âm thanh. Hãy giữ lại ít nhất một đoạn.');
      return;
    }

    const sourceAudioKey = getAssetKey(audioAsset);
    setEditingAudio(true);
    setEditError('');
    setEditWarning('');
    setMergeError('');
    stopSelectionPreview();

    try {
      const result = await api.removeAudioSegment(
        toMediaPointer(audioAsset),
        Number(deleteStart.toFixed(3)),
        Number(deleteEnd.toFixed(3))
      );
      if (!result?.success || !result.audio) {
        throw new Error(result?.error || 'Không thể xóa đoạn âm thanh đã chọn.');
      }
      if (getAssetKey(audioAssetRef.current) !== sourceAudioKey) return;

      setAudioAsset(result.audio);
      setMergedVideo(null);
      setEditWarning(result.warning || '');
      if (showToast) showToast(`Đã xóa đoạn ${formatTime(deleteStart)} – ${formatTime(deleteEnd)}.`, 'success');
    } catch (error) {
      if (getAssetKey(audioAssetRef.current) !== sourceAudioKey) return;
      const message = error.message || 'Không thể chỉnh sửa âm thanh.';
      setEditError(message);
      if (showToast) showToast(message, 'error');
    } finally {
      setEditingAudio(false);
    }
  };

  const restoreOriginalAudio = () => {
    if (!originalAudioAsset) return;
    stopSelectionPreview();
    setAudioAsset(originalAudioAsset);
    setMergedVideo(null);
    setMergeError('');
    setMergeWarning('');
    setEditError('');
    setEditWarning('');
    if (showToast) showToast('Đã khôi phục bản âm thanh gốc.', 'success');
  };

  const handleVideoFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const looksLikeVideo = file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
    if (!looksLikeVideo) {
      setVideoError('Vui lòng chọn file video MP4, MOV, M4V hoặc WebM.');
      return;
    }
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      setVideoError(`Video vượt quá giới hạn ${formatBytes(MAX_VIDEO_UPLOAD_BYTES)} của máy chủ.`);
      return;
    }

    setUploadingVideo(true);
    setUploadName(file.name);
    setVideoError('');
    setVideoWarning('');
    setMergeError('');
    setMergeWarning('');

    try {
      const result = await api.uploadSupabaseVideo(file);
      if (!result?.success || !result.video) {
        throw new Error(result?.error || 'Không thể tải video lên Supabase.');
      }

      const uploaded = result.video;
      setVideos((current) => [uploaded, ...current.filter((item) => getAssetKey(item) !== getAssetKey(uploaded))]);
      setSelectedVideo(uploaded);
      setMergedVideo(null);
      setVideoWarning(result.warning || '');
      if (showToast) showToast(`Đã thêm ${getAssetName(uploaded)} và tự động chọn video.`, 'success');
    } catch (error) {
      const message = error.message || 'Không thể tải video lên Supabase.';
      setVideoError(message);
      if (showToast) showToast(message, 'error');
    } finally {
      setUploadingVideo(false);
      setUploadName('');
    }
  };

  const selectVideo = (video) => {
    setSelectedVideo(video);
    setMergedVideo(null);
    setMergeError('');
    setMergeWarning('');
  };

  const mergeMedia = async () => {
    if (!audioAsset || !selectedVideo) {
      setMergeError('Hãy chuẩn bị âm thanh và chọn một video trước khi ghép.');
      return;
    }

    const sourceAudioKey = getAssetKey(audioAsset);
    const sourceVideoKey = getAssetKey(selectedVideo);
    setMerging(true);
    setMergeError('');
    setMergeWarning('');
    setMergedVideo(null);

    try {
      const result = await api.mergeAudioWithVideo(
        toMediaPointer(audioAsset),
        toMediaPointer(selectedVideo)
      );
      if (!result?.success || !result.video) {
        throw new Error(result?.error || 'Không thể ghép âm thanh với video.');
      }
      if (
        getAssetKey(audioAssetRef.current) !== sourceAudioKey ||
        getAssetKey(selectedVideoRef.current) !== sourceVideoKey
      ) return;

      setMergedVideo(result.video);
      setVideos((current) => [
        result.video,
        ...current.filter((item) => getAssetKey(item) !== getAssetKey(result.video))
      ]);
      setMergeWarning(result.warning || '');
      if (showToast) showToast('Ghép âm thanh và video thành công!', 'success');
    } catch (error) {
      if (
        getAssetKey(audioAssetRef.current) !== sourceAudioKey ||
        getAssetKey(selectedVideoRef.current) !== sourceVideoKey
      ) return;
      const message = error.message || 'Không thể ghép âm thanh với video.';
      setMergeError(message);
      if (showToast) showToast(message, 'error');
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-8">
      <section className="glass-effect relative overflow-hidden rounded-3xl border border-[var(--glass-border)] p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-13 w-13 items-center justify-center rounded-2xl border border-indigo-500/25 bg-indigo-500/10 text-indigo-400">
                <Music size={27} />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-indigo-400">Media Studio</span>
                <h1 className="mt-1 text-xl font-bold text-[var(--text-main)] sm:text-2xl">Trích âm thanh & ghép video</h1>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-[var(--text-muted)]">
              Dán liên kết để tự động lấy âm thanh, xóa đoạn không cần thiết, rồi ghép với video bạn chọn trong Supabase.
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2 rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] p-2">
            {[
              { value: 1, done: Boolean(audioAsset), label: 'Lấy âm' },
              { value: 2, done: Boolean(audioAsset), label: 'Chỉnh sửa' },
              { value: 3, done: Boolean(selectedVideo), label: 'Chọn video' },
              { value: 4, done: Boolean(mergedVideo), label: 'Ghép' }
            ].map((step) => (
              <div key={step.value} className="flex min-w-14 flex-col items-center gap-1 rounded-xl px-2 py-2 text-center">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                  step.done ? 'bg-emerald-500 text-white' : 'bg-[var(--active-menu-bg)] text-[var(--text-muted)]'
                }`}>
                  {step.done ? <CheckCircle2 size={13} /> : step.value}
                </span>
                <span className="hidden text-[9px] font-semibold text-[var(--text-muted)] sm:block">{step.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="glass-effect rounded-3xl border border-[var(--glass-border)] p-5 sm:p-7">
        <StepHeader
          number="1"
          icon={<Link2 size={20} />}
          title="Dán liên kết để lấy âm thanh"
          description="Hệ thống tự xử lý ngay khi bạn dán link. Nút thủ công bên dưới dùng khi bạn nhập hoặc sửa link bằng bàn phím."
          complete={Boolean(audioAsset)}
          busy={extracting}
        />

        <form onSubmit={handleLinkSubmit} className="mt-5 flex flex-col gap-3">
          <label htmlFor="media-source-url" className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Link YouTube, TikTok, Facebook hoặc video trực tiếp
          </label>
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="relative min-w-0 flex-1">
              <Link2 size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="media-source-url"
                type="url"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setExtractError('');
                }}
                onPaste={handleInputPaste}
                placeholder="https://www.youtube.com/watch?v=..."
                disabled={extracting}
                className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] py-3.5 pl-11 pr-12 text-sm text-[var(--text-main)] outline-none transition focus:border-indigo-500 disabled:opacity-60"
              />
              {url && !extracting && (
                <button
                  type="button"
                  onClick={clearSource}
                  className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-rose-500/10 hover:text-rose-400"
                  title="Xóa liên kết"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleClipboardPaste}
              disabled={extracting}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--active-menu-border)] bg-[var(--active-menu-bg)] px-4 py-3 text-xs font-bold text-[var(--text-main)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Clipboard size={16} /> Dán link
            </button>
            <button
              type="submit"
              disabled={extracting || !url.trim()}
              className="inline-flex min-w-48 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-xs font-bold text-white shadow-lg shadow-indigo-950/20 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {extracting ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}
              {extracting ? 'Đang trích xuất...' : 'Trích xuất âm thanh'}
            </button>
          </div>

          {extracting && (
            <div className="flex items-center gap-3 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-xs text-indigo-300">
              <Loader2 size={16} className="shrink-0 animate-spin" />
              <span>Đang tải nguồn, tách âm thanh và lưu vào thư viện media. Bạn có thể tiếp tục xem trang trong lúc chờ.</span>
            </div>
          )}
          <WarningNotice message={extractWarning} />
          <ErrorNotice message={extractError} />
        </form>
      </section>

      <section className="glass-effect rounded-3xl border border-[var(--glass-border)] p-5 sm:p-7">
        <StepHeader
          number="2"
          icon={<Scissors size={20} />}
          title="Nghe và chỉnh sửa âm thanh"
          description="Chọn thời điểm bắt đầu và kết thúc của đoạn muốn xóa. Mỗi lần chỉnh sửa tạo một bản mới nên file gốc luôn được giữ lại."
          complete={Boolean(audioAsset)}
          busy={editingAudio}
        />

        <div className="mt-5">
          {!audioAsset ? (
            <EmptyState
              icon={<FileAudio size={24} />}
              title="Chưa có âm thanh"
              description="Hoàn thành bước 1 để mở trình phát và công cụ cắt âm thanh."
            />
          ) : (
            <div className="flex flex-col gap-5">
              <div className="rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-violet-500/25 bg-violet-500/10 text-violet-400">
                      <Music size={21} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-bold text-[var(--text-main)]" title={getAssetName(audioAsset)}>
                          {getAssetName(audioAsset)}
                        </h3>
                        {isEditedAudio && (
                          <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
                            Bản đã sửa
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                        {audioDuration > 0 ? `Thời lượng ${formatTime(audioDuration)}` : 'Đang đọc thời lượng...'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {isEditedAudio && (
                      <button
                        type="button"
                        onClick={restoreOriginalAudio}
                        disabled={editingAudio}
                        className="inline-flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs font-bold text-amber-400 transition hover:bg-amber-500/15 disabled:opacity-50"
                      >
                        <RotateCcw size={15} /> Khôi phục bản gốc
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditorOpen((current) => !current)}
                      className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-bold transition ${
                        editorOpen
                          ? 'bg-zinc-600 text-white hover:bg-zinc-500'
                          : 'bg-indigo-600 text-white hover:bg-indigo-500'
                      }`}
                    >
                      {editorOpen ? <X size={15} /> : <Edit3 size={15} />}
                      {editorOpen ? 'Đóng chỉnh sửa' : 'Chỉnh sửa'}
                    </button>
                  </div>
                </div>

                {currentAudioUrl ? (
                  <audio
                    key={currentAudioKey}
                    ref={audioRef}
                    src={currentAudioUrl}
                    controls
                    preload="metadata"
                    onLoadedMetadata={handleAudioMetadata}
                    onTimeUpdate={handleAudioTimeUpdate}
                    onPause={() => setPreviewingSelection(false)}
                    onEnded={() => setPreviewingSelection(false)}
                    className="mt-4 w-full"
                  >
                    Trình duyệt không hỗ trợ phát âm thanh.
                  </audio>
                ) : (
                  <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-400">
                    Backend chưa trả về public URL để phát âm thanh này.
                  </div>
                )}
              </div>

              {editorOpen && (
                <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.04] p-4 sm:p-6">
                  <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
                        <Scissors size={16} className="text-indigo-400" /> Chọn đoạn muốn xóa
                      </h3>
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                        Vị trí đang phát: <strong className="text-[var(--text-main)]">{formatTime(playbackTime)}</strong>
                      </p>
                    </div>
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-400">
                      Sẽ xóa {formatTime(selectionLength)}
                    </div>
                  </div>

                  <div className="relative mb-6 h-10 overflow-hidden rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)]">
                    <div className="absolute inset-y-0 left-0 bg-emerald-500/10" style={{ width: `${audioDuration ? (deleteStart / audioDuration) * 100 : 0}%` }} />
                    <div
                      className="absolute inset-y-0 border-x border-rose-400/40 bg-rose-500/25"
                      style={{
                        left: `${audioDuration ? (deleteStart / audioDuration) * 100 : 0}%`,
                        width: `${audioDuration ? (selectionLength / audioDuration) * 100 : 0}%`
                      }}
                    />
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Vùng màu đỏ sẽ bị xóa
                    </div>
                  </div>

                  <div className="grid gap-5 lg:grid-cols-2">
                    <div className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <label htmlFor="delete-start-number" className="text-xs font-bold text-[var(--text-main)]">Điểm bắt đầu</label>
                        <span className="font-mono text-xs font-bold text-indigo-400">{formatTime(deleteStart)}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max={Math.max(audioDuration, MIN_SEGMENT_SECONDS)}
                        step="0.01"
                        value={deleteStart}
                        onChange={(event) => updateDeleteStart(event.target.value)}
                        disabled={!audioDuration || editingAudio}
                        className="w-full accent-indigo-500 disabled:opacity-40"
                      />
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                          id="delete-start-number"
                          type="number"
                          min="0"
                          max={Math.max(0, deleteEnd - MIN_SEGMENT_SECONDS)}
                          step="0.1"
                          value={Number(deleteStart.toFixed(2))}
                          onChange={(event) => updateDeleteStart(event.target.value)}
                          disabled={!audioDuration || editingAudio}
                          className="min-w-0 flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--bg-main)] px-3 py-2 text-xs text-[var(--text-main)] outline-none focus:border-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={setStartFromPlayback}
                          disabled={!audioDuration || editingAudio}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--active-menu-border)] bg-[var(--active-menu-bg)] px-3 py-2 text-[11px] font-bold text-[var(--text-main)] disabled:opacity-40"
                        >
                          <Clock size={13} /> Dùng vị trí đang phát
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <label htmlFor="delete-end-number" className="text-xs font-bold text-[var(--text-main)]">Điểm kết thúc</label>
                        <span className="font-mono text-xs font-bold text-indigo-400">{formatTime(deleteEnd)}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max={Math.max(audioDuration, MIN_SEGMENT_SECONDS)}
                        step="0.01"
                        value={deleteEnd}
                        onChange={(event) => updateDeleteEnd(event.target.value)}
                        disabled={!audioDuration || editingAudio}
                        className="w-full accent-indigo-500 disabled:opacity-40"
                      />
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                          id="delete-end-number"
                          type="number"
                          min={Math.min(audioDuration, deleteStart + MIN_SEGMENT_SECONDS)}
                          max={audioDuration}
                          step="0.1"
                          value={Number(deleteEnd.toFixed(2))}
                          onChange={(event) => updateDeleteEnd(event.target.value)}
                          disabled={!audioDuration || editingAudio}
                          className="min-w-0 flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--bg-main)] px-3 py-2 text-xs text-[var(--text-main)] outline-none focus:border-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={setEndFromPlayback}
                          disabled={!audioDuration || editingAudio}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--active-menu-border)] bg-[var(--active-menu-bg)] px-3 py-2 text-[11px] font-bold text-[var(--text-main)] disabled:opacity-40"
                        >
                          <Clock size={13} /> Dùng vị trí đang phát
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={previewingSelection ? stopSelectionPreview : previewSelectedSegment}
                      disabled={!currentAudioUrl || selectionLength < MIN_SEGMENT_SECONDS || editingAudio}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--active-menu-border)] bg-[var(--active-menu-bg)] px-4 py-3 text-xs font-bold text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {previewingSelection ? <Pause size={15} /> : <Play size={15} />}
                      {previewingSelection ? 'Dừng nghe thử' : 'Nghe thử đoạn đã chọn'}
                    </button>
                    <button
                      type="button"
                      onClick={removeSelectedSegment}
                      disabled={editingAudio || !audioDuration || selectionLength < MIN_SEGMENT_SECONDS}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-3 text-xs font-bold text-white shadow-lg shadow-rose-950/20 transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {editingAudio ? <Loader2 size={16} className="animate-spin" /> : <Scissors size={16} />}
                      {editingAudio ? 'Đang tạo bản âm thanh mới...' : 'Xóa đoạn đã chọn'}
                    </button>
                  </div>
                  <div className="mt-4 flex flex-col gap-3">
                    <WarningNotice message={editWarning} />
                    <ErrorNotice message={editError} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="glass-effect rounded-3xl border border-[var(--glass-border)] p-5 sm:p-7">
        <StepHeader
          number="3"
          icon={<Video size={20} />}
          title="Tải lên hoặc chọn video Supabase"
          description="Video tải lên sẽ được lưu trong Supabase Storage. Bạn cũng có thể chọn lại một video đã có trong thư viện."
          complete={Boolean(selectedVideo)}
          busy={videosLoading || uploadingVideo}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/x-m4v,video/webm,.mp4,.mov,.m4v,.webm"
          onChange={handleVideoFile}
          className="hidden"
        />

        <div className="mt-5 flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative min-w-0 flex-1 lg:max-w-md">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="search"
                value={videoSearch}
                onChange={(event) => setVideoSearch(event.target.value)}
                placeholder="Tìm theo tên video..."
                className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] py-3 pl-10 pr-4 text-xs text-[var(--text-main)] outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => loadVideos()}
                disabled={videosLoading || uploadingVideo}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--active-menu-border)] bg-[var(--active-menu-bg)] px-4 py-3 text-xs font-bold text-[var(--text-main)] disabled:opacity-50"
              >
                <RefreshCw size={15} className={videosLoading ? 'animate-spin' : ''} /> Làm mới thư viện
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingVideo || videosLoading}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {uploadingVideo ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {uploadingVideo ? `Đang tải ${uploadName || 'video'}...` : 'Tải video lên Supabase'}
              </button>
            </div>
          </div>

          <ErrorNotice message={videoError} />
          <WarningNotice message={videoWarning} />

          {videosLoading ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] text-xs text-[var(--text-muted)]">
              <Loader2 size={26} className="animate-spin text-indigo-400" />
              Đang đồng bộ thư viện Supabase...
            </div>
          ) : filteredVideos.length === 0 ? (
            <EmptyState
              icon={<FolderOpen size={24} />}
              title={videoSearch ? 'Không tìm thấy video phù hợp' : 'Thư viện video đang trống'}
              description={videoSearch ? 'Thử từ khóa khác hoặc làm mới thư viện.' : 'Nhấn “Tải video lên Supabase” để thêm video đầu tiên.'}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredVideos.map((video) => {
                const key = getAssetKey(video);
                const selected = key === selectedVideoKey;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectVideo(video)}
                    aria-pressed={selected}
                    className={`flex min-w-0 items-center gap-3 rounded-2xl border p-4 text-left transition ${
                      selected
                        ? 'border-indigo-500/60 bg-indigo-500/10 shadow-lg shadow-indigo-950/10'
                        : 'border-[var(--input-border)] bg-[var(--input-bg)] hover:border-indigo-500/30'
                    }`}
                  >
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                      selected ? 'bg-indigo-600 text-white' : 'bg-[var(--active-menu-bg)] text-[var(--text-muted)]'
                    }`}>
                      {selected ? <CheckCircle2 size={20} /> : <Video size={20} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-xs font-bold text-[var(--text-main)]" title={getAssetName(video)}>{getAssetName(video)}</h3>
                      <p className="mt-1 truncate text-[10px] text-[var(--text-muted)]">
                        {formatBytes(video.size || video.fileSize || video.metadata?.size)}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">
                        {formatDate(video.createdAt || video.created_at || video.updatedAt)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {selectedVideo && (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Video đã chọn</span>
                  <h3 className="mt-1 truncate text-sm font-bold text-[var(--text-main)]">{getAssetName(selectedVideo)}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => selectVideo(null)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-rose-500/10 hover:text-rose-400"
                  title="Bỏ chọn video"
                >
                  <X size={16} />
                </button>
              </div>
              {getAssetUrl(selectedVideo) && (
                <video
                  key={selectedVideoKey}
                  src={getAssetUrl(selectedVideo)}
                  controls
                  preload="metadata"
                  className="max-h-96 w-full rounded-xl bg-black object-contain"
                >
                  Trình duyệt không hỗ trợ phát video.
                </video>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="glass-effect rounded-3xl border border-[var(--glass-border)] p-5 sm:p-7">
        <StepHeader
          number="4"
          icon={<GitMerge size={20} />}
          title="Ghép âm thanh vào video"
          description="Âm thanh đang chọn sẽ thay thế âm thanh gốc của video. File kết quả được lưu vào thư viện media, ưu tiên Supabase, để xem và tải xuống."
          complete={Boolean(mergedVideo)}
          busy={merging}
        />

        <div className="mt-5 flex flex-col gap-5">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className={`rounded-2xl border p-4 ${audioAsset ? 'border-violet-500/25 bg-violet-500/[0.06]' : 'border-[var(--input-border)] bg-[var(--input-bg)]'}`}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400"><Music size={19} /></div>
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Âm thanh</span>
                  <p className="mt-1 truncate text-xs font-bold text-[var(--text-main)]">{audioAsset ? getAssetName(audioAsset) : 'Chưa hoàn thành bước 1'}</p>
                </div>
              </div>
            </div>
            <div className={`rounded-2xl border p-4 ${selectedVideo ? 'border-sky-500/25 bg-sky-500/[0.06]' : 'border-[var(--input-border)] bg-[var(--input-bg)]'}`}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400"><Video size={19} /></div>
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Video</span>
                  <p className="mt-1 truncate text-xs font-bold text-[var(--text-main)]">{selectedVideo ? getAssetName(selectedVideo) : 'Chưa chọn video ở bước 3'}</p>
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={mergeMedia}
            disabled={merging || !audioAsset || !selectedVideo}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 text-sm font-bold text-white shadow-xl shadow-indigo-950/20 transition hover:from-indigo-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {merging ? <Loader2 size={19} className="animate-spin" /> : <GitMerge size={19} />}
            {merging ? 'Đang ghép và lưu video kết quả...' : 'Ghép âm thanh với video đã chọn'}
          </button>

          {(!audioAsset || !selectedVideo) && (
            <p className="text-center text-[11px] text-[var(--text-muted)]">
              {!audioAsset && !selectedVideo
                ? 'Cần có âm thanh ở bước 1 và một video được chọn ở bước 3.'
                : !audioAsset
                  ? 'Hãy trích xuất âm thanh ở bước 1.'
                  : 'Hãy chọn hoặc tải video lên ở bước 3.'}
            </p>
          )}
          <WarningNotice message={mergeWarning} />
          <ErrorNotice message={mergeError} />

          {mergedVideo && (
            <div className="overflow-hidden rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.05]">
              <div className="flex flex-col gap-3 border-b border-emerald-500/15 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                    <CheckCircle2 size={13} /> Ghép thành công
                  </span>
                  <h3 className="mt-1 truncate text-sm font-bold text-[var(--text-main)]">{getAssetName(mergedVideo)}</h3>
                </div>
                {mergedVideoDownloadUrl && (
                  <a
                    href={mergedVideoDownloadUrl}
                    download={getAssetName(mergedVideo)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-500"
                  >
                    <Download size={15} /> Tải video kết quả
                  </a>
                )}
              </div>
              {mergedVideoUrl ? (
                <div className="p-4">
                  <video
                    key={mergedVideoUrl}
                    src={mergedVideoUrl}
                    controls
                    preload="metadata"
                    className="max-h-[560px] w-full rounded-xl bg-black object-contain"
                  >
                    Trình duyệt không hỗ trợ phát video.
                  </video>
                </div>
              ) : (
                <div className="p-4 text-xs text-amber-400">Backend chưa trả về public URL cho video kết quả.</div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
