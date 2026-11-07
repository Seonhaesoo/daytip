/* 데이팁 페이지 생성기 — node tools/build.mjs → dist/
 * data/ 의 글·페이지·분류(워드프레스에서 내보낸 JSON)와 public/ 의 업로드 파일로 정적 사이트를 만든다.
 * 주소는 워드프레스 때와 똑같다: /<slug>/, /category/<상위>/<하위>/, /page/N/, /feed/, /wp-content/uploads/연/월/파일.
 * BASE_PATH=/daytip 처럼 주면 모든 루트 상대 주소 앞에 붙인다(테스트용 seonhaesoo.github.io/daytip/). canonical 은 늘 https://daytip.kr 이다.
 * 발행일이 아직 안 된 글(KST 기준 미래)은 빼고 만든다 — 매일 도는 워크플로가 다시 빌드하면 그날 글이 나온다. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const t0 = Date.now();

const read = (n) => JSON.parse(fs.readFileSync(path.join(DATA, n), 'utf8'));
const site = read('site.json');
const categories = read('categories.json');
const tags = read('tags.json');
/* 페이지 = data/pages.json + data/pages/*.json (황금키워드가 수업 목차 페이지를 여기에 다시 쓴다; slug 가 같으면 이 쪽이 이긴다) */
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
const posts = [...postMap.values()]
  .filter((p) => (p.status || 'publish') === 'publish')
  .filter((p) => { if (p.date > nowKst) { skippedFuture.push(p.slug); return false; } return true; })
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
const pages = pagesAll.filter((p) => (p.status || 'publish') === 'publish');
const postById = new Map(posts.map((p) => [p.id, p]));
const pageById = new Map(pages.map((p) => [p.id, p]));
const BUILD_DATE = nowKst.slice(0, 10);

