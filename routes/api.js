const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../database/init');
const { authApi, signToken } = require('../middleware/auth');
const { buildFlexJson } = require('./flex-builder');

const router = express.Router();

// 登入/註冊速率限制：每個 IP 每 15 分鐘最多 10 次
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: '嘗試次數過多，請 15 分鐘後再試' }
});

// 帳號鎖定記錄
const loginAttempts = new Map(); // ip -> { count, lockUntil }
function checkLoginAttempts(ip) {
  const record = loginAttempts.get(ip);
  if (record && record.lockUntil > Date.now()) {
    return false;
  }
  return true;
}
function recordFailedLogin(ip) {
  const record = loginAttempts.get(ip) || { count: 0, lockUntil: 0 };
  record.count++;
  if (record.count >= 5) {
    record.lockUntil = Date.now() + 15 * 60 * 1000; // 鎖定 15 分鐘
    record.count = 0;
  }
  loginAttempts.set(ip, record);
}
function clearLoginAttempts(ip) { loginAttempts.delete(ip); }

// ==========================================
// Email 驗證碼系統
// ==========================================
const emailCodeStore = new Map(); // email -> { code, expires }

const mailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER || '',
    pass: process.env.MAIL_PASS || ''
  }
});

router.post('/send-email-code', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: '請輸入 Email' });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Email 格式不正確' });

  // 防止頻繁發送：同一 email 60 秒內只能發一次
  const existing = emailCodeStore.get(email.toLowerCase().trim());
  if (existing && existing.expires - Date.now() > 4 * 60 * 1000) {
    return res.status(429).json({ error: '驗證碼已發送，請稍後再試' });
  }

  // 檢查 email 是否已註冊
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (user) return res.status(400).json({ error: '此 Email 已註冊，請直接登入' });

  // 產生 6 位數驗證碼
  const code = String(crypto.randomInt(100000, 999999));
  emailCodeStore.set(email.toLowerCase().trim(), { code, expires: Date.now() + 5 * 60 * 1000 });

  // 清理過期的
  for (const [k, v] of emailCodeStore) {
    if (v.expires < Date.now()) emailCodeStore.delete(k);
  }

  // 先回應前端，再背景發送郵件（避免 sendmail 阻塞）
  res.json({ ok: true, message: '驗證碼已發送至您的信箱' });

  mailTransporter.sendMail({
    from: '"KS-DIGI 電子名片" <kurtaaaalove@gmail.com>',
    to: email,
    subject: '【KS-DIGI】Email 驗證碼',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:30px;background:#f9f9f9;border-radius:12px;">
        <h2 style="color:#06c755;margin-bottom:20px;">KS-DIGI 電子名片</h2>
        <p>您好，您正在註冊 KS-DIGI 電子名片帳號。</p>
        <p>您的驗證碼為：</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#333;background:#fff;padding:20px;border-radius:8px;text-align:center;margin:20px 0;">${code}</div>
        <p style="color:#888;font-size:13px;">此驗證碼 5 分鐘內有效，請勿分享給他人。</p>
        <p style="color:#aaa;font-size:12px;margin-top:20px;">如果這不是您的操作，請忽略此郵件。</p>
      </div>
    `
  }).catch((err) => {
    console.error('Email 發送失敗:', err);
  });
});

function verifyEmailCode(email, code) {
  if (!email || !code) return false;
  const entry = emailCodeStore.get(email.toLowerCase().trim());
  if (!entry) return false;
  if (entry.expires < Date.now()) { emailCodeStore.delete(email.toLowerCase().trim()); return false; }
  if (entry.code !== code) return false;
  emailCodeStore.delete(email.toLowerCase().trim());
  return true;
}

// ==========================================
// 圖片驗證碼系統（記憶體暫存）
// ==========================================
const captchaStore = new Map(); // key -> { code, expires }

router.get('/captcha', (req, res) => {
  const id = uuidv4().slice(0, 12);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[crypto.randomInt(chars.length)];
  captchaStore.set(id, { code, expires: Date.now() + 5 * 60 * 1000 }); // 5 分鐘有效

  // 清理過期的
  for (const [k, v] of captchaStore) {
    if (v.expires < Date.now()) captchaStore.delete(k);
  }

  // 用 SVG 產生驗證碼圖片
  const colors = ['#e74c3c','#3498db','#2ecc71','#9b59b6','#f39c12','#1abc9c'];
  const letters = code.split('').map((c, i) => {
    const x = 22 + i * 30;
    const y = 28 + Math.random() * 10;
    const rotate = (Math.random() - 0.5) * 30;
    const color = colors[Math.floor(Math.random() * colors.length)];
    return `<text x="${x}" y="${y}" fill="${color}" font-size="26" font-weight="bold" font-family="monospace" transform="rotate(${rotate},${x},${y})">${c}</text>`;
  }).join('');

  // 干擾線
  let lines = '';
  for (let i = 0; i < 4; i++) {
    const x1 = Math.random() * 180, y1 = Math.random() * 45;
    const x2 = Math.random() * 180, y2 = Math.random() * 45;
    const color = colors[Math.floor(Math.random() * colors.length)];
    lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1" opacity="0.4"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="45" viewBox="0 0 180 45">
    <rect width="180" height="45" fill="#f0f0f0" rx="6"/>
    ${lines}${letters}
  </svg>`;

  const svgBase64 = Buffer.from(svg).toString('base64');
  res.json({ ok: true, id, image: `data:image/svg+xml;base64,${svgBase64}` });
});

