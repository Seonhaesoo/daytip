/* 로컬 개발 서버 — dist/ 를 정적으로 서빙 (node server.js → http://localhost:8327). BASE_PATH 로 빌드했으면 그 경로 아래에 붙는다 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = process.env.PORT || 8327;
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.json': 'application/json', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (BASE && p.startsWith(BASE)) p = p.slice(BASE.length) || '/';
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) && fs.existsSync(file + '/index.html')) { res.writeHead(301, { Location: BASE + p + '/' }); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { file = path.join(ROOT, '404.html'); res.statusCode = 404; }
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`데이팁 dev: http://localhost:${PORT}${BASE}/`));