/* ---------- 작은 도구 ---------- */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·' };
const decode = (s) => String(s ?? '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&([a-z]+);/gi, (m, n) => NAMED[n] ?? m);
const text = (html) => decode(String(html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const url = (p) => BASE + p;                                          /* 사이트 안 주소 (BASE_PATH 반영) */
const abs = (p) => SITE + p;                                          /* canonical 등 — 늘 실제 도메인 */
const iso = (d) => (d ? d.slice(0, 19) + '+09:00' : '');
const fmtDate = (d) => `${d.slice(0, 4)}년 ${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
const write = (p, body) => { const f = path.join(OUT, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
const uploadExists = (rel) => { try { return fs.statSync(path.join(PUBLIC, decodeURIComponent(rel))).isFile(); } catch { return false; } };

/* 분류 — 워드프레스 경로(/category/study/chinese/)와 하위 분류 포함 글 수 */
const catById = new Map(categories.map((c) => [c.id, c]));
function catPath(c) { const parts = []; for (let x = c; x; x = catById.get(x.parent)) parts.unshift(x.slug); return `/category/${parts.join('/')}/`; }
function catChain(c) { const out = []; for (let x = c; x; x = catById.get(x.parent)) out.unshift(x); return out; }
const children = (c) => categories.filter((x) => x.parent === c.id);
function descendantIds(c) { const ids = [c.id]; for (const k of children(c)) ids.push(...descendantIds(k)); return ids; }
const catPosts = (c) => { const ids = new Set(descendantIds(c)); return posts.filter((p) => p.categories.some((id) => ids.has(id))); };
const liveCats = categories.filter((c) => c.slug !== 'uncategorized' && catPosts(c).length);
const topNav = categories.filter((c) => c.parent === 0 && c.slug !== 'uncategorized' && catPosts(c).length);
const primaryCat = (p) => { const own = p.categories.map((id) => catById.get(id)).filter(Boolean); return own.sort((a, b) => catChain(b).length - catChain(a).length)[0]; };
const postsByCat = new Map(categories.map((c) => [c.id, catPosts(c)]));

/* ---------- 본문 정리 ---------- */
const slugByPostId = new Map([...posts.map((p) => [p.id, `/${p.slug}/`]), ...pages.map((p) => [p.id, `/${p.slug}/`])]);
const missingRefs = new Set();
const mediaByName = new Map();   /* 파일명 → /wp-content/uploads/... (같은 이름이면 먼저 올린 것) */
for (const m of [...mediaById.values()].sort((a, b) => (a.date < b.date ? -1 : 1))) { const rel = m.source_url.replace(/^https?:\/\/daytip\.kr/, ''); const name = decodeURIComponent(rel.split('/').pop()); if (!mediaByName.has(name) && uploadExists(rel)) mediaByName.set(name, rel); }
function cleanHtml(html) {
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
  return h.trim();
}
const featured = (p) => { if (p.featured_image) return uploadExists(p.featured_image) ? { rel: p.featured_image, alt: '' } : null; const m = mediaById.get(p.featured_media); if (!m) return null; const rel = m.source_url.replace(/^https?:\/\/daytip\.kr/, ''); return uploadExists(rel) ? { rel, alt: m.alt || '', w: m.width, h: m.height } : null; };
function firstImage(p) { const m = p.content.match(/<img[^>]*\ssrc="(https?:\/\/daytip\.kr)?(\/wp-content\/uploads\/[^"]+)"/); return m && uploadExists(m[2]) ? { rel: m[2], alt: '' } : null; }
const thumb = (p) => featured(p) || firstImage(p);
const excerpt = (p) => text(p.excerpt) || text(p.content).slice(0, 150);

/* ---------- 틀 ---------- */
const CSS = fs.readFileSync(path.join(SRC, 'style.css'), 'utf8').replace(/\n+/g, '\n');
const ICON = site.icon;
const analytics = PROD ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${GTAG_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${GTAG_ID}');</script>
<script async crossorigin="anonymous" src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE}&host=${ADSENSE_HOST}"></script>` : '';

function shell({ path: p, title, description, body, type = 'website', image, jsonld, noindex = false, extraHead = '', extraFoot = '', nav = '' }) {
  const full = p === '/' ? site.name : `${title} - ${site.name}`;
  const img = image ? abs(image) : abs(ICON);
  const head = `<!doctype html>
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
<a class="brand" href="${url('/')}"><img src="${url(site.icon32)}" alt="" width="28" height="28">${esc(site.name)}</a>
<nav class="site-nav" aria-label="분류">${topNav.map((c) => `<a href="${url(catPath(c))}"${nav === catPath(c) ? ' class="on"' : ''}>${esc(c.name)}</a>`).join('')}</nav>
</div></header>
<main><div class="wrap">
${body}
</div></main>
<footer class="site-foot"><div class="wrap">
<div class="links">${pages.filter((x) => ['about', 'contact', 'privacy-policy'].includes(x.slug)).map((x) => `<a href="${url(`/${x.slug}/`)}">${esc(text(x.title))}</a>`).join('')}<a href="${url('/chinese-course/')}">중국어 과정</a><a href="${url('/japanese-course/')}">일본어 과정</a><a href="${url('/feed/')}">RSS</a></div>
<div>© ${BUILD_DATE.slice(0, 4)} ${esc(site.name)} · ${esc(site.description)}</div>
</div></footer>
${extraFoot}
</body>
</html>`;
  return head;
}

const publisher = { '@type': 'Organization', name: site.name, url: SITE + '/', logo: { '@type': 'ImageObject', url: abs(ICON) } };
const sitemap = [];   /* { loc, lastmod } */

/* ---------- 글 ---------- */
function card(p) {
  const th = thumb(p); const c = primaryCat(p);
  return `<li>${th ? `<a class="th" href="${url(`/${p.slug}/`)}"><img src="${url(th.rel)}" alt="" loading="lazy"></a>` : ''}<div class="tx"><a class="t" href="${url(`/${p.slug}/`)}">${p.title}</a><p>${esc(excerpt(p))}</p><div class="m"><time datetime="${iso(p.date)}">${fmtDate(p.date)}</time>${c ? ` · <a href="${url(catPath(c))}">${esc(c.name)}</a>` : ''}</div></div></li>`;
}
function pager(base, n, total) {
  if (total <= 1) return '';
  const at = (i) => (i === 1 ? base : `${base}page/${i}/`);
  return `<nav class="pager" aria-label="페이지"><span>${n > 1 ? `<a href="${url(at(n - 1))}" rel="prev">← 이전</a>` : ''}</span><span class="num">${n} / ${total}</span><span>${n < total ? `<a href="${url(at(n + 1))}" rel="next">다음 →</a>` : ''}</span></nav>`;
}
function listing({ base, items, title, intro = '', description, nav = '', noindex = false, lead = '' }) {
  const total = Math.max(1, Math.ceil(items.length / PER_PAGE));
  for (let n = 1; n <= total; n++) {
    const slice = items.slice((n - 1) * PER_PAGE, n * PER_PAGE);
    const p = n === 1 ? base : `${base}page/${n}/`;
    const body = `${n === 1 ? lead : ''}<div class="list-head">${title ? `<h1>${esc(title)}${n > 1 ? ` <small style="font-weight:400;color:var(--dim)">(${n}쪽)</small>` : ''}</h1>` : ''}${n === 1 && intro ? intro : ''}</div><ul class="list">${slice.map(card).join('')}</ul>${pager(base, n, total)}`;
    write(`${p}index.html`, shell({ path: p, title: title ? (n > 1 ? `${title} ${n}쪽` : title) : site.name, description, body, nav, noindex: noindex || n > 1 }));
    if (!noindex) sitemap.push({ loc: p, lastmod: slice[0]?.modified > slice[0]?.date ? slice[0].modified : slice[0]?.date, priority: n === 1 ? (base === '/' ? '1.0' : '0.6') : '0.3' });
  }
}

const inCatOrder = new Map();   /* 글 → 같은 분류 안 이전·다음(발행순) */
for (const c of categories) { const arr = postsByCat.get(c.id); arr.forEach((p, i) => { if (!inCatOrder.has(p.id) || catChain(c).length > inCatOrder.get(p.id).depth) inCatOrder.set(p.id, { depth: catChain(c).length, older: arr[i + 1], newer: arr[i - 1] }); }); }

for (const p of posts) {
  const c = primaryCat(p); const chain = c ? catChain(c) : [];
  const th = featured(p);
  const modified = p.modified > p.date ? p.modified : p.date;
  const nb = inCatOrder.get(p.id) || {};
  const related = (c ? postsByCat.get(c.id) : posts).filter((x) => x.id !== p.id).slice(0, 6);
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: text(p.title), description: excerpt(p),
    datePublished: iso(p.date), dateModified: iso(modified), inLanguage: 'ko',
    mainEntityOfPage: { '@type': 'WebPage', '@id': abs(`/${p.slug}/`) },
    author: { '@type': 'Person', name: p.author || users[0]?.name || site.name }, publisher,
    ...(th ? { image: abs(th.rel) } : {}), ...(c ? { articleSection: c.name } : {}),
    ...(p.tags?.length ? { keywords: p.tags.map((id) => tags.find((t) => t.id === id)?.name).filter(Boolean).join(', ') } : {}),
  };
  const body = `<article>
<p class="crumb"><a href="${url('/')}">홈</a>${chain.map((x) => `<span>›</span><a href="${url(catPath(x))}">${esc(x.name)}</a>`).join('')}</p>
<h1 class="title">${p.title}</h1>
<p class="meta"><time datetime="${iso(p.date)}">${fmtDate(p.date)}</time>${modified.slice(0, 10) !== p.date.slice(0, 10) ? `<span>수정 <time datetime="${iso(modified)}">${fmtDate(modified)}</time></span>` : ''}${p.author ? `<span>${esc(p.author)}</span>` : ''}</p>
<div class="entry">${cleanHtml(p.content)}</div>
${p.tags?.length ? `<p class="tags">${p.tags.map((id) => tags.find((t) => t.id === id)).filter(Boolean).map((t) => `<a href="${url(`/tag/${t.slug}/`)}">#${esc(t.name)}</a>`).join('')}</p>` : ''}
${nb.older || nb.newer ? `<nav class="pn" aria-label="이전·다음 글">${nb.older ? `<a class="prev" href="${url(`/${nb.older.slug}/`)}"><small>← 이전 글</small>${nb.older.title}</a>` : '<span></span>'}${nb.newer ? `<a class="next" href="${url(`/${nb.newer.slug}/`)}"><small>다음 글 →</small>${nb.newer.title}</a>` : ''}</nav>` : ''}
</article>
${related.length ? `<section class="related"><h2>${c ? `${esc(c.name)} 다른 글` : '다른 글'}</h2><ul class="list">${related.map(card).join('')}</ul></section>` : ''}`;
  write(`/${p.slug}/index.html`, shell({ path: `/${p.slug}/`, title: text(p.title), description: excerpt(p), body, type: 'article', image: th?.rel, jsonld, nav: chain[0] ? catPath(chain[0]) : '' }));
  sitemap.push({ loc: `/${p.slug}/`, lastmod: modified, priority: '0.8' });
}

/* ---------- 페이지 ---------- */
const calcJs = fs.readFileSync(path.join(SRC, 'calc-median-income.js'), 'utf8');
const calcCss = fs.readFileSync(path.join(SRC, 'calc-median-income.css'), 'utf8');
for (const p of pages) {
  const modified = p.modified > p.date ? p.modified : p.date;
  const isCalc = p.slug === 'median-income-calculator';
  const body = `<article><p class="crumb"><a href="${url('/')}">홈</a><span>›</span>${esc(text(p.title))}</p><h1 class="title">${p.title}</h1><div class="entry">${cleanHtml(p.content)}</div></article>`;
  const jsonld = { '@context': 'https://schema.org', '@type': 'WebPage', name: text(p.title), description: excerpt(p), url: abs(`/${p.slug}/`), datePublished: iso(p.date), dateModified: iso(modified), inLanguage: 'ko', publisher };
  write(`/${p.slug}/index.html`, shell({ path: `/${p.slug}/`, title: text(p.title), description: excerpt(p), body, jsonld, extraHead: isCalc ? `<style>${calcCss}</style>` : '', extraFoot: isCalc ? `<script>${calcJs}</script>` : '' }));
  sitemap.push({ loc: `/${p.slug}/`, lastmod: modified, priority: '0.5' });
}

/* ---------- 홈·분류·태그·작성자 ---------- */
const courseRow = `<div class="course-row"><a href="${url('/chinese-course/')}"><b>중국어 한 마디</b><span>하루 한 과씩, 발음 듣기와 함께 — ${postsByCat.get(24)?.length || 0}일차까지</span></a><a href="${url('/japanese-course/')}"><b>일본어 한 마디</b><span>히라가나·가타카나부터 — ${postsByCat.get(25)?.length || 0}일차까지</span></a></div>`;
listing({ base: '/', items: posts, title: '', description: site.description, lead: courseRow });
for (const c of liveCats) {
  const kids = children(c).filter((k) => postsByCat.get(k.id).length);
  const intro = `${c.description ? `<p>${esc(c.description)}</p>` : ''}${kids.length ? `<div class="subcats">${kids.map((k) => `<a href="${url(catPath(k))}">${esc(k.name)} ${postsByCat.get(k.id).length}</a>`).join('')}</div>` : ''}`;
  listing({ base: catPath(c), items: postsByCat.get(c.id), title: c.name, intro, description: `${c.name} — ${site.name}의 ${c.name} 글 ${postsByCat.get(c.id).length}편`, nav: catPath(catChain(c)[0]) });
}
for (const t of tags) {
  const items = posts.filter((p) => p.tags.includes(t.id));
  if (items.length) listing({ base: `/tag/${t.slug}/`, items, title: `#${t.name}`, description: `${t.name} 태그 글 ${items.length}편` });
}
listing({ base: `/author/${AUTHOR_SLUG}/`, items: posts, title: `${users[0]?.name || site.name}의 글`, description: `${site.name} 전체 글`, noindex: true });

/* ---------- 404, robots, ads.txt, 사이트맵, RSS ---------- */
write('/404.html', shell({ path: '/404.html', title: '페이지를 찾을 수 없습니다', description: '주소가 바뀌었거나 없는 페이지입니다.', noindex: true, body: `<div class="notfound"><h1>페이지를 찾을 수 없습니다</h1><p>주소가 바뀌었거나 없는 페이지입니다. <a href="${url('/')}">홈으로</a> 가거나 아래 분류에서 찾아보세요.</p><p>${topNav.map((c) => `<a href="${url(catPath(c))}">${esc(c.name)}</a>`).join(' · ')}</p></div>` }));
write('/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`);
write('/ads.txt', 'google.com, pub-1562244199345682, DIRECT, f08c47fec0942fa0\n');
const sm = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map((u) => `<url><loc>${abs(u.loc)}</loc>${u.lastmod ? `<lastmod>${iso(u.lastmod)}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n')}\n</urlset>\n`;
write('/sitemap.xml', sm);
write('/sitemaps.xml', sm);   /* 워드프레스 robots.txt 가 가리키던 이름 */
/* RSS 본문은 어디서 읽을지 모르니 절대 주소로 */
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
<content:encoded><![CDATA[${absolutize(cleanHtml(p.content))}]]></content:encoded>
</item>`; }).join('\n');
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(site.name)}</title>
<atom:link href="${abs('/feed/')}" rel="self" type="application/rss+xml"/>
<link>${SITE}</link>
<description>${esc(site.description)}</description>
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
if (missing.length) console.log(`본문이 가리키는데 public/ 에 없는 업로드 파일 ${missing.length}개 → data/build-missing.json`);
