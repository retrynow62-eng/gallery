// DB 초기화 (자동 실행)
const Database = require('better-sqlite3');
const db = new Database('data/gallery.db');

db.pragma('journal_mode = WAL');

db.prepare(`
CREATE TABLE IF NOT EXISTS comics (
  id TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  uploader_ip TEXT,
  created_at INTEGER
);
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comic_id TEXT,
  filename TEXT,
  "order" INTEGER,
  FOREIGN KEY(comic_id) REFERENCES comics(id) ON DELETE CASCADE
);
`).run();

module.exports = db;
