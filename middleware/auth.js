const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error('JWT_SECRET 未設定或過短，請在 .env 設定至少 32 字元的隨機密鑰');
  process.exit(1);
}

// 驗證 JWT token（API 用）
function authApi(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  if (!token) return res.status(401).json({ error: '請先登入' });
  try {
    req.admin = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: '登入已過期，請重新登入' });
  }
}

// 驗證 JWT token（頁面用，未登入導向登入頁）
function authPage(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.redirect('/admin/login');
  try {
    req.admin = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    return res.redirect('/admin/login');
  }
}

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '24h' });
}

module.exports = { authApi, authPage, signToken };
