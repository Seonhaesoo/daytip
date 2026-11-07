/* 데이팁 페이지 생성기 — node tools/build.mjs → dist/
 * data/ 의 글·페이지·분류(워드프레스에서 내보낸 JSON)와 public/ 의 업로드 파일로 정적 사이트를 만든다.
 * 주소는 워드프레스 때와 똑같다: /<slug>/, /category/<상위>/<하위>/, /page/N/, /feed/, /wp-content/uploads/연/월/파일.
 * 2026-11-08 중국어·일본어 공부 사이트로 고침 — 홈(오늘의 수업), 과정 목차(/chinese-course/ /japanese-course/ 를 글 데이터로 생성),
 *   단어장(/vocabulary/), 가나표(/kana/), 병음표(/pinyin/), 생활정보 모음(/life/) 을 수업 글 본문에서 뽑아(tools/lessons.mjs) 빌드 때마다 만든다.
 * BASE_PATH=/daytip 처럼 주면 모든 루트 상대 주소 앞에 붙인다(테스트용 seonhaesoo.github.io/daytip/). canonical 은 늘 https://daytip.kr 이다.
 * 발행일이 아직 안 된 글(KST 기준 미래)은 빼고 만든다 — 목차에는 "N월 N일 공개" 로만 보인다. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS, langOf, lessonDay, reviewRange, parseLesson, parseReview } from './lessons.mjs';

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

function shell({ path: p, title, description, body, type = 'website', image, jsonld, noindex = false, extraHead = '', extraFoot = '', nav = '', js = false }) {
  const full = p === '/' ? `${site.name} — 하루 한 마디 중국어·일본어` : `${title} - ${site.name}`;
  const img = image ? abs(image) : abs(ICON);
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex, follow">' : '<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">'}
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
${analytics}
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
write('/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`);
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

const missing = [...missingRefs].sort();
fs.writeFileSync(path.join(DATA, 'build-missing.json'), JSON.stringify(missing, null, 1));
console.log(`글 ${posts.length}편(미래 발행 ${skippedFuture.length}편 제외${skippedFuture.length ? ': ' + skippedFuture.join(', ') : ''}), 페이지 ${pages.length}, 분류 ${liveCats.length}, 사이트맵 ${sitemap.length}개 주소, 업로드 파일 ${copied}개 ${(copiedBytes / 1048576).toFixed(1)}MB${BASE ? `, BASE_PATH=${BASE}` : ''}${PROD ? '' : ' (통계·광고 스크립트 없음)'} — ${((Date.now() - t0) / 1000).toFixed(1)}초`);
console.log(`수업: 중국어 ${lessons.zh.length}편(예약 ${scheduled.zh.length}) · 일본어 ${lessons.ja.length}편(예약 ${scheduled.ja.length}) · 복습 ${reviews.zh.length + reviews.ja.length}편 · 단어장 ${vocab.length}개(녹음 ${vocab.filter((v) => v.audio).length}) · 가나 녹음 ${recordings.ja.size}자 · 한자 녹음 ${recordings.zh.size}자`);
if (unparsed.length) console.log(`구조를 못 읽은 수업 글 ${unparsed.length}편: ${unparsed.join(', ')}`);
if (missing.length) console.log(`본문이 가리키는데 public/ 에 없는 업로드 파일 ${missing.length}개 → data/build-missing.json`);
