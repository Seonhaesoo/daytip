/* 데이팁 워드프레스 내보내기 — node tools/export-wp.mjs
 * daytip.kr 의 공개 REST API(/wp-json/wp/v2/)에서 글·페이지·분류·태그·미디어 목록을 data/ 에 JSON 으로 받고,
 * 미디어 원본 파일을 public/wp-content/uploads/연/월/파일명 — 지금 주소와 똑같은 경로 — 에 내려받는다.
 * 다시 실행하면 이미 받은 파일(크기가 같은 것)은 건너뛴다. 전체 용량이 800MB 를 넘으면 멈추고 알린다.
 * NinjaFirewall 이 기본 curl UA 를 403 으로 막으므로 브라우저 UA 를 보내고, 동시 요청은 3개, 요청 사이 짧은 간격을 둔다. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
const SITE = 'https://daytip.kr';
const API = `${SITE}/wp-json/wp/v2`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const LIMIT_BYTES = 800 * 1024 * 1024;
const CONCURRENCY = 3;
const DELAY_MS = 120;
const ONLY = new Set(process.argv.slice(2));   /* 예: node tools/export-wp.mjs data  (미디어 내려받기 생략) */

fs.mkdirSync(DATA, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { asBuffer = false, tries = 4 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: asBuffer ? '*/*' : 'application/json' } });
      if (res.status === 404) return { status: 404 };
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      await sleep(DELAY_MS);
      return { status: res.status, headers: res.headers, body: asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.json() };
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
  throw new Error(`요청 실패 ${url}`);
}

/* REST 목록을 끝까지 넘겨 가며 받는다 */
async function list(type, fields, extra = '') {
  const out = [];
  for (let page = 1; ; page++) {
    const url = `${API}/${type}?per_page=100&page=${page}&_fields=${fields}${extra}`;
    const r = await get(url);
    if (r.status === 404) break;
    out.push(...r.body);
    const total = Number(r.headers.get('x-wp-totalpages') || 1);
    process.stdout.write(`  ${type} ${page}/${total} (${out.length})\r`);
    if (page >= total) break;
  }
  console.log(`  ${type}: ${out.length}건                `);
  return out;
}

const POST_FIELDS = 'id,slug,date,date_gmt,modified,modified_gmt,status,link,title,content,excerpt,categories,tags,featured_media,author,sticky,format';
const PAGE_FIELDS = 'id,slug,date,date_gmt,modified,modified_gmt,status,link,title,content,excerpt,featured_media,author,parent,menu_order';
const MEDIA_FIELDS = 'id,slug,date,title,alt_text,caption,mime_type,source_url,post,media_details.width,media_details.height,media_details.filesize,media_details.file';

function save(name, obj) {
  fs.writeFileSync(path.join(DATA, name), JSON.stringify(obj, null, 1));
}

/* 글·페이지 JSON 을 가볍게 — rendered 만 남긴다 */
function slim(p, users) {
  const u = users.find((x) => x.id === p.author);
  return {
    id: p.id, slug: p.slug, status: p.status, link: p.link,
    date: p.date, date_gmt: p.date_gmt, modified: p.modified, modified_gmt: p.modified_gmt,
    title: p.title.rendered, content: p.content.rendered, excerpt: p.excerpt.rendered,
    categories: p.categories || [], tags: p.tags || [], featured_media: p.featured_media || 0,
    author: u ? u.name : '', sticky: !!p.sticky, parent: p.parent || 0, menu_order: p.menu_order || 0,
  };
}

async function exportData() {
  console.log('목록 받기');
  const users = await list('users', 'id,name,slug,description');
  const categories = await list('categories', 'id,slug,name,description,parent,count,link');
  const tags = await list('tags', 'id,slug,name,description,count,link');
  const posts = (await list('posts', POST_FIELDS)).map((p) => slim(p, users));
  const pages = (await list('pages', PAGE_FIELDS)).map((p) => slim(p, users));
  const media = await list('media', MEDIA_FIELDS);
  save('users.json', users);
  save('categories.json', categories);
  save('tags.json', tags);
  save('posts.json', posts.sort((a, b) => (a.date < b.date ? 1 : -1)));
  save('pages.json', pages);
  save('media.json', media.map((m) => ({
    id: m.id, slug: m.slug, date: m.date, title: m.title?.rendered || '', alt: m.alt_text || '', caption: m.caption?.rendered || '',
    mime: m.mime_type, source_url: m.source_url, post: m.post || 0,
    width: m.media_details?.width || 0, height: m.media_details?.height || 0, filesize: m.media_details?.filesize || 0,
  })));
  /* 사이트 공통 정보 — 라이브 head 에서 읽은 값 */
  save('site.json', {
    name: '데이팁', description: '일상생활및 작업실무 팁', url: SITE, lang: 'ko-KR',
    icon: '/wp-content/uploads/2026/08/icon-a-dark-d-300x300.png', icon32: '/wp-content/uploads/2026/08/icon-a-dark-d-150x150.png',
    exported: new Date().toISOString(),
  });
}

