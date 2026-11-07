/* 워드프레스에 '예약'으로만 걸려 있던 글을 data/posts/<slug>.json 으로 옮긴다 (2026-11-08 전환 날).
 *
 * 공개 REST 는 예약 글(status=future)을 안 보여 줘서 export-wp.mjs 가 놓쳤다 — 중국어 39~50일차,
 * 일본어 22일차 13편이 12/23 까지 걸려 있었다. 네이버 수업 글이 그날그날 이 글과 그 음원을
 * 가리키므로 빠지면 그날부터 재생이 끊긴다.
 *
 *   node tools/import-future.mjs <future-posts.json> <future-media.json>
 *
 * future-posts.json 은 101 에서 관리자 인증으로 받은 /wp/v2/posts?status=future&context=edit 응답,
 * future-media.json 은 대표 이미지 {id: source_url}. 본문·대표 이미지가 가리키는 uploads 파일 중
 * 아직 없는 것은 내려받는다 (예약 글의 첨부는 공개 미디어 목록에 안 나온다).
 * 빌드는 date 가 지금보다 뒤인 글을 빼므로, 그날이 되면 정해진 시각 배포에 저절로 실린다. */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const [postsFile, mediaFile] = process.argv.slice(2);
const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
const featured = JSON.parse(fs.readFileSync(mediaFile, 'utf8'));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const UP = /https?:\/\/daytip\.kr(\/wp-content\/uploads\/[^"'\s)<>]+)/g;

const outDir = path.join(ROOT, 'data', 'posts');
fs.mkdirSync(outDir, { recursive: true });
const want = new Set();
for (const p of posts) {
  const img = featured[p.featured_media] || '';
  const post = {
    id: p.id, slug: p.slug, status: 'publish', link: `https://daytip.kr/${p.slug}/`,
    date: p.date, date_gmt: p.date_gmt, modified: p.modified, modified_gmt: p.modified_gmt,
    title: p.title.rendered, content: p.content.rendered, excerpt: p.excerpt.rendered,
    categories: p.categories || [], tags: p.tags || [],
    featured_image: img.replace(/^https?:\/\/daytip\.kr/, ''),
    author: '켄치', sticky: false, parent: 0, menu_order: 0,
  };
  fs.writeFileSync(path.join(outDir, `${p.slug}.json`), JSON.stringify(post, null, 1) + '\n');
  for (const m of `${p.content.rendered} ${img}`.matchAll(UP)) want.add(decodeURI(m[1]));
  console.log(`  ${p.date}  ${p.slug}`);
}

let got = 0, have = 0, miss = [];
for (const rel of want) {
  const dest = path.join(ROOT, 'public', rel);
  if (fs.existsSync(dest)) { have++; continue; }
  const r = await fetch(`https://daytip.kr${encodeURI(rel)}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) { miss.push(`${r.status} ${rel}`); continue; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  got++;
  await new Promise((s) => setTimeout(s, 150));
}
console.log(`글 ${posts.length}편 → data/posts/, 파일: 이미 있음 ${have} · 새로 받음 ${got} · 못 받음 ${miss.length}`);
for (const m of miss) console.log('  ! ' + m);
