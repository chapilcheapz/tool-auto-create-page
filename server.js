const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3456;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Mount API router
app.use('/api', require('./backend/routes/api'));

// Health check
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Launch server
app.listen(PORT, () => {
  console.log(`\n🚀 Server đang chạy tại: http://localhost:${PORT}\n`);
});