/* 본문에 쓰인 업로드 주소 전부 — src, href, srcset, poster, 인라인 style url() */
function uploadUrlsIn(html) {
  const out = new Set();
  const re = /https?:\/\/daytip\.kr\/wp-content\/uploads\/[^\s"'<>()]+/g;
  for (const m of html.matchAll(re)) out.add(m[0].replace(/[,.;]+$/, ''));
  return out;
}

async function downloadAll() {
  const media = JSON.parse(fs.readFileSync(path.join(DATA, 'media.json'), 'utf8'));
  const posts = JSON.parse(fs.readFileSync(path.join(DATA, 'posts.json'), 'utf8'));
  const pages = JSON.parse(fs.readFileSync(path.join(DATA, 'pages.json'), 'utf8'));
  const site = JSON.parse(fs.readFileSync(path.join(DATA, 'site.json'), 'utf8'));
  const wanted = new Map();   /* url → 알려진 크기(0이면 모름) */
  for (const m of media) if (m.source_url) wanted.set(m.source_url, m.filesize || 0);
  for (const p of [...posts, ...pages]) for (const u of uploadUrlsIn(p.content + p.excerpt)) if (!wanted.has(u)) wanted.set(u, 0);
  for (const u of [site.icon, site.icon32]) wanted.set(SITE + u, 0);
  const urls = [...wanted.keys()];
  console.log(`내려받을 파일 ${urls.length}개 (미디어 목록 ${media.length} + 본문에서 찾은 추가 파일 ${urls.length - media.length - 2})`);

  const manifestPath = path.join(DATA, 'media-files.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  const missing = [];
  let done = 0, downloaded = 0, skipped = 0, bytes = 0, newBytes = 0, stop = false;

  async function one(url) {
    const rel = decodeURIComponent(new URL(url).pathname);   /* /wp-content/uploads/2026/08/day1-all.mp3 */
    const file = path.join(PUBLIC, rel);
    const known = manifest[rel] ?? wanted.get(url) ?? 0;
    if (fs.existsSync(file)) {
      const size = fs.statSync(file).size;
      if (size > 0 && (!known || size === known)) { skipped++; bytes += size; manifest[rel] = size; return; }
    }
    if (stop) return;
    const r = await get(url, { asBuffer: true });
    if (r.status === 404) { missing.push(rel); return; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, r.body);
    manifest[rel] = r.body.length;
    downloaded++; bytes += r.body.length; newBytes += r.body.length;
    if (bytes > LIMIT_BYTES) stop = true;
  }

  let idx = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < urls.length && !stop) {
      const url = urls[idx++];
      try { await one(url); } catch (e) { missing.push(`${url} — ${e.message}`); }
      done++;
      if (done % 50 === 0 || done === urls.length) {
        process.stdout.write(`  ${done}/${urls.length} 받음 ${downloaded} 건너뜀 ${skipped} 없음 ${missing.length} — ${(bytes / 1048576).toFixed(1)}MB\r`);
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
      }
    }
  });
  await Promise.all(workers);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  fs.writeFileSync(path.join(DATA, 'media-missing.json'), JSON.stringify(missing, null, 1));
  console.log(`\n파일 ${Object.keys(manifest).length}개, 합계 ${(bytes / 1048576).toFixed(1)}MB (이번에 받은 양 ${(newBytes / 1048576).toFixed(1)}MB), 서버에 없는 파일 ${missing.length}개 → data/media-missing.json`);
  if (stop) {
    console.error(`!! 합계가 ${LIMIT_BYTES / 1048576}MB 를 넘어 중단했습니다. 커밋하기 전에 용량을 줄일 방법을 정하세요.`);
    process.exit(2);
  }
}

const t0 = Date.now();
if (!ONLY.size || ONLY.has('data')) await exportData();
if (!ONLY.size || ONLY.has('media')) await downloadAll();
console.log(`${((Date.now() - t0) / 1000).toFixed(0)}초`);
