// 서버 메인
require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const db = require('./db/init');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const THUMB_DIR = path.join(UPLOAD_DIR, 'thumbs');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR);

const app = express();
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));
app.use(helmet());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/public', express.static(path.join(__dirname, 'public')));

// 기본 레이트리미트 (IP당 초당/분 제한)
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1분
  max: 5, // 분당 업로드 시도 수 제한 (환경/운영에 맞게 조정)
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/upload', uploadLimiter);

// Multer 설정 (메모리 저장 후 파일 검사/저장)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: (parseInt(process.env.MAX_UPLOAD_MB || '50', 10) * 1024 * 1024),
    files: 100
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(null, false);
  }
});

// 홈: 갤러리 (간단 페이징)
app.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const per = 12;
  const total = db.prepare('SELECT COUNT(*) as c FROM comics').get().c;
  const comics = db.prepare('SELECT id, title, created_at FROM comics ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(per, (page - 1) * per);
  // 썸네일 경로(uploads/thumbs/{id}.jpg)
  res.render('index', { comics, page, per, total });
});

// 업로드 폼
app.get('/upload', (req, res) => {
  res.render('upload');
});

// 업로드 처리
app.post('/upload', upload.array('pages', 100), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).send('No files uploaded.');

    const comicId = uuidv4();
    const title = (req.body.title || '').slice(0, 200) || 'untitled';
    const description = (req.body.description || '').slice(0, 2000);
    const uploader_ip = req.ip;
    const created_at = Date.now();

    // 디렉토리 생성
    const comicDir = path.join(UPLOAD_DIR, comicId);
    fs.mkdirSync(comicDir);

    const insertComic = db.prepare('INSERT INTO comics (id, title, description, uploader_ip, created_at) VALUES (?, ?, ?, ?, ?)');
    insertComic.run(comicId, title, description, uploader_ip, created_at);

    const insertPage = db.prepare('INSERT INTO pages (comic_id, filename, "order") VALUES (?, ?, ?)');
    // 저장 순서 보장
    for (let i = 0; i < req.files.length; i++) {
      const f = req.files[i];
      // 확장자 추출
      const ext = (f.mimetype === 'image/png') ? '.png' :
                  (f.mimetype === 'image/webp') ? '.webp' :
                  (f.mimetype === 'image/gif') ? '.gif' : '.jpg';
      const filename = `${String(i + 1).padStart(3, '0')}${ext}`;
      const outPath = path.join(comicDir, filename);
      // 안전하게 파일 저장 (메모리 -> 디스크)
      fs.writeFileSync(outPath, f.buffer);
      insertPage.run(comicId, `/uploads/${comicId}/${filename}`, i + 1);
    }

    // 썸네일(첫 페이지) 생성
    const firstPage = path.join(comicDir, fs.readdirSync(comicDir).sort()[0]);
    const thumbOut = path.join(THUMB_DIR, `${comicId}.jpg`);
    await sharp(firstPage)
      .resize({ width: parseInt(process.env.THUMB_MAX_WIDTH || '400', 10) })
      .jpeg({ quality: 80 })
      .toFile(thumbOut);

    res.redirect(`/comic/${comicId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Upload error');
  }
});

// 뷰어
app.get('/comic/:id', (req, res) => {
  const id = req.params.id;
  const comic = db.prepare('SELECT id, title, description, created_at FROM comics WHERE id = ?').get(id);
  if (!comic) return res.status(404).send('Not found');
  const pages = db.prepare('SELECT filename, "order" FROM pages WHERE comic_id = ? ORDER BY "order" ASC').all(id);
  res.render('view', { comic, pages, thumb: `/uploads/thumbs/${id}.jpg` });
});

// 간단한 삭제(관리자 토큰 필요)
app.post('/admin/delete', (req, res) => {
  const token = req.body.token || '';
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return res.status(403).send('Forbidden');
  const id = req.body.id;
  if (!id) return res.status(400).send('Missing id');
  // 파일 삭제
  const comicDir = path.join(UPLOAD_DIR, id);
  if (fs.existsSync(comicDir)) {
    fs.rmSync(comicDir, { recursive: true, force: true });
  }
  const thumb = path.join(THUMB_DIR, `${id}.jpg`);
  if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
  db.prepare('DELETE FROM pages WHERE comic_id = ?').run(id);
  db.prepare('DELETE FROM comics WHERE id = ?').run(id);
  res.send('Deleted');
});

// 간단 API: 최신 n개 (JSON)
app.get('/api/latest', (req, res) => {
  const n = Math.min(50, parseInt(req.query.n || '20', 10));
  const rows = db.prepare('SELECT id, title, created_at FROM comics ORDER BY created_at DESC LIMIT ?').all(n);
  res.json(rows);
});

// 시작
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
