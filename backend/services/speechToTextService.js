const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Infer correct MIME type for Gemini API audio files based on extension
 */
function getAudioMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.mp3': 'audio/mp3',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac'
  };
  return mimeTypes[ext] || 'audio/mp3';
}

/**
 * Transcribes audio using Gemini 2.0 Flash and returns an array of words with timestamps
 * @param {string} audioPath - Absolute path to the local audio file
 * @returns {Promise<Array<{text: string, start: number, end: number}>>}
 */
async function transcribeAudioFile(audioPath) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Chưa cấu hình GEMINI_API_KEY trong tệp .env. Vui lòng thêm khóa API vào cấu hình để sử dụng tính năng chuyển giọng nói thành văn bản.');
  }

  if (!fs.existsSync(audioPath)) {
    throw new Error('Không tìm thấy tệp âm thanh để chuyển đổi.');
  }

  const audioBuffer = await fs.promises.readFile(audioPath);
  const base64Audio = audioBuffer.toString('base64');
  const mimeType = getAudioMimeType(audioPath);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  
  const prompt = 
    `Hãy nghe kỹ đoạn âm thanh này và tạo transcript tiếng Việt chi tiết dưới dạng một mảng JSON các đối tượng. ` +
    `Mỗi đối tượng đại diện cho một từ hoặc một cụm từ rất ngắn (không quá 3 từ) liên tục trong audio, có cấu trúc chính xác như sau: ` +
    `{\n  "text": "từ hoặc cụm từ tương ứng",\n  "start": thời_gian_bắt_đầu_bằng_giây,\n  "end": thời_gian_kết_thúc_bằng_giây\n} ` +
    `Hãy chia nhỏ tối đa văn bản để dễ dàng cho việc chọn lọc và xóa từ. ` +
    `Mốc thời gian start và end phải khớp chính xác với giọng nói trong audio (thời gian tính bằng giây, kiểu số thực). ` +
    `Chỉ trả về chuỗi JSON là một mảng hợp lệ, không chứa ký tự bao ngoài như \`\`\`json hay bất kỳ văn bản chú thích nào khác.`;

  const payload = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Audio
            }
          },
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  console.log(`[SpeechToText] Bắt đầu gửi yêu cầu STT cho file: ${path.basename(audioPath)} (${(audioBuffer.length / (1024 * 1024)).toFixed(2)} MB)...`);

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 180000 // 3 minutes timeout
    });

    const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      throw new Error('Không nhận được phản hồi chứa nội dung văn bản từ Gemini API.');
    }

    let cleaned = responseText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
    }

    const result = JSON.parse(cleaned);
    if (!Array.isArray(result)) {
      throw new Error('Gemini API phản hồi thành công nhưng không trả về một mảng JSON.');
    }

    console.log(`[SpeechToText] Chuyển đổi thành công! Nhận được ${result.length} từ/cụm từ.`);
    return result;
  } catch (err) {
    if (err.response) {
      console.error('[SpeechToText] Lỗi từ phía Gemini API:', err.response.status, err.response.data);
      throw new Error(`Gemini API trả về lỗi (${err.response.status}): ${err.response.data?.error?.message || err.message}`);
    }
    console.error('[SpeechToText] Lỗi khi chuyển đổi giọng nói:', err.message);
    throw err;
  }
}

module.exports = {
  transcribeAudioFile
};
