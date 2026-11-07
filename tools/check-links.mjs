/* 링크 점검 — node tools/check-links.mjs [dist]
 * dist/ 의 모든 HTML 에서 사이트 안 링크(href)와 img·audio·source 의 src·srcset 을 모아 dist/ 안에 파일이 있는지 본다.
 * BASE_PATH 로 빌드했으면 같은 BASE_PATH 로 실행한다. 없는 파일이 하나라도 있으면 종료 코드 1. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');

const htmls = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.html')) htmls.push(f); } })(OUT);

const missing = new Map();   /* 주소 → 처음 나온 페이지 */
let checked = 0, external = 0;
const exists = (u) => {
  let p = decodeURIComponent(u.split('#')[0].split('?')[0]);
  if (BASE) { if (!p.startsWith(BASE + '/') && p !== BASE) return false; p = p.slice(BASE.length) || '/'; }
  const f = path.join(OUT, p);
  if (p.endsWith('/')) return fs.existsSync(path.join(f, 'index.html'));
  return fs.existsSync(f) && fs.statSync(f).isFile();
};
for (const f of htmls) {
  const h = fs.readFileSync(f, 'utf8');
  const page = '/' + path.relative(OUT, f).replace(/\\/g, '/');
  const urls = new Set();
  const body = h.slice(h.indexOf('<body'));   /* head 의 canonical·og:url·피드 링크는 일부러 절대 주소다 — 본문에 남은 절대 주소만 잡는다 */
  for (const m of body.matchAll(/\s(?:href|src|poster)="([^"]+)"/g)) urls.add(m[1]);
  for (const m of h.matchAll(/<link[^>]*rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)) urls.add(m[1]);
  for (const m of body.matchAll(/\ssrcset="([^"]+)"/g)) for (const s of m[1].split(',')) urls.add(s.trim().split(/\s+/)[0]);
  for (const m of body.matchAll(/url\(([^)]+)\)/g)) urls.add(m[1].replace(/['"]/g, ''));
  for (const u of urls) {
    if (/^(https?:)?\/\//.test(u)) { if (/^https?:\/\/daytip\.kr\//.test(u)) { if (!missing.has(u)) missing.set(u, page + ' (절대 주소가 남음)'); } else external++; continue; }
    if (/^(mailto:|tel:|#|data:|javascript:)/.test(u)) continue;
    checked++;
    if (!exists(u)) { if (!missing.has(u)) missing.set(u, page); }
  }
}
console.log(`HTML ${htmls.length}장, 사이트 안 주소 ${checked}개 점검, 바깥 링크 ${external}개 건너뜀`);
if (missing.size) {
  console.log(`없는 주소 ${missing.size}개:`);
  for (const [u, page] of [...missing].slice(0, 80)) console.log(`  ${u}  ← ${page}`);
  process.exit(1);
}
console.log('없는 주소 없음');
