require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { initDatabase } = require('./database/init');

// 初始化資料庫
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;
const BASE = '';

// 安全標頭
app.use(helmet({
  contentSecurityPolicy: false,  // LIFF SDK 需要載入外部腳本
  crossOriginEmbedderPolicy: false
}));

// 全域速率限制：每個 IP 每 15 分鐘最多 300 次請求
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: '請求過於頻繁，請稍後再試' }
}));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// JSON 解析錯誤處理（防止亂碼 JSON 導致 crash）
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON 格式錯誤，請確認資料編碼正確' });
  }
  next(err);
});

// 靜態檔案
app.use(BASE + '/public', express.static(path.join(__dirname, 'public')));
app.use(BASE + '/uploads', express.static(path.join(__dirname, 'uploads')));

// API 路由
app.use(BASE + '/api', require('./routes/api'));

// ==========================================
// 頁面路由
// ==========================================

// 首頁：不做 server 端 redirect，讓 LIFF SDK 在前端處理 liff.state 和 OAuth code
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

// 客人註冊
app.get(BASE + '/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

// 客人登入
app.get(BASE + '/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// 客人名片管理
app.get(BASE + '/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// 管理員登入
app.get(BASE + '/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin-login.html'));
});

// 管理員後台
app.get(BASE + '/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// 名片 LIFF 分享頁
app.get(BASE + '/share/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'share.html'));
});

// 保留舊的編輯頁路由，導向新的登入頁
app.get('/edit', (req, res) => {
  res.redirect('/login');
});

// 舊路徑相容：/ksic/* 重新導向到 /*
app.get('/ksic', (req, res) => res.redirect('/'));
app.get('/ksic/*', (req, res) => {
  const newPath = req.path.replace(/^\/ksic/, '');
  res.redirect(newPath || '/');
});

// 啟動
app.listen(PORT, () => {
  console.log(`🚀 名片平台已啟動: http://localhost:${PORT}${BASE}`);
  console.log(`📋 後台: http://localhost:${PORT}${BASE}/admin`);
  console.log(`📝 客人註冊: http://localhost:${PORT}${BASE}/register`);
  console.log(`🔑 客人登入: http://localhost:${PORT}${BASE}/login`);
  console.log(`📊 客人名片: http://localhost:${PORT}${BASE}/dashboard`);
});
