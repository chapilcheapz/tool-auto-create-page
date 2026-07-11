const express = require('express');
const cors = require('cors');
const path = require('path');

const { initializeUsers } = require('./backend/services/userService');

const app = express();
const PORT = process.env.PORT || 3456;

// Uncaught error handler to prevent silent crashes
process.on('uncaughtException', (err) => {
  console.error('❌ Lỗi không được bắt (uncaughtException):', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Lỗi promise chưa được xử lý (unhandledRejection):', reason);
});

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'build')));

// Mount API router with safe require
let apiRouter;
try {
  apiRouter = require('./backend/routes/api');
  app.use('/api', apiRouter);
} catch (err) {
  console.error('❌ Lỗi khi load API routes:', err.message);
  // Define fallback router if main routes fail to load
  apiRouter = express.Router();
  apiRouter.get('/status', (req, res) => {
    res.json({ status: 'error', error: 'API routes failed to load' });
  });
  app.use('/api', apiRouter);
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
    console.log('✅ Khởi tạo người dùng hoàn tất.');
  } catch (error) {
    // Bỏ qua lỗi khởi tạo để tiếp tục chạy server
    console.warn('⚠️ Lỗi trong quá trình khởi tạo:', error.message);
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 Server đang chạy tại cổng: ${PORT}\n`);
  });
}

startServer().catch(err => {
  console.error('❌ Lỗi fatal khi khởi động server:', err);
  process.exit(1);
});

