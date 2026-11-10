/* 데이팁 페이지 생성기 — node tools/build.mjs → dist/
 * data/ 의 글·페이지·분류(워드프레스에서 내보낸 JSON)와 public/ 의 업로드 파일로 정적 사이트를 만든다.
 * 주소는 워드프레스 때와 똑같다: /<slug>/, /category/<상위>/<하위>/, /page/N/, /feed/, /wp-content/uploads/연/월/파일.
 * 2026-11-08 중국어·일본어 공부 사이트로 고침 — 홈(오늘의 수업), 과정 목차(/chinese-course/ /japanese-course/ 를 글 데이터로 생성),
 *   단어장(/vocabulary/), 가나표(/kana/), 병음표(/pinyin/), 생활정보 모음(/life/) 을 수업 글 본문에서 뽑아(tools/lessons.mjs) 빌드 때마다 만든다.
 * BASE_PATH=/daytip 처럼 주면 모든 루트 상대 주소 앞에 붙인다(테스트용 seonhaesoo.github.io/daytip/). canonical 은 늘 https://daytip.kr 이다.
 * 발행일이 아직 안 된 글(KST 기준 미래)은 빼고 만든다 — 목차에는 "N월 N일 공개" 로만 보인다.
 * 2026-11-10 /admin/ 관리 현황(방문자·수업·글·바로가기) — 맨 끝에서 만든다. noindex·robots Disallow, 사이트맵·메뉴·바닥·피드에 없음. 본문은 ADMIN_PASSWORD 로 암호화해 싣고, 없으면 자료 없는 닫힌 쪽만 낸다.
 *   방문자 숫자는 data/admin/stats.json (tools/fetch-ga.mjs 가 쓴다; STATS_FILE 로 다른 파일을 가리킬 수 있다) 이 있을 때만. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { LANGS, langOf, lessonDay, reviewRange, parseLesson, parseReview } from './lessons.mjs';
import { checkLinks } from './check-links.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist');
const SITE = 'https://daytip.kr';
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');
const PROD = BASE === '';                                   /* 도메인 루트 빌드일 때만 통계·광고 스크립트를 넣는다 */
const GTAG_ID = 'GT-MBGF2V3V';                              /* 라이브 head 의 구글 태그(Site Kit) — 2026-11-08 확인 */
const ADSENSE = 'ca-pub-1562244199345682';                  /* 라이브 head·ads.txt 의 애드센스 게시자 ID */
const ADSENSE_HOST = 'ca-host-pub-2644536267352236';        /* Site Kit 이 붙이던 host 매개변수 — 라이브와 같게 */
const PER_PAGE = 10;                                        /* 워드프레스 기본값 */
const AUTHOR_SLUG = 'tjsgotn';
const LIFE_CATS = [19, 21, 20, 22];                         /* 정부지원금 · 생활법률·안전 · 부동산·세금 · 명절·생활상식 — 홈·메뉴에서 빠지고 /life/ 로 모은다 */
const WORLD_CAT = 26;                                       /* 세계 이야기(일본이야기·중국이야기) = 읽을거리 */
const CAT_LABEL = { 26: '읽을거리' };                        /* 화면에 보이는 분류 이름 (주소·데이터는 그대로) */
const t0 = Date.now();

const read = (n) => JSON.parse(fs.readFileSync(path.join(DATA, n), 'utf8'));
const site = read('site.json');
const categories = read('categories.json');
const tags = read('tags.json');
/* 페이지 = data/pages.json + data/pages/*.json (황금키워드가 수업 목차 페이지를 여기에 다시 쓴다; slug 가 같으면 이 쪽이 이긴다)
 * chinese-course · japanese-course 는 본문을 그대로 내지 않고 글 데이터로 목차를 만든다 — 페이지 JSON 에서는 소개 문단과 단원(h2 "발음 1~10일차") 구조만 가져온다. */
const pageMap = new Map();
for (const p of read('pages.json')) pageMap.set(p.slug, p);
const extraPages = path.join(DATA, 'pages');
if (fs.existsSync(extraPages)) for (const f of fs.readdirSync(extraPages).filter((f) => f.endsWith('.json')).sort()) {
  const p = JSON.parse(fs.readFileSync(path.join(extraPages, f), 'utf8'));
  for (const one of Array.isArray(p) ? p : [p]) pageMap.set(one.slug, one);
}
const pagesAll = [...pageMap.values()];
const users = read('users.json');
const mediaById = new Map(read('media.json').map((m) => [m.id, m]));

/* 글 = data/posts.json + data/posts/*.json (새 글은 파일 하나씩 더한다; slug 가 같으면 나중 것이 이긴다) */
const postMap = new Map();
for (const p of read('posts.json')) postMap.set(p.slug, p);
const extraDir = path.join(DATA, 'posts');
if (fs.existsSync(extraDir)) for (const f of fs.readdirSync(extraDir).filter((f) => f.endsWith('.json')).sort()) {
  const p = JSON.parse(fs.readFileSync(path.join(extraDir, f), 'utf8'));
  for (const one of Array.isArray(p) ? p : [p]) postMap.set(one.slug, one);
}
const nowKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19);   /* 워드프레스 date 는 KST 로컬 시각 */
const skippedFuture = [];
const publishable = [...postMap.values()].filter((p) => (p.status || 'publish') === 'publish');
const posts = publishable
  .filter((p) => { if (p.date > nowKst) { skippedFuture.push(p.slug); return false; } return true; })
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
const futurePosts = publishable.filter((p) => p.date > nowKst).sort((a, b) => (a.date < b.date ? -1 : 1));   /* 예약 글 — 목차에 "공개 예정" 으로만 */
const pages = pagesAll.filter((p) => (p.status || 'publish') === 'publish');
const BUILD_DATE = nowKst.slice(0, 10);

