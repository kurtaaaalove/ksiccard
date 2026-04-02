# 🚀 商轉版部署指南 — card.ks-digi.com

## 一、寶塔面板操作

### 1. 修改網站設定

你之前建的 `card.ks-digi.com` 目前是純靜態站，
現在要改成 **Node.js 反向代理**。

在寶塔面板：
- 左側 → **網站** → 點 `card.ks-digi.com` → **設定**
- 點 **配置文件**（Nginx config）
- 找到 `location /` 那個區塊，**在它上面**加入：

```nginx
# === Node.js API 反向代理 ===
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# === 上傳的圖片 ===
location /uploads/ {
    proxy_pass http://127.0.0.1:3000;
}

# === LIFF 分享頁（動態路由）===
location /share/ {
    proxy_pass http://127.0.0.1:3000;
}

# === 後台頁面 ===
location /admin {
    proxy_pass http://127.0.0.1:3000;
}

# === 客人註冊/編輯 ===
location /register {
    proxy_pass http://127.0.0.1:3000;
}
location /edit {
    proxy_pass http://127.0.0.1:3000;
}
```

儲存。

> 💡 或者更簡單：把整個站都 proxy 給 Node.js。
> 把原本的 `location / { ... }` 整段改成：
> ```nginx
> location / {
>     proxy_pass http://127.0.0.1:3000;
>     proxy_set_header Host $host;
>     proxy_set_header X-Real-IP $remote_addr;
>     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
>     proxy_set_header X-Forwarded-Proto $scheme;
> }
> ```

### 2. 確認 Node.js 環境

SSH 登入伺服器，確認 Node.js 版本：
```bash
node -v   # 需要 v16 以上
npm -v
```

如果版本太舊，在寶塔 → **軟體商店** → 搜尋 **Node.js版本管理器** → 安裝 v18 或 v20。

---

## 二、上傳並啟動專案

### 1. 上傳檔案

把整個 `card-platform` 資料夾上傳到伺服器。建議放在：

```
/www/wwwroot/card.ks-digi.com/
```

你可以透過寶塔檔案管理上傳，或用 SSH：

```bash
cd /www/wwwroot/card.ks-digi.com

# 先備份舊檔案
mkdir -p /tmp/card-old-backup && cp -r ./* /tmp/card-old-backup/ 2>/dev/null

# 清空目錄
rm -rf ./*

# 上傳新檔案（透過寶塔檔案管理上傳 card-platform 裡的所有檔案）
# 或用 scp/sftp 上傳
```

確保目錄結構如下：
```
/www/wwwroot/card.ks-digi.com/
├── server.js
├── package.json
├── .env              ← 從 .env.example 複製並修改
├── database/
│   └── init.js
├── middleware/
│   └── auth.js
├── routes/
│   ├── api.js
│   └── flex-builder.js
├── views/
│   ├── home.html
│   ├── admin-login.html
│   ├── admin.html
│   ├── register.html
│   ├── edit.html
│   └── share.html
├── public/
│   └── (靜態檔案)
└── uploads/
    └── (上傳的圖片)
```

### 2. 設定環境變數

```bash
cd /www/wwwroot/card.ks-digi.com
cp .env.example .env
```

編輯 `.env`：
```bash
vi .env
```

修改以下內容：
```
PORT=3000
DOMAIN=https://card.ks-digi.com
JWT_SECRET=這裡改成一個隨機長字串
LIFF_ID=2007344981-yXozKWX0
ADMIN_USER=admin
ADMIN_PASS=你的管理員密碼
```

### 3. 安裝依賴

```bash
cd /www/wwwroot/card.ks-digi.com
npm install
```

### 4. 測試啟動

```bash
node server.js
```

應該看到：
```
✅ 預設管理員已建立: admin
✅ 資料庫初始化完成
🚀 名片平台已啟動: http://localhost:3000
```

按 `Ctrl+C` 停止。

### 5. 用 PM2 常駐運行

```bash
# 安裝 PM2（如果還沒裝）
npm install -g pm2

# 啟動
cd /www/wwwroot/card.ks-digi.com
pm2 start server.js --name "card-platform"

# 設定開機自啟
pm2 save
pm2 startup
```

PM2 常用指令：
```bash
pm2 list              # 查看運行狀態
pm2 logs card-platform # 查看日誌
pm2 restart card-platform  # 重啟
pm2 stop card-platform     # 停止
```

---

## 三、更新 LIFF 設定

到 [LINE Developers Console](https://developers.line.biz/console/)：

1. 確認 LIFF Endpoint URL 仍是 `https://card.ks-digi.com`
2. **重要**：如果你之前有分開的 LIFF App 給 card/ 和 share/，
   現在統一用主要的那個就好，因為 `/share/:slug` 現在是動態路由

---

## 四、測試清單

啟動完成後，逐項測試：

| 測試項目 | URL | 預期結果 |
|---------|-----|---------|
| 首頁 | https://card.ks-digi.com | 看到三個按鈕 |
| 管理員登入 | https://card.ks-digi.com/admin/login | 登入表單 |
| 後台 | https://card.ks-digi.com/admin | 名片列表（需登入） |
| 客人註冊 | https://card.ks-digi.com/register | 註冊表單 |
| 客人編輯 | https://card.ks-digi.com/edit | 登入後可編輯 |
| 名片分享 | https://card.ks-digi.com/share/test | LIFF 分享頁 |

---

## 五、日常維護

### 備份資料庫
```bash
cp /www/wwwroot/card.ks-digi.com/database/cards.db /tmp/cards-backup-$(date +%Y%m%d).db
```

### 更新程式碼後重啟
```bash
cd /www/wwwroot/card.ks-digi.com
pm2 restart card-platform
```

### 查看錯誤日誌
```bash
pm2 logs card-platform --lines 50
```

---

## 六、安全建議

1. **務必修改** `.env` 中的 `JWT_SECRET` 和 `ADMIN_PASS`
2. 首次登入後台後建議修改管理員密碼
3. 定期備份 `database/cards.db`
4. 確保 `uploads/` 目錄權限為 755
5. Nginx 已經有 SSL，確保強制 HTTPS 開啟