function verifyCaptcha(id, code) {
  if (!id || !code) return false;
  const entry = captchaStore.get(id);
  if (!entry) return false;
  captchaStore.delete(id); // 一次性使用
  if (entry.expires < Date.now()) return false;
  return entry.code.toUpperCase() === code.toUpperCase();
}

// 圖片上傳設定
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  }
});

const FREE_CARD_LIMIT = 3;

// ==========================================
// 管理員認證
// ==========================================

router.post('/auth/login', authLimiter, (req, res) => {
  const ip = req.ip;
  if (!checkLoginAttempts(ip)) {
    return res.status(429).json({ error: '嘗試次數過多，帳號已暫時鎖定，請 15 分鐘後再試' });
  }

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '請輸入帳號密碼' });

  const db = getDb();
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    recordFailedLogin(ip);
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }

  clearLoginAttempts(ip);
  const token = signToken({ id: admin.id, username: admin.username, role: 'admin' });
  res.cookie('token', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'strict', secure: true });
  res.json({ ok: true, token, admin: { id: admin.id, username: admin.username, display_name: admin.display_name } });
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/auth/me', authApi, (req, res) => {
  res.json({ ok: true, admin: req.admin });
});

// ==========================================
// 客人帳號（Email 註冊 / 登入）
// ==========================================

