import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
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
  X,
  CloudUpload,
  Trash2
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
  // --- STATES & REFS ---
  const [url, setUrl] = useState('');
  const [audioAsset, setAudioAsset] = useState(null);
  const [originalAudioAsset, setOriginalAudioAsset] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extractType, setExtractType] = useState('audio'); // 'audio', 'video_silent', 'video_full'
  const [extractError, setExtractError] = useState('');
  const [extractWarning, setExtractWarning] = useState('');

  // Manual Audio Slider Editing States
  const [audioDuration, setAudioDuration] = useState(0);
  const [deleteStart, setDeleteStart] = useState(0);
  const [deleteEnd, setDeleteEnd] = useState(0);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [previewingSelection, setPreviewingSelection] = useState(false);
  const [editingAudio, setEditingAudio] = useState(false);
  const [editError, setEditError] = useState('');
  const [editWarning, setEditWarning] = useState('');

  // Video Library States
  const [videos, setVideos] = useState([]);
  const [selectedVideos, setSelectedVideos] = useState([]); // Ordered list of selected videos
  const [videoSearch, setVideoSearch] = useState('');
  const [videosLoading, setVideosLoading] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [videoWarning, setVideoWarning] = useState('');
  const [uploadName, setUploadName] = useState('');

  // Watermark/Logo States
  const [watermarkAsset, setWatermarkAsset] = useState(null);
  const [uploadingWatermark, setUploadingWatermark] = useState(false);
  const [watermarkError, setWatermarkError] = useState('');

  // Merging States
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const [mergeWarning, setMergeWarning] = useState('');
  const [mergedVideo, setMergedVideo] = useState(null);
  const [downloadingVideo, setDownloadingVideo] = useState(false);
  const [persistingMergedVideo, setPersistingMergedVideo] = useState(false);

  const [persistingAudio, setPersistingAudio] = useState(false);
  const [persistingVideo, setPersistingVideo] = useState(false);

  const audioRef = useRef(null);
  const fileInputRef = useRef(null);
  const watermarkInputRef = useRef(null);
  const extractSequenceRef = useRef(0);
  const extractAbortRef = useRef(null);
  const mergeDebounceRef = useRef(null); // debounce timer cho auto-merge
  const audioAssetRef = useRef(audioAsset);
  const selectedVideosRef = useRef(selectedVideos);
  const watermarkAssetRef = useRef(watermarkAsset);

  audioAssetRef.current = audioAsset;
  selectedVideosRef.current = selectedVideos;
  watermarkAssetRef.current = watermarkAsset;

  const currentAudioKey = getAssetKey(audioAsset);
  const originalAudioKey = getAssetKey(originalAudioAsset);
  const mergedVideoUrl = getAssetUrl(mergedVideo);
  const mergedVideoDownloadUrl = getAssetDownloadUrl(mergedVideo);
  const currentAudioUrl = getAssetUrl(audioAsset);
  const selectionLength = Math.max(0, deleteEnd - deleteStart);
  const isEditedAudio = Boolean(currentAudioKey && originalAudioKey && currentAudioKey !== originalAudioKey);

  // Total duration of selected videos
  const selectedVideosTotalDuration = selectedVideos.reduce((sum, v) => sum + (Number(v.duration) || 0), 0);

  // --- VIDEO LIBRARY SEARCH ---
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
      // Sync lại selectedVideos: giữ thứ tự, cập nhật data mới
      setSelectedVideos((current) =>
        current
          .map(sel => result.videos.find(v => getAssetKey(v) === getAssetKey(sel)) || sel)
          .filter(Boolean)
      );
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

  // Sync sliders when audio changes
  useEffect(() => {
    const nextDuration = Math.max(0, Number(audioAsset?.duration) || 0);
    setAudioDuration(nextDuration);
    setDeleteStart(0);
    setDeleteEnd(defaultDeleteEnd(nextDuration));
    setPlaybackTime(0);
    setPreviewingSelection(false);
    setEditError('');
  }, [audioAsset]);

  // Lưu video về máy trực tiếp (không qua trình tải của Chrome nếu ở local)
  const handleDownloadMergedVideo = useCallback(async () => {
    if (!mergedVideo || downloadingVideo) return;
    const fileName = getAssetName(mergedVideo) || 'video.mp4';

    // Nếu video đang ở local server, tải trực tiếp qua trình duyệt của người dùng
    if (mergedVideo?.storageProvider === 'local' && mergedVideo?.localFileName) {
      const localUrl = `/api/media/local/${encodeURIComponent(mergedVideo.localFileName)}`;
      window.location.href = localUrl.includes('?') ? `${localUrl}&dl=1` : `${localUrl}?dl=1`;
      showToast?.(`Đang tải video về máy: ${fileName}`, 'success');
      return;
    }

    // Fallback: Nếu đã lưu Supabase, mở trong tab mới để xem/tải
    const remoteUrl = getAssetDownloadUrl(mergedVideo);
    if (!remoteUrl) {
      showToast?.('Không tìm thấy URL video.', 'error');
      return;
    }
    window.open(remoteUrl, '_blank');
    showToast?.(`Đang mở video: ${fileName}`, 'success');
  }, [mergedVideo, downloadingVideo, showToast]);

  useEffect(() => () => {
    extractAbortRef.current?.abort();
  }, []);

  // --- AUTO MERGE HELPER (immediate) ---
  const triggerAutoMerge = async (audio, videosArr, watermark) => {
    // Hủy debounce đang chờ nếu có
    if (mergeDebounceRef.current) {
      clearTimeout(mergeDebounceRef.current);
      mergeDebounceRef.current = null;
    }
    if (!audio || !videosArr || videosArr.length === 0) return;
    setMerging(true);
    setMergeError('');
    setMergeWarning('');
    setMergedVideo(null);

    try {
      const videoPointers = videosArr.map(v => toMediaPointer(v));
      const result = await api.mergeAudioWithVideo(
        toMediaPointer(audio),
        videoPointers,
        watermark ? toMediaPointer(watermark) : null
      );
      if (!result?.success || !result.video) {
        throw new Error(result?.error || 'Không thể tự động ghép âm thanh với video.');
      }

      setMergedVideo(result.video);
      setVideos((current) => [
        result.video,
        ...current.filter((item) => getAssetKey(item) !== getAssetKey(result.video))
      ]);
      setMergeWarning(result.warning || '');
      if (showToast) showToast('Đã tự động ghép video thành công!', 'success');
    } catch (error) {
      const message = error.message || 'Không thể tự động ghép âm thanh với video.';
      setMergeError(message);
      if (showToast) showToast(message, 'error');
    } finally {
      setMerging(false);
    }
  };

  // --- DEBOUNCED AUTO MERGE (dùng khi chọn/bỏ chọn/đổi thứ tự video) ---
  // Chỉ thực sự merge sau 800ms ngừng thay đổi → tránh lưu video rác
  const debouncedAutoMerge = (audio, videosArr, watermark, delay = 800) => {
    if (mergeDebounceRef.current) clearTimeout(mergeDebounceRef.current);
    mergeDebounceRef.current = setTimeout(() => {
      mergeDebounceRef.current = null;
      triggerAutoMerge(audio, videosArr, watermark);
    }, delay);
  };

  // --- AUDIO EXTRACTION ---
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

    try {
      const result = await api.extractAudio(targetUrl, extractType, controller.signal);
      if (requestId !== extractSequenceRef.current) return;

      if (extractType === 'audio') {
        if (!result?.success || !result.audio) {
          throw new Error(result?.error || 'Máy chủ không trả về file âm thanh hợp lệ.');
        }

        setAudioAsset(result.audio);
        setOriginalAudioAsset(result.audio);
        setExtractWarning(result.warning || '');

        // Kích hoạt tải về máy trực tiếp qua trình duyệt của người dùng
        if (result.audio.localFileName) {
          const localUrl = `/api/media/local/${encodeURIComponent(result.audio.localFileName)}`;
          window.location.href = `${localUrl}?dl=1`;
        }

        if (showToast) showToast('Đã trích xuất và tải âm thanh về máy thành công!', 'success');

        // Chỉ lấy âm thanh. Nếu đã có video trong danh sách thì tự động ghép.
        const existingVideos = selectedVideosRef.current;
        if (existingVideos && existingVideos.length > 0) {
          triggerAutoMerge(result.audio, existingVideos, watermarkAssetRef.current);
        }
      } else {
        if (!result?.success || !result.video) {
          throw new Error(result?.error || 'Máy chủ không trả về file video hợp lệ.');
        }

        // Thêm vào danh sách video thư viện
        setVideos(current => [
          result.video,
          ...current.filter(v => getAssetKey(v) !== getAssetKey(result.video))
        ]);
        // Tự động chọn video mới trích xuất
        setSelectedVideos(current => {
          if (current.some(v => getAssetKey(v) === getAssetKey(result.video))) return current;
          return [...current, result.video];
        });

        // Nếu tải cả hai, tự động chuyển vào kết quả bước 3
        if (extractType === 'video_full') {
          setMergedVideo(result.video);
        }

        // Kích hoạt tải về máy trực tiếp qua trình duyệt của người dùng
        if (result.video.localFileName) {
          const localUrl = `/api/media/local/${encodeURIComponent(result.video.localFileName)}`;
          window.location.href = `${localUrl}?dl=1`;
        }

        setExtractWarning(result.warning || '');
        const modeText = extractType === 'video_silent' ? 'video câm' : 'toàn bộ video';
        if (showToast) showToast(`Đã tải thành công ${modeText} về máy!`, 'success');
      }

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
    setMergedVideo(null);
    setMergeError('');
    setMergeWarning('');
  };

  // --- AUDIO RANGE SLIDERS EVENTS ---
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
      
      // XONG TỰ ĐỘNG GHÉP LUÔN SAU KHI CẮT ÂM THANH
      if (selectedVideosRef.current && selectedVideosRef.current.length > 0) {
        triggerAutoMerge(result.audio, selectedVideosRef.current, watermarkAssetRef.current);
      }
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

  // --- VIDEO & WATERMARK HANDLERS ---
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
        throw new Error(result?.error || 'Không thể tải video lên.');
      }

      const uploaded = result.video;
      setVideos((current) => [uploaded, ...current.filter((item) => getAssetKey(item) !== getAssetKey(uploaded))]);
      // Thêm video vừa upload vào danh sách đã chọn
      setSelectedVideos((current) => {
        const alreadySelected = current.some(v => getAssetKey(v) === getAssetKey(uploaded));
        return alreadySelected ? current : [...current, uploaded];
      });
      setMergedVideo(null);
      setVideoWarning(result.warning || '');
      if (showToast) showToast(`Đã tải lên ${getAssetName(uploaded)} và thêm vào danh sách video.`, 'success');

      // TỰ ĐỘNG GHÉP NẾU CÓ ÂM THANH SẴN
      if (audioAssetRef.current) {
        const nextSelected = [...selectedVideosRef.current];
        const alreadyIn = nextSelected.some(v => getAssetKey(v) === getAssetKey(uploaded));
        const finalList = alreadyIn ? nextSelected : [...nextSelected, uploaded];
        triggerAutoMerge(audioAssetRef.current, finalList, watermarkAssetRef.current);
      }
    } catch (error) {
      const message = error.message || 'Không thể tải video lên.';
      setVideoError(message);
      if (showToast) showToast(message, 'error');
    } finally {
      setUploadingVideo(false);
      setUploadName('');
    }
  };

  // Toggle video vào/ra danh sách đã chọn (multi-select)
  const toggleVideoSelection = (video) => {
    const key = getAssetKey(video);
    const isSelected = selectedVideos.some(v => getAssetKey(v) === key);
    const nextSelected = isSelected
      ? selectedVideos.filter(v => getAssetKey(v) !== key)
      : [...selectedVideos, video];

    setSelectedVideos(nextSelected);
    setMergedVideo(null);
    setMergeError('');
    setMergeWarning('');

    // Dùng debounce: chứ 800ms sau thao tác cuối mới merge
    if (nextSelected.length > 0 && audioAssetRef.current) {
      debouncedAutoMerge(audioAssetRef.current, nextSelected, watermarkAssetRef.current);
    }
  };

  // Di chuyển video trong danh sách đã chọn (lên / xuống)
  const moveSelectedVideo = (index, direction) => {
    const nextSelected = [...selectedVideos];
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= nextSelected.length) return;
    [nextSelected[index], nextSelected[swapIndex]] = [nextSelected[swapIndex], nextSelected[index]];
    setSelectedVideos(nextSelected);
    setMergedVideo(null);
    setMergeError('');
    setMergeWarning('');
    // Dùng debounce: chứ 800ms sau thao tác cuối mới merge
    if (audioAssetRef.current) {
      debouncedAutoMerge(audioAssetRef.current, nextSelected, watermarkAssetRef.current);
    }
  };

  // Xóa video khỏi danh sách đã chọn
  const removeFromSelected = (index) => {
    const nextSelected = selectedVideos.filter((_, i) => i !== index);
    setSelectedVideos(nextSelected);
    setMergedVideo(null);
    setMergeError('');
    setMergeWarning('');
    if (nextSelected.length > 0 && audioAssetRef.current) {
      debouncedAutoMerge(audioAssetRef.current, nextSelected, watermarkAssetRef.current);
    }
  };

  const handleWatermarkFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const looksLikeImage = file.type.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(file.name);
    if (!looksLikeImage) {
      setWatermarkError('Vui lòng chọn file ảnh PNG, JPG, JPEG hoặc WebP.');
      return;
    }

    setUploadingWatermark(true);
    setWatermarkError('');
    setMergeError('');
    setMergeWarning('');

    try {
      const result = await api.uploadWatermark(file);
      if (!result?.success || !result.watermark) {
        throw new Error(result?.error || 'Không thể tải ảnh watermark lên.');
      }

      setWatermarkAsset(result.watermark);
      if (showToast) showToast('Đã tải ảnh logo/watermark lên thành công!', 'success');

      // TỰ ĐỘNG GHÉP NẾU CÓ CẢ VIDEO VÀ ÂM THANH SẴN
      if (audioAssetRef.current && selectedVideosRef.current && selectedVideosRef.current.length > 0) {
        triggerAutoMerge(audioAssetRef.current, selectedVideosRef.current, result.watermark);
      }
    } catch (error) {
      const message = error.message || 'Không thể tải ảnh logo/watermark lên.';
      setWatermarkError(message);
      if (showToast) showToast(message, 'error');
    } finally {
      setUploadingWatermark(false);
    }
  };

  // --- MANUAL MERGE ACTION ---
  const mergeMedia = async () => {
    if (!audioAsset || selectedVideos.length === 0) {
      setMergeError('Hãy chuẩn bị âm thanh và chọn ít nhất một video trước khi ghép.');
      return;
    }
    triggerAutoMerge(audioAsset, selectedVideos, watermarkAsset);
  };

  // --- PERSIST ACTIONS ---
  const handlePersistAudio = async () => {
    if (!audioAsset || audioAsset.storageProvider !== 'local') return;
    setPersistingAudio(true);
    try {
      const res = await api.persistRemoteMedia(audioAsset.localFileName, 'audio');
      if (res.success && res.asset) {
        setAudioAsset(res.asset);
        if (originalAudioAsset && originalAudioAsset.localFileName === audioAsset.localFileName) {
          setOriginalAudioAsset(res.asset);
        }
        if (showToast) showToast('Đã tải âm thanh lên Supabase thành công!', 'success');
      } else {
        throw new Error(res.error || 'Lưu thất bại.');
      }
    } catch (err) {
      if (showToast) showToast(err.message || 'Lỗi khi tải lên Supabase.', 'error');
    } finally {
      setPersistingAudio(false);
    }
  };

  const handlePersistVideo = async () => {
    // Lưu tất cả video local trong selectedVideos lên Supabase
    const localVideos = selectedVideos.filter(v => v.storageProvider === 'local');
    if (localVideos.length === 0) return;
    setPersistingVideo(true);
    try {
      const updated = await Promise.all(
        localVideos.map(v => api.persistRemoteMedia(v.localFileName, 'video'))
      );
      const successAssets = updated.filter(r => r.success && r.asset).map(r => r.asset);
      if (successAssets.length > 0) {
        setSelectedVideos(current =>
          current.map(v => {
            const upd = successAssets.find(a => a.fileName === v.localFileName || a.originalName === v.localFileName);
            return upd || v;
          })
        );
        setVideos(current => [
          ...successAssets,
          ...current.filter(v => !successAssets.some(a => getAssetKey(a) === getAssetKey(v)))
        ]);
        if (showToast) showToast(`Đã tải ${successAssets.length} video lên Supabase thành công!`, 'success');
      }
    } catch (err) {
      if (showToast) showToast(err.message || 'Lỗi khi tải lên Supabase.', 'error');
    } finally {
      setPersistingVideo(false);
    }
  };

  // Lưu merged video (đang ở local) lên Supabase
  const handlePersistMergedVideo = async () => {
    if (!mergedVideo || mergedVideo.storageProvider !== 'local' || !mergedVideo.localFileName) return;
    setPersistingMergedVideo(true);
    try {
      const result = await api.persistRemoteMedia(mergedVideo.localFileName, 'video');
      if (result?.success && result.asset) {
        setMergedVideo(result.asset);
        setVideos(current => [
          result.asset,
          ...current.filter(v => getAssetKey(v) !== getAssetKey(mergedVideo))
        ]);
        if (showToast) showToast('Đã lưu video lên Supabase thành công!', 'success');
      } else {
        throw new Error(result?.error || 'Không thể lưu lên Supabase');
      }
    } catch (err) {
      if (showToast) showToast(err.message || 'Lỗi khi lưu lên Supabase.', 'error');
    } finally {
      setPersistingMergedVideo(false);
    }
  };

  // Xóa video khỏi thư viện
  const handleDeleteVideo = async (video) => {
    const key = getAssetKey(video);
    // Xóa khỏi danh sách đã chọn trước
    setSelectedVideos(current => current.filter(v => getAssetKey(v) !== key));
    setVideos(current => current.filter(v => getAssetKey(v) !== key));
    try {
      await api.deleteMedia({
        storageProvider: video.storageProvider,
        storagePath: video.storagePath,
        localFileName: video.localFileName,
        type: 'video'
      });
    } catch (_) {
      // Bỏ qua lỗi xóa - UI đã cập nhật
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-8">
      {/* GLOW DECORATIONS & HEADER */}
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
                <h1 className="mt-1 text-xl font-bold text-[var(--text-main)] sm:text-2xl">
                  Bảng Điều Khiển Video Tự Động
                </h1>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-[var(--text-muted)]">
              Dán liên kết lấy âm thanh, chọn video nền và logo để ghép tự động. Bạn có thể sử dụng thanh trượt bên dưới để cắt bỏ một đoạn âm thanh tùy chọn bất cứ lúc nào.
            </p>
          </div>
        </div>
      </section>

      {/* DASHBOARD COLUMNS */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* LEFT COLUMN: AUDIO & CUTTER */}
        <div className="flex flex-col gap-6 lg:col-span-6">
          {/* STEP 1: AUDIO SOURCE & EXTRACTION */}
          <div className="glass-effect flex flex-col gap-4 rounded-3xl border border-[var(--glass-border)] p-5 sm:p-6">
            <div className="flex items-center gap-2 border-b border-[var(--border-main)] pb-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                <Link2 size={16} />
              </div>
              <h2 className="text-sm font-bold text-[var(--text-main)]">1. Nguồn âm thanh & Công cụ cắt đoạn</h2>
            </div>

            <form onSubmit={handleLinkSubmit} className="flex flex-col gap-3">
              <label htmlFor="media-source-url" className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Link YouTube, TikTok, Facebook hoặc Video trực tiếp
              </label>
              <div className="flex gap-2">
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
                  disabled={extracting || merging}
                  className="w-full flex-1 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] py-3 px-4 text-xs text-[var(--text-main)] outline-none transition focus:border-indigo-500 disabled:opacity-60"
                />
                {url && !extracting && (
                  <button
                    type="button"
                    onClick={clearSource}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-rose-400 transition"
                    title="Xóa liên kết"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              {/* LOẠI TRÍCH XUẤT SELECTION PILLS */}
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Loại trích xuất
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setExtractType('audio')}
                    disabled={extracting}
                    className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition border ${
                      extractType === 'audio'
                        ? 'bg-violet-600/10 text-violet-400 border-violet-500/30'
                        : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    Âm thanh
                  </button>
                  <button
                    type="button"
                    onClick={() => setExtractType('video_silent')}
                    disabled={extracting}
                    className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition border ${
                      extractType === 'video_silent'
                        ? 'bg-violet-600/10 text-violet-400 border-violet-500/30'
                        : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    Video silent
                  </button>
                  <button
                    type="button"
                    onClick={() => setExtractType('video_full')}
                    disabled={extracting}
                    className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition border ${
                      extractType === 'video_full'
                        ? 'bg-violet-600/10 text-violet-400 border-violet-500/30'
                        : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    Cả hai
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleClipboardPaste}
                  disabled={extracting || merging}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--active-menu-border)] bg-[var(--active-menu-bg)] py-3 text-xs font-bold text-[var(--text-main)] transition hover:brightness-110 disabled:opacity-50"
                >
                  <Clipboard size={14} /> Dán link
                </button>
                <button
                  type="submit"
                  disabled={extracting || !url.trim() || merging}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3 text-xs font-bold text-white shadow-lg shadow-indigo-950/20 transition hover:bg-indigo-500 disabled:opacity-50"
                >
                  {extracting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Trích xuất
                </button>
              </div>
              <WarningNotice message={extractWarning} />
              <ErrorNotice message={extractError} />
            </form>

            {/* Audio info & MANUALLY VISIBLE EDITOR */}
            {audioAsset && (
              <div className="mt-2 flex flex-col gap-4">
                <div className="rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Music size={16} className="text-violet-400 shrink-0" />
                      <div className="min-w-0">
                        <span className="block truncate text-xs font-bold" title={getAssetName(audioAsset)}>
                          {getAssetName(audioAsset)}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {audioDuration > 0 ? `Thời lượng: ${formatTime(audioDuration)}` : 'Đang đọc thời lượng...'}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-1 shrink-0">
                      {audioAsset?.storageProvider === 'local' && (
                        <button
                          type="button"
                          onClick={handlePersistAudio}
                          disabled={persistingAudio || editingAudio || merging}
                          className="p-1.5 rounded-lg bg-violet-600/10 text-violet-400 hover:bg-violet-600/20 transition"
                          title="Lưu lên Supabase"
                        >
                          {persistingAudio ? <Loader2 className="animate-spin" size={13} /> : <CloudUpload size={13} />}
                        </button>
                      )}
                      {isEditedAudio && (
                        <button
                          type="button"
                          onClick={restoreOriginalAudio}
                          disabled={editingAudio || merging}
                          className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition"
                          title="Khôi phục gốc"
                        >
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  {currentAudioUrl && (
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
                      className="w-full h-8"
                    />
                  )}
                </div>

                {/* Range Sliders Audio Cutter (Permanently visible when audio exists) */}
                <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.03] p-4 flex flex-col gap-4">
                  <div className="flex items-center gap-1.5 border-b border-[var(--border-main)] pb-2 text-indigo-400">
                    <Scissors size={14} />
                    <span className="text-xs font-bold">Cắt bỏ đoạn âm thanh đã chọn</span>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-[10px] text-[var(--text-muted)] font-medium">
                      <span>Vị trí hiện tại: {formatTime(playbackTime)}</span>
                      <span className="text-rose-400 font-bold">Sẽ xóa {formatTime(selectionLength)}</span>
                    </div>

                    <div className="relative h-6 overflow-hidden rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)]">
                      <div className="absolute inset-y-0 left-0 bg-emerald-500/10" style={{ width: `${audioDuration ? (deleteStart / audioDuration) * 100 : 0}%` }} />
                      <div
                        className="absolute inset-y-0 border-x border-rose-400/40 bg-rose-500/25"
                        style={{
                          left: `${audioDuration ? (deleteStart / audioDuration) * 100 : 0}%`,
                          width: `${audioDuration ? (selectionLength / audioDuration) * 100 : 0}%`
                        }}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-1">
                      <div className="flex flex-col gap-1 p-2 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)]">
                        <span className="text-[9px] font-bold uppercase text-[var(--text-muted)]">Điểm bắt đầu</span>
                        <input
                          type="range"
                          min="0"
                          max={Math.max(audioDuration, MIN_SEGMENT_SECONDS)}
                          step="0.01"
                          value={deleteStart}
                          onChange={(event) => updateDeleteStart(event.target.value)}
                          disabled={!audioDuration || editingAudio}
                          className="w-full accent-indigo-500"
                        />
                        <div className="flex gap-1.5 mt-1.5">
                          <input
                            type="number"
                            min="0"
                            max={Math.max(0, deleteEnd - MIN_SEGMENT_SECONDS)}
                            step="0.1"
                            value={Number(deleteStart.toFixed(2))}
                            onChange={(event) => updateDeleteStart(event.target.value)}
                            disabled={!audioDuration || editingAudio}
                            className="w-full rounded border border-[var(--input-border)] bg-[var(--bg-main)] px-2 py-1 text-[11px] text-[var(--text-main)] outline-none"
                          />
                          <button
                            type="button"
                            onClick={setStartFromPlayback}
                            disabled={!audioDuration || editingAudio}
                            className="px-3 border border-[var(--active-menu-border)] bg-[var(--active-menu-bg)] rounded-lg text-[10px] font-bold text-[var(--text-main)] whitespace-nowrap transition hover:brightness-110"
                          >
                            Dùng vị trí đang phát
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1 p-2 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)]">
                        <span className="text-[9px] font-bold uppercase text-[var(--text-muted)]">Điểm kết thúc</span>
                        <input
                          type="range"
                          min="0"
                          max={Math.max(audioDuration, MIN_SEGMENT_SECONDS)}
                          step="0.01"
                          value={deleteEnd}
                          onChange={(event) => updateDeleteEnd(event.target.value)}
                          disabled={!audioDuration || editingAudio}
                          className="w-full accent-indigo-500"
                        />
                        <div className="flex gap-1.5 mt-1.5">
                          <input
                            type="number"
                            min={Math.min(audioDuration, deleteStart + MIN_SEGMENT_SECONDS)}
                            max={audioDuration}
                            step="0.1"
                            value={Number(deleteEnd.toFixed(2))}
                            onChange={(event) => updateDeleteEnd(event.target.value)}
                            disabled={!audioDuration || editingAudio}
                            className="w-full rounded border border-[var(--input-border)] bg-[var(--bg-main)] px-2 py-1 text-[11px] text-[var(--text-main)] outline-none"
                          />
                          <button
                            type="button"
                            onClick={setEndFromPlayback}
                            disabled={!audioDuration || editingAudio}
                            className="px-3 border border-[var(--active-menu-border)] bg-[var(--active-menu-bg)] rounded-lg text-[10px] font-bold text-[var(--text-main)] whitespace-nowrap transition hover:brightness-110"
                          >
                            Dùng vị trí đang phát
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center mt-3 gap-2">
                      <button
                        type="button"
                        onClick={previewingSelection ? stopSelectionPreview : previewSelectedSegment}
                        disabled={!currentAudioUrl || selectionLength < MIN_SEGMENT_SECONDS || editingAudio}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--active-menu-border)] bg-[var(--active-menu-bg)] px-3 py-2 text-xs font-bold text-[var(--text-main)] disabled:opacity-40"
                      >
                        {previewingSelection ? <Pause size={13} /> : <Play size={13} />}
                        Nghe thử
                      </button>
                      <button
                        type="button"
                        onClick={removeSelectedSegment}
                        disabled={editingAudio || !audioDuration || selectionLength < MIN_SEGMENT_SECONDS}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-rose-500 disabled:opacity-40"
                      >
                        {editingAudio ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />}
                        Xóa đoạn đã chọn & Ghép lại
                      </button>
                    </div>
                    <WarningNotice message={editWarning} />
                    <ErrorNotice message={editError} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: VIDEO, LOGO, ACTION, RESULT */}
        <div className="flex flex-col gap-6 lg:col-span-6">
          {/* STEP 2: VIDEO SOURCE SELECTION */}
          <div className="glass-effect flex flex-col gap-4 rounded-3xl border border-[var(--glass-border)] p-5 sm:p-6">
            <div className="flex items-center gap-2 border-b border-[var(--border-main)] pb-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                <Video size={16} />
              </div>
              <h2 className="text-sm font-bold text-[var(--text-main)]">2. Tải lên hoặc chọn video nền & Logo</h2>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/x-m4v,video/webm,.mp4,.mov,.m4v,.webm"
              onChange={handleVideoFile}
              className="hidden"
            />

            <input
              ref={watermarkInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              onChange={handleWatermarkFile}
              className="hidden"
            />

            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    type="search"
                    value={videoSearch}
                    onChange={(event) => setVideoSearch(event.target.value)}
                    placeholder="Tìm theo tên video..."
                    className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] py-2.5 pl-8 pr-3 text-xs text-[var(--text-main)] outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => loadVideos()}
                  disabled={videosLoading || uploadingVideo}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--active-menu-border)] bg-[var(--active-menu-bg)] text-[var(--text-main)] transition hover:brightness-110"
                >
                  <RefreshCw size={14} className={videosLoading ? 'animate-spin' : ''} />
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingVideo || videosLoading || merging}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-indigo-500/40 bg-indigo-500/[0.03] py-2.5 text-xs font-bold text-indigo-400 hover:bg-indigo-500/10 transition"
                >
                  {uploadingVideo ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  Tải video lên
                </button>

                <button
                  type="button"
                  onClick={() => watermarkInputRef.current?.click()}
                  disabled={uploadingWatermark || merging}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-violet-500/40 bg-violet-500/[0.03] py-2.5 text-xs font-bold text-violet-400 hover:bg-violet-500/10 transition"
                >
                  {uploadingWatermark ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  Chèn Logo
                </button>
              </div>

              {/* Watermark preview */}
              {watermarkAsset && (
                <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-violet-500/[0.04] border border-violet-500/20">
                  <div className="flex items-center gap-2 min-w-0">
                    <img src={getAssetUrl(watermarkAsset)} alt="Logo" className="h-7 w-7 rounded object-contain border border-[var(--border-main)] bg-[var(--input-bg)]" />
                    <span className="text-[11px] truncate text-[var(--text-muted)]" title={getAssetName(watermarkAsset)}>
                      Watermark: {getAssetName(watermarkAsset)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWatermarkAsset(null)}
                    className="p-1 rounded text-[var(--text-muted)] hover:text-rose-400 transition"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              <ErrorNotice message={videoError} />
              <ErrorNotice message={watermarkError} />
              <WarningNotice message={videoWarning} />

              {/* Video Library List - multi-select với badge */}
              <div className="max-h-52 overflow-y-auto rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-2 flex flex-col gap-1">
                {videosLoading ? (
                  <div className="flex py-6 flex-col items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
                    <Loader2 size={18} className="animate-spin text-indigo-400" />
                    Đang đồng bộ...
                  </div>
                ) : filteredVideos.length === 0 ? (
                  <div className="text-center py-6 text-xs text-[var(--text-muted)]">Thư viện trống</div>
                ) : (
                  filteredVideos.map((video) => {
                    const key = getAssetKey(video);
                    const selIdx = selectedVideos.findIndex(v => getAssetKey(v) === key);
                    const isSelected = selIdx >= 0;
                    return (
                      <div
                        key={key}
                        onClick={() => toggleVideoSelection(video)}
                        className={`flex items-center justify-between gap-2 p-2 rounded-lg cursor-pointer transition select-none ${
                          isSelected
                            ? 'bg-indigo-500/10 border border-indigo-500/40'
                            : 'hover:bg-[var(--active-menu-bg)] border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {/* Badge số thứ tự */}
                          {isSelected ? (
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
                              {selIdx + 1}
                            </span>
                          ) : (
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--input-border)] text-[var(--text-muted)]">
                              <Video size={10} />
                            </span>
                          )}
                          <span className="truncate text-xs text-[var(--text-main)]" title={getAssetName(video)}>
                            {getAssetName(video)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {video.duration > 0 && (
                            <span className="text-[10px] text-[var(--text-muted)]">{formatTime(video.duration)}</span>
                          )}
                          <span className="text-[10px] text-[var(--text-muted)]">
                            {formatBytes(video.size || video.fileSize || video.metadata?.size)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteVideo(video);
                            }}
                            className="p-1 rounded text-[var(--text-muted)] hover:text-rose-400 transition"
                            title="Xóa video"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Selected Videos Panel - danh sách đã chọn + reorder */}
              {selectedVideos.length > 0 && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                      Danh sách video ghép ({selectedVideos.length})
                    </span>
                    <div className="flex items-center gap-2">
                      {/* Tổng thời lượng so với âm thanh */}
                      {audioDuration > 0 && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          selectedVideosTotalDuration >= audioDuration
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-amber-500/15 text-amber-400'
                        }`}>
                          Video: {formatTime(selectedVideosTotalDuration)} / Âm thanh: {formatTime(audioDuration)}
                          {selectedVideosTotalDuration < audioDuration && ' (sẽ lặp lại)'}
                        </span>
                      )}
                      {selectedVideos.some(v => v.storageProvider === 'local') && (
                        <button
                          type="button"
                          onClick={handlePersistVideo}
                          disabled={persistingVideo}
                          className="inline-flex items-center gap-1 bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600/20 px-2 py-1 rounded text-[10px] font-bold transition"
                        >
                          {persistingVideo ? <Loader2 className="animate-spin" size={10} /> : <CloudUpload size={10} />}
                          Lưu Supabase
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Danh sách thứ tự */}
                  <div className="flex flex-col gap-1">
                    {selectedVideos.map((video, index) => (
                      <div
                        key={`selected-${getAssetKey(video)}-${index}`}
                        className="flex items-center gap-2 p-1.5 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)]"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
                          {index + 1}
                        </span>
                        <span className="truncate text-xs text-[var(--text-main)] flex-1" title={getAssetName(video)}>
                          {getAssetName(video)}
                        </span>
                        {video.duration > 0 && (
                          <span className="text-[10px] text-[var(--text-muted)] shrink-0">{formatTime(video.duration)}</span>
                        )}
                        {/* Nút lên / xuống */}
                        <div className="flex gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => moveSelectedVideo(index, -1)}
                            disabled={index === 0 || merging}
                            className="p-0.5 rounded text-[var(--text-muted)] hover:text-indigo-400 disabled:opacity-30 transition"
                            title="Lên"
                          >
                            <ChevronUp size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSelectedVideo(index, 1)}
                            disabled={index === selectedVideos.length - 1 || merging}
                            className="p-0.5 rounded text-[var(--text-muted)] hover:text-indigo-400 disabled:opacity-30 transition"
                            title="Xuống"
                          >
                            <ChevronDown size={13} />
                          </button>
                        </div>
                        {/* Xóa khỏi danh sách */}
                        <button
                          type="button"
                          onClick={() => removeFromSelected(index)}
                          disabled={merging}
                          className="p-0.5 rounded text-[var(--text-muted)] hover:text-rose-400 transition shrink-0"
                          title="Bỏ chọn"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Preview video đầu tiên */}
                  {getAssetUrl(selectedVideos[0]) && (
                    <video
                      key={getAssetKey(selectedVideos[0])}
                      src={getAssetUrl(selectedVideos[0])}
                      controls
                      className="max-h-36 w-full rounded bg-black object-contain mt-1"
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* STEP 3: MERGING PROCESS & RESULTS */}
          <div className="glass-effect flex flex-col gap-4 rounded-3xl border border-[var(--glass-border)] p-5 sm:p-7">
            <div className="flex items-center gap-2 border-b border-[var(--border-main)] pb-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                <GitMerge size={16} />
              </div>
              <h2 className="text-sm font-bold text-[var(--text-main)]">3. Kết quả ghép video</h2>
            </div>

            <div className="flex flex-col gap-4">
              <button
                type="button"
                onClick={mergeMedia}
                disabled={merging || !audioAsset || selectedVideos.length === 0}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 text-sm font-bold text-white shadow-xl shadow-indigo-950/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {merging ? <Loader2 size={18} className="animate-spin" /> : <GitMerge size={18} />}
                {merging
                  ? 'Đang ghép và tạo video mới...'
                  : selectedVideos.length > 1
                    ? `Ghép ${selectedVideos.length} video + âm thanh`
                    : 'Ghép âm thanh vào video đã chọn'
                }
              </button>

              <ErrorNotice message={mergeError} />
              <WarningNotice message={mergeWarning} />

              {/* Merged Video Result Display */}
              {mergedVideo ? (
                <div className="overflow-hidden rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.03] mt-2">
                  <div className="flex flex-col gap-3 border-b border-emerald-500/15 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                        <CheckCircle2 size={12} /> {getAssetName(mergedVideo)?.includes('_full') ? 'Tải thành công' : 'Ghép thành công'}
                        {!getAssetName(mergedVideo)?.includes('_full') && selectedVideos.length > 1 && ` (${selectedVideos.length} video)`}
                      </span>
                      <h3 className="mt-1 truncate text-xs font-bold text-[var(--text-main)]" title={getAssetName(mergedVideo)}>
                        {getAssetName(mergedVideo)}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Lưu Supabase - chỉ hiện khi file đang ở local */}
                      {mergedVideo?.storageProvider === 'local' && mergedVideo?.localFileName && (
                        <button
                          type="button"
                          onClick={handlePersistMergedVideo}
                          disabled={persistingMergedVideo || downloadingVideo}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600/15 px-3.5 py-2 text-xs font-bold text-indigo-400 hover:bg-indigo-600/25 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {persistingMergedVideo
                            ? <><Loader2 size={14} className="animate-spin" /> Đang lưu...</>
                            : <><CloudUpload size={14} /> Lưu Supabase</>
                          }
                        </button>
                      )}
                      {mergedVideoDownloadUrl && (
                        <button
                          type="button"
                          onClick={handleDownloadMergedVideo}
                          disabled={downloadingVideo}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {downloadingVideo
                            ? <><Loader2 size={14} className="animate-spin" /> Đang sao chép...</>
                            : <><Download size={14} /> Tải về máy</>
                          }
                        </button>
                      )}
                    </div>
                  </div>
                  {mergedVideoUrl ? (
                    <div className="p-4 bg-black">
                      <video
                        key={mergedVideoUrl}
                        src={mergedVideoUrl}
                        controls
                        className="max-h-96 w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="p-4 text-xs text-amber-400">Không tìm thấy public URL để xem trước video.</div>
                  )}
                </div>
              ) : (
                <EmptyState
                  icon={<Video size={24} />}
                  title="Chưa có video kết quả"
                  description="Hãy chuẩn bị đủ âm thanh ở phần 1, chọn một hoặc nhiều video ở phần 2. Hệ thống sẽ tự động ghép, nếu video ngắn hơn âm thanh sẽ tự động lặp lại."
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
