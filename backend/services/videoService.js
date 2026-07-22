const axios = require('axios');

/**
 * Service xử lý phân tích và giải mã đường dẫn video từ nhiều nguồn (Facebook, TikTok, YouTube, direct MP4,...)
 */

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
};

function decodeUnicodeEscapes(str) {
  if (!str) return '';
  try {
    return str
      .replace(/\\u0026/g, '&')
      .replace(/\\u003C/gi, '<')
      .replace(/\\u003E/gi, '>')
      .replace(/\\u0025/g, '%')
      .replace(/\\\//g, '/')
      .replace(/\\"/g, '"');
  } catch (e) {
    return str;
  }
}

/**
 * Bóc tách thông tin TikTok Video (Không dính watermark)
 */
async function parseTikTokVideo(url) {
  const cleanUrl = url.trim();
  try {
    // Gọi API TikWM
    const response = await axios.post('https://www.tikwm.com/api/', 
      new URLSearchParams({ url: cleanUrl, hd: '1' }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': DEFAULT_HEADERS['User-Agent']
        },
        timeout: 10000
      }
    );

    if (response.data && response.data.code === 0 && response.data.data) {
      const data = response.data.data;
      const title = data.title || 'TikTok Video';
      const thumbnail = data.cover || data.origin_cover || '';

      const qualities = [];
      if (data.hdplay) {
        const hdUrl = data.hdplay.startsWith('http') ? data.hdplay : `https://www.tikwm.com${data.hdplay}`;
        qualities.push({ quality: 'HD (Không Logo)', url: hdUrl, format: 'mp4' });
      }
      if (data.play) {
        const playUrl = data.play.startsWith('http') ? data.play : `https://www.tikwm.com${data.play}`;
        qualities.push({ quality: 'MP4 (Không Logo)', url: playUrl, format: 'mp4' });
      }

      if (qualities.length > 0) {
        return {
          success: true,
          platform: 'TikTok',
          title,
          thumbnail,
          qualities
        };
      }
    }
  } catch (err) {
    console.error('⚠️ TikWM API thất bại, chuyển sang phương án fallback:', err.message);
  }

  return await parseGenericVideo(cleanUrl);
}

/**
 * Bóc tách thông tin YouTube (Video & Shorts) dùng yt-dlp để lấy stream URL preview
 */
async function parseYouTubeVideo(url) {
  const { execFile } = require('child_process');
  const fs = require('fs');

  const cleanUrl = url.trim();
  let videoId = '';
  const ytRegex = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/;
  const match = cleanUrl.match(ytRegex);
  if (match && match[1]) videoId = match[1];

  if (!videoId) throw new Error('Đường dẫn YouTube không hợp lệ');

  const thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  // 💡 CÁCH 1: Dùng Invidious API công khai giải mã stream MP4 siêu tốc (Không dính bot check)
  const invidiousInstances = [
    `https://inv.tux.pizza/api/v1/videos/${videoId}`,
    `https://invidious.nerdvpn.de/api/v1/videos/${videoId}`,
    `https://vid.puffyan.us/api/v1/videos/${videoId}`
  ];

  for (const apiUrl of invidiousInstances) {
    try {
      const res = await axios.get(apiUrl, { timeout: 4000 });
      if (res.data && res.data.title) {
        const title = res.data.title;
        const mp4Stream = res.data.formatStreams?.find(s => s.container === 'mp4' && s.url);
        if (mp4Stream && mp4Stream.url) {
          console.log(`[YouTubeParser] ⚡ Bóc tách thành công qua Invidious API: ${title}`);
          return {
            success: true,
            platform: 'YouTube',
            title,
            thumbnail: res.data.videoThumbnails?.[0]?.url || thumbnail,
            qualities: [{
              quality: `${mp4Stream.qualityLabel || 'MP4'} (Direct Stream)`,
              url: mp4Stream.url,
              format: 'mp4'
            }]
          };
        }
      }
    } catch (_) {}
  }

  // 💡 CÁCH 2: Dùng yt-dlp với cờ giả lập iOS Client bypass
  function findBin(name) {
    const paths = [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`, name];
    for (const p of paths) { try { if (fs.existsSync(p)) return p; } catch(e) {} }
    return name;
  }

  const ytdlp = process.env.YTDLP_PATH || findBin('yt-dlp');
  const iosUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

  return new Promise((resolve) => {
    const titleArgs = [
      '--no-playlist', '--no-warnings', '--skip-download',
      '--extractor-args', 'youtube:player_client=ios,android,mweb',
      '--user-agent', iosUA,
      '--print', 'title',
      cleanUrl
    ];

    const urlArgs = [
      '--no-playlist', '--no-warnings',
      '--extractor-args', 'youtube:player_client=ios,android,mweb',
      '--user-agent', iosUA,
      '-f', 'best[ext=mp4][vcodec^=avc]/18/best[ext=mp4]/best',
      '--get-url',
      cleanUrl
    ];

    const runYtdlp = (args) => new Promise((res) => {
      execFile(ytdlp, args, { timeout: 25000 }, (err, stdout) => {
        res(err ? '' : stdout.trim());
      });
    });

    Promise.all([runYtdlp(titleArgs), runYtdlp(urlArgs)]).then(([titleOut, urlOut]) => {
      const title = titleOut.split('\n')[0].trim() || `YouTube Video (${videoId})`;
      const streamUrl = urlOut.split('\n')[0].trim();

      if (!streamUrl || !streamUrl.startsWith('http')) {
        return resolve({
          success: true,
          platform: 'YouTube',
          title,
          thumbnail,
          previewUnavailable: true,
          qualities: [{ quality: 'MP4 Video', url: cleanUrl, format: 'mp4' }]
        });
      }

      resolve({
        success: true,
        platform: 'YouTube',
        title,
        thumbnail,
        qualities: [{
          quality: 'MP4 H.264',
          url: streamUrl,
          format: 'mp4'
        }]
      });
    });
  });
}

/**
 * Bóc tách Facebook Video
 */
async function parseFacebookVideo(url) {
  try {
    let cleanUrl = url.trim();
    if (cleanUrl.includes('m.facebook.com')) {
      cleanUrl = cleanUrl.replace('m.facebook.com', 'www.facebook.com');
    }

    const response = await axios.get(cleanUrl, {
      headers: {
        ...DEFAULT_HEADERS,
        'Sec-Fetch-Mode': 'navigate'
      },
      timeout: 12000
    });

    const html = response.data;
    if (typeof html !== 'string') {
      throw new Error('Không thể đọc dữ liệu HTML từ Facebook');
    }

    let title = '';
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                       html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      title = decodeUnicodeEscapes(titleMatch[1]).replace(/ \| Facebook$/i, '').trim();
    }
    if (!title || title.toLowerCase().includes('facebook')) {
      title = 'Facebook Video';
    }

    let thumbnail = '';
    const thumbMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    if (thumbMatch) {
      thumbnail = decodeUnicodeEscapes(thumbMatch[1]);
    }

    let hdUrl = '';
    let sdUrl = '';

    const hdMatch = html.match(/hd_src:"([^"]+)"/) || html.match(/hd_src_no_ratelimit:"([^"]+)"/) || html.match(/"browser_native_hd_url":"([^"]+)"/);
    if (hdMatch) hdUrl = decodeUnicodeEscapes(hdMatch[1]);

    const sdMatch = html.match(/sd_src:"([^"]+)"/) || html.match(/sd_src_no_ratelimit:"([^"]+)"/) || html.match(/"browser_native_sd_url":"([^"]+)"/);
    if (sdMatch) sdUrl = decodeUnicodeEscapes(sdMatch[1]);

    if (!hdUrl) {
      const pHd = html.match(/"playable_url_quality_hd":"([^"]+)"/);
      if (pHd) hdUrl = decodeUnicodeEscapes(pHd[1]);
    }
    if (!sdUrl) {
      const pSd = html.match(/"playable_url":"([^"]+)"/);
      if (pSd) sdUrl = decodeUnicodeEscapes(pSd[1]);
    }

    if (!hdUrl && !sdUrl) {
      const ogVid = html.match(/<meta\s+property="og:video(?::secure_url)?"\s+content="([^"]+)"/i) ||
                    html.match(/<meta\s+property="og:video:url"\s+content="([^"]+)"/i);
      if (ogVid) {
        sdUrl = decodeUnicodeEscapes(ogVid[1]);
      }
    }

    const qualities = [];
    if (hdUrl) {
      qualities.push({ quality: 'HD (Độ phân giải cao)', url: hdUrl, format: 'mp4' });
    }
    if (sdUrl) {
      qualities.push({ quality: 'SD (Tiêu chuẩn)', url: sdUrl, format: 'mp4' });
    }

    if (qualities.length === 0) {
      throw new Error('Không tìm thấy nguồn tải trực tiếp từ Facebook Video.');
    }

    return {
      success: true,
      platform: 'Facebook',
      title,
      thumbnail,
      qualities
    };
  } catch (err) {
    throw new Error('Lỗi phân tích Facebook Video: ' + (err.message || 'Không tìm thấy video'));
  }
}

/**
 * Bóc tách link trực tiếp / web chung
 */
async function parseGenericVideo(url) {
  if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(url)) {
    const filename = url.split('/').pop().split('?')[0] || 'video.mp4';
    return {
      success: true,
      platform: 'Direct Video',
      title: filename,
      thumbnail: '',
      qualities: [{ quality: 'File MP4 Trực tiếp', url, format: 'mp4' }]
    };
  }

  try {
    const response = await axios.get(url, { headers: DEFAULT_HEADERS, timeout: 10000 });
    const html = response.data;
    if (typeof html !== 'string') {
      throw new Error('Không thể đọc nội dung đường dẫn');
    }

    let title = 'Video Web';
    const titleM = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
    if (titleM) title = decodeUnicodeEscapes(titleM[1]);

    let thumbnail = '';
    const thumbM = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    if (thumbM) thumbnail = decodeUnicodeEscapes(thumbM[1]);

    let videoUrl = '';
    const vidM = html.match(/<meta\s+property="og:video(?::secure_url)?"\s+content="([^"]+)"/i) ||
                 html.match(/<meta\s+property="og:video:url"\s+content="([^"]+)"/i) ||
                 html.match(/<video[^>]+src="([^"]+)"/i) ||
                 html.match(/<source[^>]+src="([^"]+)"/i);
    if (vidM) videoUrl = decodeUnicodeEscapes(vidM[1]);

    if (!videoUrl) {
      throw new Error('Không tìm thấy link video trên trang web này');
    }

    return {
      success: true,
      platform: 'Web Media',
      title,
      thumbnail,
      qualities: [{ quality: 'MP4 Video', url: videoUrl, format: 'mp4' }]
    };
  } catch (err) {
    throw new Error('Lỗi bóc tách video: ' + err.message);
  }
}

/**
 * Tổng hợp bóc tách theo nền tảng
 */
async function getVideoInfo(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Đường dẫn video không hợp lệ');
  }

  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Đường dẫn phải bắt đầu bằng http:// hoặc https://');
  }

  if (url.includes('tiktok.com') || url.includes('douyin.com')) {
    return await parseTikTokVideo(url);
  } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
    return await parseYouTubeVideo(url);
  } else if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.gg') || url.includes('fb.me')) {
    return await parseFacebookVideo(url);
  } else {
    return await parseGenericVideo(url);
  }
}

/**
 * Tải danh sách segment HLS m3u8 và nối lại thành file mp4
 */
async function downloadHlsStream(m3u8Url, filePath) {
  const fs = require('fs');
  const response = await axios.get(m3u8Url, { headers: DEFAULT_HEADERS, timeout: 15000 });
  let content = response.data;

  if (typeof content !== 'string') {
    throw new Error('Nội dung M3U8 không hợp lệ');
  }

  if (content.includes('#EXT-X-STREAM-INF')) {
    const lines = content.split('\n');
    let bestUrl = '';
    let maxBandwidth = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('#EXT-X-STREAM-INF')) {
        const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
        const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        let nextLine = (lines[i + 1] || '').trim();
        if (nextLine && !nextLine.startsWith('#')) {
          if (bw >= maxBandwidth) {
            maxBandwidth = bw;
            bestUrl = nextLine.startsWith('http') ? nextLine : new URL(nextLine, m3u8Url).href;
          }
        }
      }
    }
    if (bestUrl) {
      const subRes = await axios.get(bestUrl, { headers: DEFAULT_HEADERS, timeout: 15000 });
      content = subRes.data;
    }
  }

  const lines = content.split('\n');
  const segmentUrls = [];
  for (let line of lines) {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const segUrl = line.startsWith('http') ? line : new URL(line, m3u8Url).href;
      segmentUrls.push(segUrl);
    }
  }

  if (segmentUrls.length === 0) {
    throw new Error('Không tìm thấy đoạn video (TS segment) trong m3u8');
  }

  const writer = fs.createWriteStream(filePath);
  for (let i = 0; i < segmentUrls.length; i++) {
    const segRes = await axios.get(segmentUrls[i], {
      responseType: 'arraybuffer',
      headers: DEFAULT_HEADERS,
      timeout: 20000
    });
    writer.write(Buffer.from(segRes.data));
  }

  await new Promise((resolve) => {
    writer.end(resolve);
  });
}

/**
 * Tải file MP4 trực tiếp qua HTTP stream (Siêu tốc & Bảo mật 100%, không chạm máy cá nhân)
 */
async function downloadDirectHttpFile(directUrl, destPath) {
  const fs = require('fs');
  const response = await axios({
    method: 'GET',
    url: directUrl,
    responseType: 'stream',
    headers: DEFAULT_HEADERS,
    timeout: 300000
  });

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on('finish', () => resolve(destPath));
    writer.on('error', (err) => {
      try { fs.unlinkSync(destPath); } catch (e) {}
      reject(err);
    });
  });
}

module.exports = {
  getVideoInfo,
  downloadHlsStream,
  downloadDirectHttpFile,
  DEFAULT_HEADERS
};
