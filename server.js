const express = require('express');
const cors = require('cors');
const path = require('path');

const { initializeUsers } = require('./backend/services/userService');

const app = express();
const PORT = process.env.PORT || 3456;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'build')));

// Mount API router
app.use('/api', require('./backend/routes/api'));

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

  app.listen(PORT, () => {
    console.log(`\n🚀 Server đang chạy tại cổng: ${PORT}\n`);
  });
}

startServer();

