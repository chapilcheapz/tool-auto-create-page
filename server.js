require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const { initializeUsers } = require('./backend/services/userService');
const { getMediaToolStatus, writePlatformCookiesToFile } = require('./backend/services/ytdlpService');
const { setWriteFn, initPlatformCookies } = require('./backend/services/platformCookieService');

// Inject hàm ghi file vào platformCookieService (tránh circular dependency)
setWriteFn(writePlatformCookiesToFile);

// Thêm error handlers toàn cục để không bao giờ bị crash im lặng
process.on('uncaughtException', (err) => {
  console.error('❌ Lỗi không được bắt (uncaughtException):', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Lỗi Promise không được xử lý (unhandledRejection):', reason);
});

const app = express();
const PORT = process.env.PORT || 3456;

// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-File-Name']
}));
app.use(cookieParser(process.env.COOKIE_SECRET || 'fallback_secret'));
app.use(express.json({ limit: '10mb' }));

// Public health check must be registered before the protected /api router.
app.get('/api/status', (req, res) => {
  const mediaToolStatus = getMediaToolStatus();
  res.status(mediaToolStatus.ready ? 200 : 503).json({
    status: mediaToolStatus.ready ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    mediaTools: {
      ready: mediaToolStatus.ready,
      missing: mediaToolStatus.tools
        .filter(tool => !tool.available)
        .map(tool => tool.name)
    }
  });
});

app.use(express.static(path.join(__dirname, 'build')));

// Mount API router với cơ chế try-catch an toàn
try {
  const apiRouter = require('./backend/routes/api');
  app.use('/api', apiRouter);
} catch (err) {
  console.error('❌ Lỗi nghiêm trọng khi load API routes:', err);
  app.use('/api/*', (req, res) => {
    res.status(500).json({ 
      success: false, 
      error: 'API routes failed to load: ' + err.message 
    });
  });
}

// API requests must never fall through to the React index page.
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: `Không tìm thấy API ${req.method} ${req.originalUrl}`
  });
});

// Catch-all route to serve React app index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Khởi chạy server an toàn
async function startServer() {
  try {
    // Giới hạn thời gian chờ khởi tạo Supabase tối đa 3 giây để tránh treo port
    const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 3000));
    await Promise.race([initializeUsers(), timeout]);
  } catch (error) {
    // Bỏ qua lỗi khởi tạo để tiếp tục chạy server
  }

  // Load cookies YouTube & TikTok từ Supabase vào temp files
  try {
    await initPlatformCookies();
  } catch {}

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Server đang chạy tại cổng: http://0.0.0.0:${PORT}\n`);
    const mediaToolStatus = getMediaToolStatus();
    for (const tool of mediaToolStatus.tools) {
      if (tool.available) {
        console.log(`[MediaTools] ✅ ${tool.name}: ${tool.path}`);
      } else {
        console.warn(`[MediaTools] ❌ Thiếu ${tool.name}. Luồng tách/cắt/ghép media chưa sẵn sàng.`);
      }
    }
  });
  const configuredRequestTimeout = Number.parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || '', 10);
  httpServer.requestTimeout = Number.isSafeInteger(configuredRequestTimeout) && configuredRequestTimeout >= 300000
    ? configuredRequestTimeout
    : 30 * 60 * 1000;
}

// Trigger restart to refresh Supabase connection v8
startServer();
