require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const { initializeUsers } = require('./backend/services/userService');

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
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(cookieParser(process.env.COOKIE_SECRET || 'fallback_secret'));
app.use(express.json({ limit: '10mb' }));


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


// Health check
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Server đang chạy tại cổng: http://0.0.0.0:${PORT}\n`);
  });
}

startServer();