/* ---------- 작은 도구 ---------- */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·' };
const decode = (s) => String(s ?? '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&([a-z]+);/gi, (m, n) => NAMED[n] ?? m);
const text = (html) => decode(String(html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const url = (p) => BASE + p;                                          /* 사이트 안 주소 (BASE_PATH 반영) */
const abs = (p) => SITE + p;                                          /* canonical 등 — 늘 실제 도메인 */
const iso = (d) => (d ? d.slice(0, 19) + '+09:00' : '');
const fmtDate = (d) => `${d.slice(0, 4)}년 ${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
const fmtMD = (d) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
const write = (p, body) => { const f = path.join(OUT, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
const uploadExists = (rel) => { try { return fs.statSync(path.join(PUBLIC, decodeURIComponent(rel))).isFile(); } catch { return false; } };
const attrJson = (v) => JSON.stringify(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');   /* 큰따옴표 속성 안에 넣는 JSON */

/* 분류 — 워드프레스 경로(/category/study/chinese/)와 하위 분류 포함 글 수 */
const catById = new Map(categories.map((c) => [c.id, c]));
const catName = (c) => CAT_LABEL[c.id] || c.name;
function catPath(c) { const parts = []; for (let x = c; x; x = catById.get(x.parent)) parts.unshift(x.slug); return `/category/${parts.join('/')}/`; }
function catChain(c) { const out = []; for (let x = c; x; x = catById.get(x.parent)) out.unshift(x); return out; }
const children = (c) => categories.filter((x) => x.parent === c.id);
function descendantIds(c) { const ids = [c.id]; for (const k of children(c)) ids.push(...descendantIds(k)); return ids; }
const catPosts = (c) => { const ids = new Set(descendantIds(c)); return posts.filter((p) => p.categories.some((id) => ids.has(id))); };
const liveCats = categories.filter((c) => c.slug !== 'uncategorized' && catPosts(c).length);
const primaryCat = (p) => { const own = p.categories.map((id) => catById.get(id)).filter(Boolean); return own.sort((a, b) => catChain(b).length - catChain(a).length)[0]; };
const postsByCat = new Map(categories.map((c) => [c.id, catPosts(c)]));
const isLife = (p) => p.categories.some((id) => LIFE_CATS.includes(id));
const isWorld = (p) => { const ids = new Set(descendantIds(catById.get(WORLD_CAT))); return p.categories.some((id) => ids.has(id)); };

/* 메뉴 — 공부 중심. 생활정보는 맨 끝 하나로 */
const NAV = [['/', '홈'], ['/chinese-course/', '중국어'], ['/japanese-course/', '일본어'], ['/vocabulary/', '단어장'], ['/kana/', '가나표'], ['/pinyin/', '병음표'], [catPath(catById.get(WORLD_CAT)), '읽을거리'], ['/life/', '생활정보']];
function navKeyFor(p) {   /* 글·분류가 메뉴의 어디에 속하는지 */
  const l = langOf(p); if (l) return LANGS[l].hub;
  if (isWorld(p)) return catPath(catById.get(WORLD_CAT));
  if (isLife(p)) return '/life/';
  return '';
}
function navKeyForCat(c) { const top = catChain(c)[0]; if (c.id === 24 || c.id === 25) return LANGS[c.id === 24 ? 'zh' : 'ja'].hub; if (top.id === WORLD_CAT) return catPath(top); if (LIFE_CATS.includes(c.id)) return '/life/'; return ''; }

/* ---------- 수업 데이터 (tools/lessons.mjs) ---------- */
const lessons = { zh: [], ja: [] };          /* 공개된 수업 — 일차순 */
const scheduled = { zh: [], ja: [] };        /* 예약 수업 — "N월 N일 공개" */
const reviews = { zh: [], ja: [] };          /* 공개된 주간 복습 */
const scheduledReviews = { zh: [], ja: [] };
const lessonBySlug = new Map();
const unparsed = [];
for (const p of posts) {
  const lang = langOf(p); if (!lang) continue;
  const range = reviewRange(p);
  if (range) { const r = parseReview(p); reviews[lang].push({ post: p, range, parsed: r }); lessonBySlug.set(p.slug, { kind: 'review', lang, range, parsed: r }); continue; }
  const day = lessonDay(p);
  if (!day) { unparsed.push(`${p.slug} (일차를 못 읽음)`); continue; }
  const parsed = parseLesson(p);
  if (!parsed.words.length) unparsed.push(`${p.slug} (낱말 없음)`);
  lessons[lang].push({ post: p, day, parsed });
  lessonBySlug.set(p.slug, { kind: 'lesson', lang, day, parsed });
}
for (const p of futurePosts) {
  const lang = langOf(p); if (!lang) continue;
  const range = reviewRange(p);
  if (range) { scheduledReviews[lang].push({ post: p, range }); continue; }
  const day = lessonDay(p); if (day) scheduled[lang].push({ post: p, day });
}
for (const l of ['zh', 'ja']) { lessons[l].sort((a, b) => a.day - b.day || (a.post.date < b.post.date ? -1 : 1)); scheduled[l].sort((a, b) => a.day - b.day); reviews[l].sort((a, b) => a.range[1] - b.range[1]); }
/* 일차순 시간표: 수업 → 그 범위가 끝난 뒤 복습. 공개된 것과 예약된 것을 함께 */
function timeline(lang, { withScheduled = true } = {}) {
  const items = [];
  for (const x of lessons[lang]) items.push({ kind: 'lesson', key: x.day, ...x });
  for (const x of reviews[lang]) items.push({ kind: 'review', key: x.range[1] + 0.5, ...x });
  if (withScheduled) {
    for (const x of scheduled[lang]) items.push({ kind: 'soon', key: x.day, ...x });
    for (const x of scheduledReviews[lang]) items.push({ kind: 'soon-review', key: x.range[1] + 0.5, ...x });
  }
  return items.sort((a, b) => a.key - b.key || (a.post.date < b.post.date ? -1 : 1));
}
const latestLesson = (lang) => lessons[lang].slice().sort((a, b) => (a.post.date < b.post.date ? 1 : -1))[0] || null;
const nextScheduled = (lang) => scheduled[lang].slice().sort((a, b) => (a.post.date < b.post.date ? -1 : 1))[0] || null;
/* 단어장 — 공개된 수업의 낱말 전부. 예문은 복습 글에서 같은 낱말을 찾아 붙인다 */
const exampleByWord = new Map();
for (const l of ['zh', 'ja']) for (const r of reviews[l]) for (const it of r.parsed.items) { const k = `${l}|${it.word}`; if (!exampleByWord.has(k) && it.example) exampleByWord.set(k, it); }
const vocab = [];
for (const l of ['zh', 'ja']) for (const x of lessons[l]) x.parsed.words.forEach((w, i) => vocab.push({ lang: l, day: x.day, slug: x.post.slug, title: text(x.post.title), index: w.index ?? i + 1, word: w.word, reading: w.reading, meaning: w.meaning, audio: w.audio && uploadExists(w.audio) ? w.audio : null, exampleAudio: w.exampleAudio && uploadExists(w.exampleAudio) ? w.exampleAudio : null, example: exampleByWord.get(`${l}|${w.word}`) || null }));
/* 한 글자짜리 낱말의 녹음 — 가나표·병음표에서 "정말 그 소리" 인 것만 쓴다 */
const recordings = { zh: new Map(), ja: new Map() };
for (const v of vocab) if (v.audio && [...v.word].length === 1 && !recordings[v.lang].has(v.word)) recordings[v.lang].set(v.word, v);
const shiftKana = (ch, d) => { const c = ch.codePointAt(0); return String.fromCodePoint(c + d); };
for (const [k, v] of [...recordings.ja]) {   /* 히라가나 ↔ 가타카나는 같은 소리 */
  const c = k.codePointAt(0);
  if (c >= 0x3041 && c <= 0x3096 && !recordings.ja.has(shiftKana(k, 0x60))) recordings.ja.set(shiftKana(k, 0x60), v);
  if (c >= 0x30a1 && c <= 0x30f6 && !recordings.ja.has(shiftKana(k, -0x60))) recordings.ja.set(shiftKana(k, -0x60), v);
}

/* ---------- 본문 정리 ---------- */
const slugByPostId = new Map([...posts.map((p) => [p.id, `/${p.slug}/`]), ...pages.map((p) => [p.id, `/${p.slug}/`])]);
const missingRefs = new Set();
const mediaByName = new Map();   /* 파일명 → /wp-content/uploads/... (같은 이름이면 먼저 올린 것) */
for (const m of [...mediaById.values()].sort((a, b) => (a.date < b.date ? -1 : 1))) { const rel = m.source_url.replace(/^https?:\/\/daytip\.kr/, ''); const name = decodeURIComponent(rel.split('/').pop()); if (!mediaByName.has(name) && uploadExists(rel)) mediaByName.set(name, rel); }

/* 인라인 스타일의 색·배경·테두리만 테마 클래스로 바꾼다(배치용 속성은 그대로 둔다) — 어두운 모드에서 본문이 읽히게.
 * 황금키워드가 쓰는 색은 몇 가지뿐이라 표로 맞춘다. 모르는 값은 인라인 그대로 남긴다. */
const COLOR_MAP = { '#0d1725': '', '#24272e': '', '#1f2937': '', '#333': '', '#333333': '', '#767469': 'c-dim', '#6b7280': 'c-dim', '#8c6423': 'c-acc', '#a8792b': 'c-acc', '#b8862b': 'c-acc', '#fff': 'c-inv', '#ffffff': 'c-inv', '#b3261e': 'c-warn' };
const BG_MAP = { '#fdf6e7': 'bg-tint', '#fffdf5': 'bg-tint', '#f5f3ee': 'bg-soft', '#f8f9fb': 'bg-soft', '#f8f9fa': 'bg-soft', '#fff': 'bg-paper', '#ffffff': 'bg-paper', '#fbeeec': 'bg-warn', '#0d1725': 'bg-ink', '#8c6423': 'bg-acc', '#a8792b': 'bg-acc', '#d9a520': 'bg-acc', '#e5e1d8': 'bg-line', '#fef08a': 'bg-mark' };
const LINE_COLORS = new Set(['#e5e1d8', '#e2e5ea', '#e5e7eb', '#e2e6ea', '#d9d4c8']);
const ACC_COLORS = new Set(['#a8792b', '#8c6423', '#b8862b', '#d9a520']);
const WARN_COLORS = new Set(['#b3261e']);
const KNOWN_BD = new Set(['bd-1-line', 'bd-2-acc', 'bd-2-line', 'bdt-1-line', 'bdt-1-dash-line', 'bdt-3-acc', 'bdb-1-line', 'bdb-2-acc', 'bdl-3-acc', 'bdl-4-acc', 'bdl-5-acc', 'bdl-5-warn']);
function restyle(html) {
  return html.replace(/<(\w+)([^>]*?)\sstyle="([^"]*)"([^>]*)>/g, (m, tag, pre, style, post) => {
    const keep = [], classes = [];
    for (const decl of style.split(';')) {
      const i = decl.indexOf(':'); if (i < 0) continue;
      const prop = decl.slice(0, i).trim().toLowerCase(), v = decl.slice(i + 1).trim().toLowerCase().replace(/\s+/g, ' ');
      if (prop === 'color' && v in COLOR_MAP) { if (COLOR_MAP[v]) classes.push(COLOR_MAP[v]); continue; }
      if ((prop === 'background' || prop === 'background-color') && v in BG_MAP) {
        if ((v === '#fff' || v === '#ffffff') && (tag === 'svg' || tag === 'img')) { keep.push(decl.trim()); continue; }   /* 획순 그림은 흰 바탕 그대로 */
        classes.push(BG_MAP[v]); continue;
      }
      const bm = /^border(-top|-bottom|-left|-right)?$/.test(prop) && v.match(/^(\d)px (solid|dashed) (#[0-9a-f]{3,6})$/);
      if (bm) {
        const side = { border: 'bd', 'border-top': 'bdt', 'border-bottom': 'bdb', 'border-left': 'bdl', 'border-right': 'bdr' }[prop];
        const col = LINE_COLORS.has(bm[3]) ? 'line' : ACC_COLORS.has(bm[3]) ? 'acc' : WARN_COLORS.has(bm[3]) ? 'warn' : null;
        const cls = col && `${side}-${bm[1]}${bm[2] === 'dashed' ? '-dash' : ''}-${col}`;
        if (cls && KNOWN_BD.has(cls)) { classes.push(cls); continue; }
      }
      keep.push(decl.trim());
    }
    let attrs = pre + post;
    if (classes.length) attrs = /\sclass="/.test(attrs) ? attrs.replace(/\sclass="([^"]*)"/, (_, c) => ` class="${c} ${classes.join(' ')}"`) : `${attrs} class="${classes.join(' ')}"`;
    return `<${tag}${attrs}${keep.length ? ` style="${keep.join(';')}"` : ''}>`;
  });
}
function cleanHtml(html, { theme = true } = {}) {
  let h = String(html ?? '');
  /* /?p=ID → /slug/ (목차 페이지가 예약 글을 ID 로 가리킨다) */
  h = h.replace(/https?:\/\/daytip\.kr\/\?p=(\d+)/g, (m, id) => slugByPostId.get(+id) ? SITE + slugByPostId.get(+id) : m);
  /* srcset 에서 없는 파일은 빼고, 다 없으면 srcset·sizes 자체를 뺀다 */
  h = h.replace(/<img\b[^>]*>/g, (tag) => {
    let t = tag.replace(/\s+srcset="([^"]*)"/, (_, list) => {
      const keep = list.split(',').map((s) => s.trim()).filter((s) => { const u = s.split(/\s+/)[0]; const rel = u.replace(/^https?:\/\/daytip\.kr/, ''); if (!rel.startsWith('/wp-content/')) return true; if (uploadExists(rel)) return true; missingRefs.add(rel); return false; });
      return keep.length ? ` srcset="${keep.join(', ')}"` : '';
    });
    if (!/srcset=/.test(t)) t = t.replace(/\s+sizes="[^"]*"/, '');
    t = t.replace(/\s+(decoding|fetchpriority)="[^"]*"/g, '');
    if (!/loading=/.test(t)) t = t.replace(/^<img/, '<img loading="lazy"');
    return t;
  });
  /* src="파일명.png" 처럼 경로 없이 쓴 그림은 미디어 목록에서 같은 이름의 파일을 찾아 붙인다 (라이브에서는 깨져 있던 것) */
  h = h.replace(/\s(src|href)="([^"\/:]+\.(?:png|jpe?g|gif|webp|mp3))"/gi, (m, a, name) => { const rel = mediaByName.get(name); return rel ? ` ${a}="${SITE}${rel}"` : m; });
  /* 절대 주소 → 루트 상대(BASE_PATH 포함). 업로드 파일은 public/ 에 있어야 한다 */
  h = h.replace(/https?:\/\/daytip\.kr(\/[^\s"'<>()]*)?/g, (m, p = '/') => { if (p.startsWith('/wp-content/') && !uploadExists(p.split('?')[0])) missingRefs.add(p); return url(p); });
  h = h.replace(/\s+class="wp-image-\d+"/g, '');
  if (theme) h = restyle(h);
  return h.trim();
}
/* 수업 글 본문에서 빌드가 다시 그리는 조각을 뺀다: 맨 위 "전체 듣기" 상자(머리에 다시 넣는다), 맨 아래 "지난 수업" 꼬리(일차순 이전·다음으로 바꾼다 — 원본은 다른 언어 글을 가리키기도 했다) */
function stripLessonChrome(html) {
  let h = html;
  h = h.replace(/<div style="[^"]*background:#FDF6E7">\s*<div[^>]*>[^<]*전체 듣기<\/div>[\s\S]*?<\/audio>\s*<\/div>/, '');
  h = h.replace(/<div style="border-top:1px solid #E5E1D8;margin:30px 0 0;padding:16px 0 0">\s*<div[^>]*>지난 수업<\/div>[\s\S]*?전체 목차 →<\/a>\s*<\/div>\s*<\/div>\s*$/, '');
  return h;
}
const featured = (p) => { if (p.featured_image) return uploadExists(p.featured_image) ? { rel: p.featured_image, alt: '' } : null; const m = mediaById.get(p.featured_media); if (!m) return null; const rel = m.source_url.replace(/^https?:\/\/daytip\.kr/, ''); return uploadExists(rel) ? { rel, alt: m.alt || '', w: m.width, h: m.height } : null; };
function firstImage(p) { const m = p.content.match(/<img[^>]*\ssrc="(https?:\/\/daytip\.kr)?(\/wp-content\/uploads\/[^"]+)"/); return m && uploadExists(m[2]) ? { rel: m[2], alt: '' } : null; }
const thumb = (p) => featured(p) || firstImage(p);
const excerpt = (p) => text(p.excerpt) || text(p.content).slice(0, 150);

/* ---------- 틀 ---------- */
const CSS = fs.readFileSync(path.join(SRC, 'style.css'), 'utf8').replace(/\n+/g, '\n');
const STUDY_JS = fs.readFileSync(path.join(SRC, 'study.js'), 'utf8');
const ICON = site.icon;
const analytics = PROD ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${GTAG_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${GTAG_ID}');</script>
<script async crossorigin="anonymous" src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE}&host=${ADSENSE_HOST}"></script>` : '';
const lifeCatObjs = LIFE_CATS.map((id) => catById.get(id)).filter((c) => c && postsByCat.get(c.id).length);

function shell({ path: p, title, description, body, type = 'website', image, jsonld, noindex = false, robots = '', ads = true, extraHead = '', extraFoot = '', nav = '', js = false }) {
  const full = p === '/' ? `${site.name} — 하루 한 마디 중국어·일본어` : `${title} - ${site.name}`;
  const img = image ? abs(image) : abs(ICON);
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
${robots ? `<meta name="robots" content="${robots}">` : noindex ? '<meta name="robots" content="noindex, follow">' : '<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">'}
<link rel="canonical" href="${abs(p)}">
<link rel="icon" href="${url(site.icon32)}" sizes="32x32">
<link rel="icon" href="${url(ICON)}" sizes="192x192">
<link rel="apple-touch-icon" href="${url(ICON)}">
<link rel="alternate" type="application/rss+xml" title="${esc(site.name)} » 피드" href="${abs('/feed/')}">
<meta name="theme-color" content="#fffdf9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#15181d" media="(prefers-color-scheme: dark)">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:locale" content="ko_KR">
<meta property="og:type" content="${type}">
<meta property="og:url" content="${abs(p)}">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${img}">
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(full)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${img}">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
<style>${CSS}</style>
${extraHead}
${ads ? analytics : ''}
</head>
<body>
<header class="site-head"><div class="wrap">
<a class="brand" href="${url('/')}"><img src="${url(site.icon32)}" alt="" width="26" height="26">${esc(site.name)}<small>중국어·일본어</small></a>
<nav class="site-nav" aria-label="메뉴">${NAV.map(([href, label]) => `<a href="${url(href)}"${nav === href || (href === '/' && p === '/') ? ' class="on"' : ''}${href === '/life/' ? ` class="life${nav === href ? ' on' : ''}"` : ''}>${label}</a>`).join('')}</nav>
</div></header>
<main><div class="wrap">
${body}
</div></main>
<footer class="site-foot"><div class="wrap">
<div class="links">${pages.filter((x) => ['about', 'contact', 'privacy-policy'].includes(x.slug)).map((x) => `<a href="${url(`/${x.slug}/`)}">${esc(text(x.title))}</a>`).join('')}<a href="${url('/chinese-course/')}">중국어 과정</a><a href="${url('/japanese-course/')}">일본어 과정</a><a href="${url('/vocabulary/')}">단어장</a><a href="${url('/feed/')}">RSS</a></div>
<div class="links">생활정보: ${lifeCatObjs.map((c) => `<a href="${url(catPath(c))}">${esc(catName(c))}</a>`).join('')}<a href="${url('/median-income-calculator/')}">기준 중위소득 계산기</a></div>
<div>© ${BUILD_DATE.slice(0, 4)} ${esc(site.name)} · 하루 한 마디씩 쌓는 중국어·일본어</div>
</div></footer>
${js ? `<script>${STUDY_JS}</script>` : ''}
${extraFoot}
</body>
</html>`;
}

const publisher = { '@type': 'Organization', name: site.name, url: SITE + '/', logo: { '@type': 'ImageObject', url: abs(ICON) } };
const sitemap = [];   /* { loc, lastmod, priority } */

/* ---------- 공통 조각 ---------- */
const langTag = (lang, label) => `<span class="lang ${lang}">${label || LANGS[lang].name}</span>`;
const playBtn = (src, label, { tts = false, say = '', speech = '' } = {}) => src
  ? `<a class="play" href="${url(src)}" data-src="${url(src)}">${label}</a>`
  : tts ? `<button type="button" class="play tts" data-say="${esc(say)}" data-lang="${speech}">${label}</button>` : '';
function card(p) {
  const th = thumb(p); const c = primaryCat(p); const l = langOf(p); const info = lessonBySlug.get(p.slug);
  const badge = l && info ? langTag(l, info.kind === 'review' ? `${LANGS[l].name} ${info.range[0]}~${info.range[1]}일차 복습` : `${LANGS[l].name} ${info.day}일차`) : '';
  return `<li>${th ? `<a class="th" href="${url(`/${p.slug}/`)}"><img src="${url(th.rel)}" alt="" loading="lazy"></a>` : ''}<div class="tx"><a class="t" href="${url(`/${p.slug}/`)}">${p.title}</a><p>${esc(excerpt(p))}</p><div class="m">${badge}<time datetime="${iso(p.date)}">${fmtDate(p.date)}</time>${c && !badge ? `<a href="${url(catPath(c))}">${esc(catName(c))}</a>` : ''}</div></div></li>`;
}
function pager(base, n, total) {
  if (total <= 1) return '';
  const at = (i) => (i === 1 ? base : `${base}page/${i}/`);
  return `<nav class="pager" aria-label="페이지"><span>${n > 1 ? `<a href="${url(at(n - 1))}" rel="prev">← 이전</a>` : ''}</span><span class="num">${n} / ${total}</span><span>${n < total ? `<a href="${url(at(n + 1))}" rel="next">다음 →</a>` : ''}</span></nav>`;
}
function listing({ base, items, title, intro = '', description, nav = '', noindex = false, lead = '', skipFirst = false }) {
  const total = Math.max(1, Math.ceil(items.length / PER_PAGE));
  for (let n = skipFirst ? 2 : 1; n <= total; n++) {
    const slice = items.slice((n - 1) * PER_PAGE, n * PER_PAGE);
    const p = n === 1 ? base : `${base}page/${n}/`;
    const body = `${n === 1 ? lead : ''}<div class="list-head">${title ? `<h1>${esc(title)}${n > 1 ? ` <small style="font-weight:400;color:var(--dim)">(${n}쪽)</small>` : ''}</h1>` : ''}${n === 1 && intro ? intro : ''}</div><ul class="list">${slice.map(card).join('')}</ul>${pager(base, n, total)}`;
    write(`${p}index.html`, shell({ path: p, title: title ? (n > 1 ? `${title} ${n}쪽` : title) : site.name, description, body, nav, noindex: noindex || n > 1 }));
    if (!noindex) sitemap.push({ loc: p, lastmod: slice[0]?.modified > slice[0]?.date ? slice[0].modified : slice[0]?.date, priority: n === 1 ? (base === '/' ? '1.0' : '0.6') : '0.3' });
  }
}
/* 수업 글 한 편의 "낱말 띠" — 낱말·읽기·뜻과 녹음 단추(녹음이 있을 때만) */
function wordStrip(lang, words) {
  if (!words.length) return '';
  return `<ul class="word-strip" aria-label="오늘 낱말">${words.map((w) => `<li><span class="w" lang="${lang === 'zh' ? 'zh-Hans' : 'ja'}">${esc(w.word)}</span>${w.reading && w.reading !== w.word ? `<span class="r">${esc(w.reading)}</span>` : ''}<span class="m">${esc(w.meaning)}</span>${w.audio || w.exampleAudio ? `<span class="acts">${w.audio && uploadExists(w.audio) ? playBtn(w.audio, '낱말') : ''}${w.exampleAudio && uploadExists(w.exampleAudio) ? playBtn(w.exampleAudio, '예문') : ''}</span>` : ''}</li>`).join('')}</ul>`;
}
const playAllBox = (src, label, note) => src && uploadExists(src) ? `<div class="play-all"><b>${esc(label)}</b>${note ? `<p class="note">${esc(note)}</p>` : ''}<audio controls preload="none" src="${url(src)}"></audio></div>` : '';
const continueData = (lang) => attrJson(lessons[lang].map((x) => [x.post.slug, `${x.day}일차`]));

/* ---------- 글 ---------- */
const inCatOrder = new Map();   /* 글 → 같은 분류 안 이전·다음(발행순) */
for (const c of categories) { const arr = postsByCat.get(c.id); arr.forEach((p, i) => { if (!inCatOrder.has(p.id) || catChain(c).length > inCatOrder.get(p.id).depth) inCatOrder.set(p.id, { depth: catChain(c).length, older: arr[i + 1], newer: arr[i - 1] }); }); }
const timelines = { zh: timeline('zh', { withScheduled: false }), ja: timeline('ja', { withScheduled: false }) };

for (const p of posts) {
  const c = primaryCat(p); const chain = c ? catChain(c) : [];
  const th = featured(p);
  const modified = p.modified > p.date ? p.modified : p.date;
  const info = lessonBySlug.get(p.slug);
  const lang = info?.lang;
  const related = (c ? postsByCat.get(c.id) : posts).filter((x) => x.id !== p.id).slice(0, 6);
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: text(p.title), description: excerpt(p),
    datePublished: iso(p.date), dateModified: iso(modified), inLanguage: 'ko',
    mainEntityOfPage: { '@type': 'WebPage', '@id': abs(`/${p.slug}/`) },
    author: { '@type': 'Person', name: p.author || users[0]?.name || site.name }, publisher,
    ...(th ? { image: abs(th.rel) } : {}), ...(c ? { articleSection: c.name } : {}),
    ...(p.tags?.length ? { keywords: p.tags.map((id) => tags.find((t) => t.id === id)?.name).filter(Boolean).join(', ') } : {}),
    ...(info ? { isPartOf: { '@type': 'Course', name: `${LANGS[lang].name} 한 마디`, url: abs(LANGS[lang].hub) } } : {}),
  };
  let top = '', bottom = '', nav = '';
  let content = p.content;
  if (info) {
    const L = LANGS[lang];
    const label = info.kind === 'review' ? `${info.range[0]}~${info.range[1]}일차 복습` : `${info.day}일차`;
    top = `<div class="lesson-top"><p class="kicker">${langTag(lang)}<span>${label}</span><a href="${url(L.hub)}">전체 목차 →</a></p>
${playAllBox(info.parsed.allAudio, info.kind === 'review' ? '이번 주 전체 듣기' : `${info.day}일차 전체 듣기`, info.kind === 'review' ? '낱말과 예문을 이어서 읽습니다. 눈 감고 들어도 됩니다.' : '오늘 낱말과 예문을 이어서 읽어 줍니다. 복습은 이것만 들어도 됩니다.')}
${info.kind === 'lesson' ? wordStrip(lang, info.parsed.words) : ''}</div>`;
    content = stripLessonChrome(content);
    const tl = timelines[lang]; const i = tl.findIndex((x) => x.post.slug === p.slug);
    const prev = tl[i - 1], next = tl[i + 1];
    const tlabel = (x) => x.kind === 'review' ? `${x.range[0]}~${x.range[1]}일차 복습` : `${x.day}일차`;
    nav = `<nav class="pn" aria-label="이전·다음 수업">${prev ? `<a class="prev" href="${url(`/${prev.post.slug}/`)}"><small>← 이전 · ${tlabel(prev)}</small>${prev.post.title}</a>` : '<span></span>'}${next ? `<a class="next" href="${url(`/${next.post.slug}/`)}"><small>다음 · ${tlabel(next)} →</small>${next.post.title}</a>` : `<a class="next" href="${url(L.hub)}"><small>여기까지가 최신입니다</small>전체 목차에서 복습하기</a>`}</nav>`;
    bottom = `<div class="done-box js-only" hidden><button type="button" class="done-btn" data-done="${esc(p.slug)}">공부했어요</button><p class="note">표시는 이 기기에만 저장됩니다. <a href="${url(L.hub)}">목차</a>에서 진도를 볼 수 있어요.</p></div>`;
  } else {
    const nb = inCatOrder.get(p.id) || {};
    nav = nb.older || nb.newer ? `<nav class="pn" aria-label="이전·다음 글">${nb.older ? `<a class="prev" href="${url(`/${nb.older.slug}/`)}"><small>← 이전 글</small>${nb.older.title}</a>` : '<span></span>'}${nb.newer ? `<a class="next" href="${url(`/${nb.newer.slug}/`)}"><small>다음 글 →</small>${nb.newer.title}</a>` : ''}</nav>` : '';
  }
  const body = `<article>
<p class="crumb"><a href="${url('/')}">홈</a>${chain.map((x) => `<span>›</span><a href="${url(catPath(x))}">${esc(catName(x))}</a>`).join('')}</p>
<h1 class="title">${p.title}</h1>
<p class="meta"><time datetime="${iso(p.date)}">${fmtDate(p.date)}</time>${modified.slice(0, 10) !== p.date.slice(0, 10) ? `<span>수정 <time datetime="${iso(modified)}">${fmtDate(modified)}</time></span>` : ''}${p.author ? `<span>${esc(p.author)}</span>` : ''}</p>
${top}
<div class="entry">${cleanHtml(content)}</div>
${p.tags?.length ? `<p class="tags">${p.tags.map((id) => tags.find((t) => t.id === id)).filter(Boolean).map((t) => `<a href="${url(`/tag/${t.slug}/`)}">#${esc(t.name)}</a>`).join('')}</p>` : ''}
${bottom}
${nav}
</article>
${related.length ? `<section class="related"><h2>${c ? `${esc(catName(c))} 다른 글` : '다른 글'}</h2><ul class="list">${related.map(card).join('')}</ul></section>` : ''}`;
  write(`/${p.slug}/index.html`, shell({ path: `/${p.slug}/`, title: text(p.title), description: excerpt(p), body, type: 'article', image: th?.rel, jsonld, nav: navKeyFor(p), js: !!info }));
  sitemap.push({ loc: `/${p.slug}/`, lastmod: modified, priority: '0.8' });
}

/* ---------- 과정 목차 (/chinese-course/ · /japanese-course/) ---------- */
/* 페이지 JSON(황금키워드 hub.refresh 가 쓰는 것)에서 소개 문단과 단원 구조만 읽는다: <h2>발음<span>1~10일차 · 10/10편</span></h2><p>설명</p> */
function hubMeta(page, lang) {
  const html = page?.content || '';
  const titleParts = text(page?.title || `${LANGS[lang].name} 한 마디`).split(/\s+[—-]\s+/);
  const total = (text(page?.title || '').match(/(\d+)\s*일/) || [])[1];
  const introM = html.match(/<p[^>]*>([\s\S]*?)<\/p>/);
  const intro = introM ? text(introM[1]) : '';
  const sections = [];
  for (const m of html.matchAll(/<h2[^>]*>([^<]+)<span[^>]*>\s*(\d+)\s*~\s*(\d+)\s*일차[^<]*<\/span>\s*<\/h2>\s*(?:<p[^>]*>([\s\S]*?)<\/p>)?/g)) sections.push({ title: text(m[1]), from: +m[2], to: +m[3], desc: m[4] ? text(m[4]) : '' });
  return { title: titleParts[0], sub: titleParts.slice(1).join(' — '), total: total ? +total : null, intro, sections };
}
function renderHub(lang, page) {
  const L = LANGS[lang]; const meta = hubMeta(page, lang);
  const items = timeline(lang);
  const maxDay = Math.max(0, ...items.map((x) => Math.ceil(x.key)));
  const total = meta.total || Math.max(maxDay, ...meta.sections.map((s) => s.to));
  const published = lessons[lang].length;
  const pct = total ? Math.min(100, Math.round(published / total * 100)) : 0;
  const first = lessons[lang][0];
  const sections = meta.sections.length ? meta.sections.map((s) => ({ ...s, items: [] })) : [{ title: '전체 수업', from: 1, to: total || 9999, desc: '', items: [] }];
  const rest = { title: '그 밖의 수업', from: 0, to: 0, desc: '', items: [] };
  for (const it of items) { const d = Math.floor(it.key); (sections.find((s) => d >= s.from && d <= s.to) || rest).items.push(it); }
  if (rest.items.length) sections.push(rest);
  const row = (it) => {
    const p = it.post;
    if (it.kind === 'lesson') {
      const words = it.parsed.words.map((w) => w.word).slice(0, 5).join(' · ');
      return `<li class="day" data-day="${it.day}"><label class="chk js-only" hidden><input type="checkbox" data-done="${esc(p.slug)}" aria-label="${it.day}일차 공부했어요"></label><div class="tx"><a href="${url(`/${p.slug}/`)}"><b>${it.day}일차</b>${p.title}</a>${words ? `<span class="words" lang="${lang === 'zh' ? 'zh-Hans' : 'ja'}">${esc(words)}</span>` : ''}</div><div class="acts">${it.parsed.allAudio && uploadExists(it.parsed.allAudio) ? playBtn(it.parsed.allAudio, '전체 듣기') : '<span class="no-audio">소리 없음</span>'}</div></li>`;
    }
    if (it.kind === 'review') return `<li class="day review"><label class="chk js-only" hidden><input type="checkbox" data-done="${esc(p.slug)}" aria-label="복습 했어요"></label><div class="tx"><a href="${url(`/${p.slug}/`)}"><b>${it.range[0]}~${it.range[1]}일차 복습</b>낱말 ${it.parsed.items.length}개 가리고 맞히기</a></div><div class="acts">${it.parsed.allAudio && uploadExists(it.parsed.allAudio) ? playBtn(it.parsed.allAudio, '전체 듣기') : ''}</div></li>`;
    const label = it.kind === 'soon' ? `${it.day}일차` : `${it.range[0]}~${it.range[1]}일차 복습`;
    return `<li class="day soon"><span class="chk" aria-hidden="true"></span><div class="tx"><b>${label}</b><span class="t">${p.title}</span></div><span class="when">${fmtMD(p.date)} 공개</span></li>`;
  };
  const body = `<article class="hub">
<p class="crumb"><a href="${url('/')}">홈</a><span>›</span>${esc(meta.title)}</p>
<h1 class="title">${esc(meta.title)}</h1>
${meta.sub ? `<p class="sub">${esc(meta.sub)}${total ? ` · 지금까지 ${published}일차 공개` : ''}</p>` : ''}
${meta.intro ? `<p class="lead">${esc(meta.intro)}</p>` : ''}
<div class="progress card" data-progress="${attrJson(lessons[lang].map((x) => x.post.slug))}">
<div class="row"><b>공개된 수업 ${published}${total ? ` / ${total}일` : '일차'}</b><span class="mine js-only" hidden>공부했어요 <span class="n">0</span> / ${published}</span></div>
<div class="bar" role="img" aria-label="공개 ${pct}%"><i style="width:${pct}%"></i><i class="me" style="width:0"></i></div>
<p class="hint"><span>매일 아침 한 편씩 더해집니다.${lessons[lang].length ? ' 공부한 수업은 체크해 두세요 — 이 기기에만 저장됩니다.' : ''}</span>${first ? `<a class="btn sm" href="${url(`/${first.post.slug}/`)}" data-continue="${continueData(lang)}" data-base="${url('/')}">1일차부터 시작하기</a>` : ''}</p>
</div>
<nav class="hub-tools" aria-label="공부 도구"><a href="${url(`/vocabulary/${lang === 'zh' ? 'chinese' : 'japanese'}/`)}">${L.name} 단어장 ${vocab.filter((v) => v.lang === lang).length}개</a><a href="${url(lang === 'zh' ? '/pinyin/' : '/kana/')}">${lang === 'zh' ? '병음·성조표' : '히라가나·가타카나표'}</a><a href="${url(catPath(catById.get(lang === 'zh' ? 24 : 25)))}">최신순 글 목록</a>${reviews[lang].length ? `<a href="#reviews">주간 복습 ${reviews[lang].length}편</a>` : ''}</nav>
${sections.map((s) => { const n = s.items.filter((x) => x.kind === 'lesson').length; const planned = s.to && s.from ? s.to - s.from + 1 : null; return `<section>
<h2>${esc(s.title)}<small>${s.from && s.to && s.title !== '그 밖의 수업' ? `${s.from}~${s.to}일차 · ` : ''}${n}${planned ? `/${planned}` : ''}편</small></h2>
${s.desc ? `<p>${esc(s.desc)}</p>` : ''}
${s.items.length ? `<ol class="days">${s.items.map(row).join('')}</ol>` : '<p class="empty">아직 시작 전입니다.</p>'}
</section>`; }).join('')}
${reviews[lang].length ? `<section id="reviews"><h2>주간 복습 모음<small>${reviews[lang].length}편</small></h2><p>그 주 낱말을 가리고 맞힙니다. 해당 수업을 다 본 뒤 하세요.</p><ol class="days">${reviews[lang].map((r) => row({ kind: 'review', ...r })).join('')}</ol></section>` : ''}
</article>`;
  const modified = [...lessons[lang], ...reviews[lang]].map((x) => (x.post.modified > x.post.date ? x.post.modified : x.post.date)).sort().pop() || page?.modified || page?.date;
  const description = `${meta.title} — ${L.name} 수업 ${published}편 목차. 일차별 전체 듣기, 낱말, 주간 복습${total ? `, ${total}일 과정` : ''}.`;
  const jsonld = { '@context': 'https://schema.org', '@type': 'Course', name: meta.title, description, url: abs(L.hub), inLanguage: 'ko', provider: publisher, hasCourseInstance: { '@type': 'CourseInstance', courseMode: 'online', courseWorkload: 'P1D' }, numberOfCredits: published };
  write(`${L.hub}index.html`, shell({ path: L.hub, title: meta.title, description, body, jsonld, nav: L.hub, js: true }));
  sitemap.push({ loc: L.hub, lastmod: modified, priority: '0.9' });
}

/* ---------- 페이지 ---------- */
const calcJs = fs.readFileSync(path.join(SRC, 'calc-median-income.js'), 'utf8');
const calcCss = fs.readFileSync(path.join(SRC, 'calc-median-income.css'), 'utf8');
const HUB_SLUGS = { 'chinese-course': 'zh', 'japanese-course': 'ja' };
for (const p of pages) {
  if (HUB_SLUGS[p.slug]) { renderHub(HUB_SLUGS[p.slug], p); continue; }
  const modified = p.modified > p.date ? p.modified : p.date;
  const isCalc = p.slug === 'median-income-calculator';
  const body = `<article><p class="crumb"><a href="${url('/')}">홈</a><span>›</span>${esc(text(p.title))}</p><h1 class="title">${p.title}</h1><div class="entry">${cleanHtml(p.content, { theme: !isCalc })}</div></article>`;
  const jsonld = { '@context': 'https://schema.org', '@type': 'WebPage', name: text(p.title), description: excerpt(p), url: abs(`/${p.slug}/`), datePublished: iso(p.date), dateModified: iso(modified), inLanguage: 'ko', publisher };
  write(`/${p.slug}/index.html`, shell({ path: `/${p.slug}/`, title: text(p.title), description: excerpt(p), body, jsonld, nav: isCalc ? '/life/' : '', extraHead: isCalc ? `<style>${calcCss}</style>` : '', extraFoot: isCalc ? `<script>${calcJs}</script>` : '' }));
  sitemap.push({ loc: `/${p.slug}/`, lastmod: modified, priority: '0.5' });
}
for (const [slug, lang] of Object.entries(HUB_SLUGS)) if (!pages.some((p) => p.slug === slug)) renderHub(lang, null);   /* 페이지 JSON 이 없어도 목차는 만든다 */

/* ---------- 홈 ---------- */
function todayCard(lang) {
  const L = LANGS[lang]; const x = latestLesson(lang); const nx = nextScheduled(lang);
  if (!x) return `<div class="today card ${lang}"><p class="kicker">${langTag(lang)}</p><p class="empty">아직 공개된 수업이 없습니다.</p></div>`;
  const isToday = x.post.date.slice(0, 10) === BUILD_DATE;
  const words = x.parsed.words;
  return `<div class="today card ${lang}">
<p class="kicker">${langTag(lang)}<span>${isToday ? '오늘의 수업' : `최근 수업 · ${fmtMD(x.post.date)}`} · ${x.day}일차</span></p>
<h2><a href="${url(`/${x.post.slug}/`)}">${x.post.title}</a></h2>
${words.length ? `<p class="key" lang="${lang === 'zh' ? 'zh-Hans' : 'ja'}">${words.slice(0, 5).map((w) => esc(w.word)).join(' · ')}<small>${words.slice(0, 3).map((w) => `${w.reading && w.reading !== w.word ? esc(w.reading) + ' ' : ''}${esc(w.meaning.split(/\s*\(/)[0])}`).join(' · ')}</small></p>` : ''}
${x.parsed.allAudio && uploadExists(x.parsed.allAudio) ? `<audio controls preload="none" src="${url(x.parsed.allAudio)}" aria-label="${x.day}일차 전체 듣기"></audio>` : '<p class="note">이 수업은 글로만 되어 있습니다(소리 없음).</p>'}
<div class="acts"><a class="btn" href="${url(`/${x.post.slug}/`)}" data-continue="${continueData(lang)}" data-base="${url('/')}">${x.day}일차 공부하기</a><a href="${url(L.hub)}">전체 목차</a></div>
${nx ? `<p class="next">다음 수업 ${nx.day}일차는 ${fmtMD(nx.post.date)} 아침에 올라옵니다.</p>` : ''}
</div>`;
}
{
  const studyPosts = posts.filter((p) => langOf(p)).slice(0, 8);
  const worldPosts = posts.filter(isWorld).slice(0, 6);
  const lifeCount = posts.filter(isLife).length;
  const body = `<section class="hero"><h1>하루 한 마디, 중국어와 일본어</h1><p>매일 아침 짧은 수업 한 편과 원어민 발음. 오늘 것부터 듣고, 모르는 글자는 표에서 눌러 보세요.</p></section>
<div class="today-grid">${todayCard('zh')}${todayCard('ja')}</div>
<nav class="tool-row" aria-label="공부 도구"><a href="${url('/vocabulary/')}"><b>단어장</b><span>낱말 ${vocab.length}개 · 발음 듣기</span></a><a href="${url('/kana/')}"><b>가나표</b><span>히라가나·가타카나 소리</span></a><a href="${url('/pinyin/')}"><b>병음표</b><span>성조·성모·운모 소리</span></a></nav>
<section class="home-sec"><h2>최근 수업<a class="more" href="${url('/category/study/')}">전체 보기 →</a></h2><ul class="list">${studyPosts.map(card).join('')}</ul></section>
${worldPosts.length ? `<section class="home-sec"><h2>읽을거리 — 일본·중국 이야기<a class="more" href="${url(catPath(catById.get(WORLD_CAT)))}">더 보기 →</a></h2><ul class="list">${worldPosts.map(card).join('')}</ul></section>` : ''}
<p class="life-row"><b>생활정보</b>정부지원금·생활법률·부동산·명절 글 ${lifeCount}편은 따로 모아 두었습니다. <a href="${url('/life/')}">생활정보 보기 →</a></p>`;
  const jsonld = { '@context': 'https://schema.org', '@type': 'WebSite', name: site.name, url: SITE + '/', description: '하루 한 마디씩 배우는 중국어·일본어', inLanguage: 'ko', publisher };
  write('/index.html', shell({ path: '/', title: site.name, description: '하루 한 마디씩 배우는 중국어·일본어 — 매일 수업 한 편, 원어민 발음, 단어장, 가나표·병음표.', body, jsonld, js: true }));
  sitemap.push({ loc: '/', lastmod: posts[0]?.date, priority: '1.0' });
  /* 워드프레스 때의 /page/N/ (전체 글 N쪽) 은 그대로 열린다 — 홈이 목록이 아니게 되어 noindex */
  listing({ base: '/', items: posts, title: '전체 글', description: `${site.name} 전체 글`, noindex: true, skipFirst: true });
}

/* ---------- 분류·태그·작성자 ---------- */
for (const c of liveCats) {
  const kids = children(c).filter((k) => postsByCat.get(k.id).length);
  const extra = c.id === WORLD_CAT ? '<p>일본과 중국의 역사·문화·사회 이야기입니다. 수업에서 배운 말이 어떤 곳에서 쓰이는지 배경을 알면 낱말이 오래 남습니다.</p>' : c.id === 23 ? `<p>중국어·일본어 수업은 <a href="${url('/chinese-course/')}">중국어 과정</a>·<a href="${url('/japanese-course/')}">일본어 과정</a> 목차에서 일차순으로 보는 편이 낫습니다. 여기는 최신순 목록입니다.</p>` : (c.id === 24 || c.id === 25) ? `<p>최신순 목록입니다. 일차순 목차와 진도는 <a href="${url(LANGS[c.id === 24 ? 'zh' : 'ja'].hub)}">${catName(c)} 과정</a>에서.</p>` : '';
  const intro = `${c.description ? `<p>${esc(c.description)}</p>` : ''}${extra}${kids.length ? `<div class="subcats">${kids.map((k) => `<a href="${url(catPath(k))}">${esc(catName(k))} ${postsByCat.get(k.id).length}</a>`).join('')}</div>` : ''}`;
  listing({ base: catPath(c), items: postsByCat.get(c.id), title: catName(c), intro, description: `${catName(c)} — ${site.name}의 ${catName(c)} 글 ${postsByCat.get(c.id).length}편`, nav: navKeyForCat(c) });
}
for (const t of tags) {
  const items = posts.filter((p) => p.tags.includes(t.id));
  if (items.length) listing({ base: `/tag/${t.slug}/`, items, title: `#${t.name}`, description: `${t.name} 태그 글 ${items.length}편` });
}
listing({ base: `/author/${AUTHOR_SLUG}/`, items: posts, title: `${users[0]?.name || site.name}의 글`, description: `${site.name} 전체 글`, noindex: true });

/* ---------- 생활정보 모음 (/life/) ---------- */
{
  const body = `<article><p class="crumb"><a href="${url('/')}">홈</a><span>›</span>생활정보</p><h1 class="title">생활정보</h1>
<p class="lead">데이팁이 중국어·일본어 공부 사이트가 되기 전에 쓴 정부지원금·생활법률·부동산·명절 글입니다. 주소는 그대로이고, 내용은 각 글의 수정일 기준입니다.</p>
<div class="life-grid">${lifeCatObjs.map((c) => { const arr = postsByCat.get(c.id); return `<section class="life-cat card"><h2><a href="${url(catPath(c))}">${esc(catName(c))}</a><small>${arr.length}편</small></h2><ul>${arr.slice(0, 6).map((p) => `<li><a href="${url(`/${p.slug}/`)}">${p.title}</a></li>`).join('')}</ul>${arr.length > 6 ? `<p class="note" style="margin:8px 0 0"><a href="${url(catPath(c))}">${esc(catName(c))} 전체 ${arr.length}편 →</a></p>` : ''}</section>`; }).join('')}</div>
<p class="life-row" style="margin-top:18px"><b>도구</b><a href="${url('/median-income-calculator/')}">기준 중위소득 계산기</a></p></article>`;
  write('/life/index.html', shell({ path: '/life/', title: '생활정보', description: '정부지원금·생활법률·안전·부동산·세금·명절 생활상식 글 모음.', body, nav: '/life/', jsonld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: '생활정보', url: abs('/life/'), inLanguage: 'ko', publisher } }));
  sitemap.push({ loc: '/life/', lastmod: posts.filter(isLife)[0]?.date, priority: '0.5' });
}

/* ---------- 단어장 (/vocabulary/ · /vocabulary/chinese/ · /vocabulary/japanese/) ---------- */
function renderVocab(only) {
  const list = only ? vocab.filter((v) => v.lang === only) : vocab;
  const groups = [];
  for (const v of list) { let g = groups.find((x) => x.lang === v.lang && x.day === v.day); if (!g) { g = { lang: v.lang, day: v.day, slug: v.slug, title: v.title, items: [] }; groups.push(g); } g.items.push(v); }
  groups.sort((a, b) => a.lang.localeCompare(b.lang) || a.day - b.day);
  const dayOptions = (lang) => groups.filter((g) => g.lang === lang).map((g) => `<option value="${lang}:${g.day}">${LANGS[lang].name} ${g.day}일차</option>`).join('');
  const item = (v) => {
    const hasEx = v.example && v.example.example;
    return `<li class="v" data-q="${esc(`${v.word} ${v.reading} ${v.meaning} ${hasEx ? v.example.example + ' ' + v.example.translation : ''}`)}"><span><span class="w" lang="${v.lang === 'zh' ? 'zh-Hans' : 'ja'}">${esc(v.word)}</span>${v.reading && v.reading !== v.word ? `<span class="r">${esc(v.reading)}</span>` : ''}</span>${v.audio || v.exampleAudio ? `<span class="acts">${v.audio ? playBtn(v.audio, '낱말') : ''}${v.exampleAudio ? playBtn(v.exampleAudio, '예문') : ''}</span>` : ''}<span class="m">${esc(v.meaning)}</span>${hasEx ? `<span class="ex"><b lang="${v.lang === 'zh' ? 'zh-Hans' : 'ja'}">${esc(v.example.example)}</b><br>${esc(v.example.translation)}</span>` : ''}<span class="from">${LANGS[v.lang].name} <a href="${url(`/${v.slug}/`)}">${v.day}일차</a></span></li>`;
  };
  const path_ = only ? `/vocabulary/${only === 'zh' ? 'chinese' : 'japanese'}/` : '/vocabulary/';
  const title = only ? `${LANGS[only].name} 단어장` : '단어장';
  const body = `<article><p class="crumb"><a href="${url('/')}">홈</a><span>›</span>${only ? `<a href="${url('/vocabulary/')}">단어장</a><span>›</span>${LANGS[only].name}` : '단어장'}</p>
<h1 class="title">${title}</h1>
<p class="lead">수업에 나온 낱말 ${list.length}개를 일차순으로 모았습니다. 낱말·읽기·뜻 어느 것으로든 찾을 수 있고, 녹음이 있는 낱말은 바로 들을 수 있습니다. 예문은 주간 복습 글에 실린 것입니다.</p>
<form class="vfilter card" role="search" action="${url(path_)}" method="get"><label class="visually-hidden" for="vq">찾기</label><input id="vq" type="search" name="q" placeholder="낱말·읽기·뜻으로 찾기 (예: 안녕, nǐ, ねこ)" autocomplete="off">
<div class="row2">${only ? `<input type="hidden" name="lang" value="${only}"><a class="btn ghost sm" href="${url('/vocabulary/')}" style="justify-self:start">전체 단어장</a>` : `<select name="lang" aria-label="언어"><option value="">중국어·일본어 모두</option><option value="zh">중국어</option><option value="ja">일본어</option></select>`}<select name="day" aria-label="일차"><option value="">모든 일차</option>${['zh', 'ja'].filter((l) => !only || l === only).map((l) => `<optgroup label="${LANGS[l].name}" data-l="${l}">${dayOptions(l)}</optgroup>`).join('')}</select><button type="button" data-reset>지우기</button></div>
<p class="stat"><span class="vcount">${list.length}</span>개 표시 · 녹음 <span class="play" style="pointer-events:none">낱말</span> 단추를 누르면 바로 재생됩니다</p></form>
${!only ? `<nav class="vtoc" aria-label="언어별"><a href="${url('/vocabulary/chinese/')}">중국어만 ${vocab.filter((v) => v.lang === 'zh').length}개</a><a href="${url('/vocabulary/japanese/')}">일본어만 ${vocab.filter((v) => v.lang === 'ja').length}개</a></nav>` : ''}
${groups.map((g) => `<section class="vday" data-l="${g.lang}" data-d="${g.day}" id="${g.lang}-${g.day}"><h2>${langTag(g.lang, `${LANGS[g.lang].name} ${g.day}일차`)}<a href="${url(`/${g.slug}/`)}">${esc(g.title)}</a></h2><ul class="vlist">${g.items.map(item).join('')}</ul></section>`).join('')}
<p class="vempty" hidden>맞는 낱말이 없습니다. 다른 말로 찾아보세요.</p>
</article>`;
  const description = `${title} — 데이팁 ${only ? LANGS[only].name : '중국어·일본어'} 수업 낱말 ${list.length}개. 읽기·뜻·예문과 원어민 녹음.`;
  write(`${path_}index.html`, shell({ path: path_, title, description, body, nav: '/vocabulary/', js: true, jsonld: { '@context': 'https://schema.org', '@type': 'Dataset', name: title, description, url: abs(path_), inLanguage: ['ko', ...(only ? [only === 'zh' ? 'zh' : 'ja'] : ['zh', 'ja'])], creator: publisher } }));
  sitemap.push({ loc: path_, lastmod: list.map((v) => postMap.get(v.slug)?.date).sort().pop(), priority: '0.7' });
}
renderVocab(null); renderVocab('zh'); renderVocab('ja');

/* ---------- 가나표 (/kana/) ---------- */
/* 오십음도 — 행마다 "글자|로마자|한국어 읽기", 빈 칸은 _ */
const GOJUON = ['あいうえお|a i u e o|아 이 우 에 오', 'かきくけこ|ka ki ku ke ko|카 키 쿠 케 코', 'さしすせそ|sa shi su se so|사 시 스 세 소', 'たちつてと|ta chi tsu te to|타 치 츠 테 토', 'なにぬねの|na ni nu ne no|나 니 누 네 노', 'はひふへほ|ha hi fu he ho|하 히 후 헤 호', 'まみむめも|ma mi mu me mo|마 미 무 메 모', 'や_ゆ_よ|ya _ yu _ yo|야 _ 유 _ 요', 'らりるれろ|ra ri ru re ro|라 리 루 레 로', 'わ___を|wa _ _ _ wo|와 _ _ _ 오', 'ん____|n _ _ _ _|응 _ _ _ _'];
const DAKUTEN = ['がぎぐげご|ga gi gu ge go|가 기 구 게 고', 'ざじずぜぞ|za ji zu ze zo|자 지 즈 제 조', 'だぢづでど|da ji zu de do|다 지 즈 데 도', 'ばびぶべぼ|ba bi bu be bo|바 비 부 베 보', 'ぱぴぷぺぽ|pa pi pu pe po|파 피 푸 페 포'];
const YOON = ['きゃ きゅ きょ|kya kyu kyo|캬 큐 쿄', 'しゃ しゅ しょ|sha shu sho|샤 슈 쇼', 'ちゃ ちゅ ちょ|cha chu cho|챠 츄 쵸', 'にゃ にゅ にょ|nya nyu nyo|냐 뉴 뇨', 'ひゃ ひゅ ひょ|hya hyu hyo|햐 휴 효', 'みゃ みゅ みょ|mya myu myo|먀 뮤 묘', 'りゃ りゅ りょ|rya ryu ryo|랴 류 료', 'ぎゃ ぎゅ ぎょ|gya gyu gyo|갸 규 교', 'じゃ じゅ じょ|ja ju jo|쟈 쥬 죠', 'びゃ びゅ びょ|bya byu byo|뱌 뷰 뵤', 'ぴゃ ぴゅ ぴょ|pya pyu pyo|퍄 퓨 표'];
const toKata = (s) => [...s].map((ch) => { const c = ch.codePointAt(0); return c >= 0x3041 && c <= 0x3096 ? String.fromCodePoint(c + 0x60) : ch; }).join('');
function kanaCell(kana, romaji, hangul) {
  if (kana === '_') return '<span class="gap" aria-hidden="true"></span>';
  const rec = recordings.ja.get(kana);
  const inner = `<span class="k" lang="ja">${kana}</span><small>${romaji}</small><small>${hangul}</small>`;
  if (rec) return `<a class="kana rec" href="${url(rec.audio)}" data-src="${url(rec.audio)}" title="${esc(`${rec.day}일차 수업 녹음 (${rec.word})`)}">${inner}</a>`;
  return `<button type="button" class="kana" data-say="${kana}" data-lang="ja-JP" title="기계 음성">${inner}</button>`;
}
function kanaGrid(rows, kata, cls = '') {
  return `<div class="kana-grid ${cls}">${rows.map((r) => { const [k, ro, ha] = r.split('|'); const ks = k.includes(' ') ? k.split(' ') : [...k]; const ros = ro.split(' '), has = ha.split(' '); return ks.map((ch, i) => kanaCell(kata ? toKata(ch) : ch, ros[i], has[i])).join(''); }).join('')}</div>`;
}
{
  const recList = [...new Set([...recordings.ja.values()])].sort((a, b) => a.day - b.day);
  const kanaLessons = lessons.ja.filter((x) => /히라가나|가타카나|탁음|요음|촉음|장음/.test(text(x.post.title)));
  const body = `<article class="chart"><p class="crumb"><a href="${url('/')}">홈</a><span>›</span>가나표</p><h1 class="title">히라가나·가타카나 표</h1>
<p class="lead chart-intro">글자를 누르면 소리가 납니다. 수업에서 그 글자 하나를 따로 읽은 녹음이 있으면 그 녹음(${recList.length ? recList.map((r) => `${r.word}`).join(' ') : '없음'})을 쓰고, 나머지는 브라우저의 일본어 <b>기계 음성</b>으로 읽어 줍니다 — 기계 음성은 기기에 따라 억양이 다르니 참고만 하세요. 낱말 단위 원어민 발음은 <a href="${url('/vocabulary/japanese/')}">일본어 단어장</a>에 있습니다.</p>
<div class="legend"><span class="kana rec" style="min-height:0;padding:2px 8px;pointer-events:none"><span class="k" style="font-size:16px">あ</span></span>초록 점 = 수업 녹음 · <span class="kana" style="min-height:0;padding:2px 8px;pointer-events:none"><span class="k" style="font-size:16px">か</span></span>점 없음 = 기계 음성 · 로마자 · 한국어 읽기(가까운 소리)</div>
<p class="tts-note" hidden></p>
<h2 id="hiragana">히라가나 ひらがな</h2>
<h3>청음 — 기본 46자</h3>${kanaGrid(GOJUON, false)}
<h3>탁음·반탁음 — 점 두 개(゛)와 동그라미(゜)</h3>${kanaGrid(DAKUTEN, false)}
<h3>요음 — 작은 ゃ ゅ ょ 를 붙인 한 박자</h3>${kanaGrid(YOON, false, 'yoon')}
<h2 id="katakana">가타카나 カタカナ</h2>
<h3>청음 — 기본 46자</h3>${kanaGrid(GOJUON, true)}
<h3>탁음·반탁음</h3>${kanaGrid(DAKUTEN, true)}
<h3>요음</h3>${kanaGrid(YOON, true, 'yoon')}
<h2>읽는 법 메모</h2>
<ul class="chart-links">
<li>し는 '시', ち는 '치', つ는 '츠'보다 '쯔'에 가깝고, ふ는 입술을 가볍게 스치는 '후'입니다. を는 조사로만 쓰고 '오'로 읽습니다. ん은 뒤에 오는 소리에 따라 ㄴ·ㅁ·ㅇ 받침으로 들립니다.</li>
<li>가타카나의 긴 소리는 ー 한 글자로 적습니다(コーヒー). 촉음 っ·ッ 는 한 박자 쉬는 받침입니다.</li>
${kanaLessons.length ? `<li>글자별 자세한 설명은 수업에서: ${kanaLessons.map((x) => `<a href="${url(`/${x.post.slug}/`)}">${x.day}일차</a>`).join(' · ')}</li>` : ''}
</ul></article>`;
  const description = '히라가나·가타카나 오십음도 — 글자를 누르면 소리가 납니다. 수업 녹음이 있는 글자는 녹음으로, 나머지는 기계 음성으로.';
  write('/kana/index.html', shell({ path: '/kana/', title: '히라가나·가타카나 표', description, body, nav: '/kana/', js: true, jsonld: { '@context': 'https://schema.org', '@type': 'WebPage', name: '히라가나·가타카나 표', description, url: abs('/kana/'), inLanguage: 'ko', publisher } }));
  sitemap.push({ loc: '/kana/', lastmod: lessons.ja.map((x) => x.post.date).sort().pop(), priority: '0.7' });
}

/* ---------- 병음표 (/pinyin/) ---------- */
/* 성모·운모마다 보기 한자 하나 — 수업에 그 글자 하나짜리 낱말 녹음이 있으면 그 녹음을, 없으면 기계 음성을 쓴다 */
const TONES = [['mā', '妈', '1성 · 높고 평평하게', '¯'], ['má', '麻', '2성 · 중간에서 위로', 'ˊ'], ['mǎ', '马', '3성 · 낮게 눌렀다가', 'ˇ'], ['mà', '骂', '4성 · 위에서 아래로', 'ˋ']];
const INITIALS = [['b', '八', 'bā'], ['p', '怕', 'pà'], ['m', '妈', 'mā'], ['f', '发', 'fā'], ['d', '大', 'dà'], ['t', '他', 'tā'], ['n', '你', 'nǐ'], ['l', '来', 'lái'], ['g', '哥', 'gē'], ['k', '看', 'kàn'], ['h', '喝', 'hē'], ['j', '家', 'jiā'], ['q', '去', 'qù'], ['x', '学', 'xué'], ['zh', '这', 'zhè'], ['ch', '吃', 'chī'], ['sh', '是', 'shì'], ['r', '热', 'rè'], ['z', '坐', 'zuò'], ['c', '菜', 'cài'], ['s', '四', 'sì'], ['y', '一', 'yī'], ['w', '我', 'wǒ']];
const FINALS = [['a', '妈', 'mā'], ['o', '我', 'wǒ'], ['e', '喝', 'hē'], ['i', '一', 'yī'], ['u', '五', 'wǔ'], ['ü', '女', 'nǚ'], ['ai', '爱', 'ài'], ['ei', '累', 'lèi'], ['ao', '好', 'hǎo'], ['ou', '走', 'zǒu'], ['an', '看', 'kàn'], ['en', '很', 'hěn'], ['ang', '忙', 'máng'], ['eng', '冷', 'lěng'], ['ong', '东', 'dōng'], ['er', '二', 'èr'], ['ia', '家', 'jiā'], ['ie', '谢', 'xiè'], ['iao', '小', 'xiǎo'], ['iu', '六', 'liù'], ['ian', '见', 'jiàn'], ['in', '您', 'nín'], ['iang', '想', 'xiǎng'], ['ing', '请', 'qǐng'], ['iong', '熊', 'xióng'], ['ua', '花', 'huā'], ['uo', '多', 'duō'], ['uai', '快', 'kuài'], ['ui', '对', 'duì'], ['uan', '晚', 'wǎn'], ['un', '春', 'chūn'], ['uang', '黄', 'huáng'], ['ueng', '翁', 'wēng'], ['üe', '学', 'xué'], ['üan', '远', 'yuǎn'], ['ün', '云', 'yún']];
function pyCell(sym, hanzi, py, extraTop = '') {
  const rec = recordings.zh.get(hanzi);
  const inner = `${extraTop}<span class="s">${sym}</span><span class="h" lang="zh-Hans">${hanzi}</span><small>${py}${rec ? ` · ${rec.day}일차 녹음` : ' · 기계 음성'}</small>`;
  if (rec) return `<a class="py rec" href="${url(rec.audio)}" data-src="${url(rec.audio)}" title="${esc(`${rec.day}일차 수업 녹음 (${rec.word} ${rec.reading})`)}">${inner}</a>`;
  return `<button type="button" class="py" data-say="${hanzi}" data-lang="zh-CN" title="기계 음성">${inner}</button>`;
}
{
  const recCount = [...INITIALS, ...FINALS, ...TONES.map((t) => [t[0], t[1], t[0]])].filter(([, h]) => recordings.zh.has(h)).length;
  const soundLessons = lessons.zh.filter((x) => /성조|성모|운모|경성|발음|겹모음|받침/.test(text(x.post.title)));
  const group = (arr, from, to) => `<div class="py-grid">${arr.slice(from, to).map(([s, h, p]) => pyCell(s, h, p)).join('')}</div>`;
  const body = `<article class="chart"><p class="crumb"><a href="${url('/')}">홈</a><span>›</span>병음표</p><h1 class="title">병음·성조표</h1>
<p class="lead chart-intro">칸을 누르면 보기 글자를 읽어 줍니다. 수업에서 그 글자 하나를 따로 읽은 녹음이 있으면 그 녹음을(${recCount}칸), 없으면 브라우저의 중국어 <b>기계 음성</b>을 씁니다 — 기계 음성은 성조가 뭉개질 수 있으니 녹음(초록 점)을 우선 들으세요. 낱말 전체는 <a href="${url('/vocabulary/chinese/')}">중국어 단어장</a>에.</p>
<div class="legend"><span class="py rec" style="min-height:0;padding:2px 8px;pointer-events:none;flex-direction:row;gap:4px"><span class="s" style="font-size:14px">b</span></span>초록 점 = 수업 녹음 · <span class="py" style="min-height:0;padding:2px 8px;pointer-events:none;flex-direction:row"><span class="s" style="font-size:14px">p</span></span>점 없음 = 기계 음성</div>
<p class="tts-note" hidden></p>
<h2 id="tones">성조 — 같은 ma 가 네 가지 말이 됩니다</h2>
<div class="tone-row">${TONES.map(([py, h, desc, mark]) => pyCell(py, h, desc, `<span class="mark" aria-hidden="true">${mark}</span>`)).join('')}</div>
<p class="note">경성(가볍게 떨어뜨리는 소리)은 부호 없이 적습니다: 吗 ma, 的 de. 3성이 둘 이어지면 앞 3성은 2성으로 읽습니다(你好 nǐ hǎo → ní hǎo).</p>
<h2 id="initials">성모 — 음절 앞소리 21 + y·w</h2>
<h3>b p m f · d t n l — 입술과 혀끝</h3>${group(INITIALS, 0, 8)}
<h3>g k h · j q x — 목 뒤와 혀 앞</h3>${group(INITIALS, 8, 14)}
<h3>zh ch sh r · z c s — 혀를 말아 올리는 소리와 그냥 내는 소리</h3>${group(INITIALS, 14, 21)}
<h3>y · w — 모음으로 시작할 때 앞에 적는 글자</h3>${group(INITIALS, 21, 23)}
<h2 id="finals">운모 — 음절 뒷소리</h2>
<h3>홑운모</h3>${group(FINALS, 0, 6)}
<h3>겹운모·콧소리 받침(-n · -ng)</h3>${group(FINALS, 6, 16)}
<h3>i 로 시작</h3>${group(FINALS, 16, 25)}
<h3>u 로 시작</h3>${group(FINALS, 25, 33)}
<h3>ü 로 시작 (j q x y 뒤에서는 점을 빼고 u 로 적습니다)</h3>${group(FINALS, 33, 36)}
${soundLessons.length ? `<h2>발음 수업</h2><ul class="chart-links">${soundLessons.map((x) => `<li><a href="${url(`/${x.post.slug}/`)}"><b>${x.day}일차</b> ${x.post.title}</a></li>`).join('')}</ul>` : ''}
</article>`;
  const description = '중국어 병음표 — 성조 네 개, 성모 21개, 운모 36개를 보기 글자와 함께. 수업 녹음이 있는 글자는 녹음으로, 나머지는 기계 음성으로 들을 수 있습니다.';
  write('/pinyin/index.html', shell({ path: '/pinyin/', title: '병음·성조표', description, body, nav: '/pinyin/', js: true, jsonld: { '@context': 'https://schema.org', '@type': 'WebPage', name: '병음·성조표', description, url: abs('/pinyin/'), inLanguage: 'ko', publisher } }));
  sitemap.push({ loc: '/pinyin/', lastmod: lessons.zh.map((x) => x.post.date).sort().pop(), priority: '0.7' });
}

/* ---------- 404, robots, ads.txt, 사이트맵, RSS ---------- */
write('/404.html', shell({ path: '/404.html', title: '페이지를 찾을 수 없습니다', description: '주소가 바뀌었거나 없는 페이지입니다.', noindex: true, body: `<div class="notfound"><h1>페이지를 찾을 수 없습니다</h1><p>주소가 바뀌었거나 없는 페이지입니다. <a href="${url('/')}">홈으로</a> 가거나 아래에서 찾아보세요.</p><p>${NAV.slice(1).map(([href, label]) => `<a href="${url(href)}">${label}</a>`).join(' · ')}</p></div>` }));
write('/robots.txt', `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${abs('/sitemap.xml')}\n`);
write('/ads.txt', 'google.com, pub-1562244199345682, DIRECT, f08c47fec0942fa0\n');
const sm = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map((u) => `<url><loc>${abs(u.loc)}</loc>${u.lastmod ? `<lastmod>${iso(u.lastmod)}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n')}\n</urlset>\n`;
write('/sitemap.xml', sm);
write('/sitemaps.xml', sm);   /* 워드프레스 robots.txt 가 가리키던 이름 */
/* RSS 본문은 어디서 읽을지 모르니 절대 주소로. 테마 클래스는 RSS 리더에 의미가 없어 인라인 스타일 그대로 */
const BASE_RE = new RegExp(`(src|href)="${BASE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/(?!/)`, 'g');
const absolutize = (h) => h.replace(BASE_RE, `$1="${SITE}/`);
const rssItems = posts.slice(0, 10).map((p) => {   /* 워드프레스 기본값 10개, 본문 전체 */ const c = primaryCat(p); return `<item>
<title>${esc(text(p.title))}</title>
<link>${abs(`/${p.slug}/`)}</link>
<guid isPermaLink="true">${abs(`/${p.slug}/`)}</guid>
<pubDate>${new Date(p.date_gmt ? p.date_gmt + 'Z' : p.date + '+09:00').toUTCString()}</pubDate>
<dc:creator><![CDATA[${p.author || site.name}]]></dc:creator>
${c ? `<category><![CDATA[${c.name}]]></category>` : ''}
<description><![CDATA[${excerpt(p)}]]></description>
<content:encoded><![CDATA[${absolutize(cleanHtml(p.content, { theme: false }))}]]></content:encoded>
</item>`; }).join('\n');
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(site.name)}</title>
<atom:link href="${abs('/feed/')}" rel="self" type="application/rss+xml"/>
<link>${SITE}</link>
<description>${esc('하루 한 마디씩 배우는 중국어·일본어')}</description>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
<language>ko-KR</language>
<image><url>${abs(site.icon32)}</url><title>${esc(site.name)}</title><link>${SITE}</link></image>
${rssItems}
</channel>
</rss>
`;
write('/feed/index.html', rss);   /* 워드프레스 주소 /feed/ — GitHub Pages 는 디렉터리에서 index.html 만 찾는다 (text/html 로 나가지만 리더는 본문을 보고 RSS 로 읽는다) */
write('/feed.xml', rss);          /* 같은 내용, application/xml 로 나가는 주소 */

/* ---------- 업로드 파일 복사 ---------- */
let copied = 0, copiedBytes = 0;
function copyDir(from, to) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copyDir(a, b); }
    else { fs.copyFileSync(a, b); copied++; copiedBytes += fs.statSync(a).size; }
  }
}
if (fs.existsSync(PUBLIC)) copyDir(PUBLIC, OUT);
write('/.nojekyll', '');

/* ---------- 관리 현황 (/admin/) ---------- */
/* 운영자만 보는 페이지. 정적 호스팅(서버 없음)이라 비밀번호를 서버에서 물을 수 없다 — 그래서 본문을 빌드 때 암호화해서 싣는다(2026-11-10).
 *   ADMIN_PASSWORD 가 있으면: 현황 본문 HTML 을 AES-256-GCM 으로 암호화(키 = PBKDF2-SHA256, 아래 ADMIN_KDF_ITER 회, 빌드마다 새 salt 16바이트·IV 12바이트).
 *     내보내는 /admin/index.html 에는 비밀번호 칸 + salt·iv·암호문(base64) + 푸는 스크립트(crypto.subtle)만 있다. 평문은 dist/ 어디에도 쓰지 않는다.
 *   ADMIN_PASSWORD 가 없으면(로컬 빌드, 비밀 값을 넣기 전): 현황 자료가 하나도 없는 "아직 설정되지 않았어요" 쪽만 내보낸다 — 닫힌 채로 실패한다.
 *   암호문은 누구나 내려받아 오프라인에서 비밀번호를 대입해 볼 수 있으니 비밀번호는 길어야 한다. 그래도 비밀 값·메일·키는 넣지 않는다.
 *   방문자 자료(data/admin/stats.json)는 읽기만 하고 dist/ 로 복사하지 않는다.
 * noindex,nofollow + robots.txt Disallow, 사이트맵·메뉴·바닥·피드에 넣지 않고, 통계·광고 스크립트도 붙이지 않는다.
 * 업로드 파일 복사 뒤에 만든다: 다 만든 dist/ 를 check-links 로 훑어 깨진 링크 수를 적기 때문. */
{
  const num = (n) => Math.round(+n || 0).toLocaleString('ko-KR');
  const addDays = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);
  const wd = (d) => '일월화수목금토'[new Date(d.slice(0, 10) + 'T00:00:00Z').getUTCDay()];
  const fmtDay = (d) => `${fmtMD(d)}(${wd(d)})`;
  const lessonLabel = (p) => { const l = langOf(p); if (!l) return ''; const r = reviewRange(p); const d = lessonDay(p); return `${LANGS[l].name} ${r ? `${r[0]}~${r[1]}일차 복습` : d ? `${d}일차` : '수업'}`; };
  const ext = (href, label, sub) => `<a href="${href}" target="_blank" rel="noopener noreferrer"><b>${label}</b><span>${sub}</span></a>`;

  /* ----- 1. 방문자 ----- */
  const STATS_SRC = process.env.STATS_FILE || path.join(DATA, 'admin', 'stats.json');
  let stats = null, fetchedMs = NaN;
  try { if (fs.existsSync(STATS_SRC)) { const j = JSON.parse(fs.readFileSync(STATS_SRC, 'utf8')); fetchedMs = Date.parse(j?.fetchedAt); if (j && Array.isArray(j.daily) && !Number.isNaN(fetchedMs)) stats = j; else console.log('방문자 자료(stats.json)의 꼴이 달라 건너뜁니다'); } } catch (e) { console.log(`방문자 자료(stats.json)를 읽지 못해 건너뜁니다: ${e.message}`); }
  /* 자료 파일은 dist/ 로 복사하지 않는다 — 예전 빌드가 남긴 것이 있으면(로컬 dist/) 지운다. /admin/ 에는 index.html 하나만 둔다 */
  fs.rmSync(path.join(OUT, 'admin'), { recursive: true, force: true });
  let vHtml, fetched = '';
  if (!stats) {
    vHtml = `<div class="adm-box"><b>아직 방문자 자료가 없어요</b><p>저장소 Secrets 에 <code>GA_KEY_JSON</code>·<code>GA_PROPERTY_ID</code> 를 넣으면 다음 배포부터 여기에 어제·최근 7일·최근 30일 숫자가 나옵니다. 넣는 법은 README 의 “방문자 자료” 를 보세요. 그 전에는 아래 바로가기의 구글 애널리틱스에서 확인하세요.</p></div>`;
  } else {
    const fetchedKst = new Date(fetchedMs + 9 * 3600 * 1000).toISOString();
    fetched = fetchedKst;
    const stale = Date.now() - fetchedMs > 2 * 86400000;
    const endDay = addDays(fetchedKst.slice(0, 10), -1);   /* 어제 — 오늘은 집계 중이라 받지 않는다 */
    const byDate = new Map(stats.daily.filter((d) => /^\d{4}-\d\d-\d\d$/.test(d?.date || '')).map((d) => [d.date, d]));
    const series = Array.from({ length: 30 }, (_, i) => { const date = addDays(endDay, i - 29); const d = byDate.get(date) || {}; return { date, users: +d.users || 0, pageviews: +d.pageviews || 0 }; });
    const sumDays = (from, to, k) => { let s = 0; for (let i = from; i <= to; i++) s += +byDate.get(addDays(endDay, -i))?.[k] || 0; return s; };
    /* 기간 합계는 GA 가 따로 센 값(periods)을 쓴다. 없으면 날짜별로 더한다 — 그때 방문자는 여러 날 온 사람이 겹쳐 세어진다 */
    const exact = !!stats.periods?.last30;
    const period = (name, a, b) => { const p = stats.periods?.[name]; return p ? { users: +p.users || 0, pageviews: +p.pageviews || 0 } : { users: sumDays(a, b, 'users'), pageviews: sumDays(a, b, 'pageviews') }; };
    const delta = (cur, prev, than) => {
      if (!prev) return `<dd class="dl">${than} 자료 없음</dd>`;
      const r = Math.round((cur - prev) / prev * 100);
      return r === 0 ? `<dd class="dl">${than}과 비슷</dd>` : `<dd class="dl ${r > 0 ? 'up' : 'down'}">${r > 0 ? '▲' : '▼'} ${num(Math.abs(r))}% <span class="visually-hidden">${r > 0 ? '늘었어요' : '줄었어요'}</span>· ${than} ${num(prev)}</dd>`;
    };
    const tile = (label, range, cur, prev, than) => `<div class="adm-tile card"><div class="lb">${label}<span>${range}</span></div><dl><dt>방문자</dt><dd>${num(cur.users)}</dd>${delta(cur.users, prev.users, than)}<dt>페이지뷰</dt><dd>${num(cur.pageviews)}</dd>${delta(cur.pageviews, prev.pageviews, than)}</dl></div>`;
    const tiles = [
      tile('어제', fmtDay(endDay), period('yesterday', 0, 0), period('yesterdayPrev', 1, 1), '그 전날'),
      tile('최근 7일', `${fmtMD(addDays(endDay, -6))}~${fmtMD(endDay)}`, period('last7', 0, 6), period('prev7', 7, 13), '앞선 7일'),
      tile('최근 30일', `${fmtMD(addDays(endDay, -29))}~${fmtMD(endDay)}`, period('last30', 0, 29), period('prev30', 30, 59), '앞선 30일'),
    ].join('');
    /* 날짜별 막대 — 값 하나씩 두 장(방문자·페이지뷰). 눈금이 다른 두 값을 한 축에 겹치지 않는다. 막대를 누르면 아래 줄에 그날 숫자 */
    const chart = (key, label, unit) => {
      const max = Math.max(1, ...series.map((d) => d[key])); const total = series.reduce((s, d) => s + d[key], 0);
      const W = 10, H = 100;
      const bars = series.map((d, i) => {
        const h = d[key] ? Math.max(2, d[key] / max * (H - 2)) : 0; const x = i * W + 1, w = W - 2, y = H - h, r = Math.min(1.5, h);
        const t = `${fmtDay(d.date)} · 방문자 ${num(d.users)}명 · 페이지뷰 ${num(d.pageviews)}`;
        return `<g data-t="${esc(t)}"><title>${esc(t)}</title><rect class="h" x="${i * W}" y="0" width="${W}" height="${H}"/>${h ? `<path class="b" d="M${x},${H}V${(y + r).toFixed(1)}Q${x},${y.toFixed(1)} ${x + r},${y.toFixed(1)}H${x + w - r}Q${x + w},${y.toFixed(1)} ${x + w},${(y + r).toFixed(1)}V${H}Z"/>` : ''}</g>`;
      }).join('');
      const read = key === 'pageviews' ? `30일 합계 ${num(total)}${unit} · 하루 평균 ${num(total / 30)}${unit}` : `하루 평균 ${num(total / 30)}${unit}`;
      return `<figure class="adm-chart card"><figcaption>${label}<small>점선 = 가장 많은 날 ${num(max)}${unit}</small></figcaption><div class="plot"><svg viewBox="0 0 ${W * 30} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(`최근 30일 ${label} 막대그래프. ${read}. 날짜별 숫자는 아래 표에 있습니다.`)}">${bars}</svg></div><div class="ax"><span>${fmtMD(series[0].date)}</span><span>${fmtMD(series[15].date)}</span><span>${fmtMD(series[29].date)}</span></div><p class="read" data-default="${esc(read)}">${read}</p></figure>`;
    };
    /* 많이 본 페이지 — 주소를 글 제목으로 푼다. dist/ 에 실제로 있는 주소만 링크를 건다(옛 주소·오타 주소는 글자로만) */
    const titleByPath = new Map([['/', '홈'], ['/vocabulary/', '단어장'], ['/vocabulary/chinese/', '중국어 단어장'], ['/vocabulary/japanese/', '일본어 단어장'], ['/kana/', '히라가나·가타카나 표'], ['/pinyin/', '병음·성조표'], ['/life/', '생활정보'], ['/admin/', '관리 현황'], ['/chinese-course/', '중국어 과정 목차'], ['/japanese-course/', '일본어 과정 목차']]);
    for (const c of liveCats) titleByPath.set(catPath(c), `${catName(c)} 글 목록`);
    for (const p of pages) if (!titleByPath.has(`/${p.slug}/`)) titleByPath.set(`/${p.slug}/`, text(p.title));
    for (const p of posts) titleByPath.set(`/${p.slug}/`, text(p.title));
    const normPath = (raw) => { let p = String(raw || '/').split('?')[0].split('#')[0]; try { p = decodeURIComponent(p); } catch { /* 그대로 */ } if (!p.startsWith('/')) p = '/' + p; if (!p.endsWith('/') && !/\.[a-z0-9]+$/i.test(p)) p += '/'; return p; };
    const safePath = (p) => !p.includes('..') && !/[<>"\\]/.test(p);
    const pageRows = (stats.pages || []).slice(0, 20).map((r, i) => {
      const p = normPath(r.path); const title = titleByPath.get(p);
      const live = safePath(p) && p.endsWith('/') && fs.existsSync(path.join(OUT, p, 'index.html'));
      const name = esc(title || p);
      return `<tr><td><span class="rk">${i + 1}</span>${live ? `<a href="${url(encodeURI(p))}">${name}</a>` : name}<span class="p">${title ? esc(p) : live ? '' : '지금은 없는 주소'}</span></td><td class="n">${num(r.pageviews)}</td><td class="n">${num(r.users)}</td></tr>`;
    }).join('');
    const SRC_NAME = { '(direct)': '직접 방문', naver: '네이버', 'm.naver.com': '네이버(모바일)', 'search.naver.com': '네이버 검색', 'm.search.naver.com': '네이버 검색(모바일)', 'blog.naver.com': '네이버 블로그', 'm.blog.naver.com': '네이버 블로그(모바일)', google: '구글', daum: '다음', 'search.daum.net': '다음 검색', bing: '빙', yahoo: '야후', '(not set)': '알 수 없음' };
    const MED_NAME = { organic: '검색', referral: '링크', '(none)': '', '(not set)': '', social: '소셜', cpc: '광고', email: '메일' };
    const share = (v, total) => { const pct = total ? Math.round(v / total * 100) : 0; return `<span class="adm-share" role="img" aria-label="${pct}%"><i style="width:${Math.min(100, pct)}%"></i></span>`; };
    const srcList = (stats.sources || []).slice(0, 10);
    const srcTotal = +stats.periods?.last30?.sessions || srcList.reduce((s, r) => s + (+r.sessions || 0), 0);
    const srcRows = srcList.map((r) => { const m = MED_NAME[r.medium] ?? r.medium; return `<tr><td>${esc(SRC_NAME[r.source] || r.source)}${m ? ` <span class="rk">${esc(m)}</span>` : ''}${share(+r.sessions || 0, srcTotal)}</td><td class="n">${num(r.sessions)}</td><td class="n">${srcTotal ? Math.round((+r.sessions || 0) / srcTotal * 100) : 0}%</td></tr>`; }).join('');
    const DEV_NAME = { mobile: '휴대폰', desktop: 'PC', tablet: '태블릿', 'smart tv': 'TV' };
    const devList = stats.devices || []; const devTotal = devList.reduce((s, r) => s + (+r.users || 0), 0);
    const devRows = devList.map((r) => `<tr><td>${esc(DEV_NAME[r.device] || r.device)}${share(+r.users || 0, devTotal)}</td><td class="n">${num(r.users)}</td><td class="n">${devTotal ? Math.round((+r.users || 0) / devTotal * 100) : 0}%</td></tr>`).join('');
    vHtml = `<div class="adm-box warn js-stale"${stale ? '' : ' hidden'}><b>방문자 자료가 오래됐어요</b><p>마지막 갱신 ${fmtDate(fetchedKst)} ${fetchedKst.slice(11, 16)} — 이틀 넘게 새로 받지 못했습니다. GitHub Actions 의 “Fetch visitor stats” 단계와 서비스 계정 권한을 확인하세요. 아래 숫자는 그때 것입니다.</p></div>
<div class="adm-tiles">${tiles}</div>
<p class="note">방문자 = 활성 사용자${exact ? '' : ' (날짜별로 더한 값이라 여러 날 온 사람은 겹쳐 세었어요)'}. 오늘은 집계 중이라 어제까지만 셉니다.</p>
<div class="adm-charts">${chart('users', '하루 방문자', '명')}${chart('pageviews', '하루 페이지뷰', '회')}</div>
<details><summary>날짜별 숫자 표로 보기</summary><div class="adm-scroll"><table><thead><tr><th>날짜</th><th class="n">방문자</th><th class="n">페이지뷰</th></tr></thead><tbody>${series.slice().reverse().map((d) => `<tr><td>${fmtDay(d.date)}</td><td class="n">${num(d.users)}</td><td class="n">${num(d.pageviews)}</td></tr>`).join('')}</tbody></table></div></details>
<h3>많이 본 페이지<small>최근 30일</small></h3>
${pageRows ? `<div class="adm-scroll"><table><thead><tr><th>페이지</th><th class="n">페이지뷰</th><th class="n">방문자</th></tr></thead><tbody>${pageRows}</tbody></table></div>` : '<p class="note">자료가 없어요.</p>'}
<div class="adm-two"><div><h3>어디서 왔나<small>최근 30일 · 방문(세션)</small></h3>
${srcRows ? `<table><thead><tr><th>유입</th><th class="n">방문</th><th class="n">비중</th></tr></thead><tbody>${srcRows}</tbody></table>` : '<p class="note">자료가 없어요.</p>'}</div>
${devRows ? `<div><h3>기기<small>최근 30일 · 방문자</small></h3><table><thead><tr><th>기기</th><th class="n">방문자</th><th class="n">비중</th></tr></thead><tbody>${devRows}</tbody></table></div>` : ''}</div>`;
  }

  /* ----- 2. 수업 현황 ----- */
  const byDateAsc = (a, b) => (a.post.date < b.post.date ? -1 : 1);
  /* 소리 점검: 수업·복습 글(공개+예약)의 <audio>/<source> src 가 public/ 에 있는지 */
  const audit = [];
  for (const p of [...posts, ...futurePosts]) {
    if (!langOf(p)) continue;
    const srcs = [...p.content.matchAll(/<(?:audio|source)\b[^>]*\ssrc="([^"]+)"/g)].map((m) => decode(m[1]).replace(/^https?:\/\/daytip\.kr/, '').split('?')[0]);
    const missing = [...new Set(srcs)].filter((s) => s.startsWith('/wp-content/uploads/') && !uploadExists(s));
    audit.push({ post: p, future: p.date > nowKst, count: srcs.length, missing });
  }
  const noAudio = audit.filter((a) => !a.count).sort(byDateAsc);
  const missingAudio = audit.filter((a) => a.missing.length).sort(byDateAsc);
  const missingAudioCount = missingAudio.reduce((s, a) => s + a.missing.length, 0);
  const audioFiles = audit.reduce((s, a) => s + a.count, 0);
  const postRef = (a) => `<span class="x">${a.future ? a.post.title : `<a href="${url(`/${a.post.slug}/`)}">${a.post.title}</a>`}<small>${lessonLabel(a.post)} · ${a.future ? `${fmtMD(a.post.date)} 공개 예정` : fmtDate(a.post.date)}</small></span>`;
  const langCard = (lang) => {
    const L = LANGS[lang]; const latest = latestLesson(lang); const sch = scheduled[lang].slice().sort(byDateAsc);
    const days = new Set([...lessons[lang], ...scheduled[lang]].map((x) => x.day)); const maxDay = Math.max(0, ...days);
    const gaps = []; for (let d = 1; d <= maxDay; d++) if (!days.has(d)) gaps.push(d);
    const last = sch[sch.length - 1];
    return `<div class="adm-card card ${lang}"><p class="kicker">${langTag(lang)}<span>공개 ${lessons[lang].length}편 · 예약 ${sch.length}편</span></p>
${latest ? `<a class="t" href="${url(`/${latest.post.slug}/`)}">${latest.post.title}</a><p class="d">최신 공개 · ${latest.day}일차 · ${fmtDate(latest.post.date)}(${wd(latest.post.date)})</p>` : '<p class="d">아직 공개된 수업이 없어요.</p>'}
<h4>다음 예약</h4>
${sch.length ? `<ul class="adm-list">${sch.slice(0, 5).map((x) => `<li><span class="x">${x.post.title}</span><span class="w">${fmtDay(x.post.date)} ${x.post.date.slice(11, 16)}</span></li>`).join('')}</ul>${sch.length > 5 ? `<p class="d">그 뒤로 ${sch.length - 5}편 더 — 마지막은 ${last.day}일차, ${fmtDay(last.post.date)}</p>` : ''}` : '<p class="d">예약된 수업이 없어요. 새 글을 올려야 다음 수업이 나옵니다.</p>'}
${gaps.length ? `<p class="d">빠진 일차: ${gaps.join(', ')}일차 (공개·예약 어디에도 없어요)</p>` : ''}
<p class="d"><a href="${url(L.hub)}">${L.name} 과정 목차 →</a></p></div>`;
  };
  const allReviews = [...reviews.zh, ...reviews.ja].sort((a, b) => (a.post.date < b.post.date ? 1 : -1));
  const soonReviews = [...scheduledReviews.zh, ...scheduledReviews.ja].sort(byDateAsc);
  const vz = vocab.filter((v) => v.lang === 'zh').length, vj = vocab.length - vz;
  const lessonsHtml = `<div class="adm-cards">${langCard('zh')}${langCard('ja')}</div>
<div class="adm-stats" style="margin-top:12px">
<div class="adm-stat card"><div class="lb">단어장</div><div class="val">${num(vocab.length)}<small>개</small></div><div class="s">중국어 ${num(vz)} · 일본어 ${num(vj)} · 녹음 있는 낱말 ${num(vocab.filter((v) => v.audio).length)}</div></div>
<div class="adm-stat card"><div class="lb">복습 글</div><div class="val">${allReviews.length}<small>편</small></div><div class="s">중국어 ${reviews.zh.length} · 일본어 ${reviews.ja.length}${soonReviews.length ? ` · 예약 ${soonReviews.length}` : ''}</div></div>
<div class="adm-stat card ${noAudio.length ? 'bad' : 'good'}"><div class="lb">소리 없는 수업</div><div class="val">${noAudio.length}<small>편</small></div><div class="s">본문에 소리가 하나도 없는 수업·복습 글</div></div>
<div class="adm-stat card ${missingAudioCount ? 'bad' : 'good'}"><div class="lb">파일이 없는 소리</div><div class="val">${missingAudioCount}<small>개</small></div><div class="s">본문 소리 ${num(audioFiles)}개 가운데 파일이 빠진 것</div></div>
</div>
${noAudio.length ? `<h3>소리 없는 수업<small>${noAudio.length}편</small></h3><ul class="adm-list">${noAudio.map((a) => `<li>${postRef(a)}</li>`).join('')}</ul>` : ''}
${missingAudio.length ? `<h3>파일이 없는 소리<small>${missingAudio.length}편</small></h3><ul class="adm-list">${missingAudio.map((a) => `<li><span class="x">${a.future ? a.post.title : `<a href="${url(`/${a.post.slug}/`)}">${a.post.title}</a>`}<small>${a.missing.map(esc).join('<br>')}</small></span></li>`).join('')}</ul>` : ''}
${allReviews.length || soonReviews.length ? `<h3>복습 글<small>최신순</small></h3><ul class="adm-list">${soonReviews.map((r) => `<li><span class="x">${r.post.title}</span><span class="w">${fmtDay(r.post.date)} 공개 예정</span></li>`).join('')}${allReviews.map((r) => `<li><span class="x"><a href="${url(`/${r.post.slug}/`)}">${r.post.title}</a></span><span class="w">${fmtMD(r.post.date)}</span></li>`).join('')}</ul>` : ''}
${unparsed.length ? `<p class="note">구조를 못 읽은 수업 글 ${unparsed.length}편: ${unparsed.map(esc).join(', ')}</p>` : ''}`;

  /* ----- 3. 글 현황 ----- */
  const isStudy = (p) => !!langOf(p) || p.categories.includes(23);
  const groups = [['학습', posts.filter(isStudy)], ['읽을거리', posts.filter((p) => !isStudy(p) && isWorld(p))], ['생활정보', posts.filter((p) => !isStudy(p) && !isWorld(p) && isLife(p))]];
  const etc = posts.length - groups.reduce((s, g) => s + g[1].length, 0);
  const since = (n) => posts.filter((p) => p.date.slice(0, 10) > addDays(BUILD_DATE, -n)).length;
  const otherFuture = futurePosts.filter((p) => !langOf(p));
  let sha = (process.env.GITHUB_SHA || '').trim().slice(0, 7);
  if (!sha) { try { sha = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { sha = ''; } }
  if (!/^[0-9a-f]{7,12}$/.test(sha)) sha = '';
  const REPO = 'https://github.com/Seonhaesoo/daytip';
  const LINK_SLOT = '<!--adm:links-->';
  const linkStat = (r) => r ? `<div class="adm-stat card ${r.missing.size ? 'bad' : 'good'}"><div class="lb">깨진 링크</div><div class="val">${num(r.missing.size)}<small>개</small></div><div class="s">HTML ${num(r.htmls)}장 · 주소 ${num(r.checked)}개 점검</div></div>` : `<div class="adm-stat card"><div class="lb">깨진 링크</div><div class="val">–</div><div class="s">점검하지 못했어요</div></div>`;
  const LINK_LIST_SLOT = '<!--adm:link-list-->';
  const linkList = (r) => r && r.missing.size ? `<h3>깨진 링크<small>${r.missing.size > 20 ? `앞 20개 / ${num(r.missing.size)}개` : `${r.missing.size}개`}</small></h3><ul class="adm-list">${[...r.missing].slice(0, 20).map(([u, page]) => `<li><span class="x">${esc(u)}<small>← ${esc(page)}</small></span></li>`).join('')}</ul>` : '';
  const groupSub = { 학습: `중국어 ${posts.filter((p) => langOf(p) === 'zh').length} · 일본어 ${posts.filter((p) => langOf(p) === 'ja').length}`, 읽을거리: '일본·중국 이야기', 생활정보: '지원금·법률·부동산·명절' };
  const postsHtml = `<div class="adm-stats">
<div class="adm-stat card"><div class="lb">공개된 글</div><div class="val">${num(posts.length)}<small>편</small></div><div class="s">예약 ${futurePosts.length}편${otherFuture.length ? ` (수업 말고 ${otherFuture.length}편)` : ''}</div></div>
${groups.map(([name, arr]) => `<div class="adm-stat card"><div class="lb">${name}</div><div class="val">${num(arr.length)}<small>편</small></div><div class="s">${groupSub[name]}</div></div>`).join('')}
<div class="adm-stat card"><div class="lb">최근 7일 발행</div><div class="val">${since(7)}<small>편</small></div><div class="s">${fmtMD(addDays(BUILD_DATE, -6))}부터</div></div>
<div class="adm-stat card"><div class="lb">최근 30일 발행</div><div class="val">${since(30)}<small>편</small></div><div class="s">${fmtMD(addDays(BUILD_DATE, -29))}부터</div></div>
${LINK_SLOT}
<div class="adm-stat card ${missingRefs.size ? 'bad' : 'good'}"><div class="lb">없는 업로드 파일</div><div class="val">${num(missingRefs.size)}<small>개</small></div><div class="s">본문이 가리키는데 저장소에 없는 그림·소리</div></div>
</div>
${etc ? `<p class="note">어느 묶음에도 안 드는 글 ${etc}편.</p>` : ''}
${LINK_LIST_SLOT}
<h3>최근 올라온 글<small>10편</small></h3>
<ul class="adm-list">${posts.slice(0, 10).map((p) => `<li><span class="x"><a href="${url(`/${p.slug}/`)}">${p.title}</a><small>${lessonLabel(p) || esc(primaryCat(p) ? catName(primaryCat(p)) : '분류 없음')}</small></span><span class="w">${fmtDay(p.date)}</span></li>`).join('')}</ul>
<p class="adm-sub"><span>빌드 ${fmtDate(nowKst)} ${nowKst.slice(11, 16)} (한국 시간)</span>${sha ? `<span>커밋 <a href="${REPO}/commit/${sha}" target="_blank" rel="noopener noreferrer"><code>${sha}</code></a></span>` : '<span>커밋 정보 없음</span>'}${BASE ? `<span>BASE_PATH ${esc(BASE)}</span>` : ''}</p>`;

  /* ----- 4. 바로가기 ----- */
  const linksHtml = `<div class="adm-links">
${ext('https://search.google.com/search-console?resource_id=sc-domain:daytip.kr', '구글 서치 콘솔', '검색 노출·색인')}
${ext('https://analytics.google.com/', '구글 애널리틱스', '방문자 자세히')}
${ext('https://searchadvisor.naver.com/console/board', '네이버 서치어드바이저', '네이버 수집·노출')}
${ext(`${REPO}/actions`, 'GitHub Actions', '빌드·배포 기록')}
${ext(REPO, '저장소', 'Seonhaesoo/daytip')}
${ext('https://adsense.google.com/', '애드센스', '수익·광고 상태')}
</div>
<p class="adm-sub"><a href="${url('/sitemap.xml')}">사이트맵</a><a href="${url('/feed/')}">RSS</a><a href="${url('/robots.txt')}">robots.txt</a><a href="${url('/ads.txt')}">ads.txt</a></p>`;

  /* 현황 본문이 페이지에 들어간 뒤(비밀번호로 푼 뒤) 부른다 — 갱신 뒤 지난 시간·"오래됐어요" 알림, 막대그래프 읽기 줄 */
  const ADMIN_JS = `function admInit(){var v=document.querySelector('[data-fetched]');if(v){var t=Date.parse(v.getAttribute('data-fetched')),a=Date.now()-t,e=document.querySelector('.js-age'),s=document.querySelector('.js-stale');if(!isNaN(t)){var h=Math.floor(a/36e5);if(e)e.textContent=' ('+(h<1?'방금 전':h<48?h+'시간 전':Math.floor(h/24)+'일 전')+')';if(s)s.hidden=a<=1728e5}}
document.querySelectorAll('.adm-chart').forEach(function(c){var r=c.querySelector('.read'),d=r.getAttribute('data-default'),on=null;function set(g){if(on)on.classList.remove('on');on=g;if(g){g.classList.add('on');r.textContent=g.getAttribute('data-t')}else r.textContent=d}
c.addEventListener('pointerover',function(e){var g=e.target.closest('g[data-t]');if(g)set(g)});c.addEventListener('click',function(e){var g=e.target.closest('g[data-t]');if(g)set(g)});c.addEventListener('pointerleave',function(e){if(e.pointerType==='mouse')set(null)})})}`;
  /* 잠금 풀기 — 비밀번호 → PBKDF2-SHA256 → AES-GCM 키(32바이트) → 복호화 → #adm-root 에 넣고 admInit().
   * 기억: 비밀번호가 아니라 뽑아낸 키를 둔다. 기본은 sessionStorage(탭을 닫으면 사라짐), "이 기기에서 기억" 을 켜면 localStorage.
   * 키 앞에 salt 를 붙여 두어, 다시 배포돼 salt 가 바뀌면 조용히 버리고 비밀번호를 다시 묻는다. 저장소를 못 쓰는 브라우저에서도 그냥 열린다. */
  const UNLOCK_JS = `(function(){var P=JSON.parse(document.getElementById('adm-data').textContent),K='daytip-admin-key',S=window.crypto&&window.crypto.subtle,
lock=document.getElementById('adm-lock'),form=document.getElementById('adm-form'),pw=document.getElementById('adm-pw'),rem=document.getElementById('adm-rem'),err=document.getElementById('adm-err'),btn=document.getElementById('adm-open'),root=document.getElementById('adm-root'),bar=document.getElementById('adm-bar');
function b2u(s){var b=atob(s),u=new Uint8Array(b.length),i=0;for(;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
function u2b(u){var s='',i=0;for(;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s)}
function forget(){['sessionStorage','localStorage'].forEach(function(n){try{window[n].removeItem(K)}catch(e){}})}
function saved(){var n=['sessionStorage','localStorage'],i=0,v;for(;i<2;i++){try{v=window[n[i]].getItem(K);if(v)return v}catch(e){}}return ''}
function keep(raw){forget();try{window[rem.checked?'localStorage':'sessionStorage'].setItem(K,P.salt+':'+u2b(raw))}catch(e){}}
function fail(m){err.textContent=m;err.hidden=false;pw.setAttribute('aria-invalid','true')}
function busy(on){btn.disabled=on;btn.textContent=on?'여는 중…':'열기'}
function derive(pass){return S.importKey('raw',new TextEncoder().encode(pass.normalize('NFC')),'PBKDF2',false,['deriveBits']).then(function(k){return S.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:b2u(P.salt),iterations:P.iter},k,256)}).then(function(b){return new Uint8Array(b)})}
function open(raw){return S.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt']).then(function(k){return S.decrypt({name:'AES-GCM',iv:b2u(P.iv)},k,b2u(P.ct))}).then(function(b){return new TextDecoder().decode(b)})}
function show(html){root.innerHTML=html;root.hidden=false;lock.hidden=true;bar.hidden=false;pw.value='';err.hidden=true;pw.removeAttribute('aria-invalid');admInit();var t=location.hash.length>1&&document.getElementById(decodeURIComponent(location.hash.slice(1)));if(t)t.scrollIntoView()}
document.getElementById('adm-lockbtn').addEventListener('click',function(){forget();root.innerHTML='';root.hidden=true;bar.hidden=true;lock.hidden=false;rem.checked=false;pw.focus()});
if(!S||!window.TextEncoder){fail('이 브라우저(또는 http 주소)에서는 열 수 없어요. https 주소로, 최신 브라우저에서 열어 주세요.');btn.disabled=true;return}
form.addEventListener('submit',function(e){e.preventDefault();if(btn.disabled)return;var pass=pw.value;if(!pass){fail('비밀번호를 넣어 주세요');pw.focus();return}busy(true);err.hidden=true;
derive(pass).then(function(raw){return open(raw).then(function(html){keep(raw);show(html)})}).catch(function(){fail('비밀번호가 맞지 않아요');pw.focus();pw.select()}).then(function(){busy(false)})});
var s=saved(),i=s.indexOf(':');if(s){if(s.slice(0,i)!==P.salt)forget();else{var raw;try{raw=b2u(s.slice(i+1))}catch(e){forget()}if(raw)open(raw).then(show).catch(forget)}}})();`;
  const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').replace(/[\r\n]+$/, '').normalize('NFC');   /* gh secret set 에 파이프로 넣을 때 붙는 줄바꿈은 뗀다 */
  const ADMIN_KDF_ITER = 600000;                              /* PBKDF2-SHA256 반복 수 (OWASP 2023 권고 하한) */
  /* 암호화되는 부분 — 현황 본문 전부 */
  const inner = `<p class="adm-meta">배포할 때마다(매일 아침) 새로 만들어집니다. 비밀번호로 잠겨 있지만 암호문은 공개된 곳에 있으니, 비밀 값은 여기에 두지 않습니다.</p>
<nav class="adm-jump" aria-label="이 페이지 안"><a href="#visitors">방문자</a><a href="#lessons">수업</a><a href="#posts">글</a><a href="#links">바로가기</a></nav>
<section class="sec" id="visitors"><h2>방문자${fetched ? `<small data-fetched="${fetched.slice(0, 19)}+09:00">마지막 갱신 ${fmtMD(fetched)} ${fetched.slice(11, 16)}<span class="js-age"></span></small>` : ''}</h2>
${vHtml}</section>
<section class="sec" id="lessons"><h2>수업 현황</h2>
${lessonsHtml}</section>
<section class="sec" id="posts"><h2>글 현황</h2>
${postsHtml}</section>
<section class="sec" id="links"><h2>바로가기</h2>
${linksHtml}</section>`;
  const fill = (r) => inner.replace(LINK_SLOT, () => linkStat(r)).replace(LINK_LIST_SLOT, () => linkList(r));
  const adminCss = fs.readFileSync(path.join(SRC, 'admin.css'), 'utf8').replace(/\n+/g, '\n');
  const adminPage = (content, foot = '') => shell({ path: '/admin/', title: '관리 현황', description: '데이팁 운영자용 현황 페이지.', robots: 'noindex,nofollow', ads: false, extraHead: `<style>${adminCss}</style>`, extraFoot: foot, body: `<article class="adm">
<p class="crumb"><a href="${url('/')}">홈</a><span>›</span>관리</p>
<h1 class="title">관리 현황</h1>
${content}
</article>` });
  /* 비밀번호가 없을 때 — 현황 자료는 한 글자도 넣지 않는다 */
  const closedPage = adminPage(`<div class="adm-box"><b>관리자 비밀번호가 아직 설정되지 않았어요</b><p>비밀번호를 정해야 이 페이지가 열립니다. 그 전에는 현황 자료를 싣지 않습니다.</p></div>
<p class="note">운영자에게: 저장소 Secrets 에 <code>ADMIN_PASSWORD</code> 를 넣고 다시 배포하세요 — <code>gh secret set ADMIN_PASSWORD -R Seonhaesoo/daytip</code> 를 실행해 비밀번호를 입력한 뒤, GitHub Actions 에서 build-and-deploy 를 다시 돌리면 됩니다. 자세한 것은 README 의 “관리 현황” 을 보세요.</p>`);
  /* 먼저 닫힌 쪽을 써 두고(예전 빌드의 평문이 남지 않게), 본문 링크는 dist/ 에 쓰지 않은 채 점검에 얹는다 */
  write('/admin/index.html', closedPage);
  let linkResult = null;
  try { linkResult = checkLinks(OUT, BASE, [['/admin/index.html (잠긴 본문)', fill(null)]]); } catch (e) { console.log(`링크 점검을 못 했습니다: ${e.message}`); }
  if (ADMIN_PASSWORD) {
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync(Buffer.from(ADMIN_PASSWORD, 'utf8'), salt, ADMIN_KDF_ITER, 32, 'sha256');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plain = fill(linkResult);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);   /* 암호문 뒤에 인증 태그 16바이트 — WebCrypto 의 AES-GCM 꼴 */
    const payload = JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iter: ADMIN_KDF_ITER, cipher: 'AES-256-GCM', salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') });
    const lockedPage = adminPage(`<div id="adm-lock">
<p class="adm-meta">운영자용 요약입니다. 비밀번호를 넣어야 열립니다.</p>
<form id="adm-form" class="adm-lock card" autocomplete="on">
<label for="adm-pw">관리자 비밀번호</label>
<div class="row"><input id="adm-pw" name="password" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" required aria-describedby="adm-err"><button class="btn" id="adm-open" type="submit">열기</button></div>
<label class="chk"><input id="adm-rem" type="checkbox"> 이 기기에서 기억</label>
<p class="adm-err" id="adm-err" role="alert" hidden></p>
<p class="note">기억을 켜지 않으면 이 탭을 닫을 때까지만 열려 있어요. 켜면 이 기기에서 다음 배포 전까지 다시 묻지 않습니다(비밀번호가 아니라 풀이 열쇠만 저장). 같이 쓰는 기기에서는 켜지 마세요.</p>
</form>
<noscript><div class="adm-box warn"><b>자바스크립트가 꺼져 있어요</b><p>이 페이지는 브라우저에서 암호를 풀어 보여 주므로 자바스크립트가 필요합니다.</p></div></noscript>
</div>
<p class="adm-bar" id="adm-bar" hidden><button class="btn ghost sm" id="adm-lockbtn" type="button">잠그기</button></p>
<div id="adm-root" hidden></div>
<script type="application/json" id="adm-data">${payload}</script>`, `<script>${ADMIN_JS}\n${UNLOCK_JS}</script>`);
    /* 평문이 새지 않았는지 — 본문에만 있는 표식이 내보낼 쪽에 보이면 빌드를 멈춘다 */
    for (const mark of ['id="visitors"', 'id="lessons"', 'class="adm-stat', 'class="adm-tile']) if (lockedPage.includes(mark)) throw new Error(`/admin/ 잠긴 쪽에 평문이 섞였습니다(${mark}) — 내보내지 않습니다`);
    write('/admin/index.html', lockedPage);
  }
  console.log(`관리 현황 /admin/ — ${ADMIN_PASSWORD ? `암호화함(AES-256-GCM · PBKDF2-SHA256 ${ADMIN_KDF_ITER.toLocaleString('en-US')}회)` : '비밀번호 없음(ADMIN_PASSWORD) → 닫힌 쪽만 내보냄'} · 방문자 자료 ${stats ? `있음(${stats.fetchedAt})` : '없음'} · 깨진 링크 ${linkResult ? linkResult.missing.size : '?'}개 · 소리 없는 수업 ${noAudio.length}편 · 없는 소리 파일 ${missingAudioCount}개`);
}


const missing = [...missingRefs].sort();
fs.writeFileSync(path.join(DATA, 'build-missing.json'), JSON.stringify(missing, null, 1));
console.log(`글 ${posts.length}편(미래 발행 ${skippedFuture.length}편 제외${skippedFuture.length ? ': ' + skippedFuture.join(', ') : ''}), 페이지 ${pages.length}, 분류 ${liveCats.length}, 사이트맵 ${sitemap.length}개 주소, 업로드 파일 ${copied}개 ${(copiedBytes / 1048576).toFixed(1)}MB${BASE ? `, BASE_PATH=${BASE}` : ''}${PROD ? '' : ' (통계·광고 스크립트 없음)'} — ${((Date.now() - t0) / 1000).toFixed(1)}초`);
console.log(`수업: 중국어 ${lessons.zh.length}편(예약 ${scheduled.zh.length}) · 일본어 ${lessons.ja.length}편(예약 ${scheduled.ja.length}) · 복습 ${reviews.zh.length + reviews.ja.length}편 · 단어장 ${vocab.length}개(녹음 ${vocab.filter((v) => v.audio).length}) · 가나 녹음 ${recordings.ja.size}자 · 한자 녹음 ${recordings.zh.size}자`);
if (unparsed.length) console.log(`구조를 못 읽은 수업 글 ${unparsed.length}편: ${unparsed.join(', ')}`);
if (missing.length) console.log(`본문이 가리키는데 public/ 에 없는 업로드 파일 ${missing.length}개 → data/build-missing.json`);