// 客人註冊（需 Email 驗證碼 + 圖片驗證碼）
router.post('/user/register', authLimiter, (req, res) => {
  const { email, password, name, phone, captchaId, captchaCode, emailCode } = req.body;

  // 圖片驗證碼檢查
  if (!verifyCaptcha(captchaId, captchaCode)) {
    return res.status(400).json({ error: '圖片驗證碼錯誤或已過期，請重新輸入' });
  }

  if (!email || !password) return res.status(400).json({ error: '請輸入 Email 和密碼' });
  if (!name) return res.status(400).json({ error: '請輸入姓名' });
  if (!phone) return res.status(400).json({ error: '請輸入電話' });

  // Email 驗證碼檢查
  if (!verifyEmailCode(email, emailCode)) {
    return res.status(400).json({ error: 'Email 驗證碼錯誤或已過期，請重新發送' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Email 格式不正確' });
  if (password.length < 6) return res.status(400).json({ error: '密碼至少 6 個字元' });

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(400).json({ error: '此 Email 已註冊，請直接登入' });

  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (email, password_hash, name, phone) VALUES (?, ?, ?, ?)').run(
      email.toLowerCase().trim(), hash, name.trim(), phone.trim()
    );

    const token = signToken({ id: result.lastInsertRowid, email: email.toLowerCase().trim(), role: 'user' });
    res.json({ ok: true, token, user: { id: result.lastInsertRowid, email: email.toLowerCase().trim(), name: name.trim() } });
  } catch (e) {
    res.status(500).json({ error: '註冊失敗: ' + e.message });
  }
});

// 客人登入（需驗證碼）
router.post('/user/login', authLimiter, (req, res) => {
  const ip = req.ip;
  if (!checkLoginAttempts(ip)) {
    return res.status(429).json({ error: '嘗試次數過多，請 15 分鐘後再試' });
  }

  const { email, password, captchaId, captchaCode } = req.body;

  if (!verifyCaptcha(captchaId, captchaCode)) {
    return res.status(400).json({ error: '驗證碼錯誤或已過期，請重新輸入' });
  }

  if (!email || !password) return res.status(400).json({ error: '請輸入 Email 和密碼' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordFailedLogin(ip);
    return res.status(401).json({ error: 'Email 或密碼錯誤' });
  }

  clearLoginAttempts(ip);
  const token = signToken({ id: user.id, email: user.email, role: 'user' });
  res.json({
    ok: true, token,
    user: { id: user.id, email: user.email, name: user.name, phone: user.phone, is_vip: user.is_vip }
  });
});

// 客人取得自己的資料（含 VIP 狀態）
router.get('/user/me', (req, res) => {
  const payload = verifyUserToken(req);
  if (!payload) return res.status(401).json({ error: '請先登入' });

  const db = getDb();
  const user = db.prepare('SELECT id, email, name, phone, is_vip, vip_at, created_at FROM users WHERE id = ?').get(payload.id);
  if (!user) return res.status(404).json({ error: '帳號不存在' });

  const cardCount = db.prepare('SELECT COUNT(*) as count FROM cards WHERE user_id = ?').get(payload.id).count;
  res.json({ ok: true, user: { ...user, card_count: cardCount, card_limit: user.is_vip ? -1 : FREE_CARD_LIMIT } });
});

// ==========================================
// 客人名片管理（需要使用者登入）
// ==========================================

router.get('/user/cards', (req, res) => {
  const payload = verifyUserToken(req);
  if (!payload) return res.status(401).json({ error: '請先登入' });

  const db = getDb();
  const user = db.prepare('SELECT is_vip FROM users WHERE id = ?').get(payload.id);
  const cards = db.prepare('SELECT * FROM cards WHERE user_id = ? ORDER BY created_at DESC').all(payload.id);
  res.json({
    ok: true, cards,
    is_vip: user ? user.is_vip : 0,
    card_limit: user && user.is_vip ? -1 : FREE_CARD_LIMIT
  });
});

// 新增名片（客人，有數量限制）
router.post('/user/cards', (req, res) => {
  const payload = verifyUserToken(req);
  if (!payload) return res.status(401).json({ error: '請先登入' });

  const db = getDb();
  const user = db.prepare('SELECT is_vip FROM users WHERE id = ?').get(payload.id);
  const cardCount = db.prepare('SELECT COUNT(*) as count FROM cards WHERE user_id = ?').get(payload.id).count;

  // 免費用戶限制 3 張
  if (!user.is_vip && cardCount >= FREE_CARD_LIMIT) {
    return res.status(403).json({ error: `免費用戶最多建立 ${FREE_CARD_LIMIT} 張名片，升級 VIP 可建立無限名片！` });
  }

  const d = req.body;
  if (!d.name) return res.status(400).json({ error: '姓名為必填' });

  // 非 VIP 不可填社群/網站欄位，也不能自訂個別顏色
  if (!user.is_vip) {
    d.facebook = '';
    d.instagram = '';
    d.linkedin = '';
    d.website = '';
    d.color_config = '';
  }

  let slug = d.slug || d.name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slug) slug = uuidv4().slice(0, 8);

  const existing = db.prepare('SELECT id FROM cards WHERE slug = ?').get(slug);
  if (existing) return res.status(400).json({ error: '此連結名稱已被使用，請換一個' });

  try {
    const domain = process.env.DOMAIN || 'https://card.ks-digi.com';
    const colorConfig = user.is_vip && d.color_config ? d.color_config : '';
    const tempCard = { ...d, slug, color_config: colorConfig };
    const flexJson = JSON.stringify(buildFlexJson(tempCard, domain));

    const allowShare = user.is_vip && d.allow_share ? 1 : 0;

    const stmt = db.prepare(`
      INSERT INTO cards (slug, owner_type, user_id, name, title, company, department, phone, email, line_id, website, address,
        facebook, instagram, linkedin, avatar_url, theme_color, flex_json, allow_share, color_config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      slug, 'self', payload.id, d.name, d.title || '', d.company || '', d.department || '',
      d.phone || '', d.email || '', d.line_id || '', d.website || '', d.address || '',
      d.facebook || '', d.instagram || '', d.linkedin || '',
      d.avatar_url || '', d.theme_color || '#06c755', flexJson, allowShare, colorConfig
    );

    res.json({
      ok: true,
      card: { id: result.lastInsertRowid, slug },
      share_url: `${domain}/share/${slug}`
    });
  } catch (e) {
    res.status(500).json({ error: '建立失敗: ' + e.message });
  }
});

router.get('/user/cards/:id', (req, res) => {
  const payload = verifyUserToken(req);
  if (!payload) return res.status(401).json({ error: '請先登入' });

  const db = getDb();
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(req.params.id, payload.id);
  if (!card) return res.status(404).json({ error: '名片不存在' });
  res.json({ ok: true, card });
});

router.put('/user/cards/:id', (req, res) => {
  const payload = verifyUserToken(req);
  if (!payload) return res.status(401).json({ error: '請先登入' });

  const db = getDb();
  const user = db.prepare('SELECT is_vip FROM users WHERE id = ?').get(payload.id);
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(req.params.id, payload.id);
  if (!card) return res.status(404).json({ error: '名片不存在或無權限' });

  const d = req.body;

  // 非 VIP 不可填社群/網站欄位，也不能自訂個別顏色
  if (!user.is_vip) {
    d.facebook = '';
    d.instagram = '';
    d.linkedin = '';
    d.website = '';
    d.color_config = '';
  }

  try {
    const domain = process.env.DOMAIN || 'https://card.ks-digi.com';
    const colorConfig = user.is_vip && d.color_config ? d.color_config : '';
    const merged = { ...card, ...d, color_config: colorConfig };
    const flexJson = JSON.stringify(buildFlexJson(merged, domain));

    const allowShare = user.is_vip && d.allow_share ? 1 : 0;

    db.prepare(`
      UPDATE cards SET name=?, title=?, company=?, department=?, phone=?, email=?, line_id=?,
        website=?, address=?, facebook=?, instagram=?, linkedin=?, avatar_url=?,
        theme_color=?, flex_json=?, allow_share=?, color_config=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND user_id=?
    `).run(
      d.name || card.name, d.title ?? card.title, d.company ?? card.company,
      d.department ?? card.department, d.phone ?? card.phone, d.email ?? card.email,
      d.line_id ?? card.line_id, d.website ?? card.website, d.address ?? card.address,
      d.facebook ?? card.facebook, d.instagram ?? card.instagram, d.linkedin ?? card.linkedin,
      d.avatar_url ?? card.avatar_url, d.theme_color ?? card.theme_color, flexJson, allowShare,
      colorConfig, req.params.id, payload.id
    );

    res.json({ ok: true, message: '更新成功' });
  } catch (e) {
    res.status(500).json({ error: '更新失敗: ' + e.message });
  }
});

router.delete('/user/cards/:id', (req, res) => {
  const payload = verifyUserToken(req);
  if (!payload) return res.status(401).json({ error: '請先登入' });

  const db = getDb();
  const card = db.prepare('SELECT id FROM cards WHERE id = ? AND user_id = ?').get(req.params.id, payload.id);
  if (!card) return res.status(404).json({ error: '名片不存在或無權限' });

  db.prepare('DELETE FROM cards WHERE id = ? AND user_id = ?').run(req.params.id, payload.id);
  res.json({ ok: true });
});

router.post('/user/upload', upload.single('file'), (req, res) => {
  const payload = verifyUserToken(req);
  if (!payload) return res.status(401).json({ error: '請先登入' });
  if (!req.file) return res.status(400).json({ error: '請選擇圖片' });

  const domain = process.env.DOMAIN || 'https://card.ks-digi.com';
  const url = `${domain}/uploads/${req.file.filename}`;
  res.json({ ok: true, url });
});

// ==========================================
// 管理員名片 CRUD
// ==========================================

router.get('/cards', authApi, (req, res) => {
  const db = getDb();
  const cards = db.prepare(`
    SELECT c.id, c.slug, c.name, c.company, c.title, c.phone, c.email, c.is_active,
           c.view_count, c.share_count, c.owner_type, c.user_id, c.created_at,
           u.email as user_email, u.name as user_name, u.is_vip as user_vip
    FROM cards c LEFT JOIN users u ON c.user_id = u.id
    ORDER BY c.created_at DESC
  `).all();
  res.json({ ok: true, cards });
});

router.get('/cards/:id', authApi, (req, res) => {
  const db = getDb();
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: '名片不存在' });
  res.json({ ok: true, card });
});

router.post('/cards', authApi, (req, res) => {
  const db = getDb();
  const d = req.body;
  if (!d.name) return res.status(400).json({ error: '姓名為必填' });

  let slug = d.slug || d.name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slug) slug = uuidv4().slice(0, 8);
  const existing = db.prepare('SELECT id FROM cards WHERE slug = ?').get(slug);
  if (existing) slug = slug + '-' + uuidv4().slice(0, 4);

  try {
    const domain = process.env.DOMAIN || 'https://card.ks-digi.com';
    const tempCard = { ...d, slug };
    const flexJson = d.flex_json || JSON.stringify(buildFlexJson(tempCard, domain));

    const stmt = db.prepare(`
      INSERT INTO cards (slug, owner_type, name, title, company, department, phone, email, line_id, website, address,
        facebook, instagram, linkedin, avatar_url, logo_url, theme_color, flex_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      slug, 'admin', d.name, d.title || '', d.company || '', d.department || '',
      d.phone || '', d.email || '', d.line_id || '', d.website || '', d.address || '',
      d.facebook || '', d.instagram || '', d.linkedin || '',
      d.avatar_url || '', d.logo_url || '', d.theme_color || '#06c755', flexJson
    );
    res.json({ ok: true, card: { id: result.lastInsertRowid, slug }, share_url: `${domain}/share/${slug}` });
  } catch (e) {
    res.status(500).json({ error: '建立失敗: ' + e.message });
  }
});

router.put('/cards/:id', authApi, (req, res) => {
  const db = getDb();
  const d = req.body;
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: '名片不存在' });

  try {
    const domain = process.env.DOMAIN || 'https://card.ks-digi.com';
    const merged = { ...card, ...d };
    const flexJson = d.flex_json || JSON.stringify(buildFlexJson(merged, domain));

    db.prepare(`
      UPDATE cards SET name=?, title=?, company=?, department=?, phone=?, email=?, line_id=?,
        website=?, address=?, facebook=?, instagram=?, linkedin=?, avatar_url=?, logo_url=?,
        theme_color=?, flex_json=?, is_active=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      d.name || card.name, d.title ?? card.title, d.company ?? card.company,
      d.department ?? card.department, d.phone ?? card.phone, d.email ?? card.email,
      d.line_id ?? card.line_id, d.website ?? card.website, d.address ?? card.address,
      d.facebook ?? card.facebook, d.instagram ?? card.instagram, d.linkedin ?? card.linkedin,
      d.avatar_url ?? card.avatar_url, d.logo_url ?? card.logo_url,
      d.theme_color ?? card.theme_color, flexJson,
      d.is_active ?? card.is_active, req.params.id
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '更新失敗: ' + e.message });
  }
});

router.delete('/cards/:id', authApi, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM cards WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/upload', authApi, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請選擇圖片' });
  const domain = process.env.DOMAIN || 'https://card.ks-digi.com';
  const url = `${domain}/uploads/${req.file.filename}`;
  res.json({ ok: true, url });
});

// 管理員：建立自創名片（直接貼入 Flex JSON）
router.post('/cards/custom', authApi, (req, res) => {
  const db = getDb();
  const { name, slug: rawSlug, flexJson, userId } = req.body;

  if (!name) return res.status(400).json({ error: '名片名稱為必填' });
  if (!flexJson) return res.status(400).json({ error: '請貼入 Flex Message JSON' });

  // 驗證 JSON 格式
  let parsedFlex;
  try {
    parsedFlex = typeof flexJson === 'string' ? JSON.parse(flexJson) : flexJson;
    if (!parsedFlex.type) throw new Error('缺少 type 欄位');
  } catch (e) {
    return res.status(400).json({ error: 'JSON 格式錯誤: ' + e.message });
  }

  let slug = rawSlug || name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slug) slug = require('uuid').v4().slice(0, 8);
  const existing = db.prepare('SELECT id FROM cards WHERE slug = ?').get(slug);
  if (existing) slug = slug + '-' + require('uuid').v4().slice(0, 4);

  try {
    const domain = process.env.DOMAIN || 'https://card.ks-digi.com';

    const stmt = db.prepare(`
      INSERT INTO cards (slug, owner_type, user_id, name, flex_json, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);

    const ownerType = userId ? 'self' : 'admin';
    const result = stmt.run(slug, ownerType, userId || null, name, JSON.stringify(parsedFlex));

    res.json({
      ok: true,
      card: { id: result.lastInsertRowid, slug },
      share_url: `${domain}/share/${slug}`
    });
  } catch (e) {
    res.status(500).json({ error: '建立失敗: ' + e.message });
  }
});

// 管理員：更新名片的自創 Flex JSON
router.put('/cards/:id/flex', authApi, (req, res) => {
  const db = getDb();
  const { flexJson } = req.body;

  const card = db.prepare('SELECT id FROM cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: '名片不存在' });

  let parsedFlex;
  try {
    parsedFlex = typeof flexJson === 'string' ? JSON.parse(flexJson) : flexJson;
    if (!parsedFlex.type) throw new Error('缺少 type 欄位');
  } catch (e) {
    return res.status(400).json({ error: 'JSON 格式錯誤: ' + e.message });
  }

  db.prepare('UPDATE cards SET flex_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    JSON.stringify(parsedFlex), req.params.id
  );
  res.json({ ok: true, message: 'Flex JSON 已更新' });
});

// ==========================================
// 公開 API（分享頁面用）
// ==========================================

router.get('/public/card/:slug', (req, res) => {
  const db = getDb();
  const card = db.prepare('SELECT * FROM cards WHERE slug = ? AND is_active = 1').get(req.params.slug);
  if (!card) return res.status(404).json({ error: '名片不存在' });

  db.prepare('UPDATE cards SET view_count = view_count + 1 WHERE id = ?').run(card.id);
  db.prepare('INSERT INTO view_logs (card_id, action, ip, ua) VALUES (?, ?, ?, ?)').run(
    card.id, 'view', req.ip, req.get('user-agent') || ''
  );

  let flex;
  if (card.owner_type === 'admin' && card.flex_json) {
    // 後台自定義的 Flex JSON 優先使用
    try { flex = JSON.parse(card.flex_json); } catch (e) { flex = buildFlexJson(card, process.env.DOMAIN || 'https://card.ks-digi.com'); }
  } else {
    // 用戶建立的名片即時生成（確保 allow_share 即時反映）
    flex = buildFlexJson(card, process.env.DOMAIN || 'https://card.ks-digi.com');
  }

  res.json({ ok: true, name: card.name, altText: `${card.name} 的名片`, flex });
});

router.post('/public/card/:slug/shared', (req, res) => {
  const db = getDb();
  const card = db.prepare('SELECT id FROM cards WHERE slug = ?').get(req.params.slug);
  if (!card) return res.status(404).json({ error: '名片不存在' });

  db.prepare('UPDATE cards SET share_count = share_count + 1 WHERE id = ?').run(card.id);
  db.prepare('INSERT INTO view_logs (card_id, action, ip, ua) VALUES (?, ?, ?, ?)').run(
    card.id, 'share', req.ip, req.get('user-agent') || ''
  );
  res.json({ ok: true });
});

// ==========================================
// 管理員：統計
// ==========================================

router.get('/stats', authApi, (req, res) => {
  const db = getDb();
  const totalCards = db.prepare('SELECT COUNT(*) as count FROM cards').get().count;
  const activeCards = db.prepare('SELECT COUNT(*) as count FROM cards WHERE is_active = 1').get().count;
  const totalViews = db.prepare('SELECT COALESCE(SUM(view_count), 0) as count FROM cards').get().count;
  const totalShares = db.prepare('SELECT COALESCE(SUM(share_count), 0) as count FROM cards').get().count;
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const vipUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_vip = 1').get().count;
  const recentLogs = db.prepare('SELECT vl.*, c.name, c.slug FROM view_logs vl JOIN cards c ON c.id = vl.card_id ORDER BY vl.created_at DESC LIMIT 20').all();

  res.json({ ok: true, stats: { totalCards, activeCards, totalViews, totalShares, totalUsers, vipUsers }, recentLogs });
});

// ==========================================
// 管理員：用戶管理（搜尋、VIP 切換、密碼重設）
// ==========================================

// 取得所有用戶（支援搜尋）
router.get('/users', authApi, (req, res) => {
  const db = getDb();
  const search = req.query.q ? `%${req.query.q}%` : null;
  const vipFilter = req.query.vip; // '1' or '0'

  let sql = 'SELECT id, email, name, phone, is_vip, vip_at, created_at FROM users';
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(email LIKE ? OR name LIKE ?)');
    params.push(search, search);
  }
  if (vipFilter === '1') { conditions.push('is_vip = 1'); }
  else if (vipFilter === '0') { conditions.push('is_vip = 0'); }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC';

  const users = db.prepare(sql).all(...params);

  const usersWithCards = users.map(u => {
    const cards = db.prepare(
      'SELECT id, slug, name, company, title, is_active, view_count, share_count, created_at FROM cards WHERE user_id = ? ORDER BY created_at DESC'
    ).all(u.id);
    return { ...u, cards, card_count: cards.length };
  });

  res.json({ ok: true, users: usersWithCards });
});

// 切換 VIP 狀態
router.put('/users/:id/vip', authApi, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用戶不存在' });

  const newVip = user.is_vip ? 0 : 1;
  const vipAt = newVip ? new Date().toISOString() : null;
  db.prepare('UPDATE users SET is_vip = ?, vip_at = ? WHERE id = ?').run(newVip, vipAt, req.params.id);

  res.json({ ok: true, is_vip: newVip, message: newVip ? '已升級為 VIP' : '已取消 VIP' });
});

// 重設用戶密碼
router.put('/users/:id/password', authApi, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: '密碼至少 6 個字元' });

  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用戶不存在' });

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ ok: true, message: '密碼已重設' });
});

router.delete('/users/:id', authApi, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用戶不存在' });

  // 刪除該用戶的所有名片及瀏覽紀錄
  const cards = db.prepare('SELECT id FROM cards WHERE user_id = ?').all(req.params.id);
  for (const card of cards) {
    db.prepare('DELETE FROM view_logs WHERE card_id = ?').run(card.id);
  }
  db.prepare('DELETE FROM cards WHERE user_id = ?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);

  res.json({ ok: true, message: `已刪除用戶「${user.name}」及其所有名片` });
});

// ==========================================
// Helper
// ==========================================

function verifyUserToken(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'default-secret-change-me');
    if (payload.role !== 'user') return null;
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = router;
