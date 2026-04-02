const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'cards.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  const db = getDb();

  // 管理員表
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 使用者表（客人帳號）
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      is_vip INTEGER NOT NULL DEFAULT 0,
      vip_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 名片表（核心）
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      owner_type TEXT NOT NULL DEFAULT 'admin',
      user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,

      name TEXT NOT NULL,
      title TEXT DEFAULT '',
      company TEXT DEFAULT '',
      department TEXT DEFAULT '',

      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      line_id TEXT DEFAULT '',
      website TEXT DEFAULT '',
      address TEXT DEFAULT '',

      facebook TEXT DEFAULT '',
      instagram TEXT DEFAULT '',
      linkedin TEXT DEFAULT '',

      avatar_url TEXT DEFAULT '',
      logo_url TEXT DEFAULT '',
      theme_color TEXT DEFAULT '#06c755',

      flex_json TEXT DEFAULT '',

      is_active INTEGER NOT NULL DEFAULT 1,
      view_count INTEGER NOT NULL DEFAULT 0,
      share_count INTEGER NOT NULL DEFAULT 0,

      password_hash TEXT DEFAULT '',

      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 瀏覽紀錄
  db.exec(`
    CREATE TABLE IF NOT EXISTS view_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      action TEXT NOT NULL DEFAULT 'view',
      ip TEXT DEFAULT '',
      ua TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cards_slug ON cards(slug);
    CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_logs_card ON view_logs(card_id);
    CREATE INDEX IF NOT EXISTS idx_logs_date ON view_logs(created_at);
  `);

  // 為既有資料庫加欄位（如果不存在）
  const alterColumns = [
    'ALTER TABLE cards ADD COLUMN user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL',
    'ALTER TABLE users ADD COLUMN is_vip INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN vip_at DATETIME DEFAULT NULL',
<<<<<<< HEAD
    'ALTER TABLE cards ADD COLUMN allow_share INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE cards ADD COLUMN color_config TEXT DEFAULT ""',
=======
>>>>>>> 2dc27ee2c4d727f45fa8c47070dbf948720a22af
  ];
  for (const sql of alterColumns) {
    try { db.exec(sql); } catch (e) { /* 欄位已存在 */ }
  }

  // 建立預設管理員
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'admin123';
  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(adminUser);
  if (!existing) {
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare('INSERT INTO admins (username, password_hash, display_name) VALUES (?, ?, ?)').run(
      adminUser, hash, '系統管理員'
    );
    console.log(`✅ 預設管理員已建立: ${adminUser}`);
  }

  console.log('✅ 資料庫初始化完成');
}

module.exports = { getDb, initDatabase };
