/* 수업 글(중국어 24 · 일본어 25) 본문에서 일차·낱말·소리 파일을 뽑는다 — build.mjs 가 홈·과정 목차·단어장·가나표·병음표를 만드는 데 쓴다.
 *
 * 수업 글의 꼴 (황금키워드가 만든다):
 *   - 맨 위 "N일차 전체 듣기" 상자: <audio src=".../dayN-all.mp3">   (일본어 17일차부터는 소리가 없는 글도 있다)
 *   - 낱말마다 <figure><img alt="낱말 읽기 · 뜻"> … <figcaption>읽기 · 뜻</figcaption></figure>
 *     바로 뒤 상자에 "낱말 듣기" <audio src="dayN-i-word.mp3">, "예문 듣기" <audio src="dayN-i-example.mp3">
 *   - 맨 아래 "오늘 배운 것" 표: <tr><td>낱말</td><td>읽기</td><td>뜻</td></tr>   (그림 카드가 없는 글도 이 표는 있다)
 *   소리 파일 이름은 달이 다르면 겹칠 수 있으므로(일본어 day6 ↔ 중국어 day6) 반드시 본문에 적힌 전체 경로를 쓴다.
 * 복습 글: <details><summary><span>낱말</span></summary> … <b>읽기</b> · 뜻 … <div>예문<br/>번역</div></details>
 *   (summary 안에 낱말 <audio> 가 있는 글도 있다) — 단어장의 예문은 여기서 가져온다. */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·' };
export const decode = (s) => String(s ?? '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&([a-z]+);/gi, (m, n) => NAMED[n] ?? m);
const text = (html) => decode(String(html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim();
const rel = (u) => decodeURIComponent(String(u).replace(/^https?:\/\/daytip\.kr/, '').split('?')[0]);

export const LANGS = {
  zh: { cat: 24, name: '중국어', hub: '/chinese-course/', slugPrefix: 'chinese', speech: 'zh-CN', readingLabel: '병음' },
  ja: { cat: 25, name: '일본어', hub: '/japanese-course/', slugPrefix: 'japanese', speech: 'ja-JP', readingLabel: '읽기' },
};
export const langOf = (post) => (post.categories.includes(24) ? 'zh' : post.categories.includes(25) ? 'ja' : null);

/* slug 또는 제목에서 일차를 읽는다: chinese-day-12-… / [중국어 12일차] / (중국어 12일차) / 12일차 */
export function lessonDay(post) {
  const m = post.slug.match(/-day-(\d+)(?:-|$)/) || post.title.match(/(\d+)\s*일차/);
  return m ? +m[1] : null;
}
export function reviewRange(post) {
  const m = post.slug.match(/-review-day-(\d+)-(\d+)/) || post.title.match(/(\d+)\s*[~～-]\s*(\d+)\s*일차/);
  return m ? [+m[1], +m[2]] : null;
}

/* 한 수업 글 → { lang, day, allAudio, words:[{ word, reading, meaning, audio, exampleAudio, index }], newsAudio, parsed } */
export function parseLesson(post) {
  const lang = langOf(post);
  const day = lessonDay(post);
  const html = post.content;
  const out = { lang, day, allAudio: null, newsAudio: null, words: [], parsed: 'none' };
  if (!lang || !day) return out;
  const allM = html.match(/<audio[^>]*src="([^"]*\/day\d+-all(?:-\d+)?\.mp3)"/);
  if (allM) out.allAudio = rel(allM[1]);
  const newsM = html.match(/<audio[^>]*src="([^"]*\/day\d+-news(?:-\d+)?\.mp3)"/);
  if (newsM) out.newsAudio = rel(newsM[1]);

  /* 1) 낱말 소리: dayN-i-word / dayN-i-example (경로째) */
  const wordAudio = new Map(), exAudio = new Map();
  for (const m of html.matchAll(/<audio[^>]*src="([^"]*\/day\d+-(\d+)-(word|example)(?:-\d+)?\.mp3)"/g)) {
    (m[3] === 'word' ? wordAudio : exAudio).set(+m[2], rel(m[1]));
  }
  /* 2) 그림 카드: alt="낱말 읽기 · 뜻" (읽기는 띄어쓰기를 품을 수 있어 figcaption "읽기 · 뜻" 으로 자른다).
   *    카드 바로 뒤(다음 카드 전)에 오는 dayN-i-word / dayN-i-example 이 그 낱말의 소리다 — 번호 i 는 카드 순서와 다를 수 있다(43일차 꼴). */
  const figs = [...html.matchAll(/<figure[^>]*>\s*<img[^>]*\salt="([^"]*)"[^>]*>(?:\s*<figcaption[^>]*>([\s\S]*?)<\/figcaption>)?/g)];
  const cards = [];
  figs.forEach((m, fi) => {
    const alt = text(m[1]); const cap = m[2] ? text(m[2]) : '';
    if (!alt.includes(' · ')) return;
    const [capReading] = cap.split(' · ');
    const [head, ...meaningParts] = alt.split(' · ');
    const meaning = meaningParts.join(' · ').trim();
    let word, reading;
    if (capReading && head.endsWith(' ' + capReading)) { word = head.slice(0, -capReading.length - 1).trim(); reading = capReading; }
    else { const sp = head.indexOf(' '); word = sp > 0 ? head.slice(0, sp) : head; reading = sp > 0 ? head.slice(sp + 1) : ''; }
    const seg = html.slice(m.index + m[0].length, figs[fi + 1] ? figs[fi + 1].index : undefined);
    const a = seg.match(/<audio[^>]*src="([^"]*\/day\d+-(\d+)-word(?:-\d+)?\.mp3)"/);
    const e = seg.match(/<audio[^>]*src="([^"]*\/day\d+-(\d+)-example(?:-\d+)?\.mp3)"/);
    cards.push({ word, reading, meaning, index: a ? +a[2] : e ? +e[2] : null, audio: a ? rel(a[1]) : null, exampleAudio: e ? rel(e[1]) : null });
  });
  /* 3) "오늘 배운 것" 표 */
  const table = [];
  const ti = html.indexOf('오늘 배운 것');
  if (ti >= 0) {
    const tb = html.slice(ti).match(/<table[\s\S]*?<\/table>/);
    if (tb) for (const tr of tb[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => text(x[1]));
      if (tds.length >= 3 && tds[0]) table.push({ word: tds[0], reading: tds[1], meaning: tds[2] });
    }
  }
  /* 표를 기준으로 삼고(빠짐없이 들어 있다) 카드 순서로 소리 번호를 맞춘다. 표가 없으면 카드만. */
  const base = table.length ? table : cards;
  out.parsed = table.length && cards.length ? 'table+cards' : table.length ? 'table' : cards.length ? 'cards' : 'none';
  out.words = base.map((w, i) => {
    const card = cards.find((c) => c.word === w.word);
    if (card) return { ...w, index: card.index, audio: card.audio, exampleAudio: card.exampleAudio };
    /* 카드가 없는 낱말: 표의 i번째 ↔ dayN-i-*.mp3 로 본다 (카드가 아예 없는 글에서만 — 소리가 있을 때) */
    const idx = cards.length === 0 && (wordAudio.has(i + 1) || exAudio.has(i + 1)) ? i + 1 : null;
    return { ...w, index: idx, audio: idx ? wordAudio.get(idx) || null : null, exampleAudio: idx ? exAudio.get(idx) || null : null };
  });
  /* 표에 없는 카드 낱말(드물다)도 더한다 */
  for (const c of cards) if (!out.words.some((w) => w.word === c.word)) out.words.push({ ...c });
  return out;
}

/* 복습 글 → { lang, range, allAudio, items:[{ word, reading, meaning, example, translation, audio }] } (1부 "한자를 보고 뜻을" 쪽만) */
export function parseReview(post) {
  const lang = langOf(post);
  const range = reviewRange(post);
  const html = post.content;
  const out = { lang, range, allAudio: null, items: [] };
  if (!lang || !range) return out;
  const allM = html.match(/<audio[^>]*src="([^"]*\/day0-all(?:-\d+)?\.mp3)"/);
  if (allM) out.allAudio = rel(allM[1]);
  const second = html.search(/2\.\s*뜻을 보고/);
  const part = second > 0 ? html.slice(0, second) : html;
  for (const d of part.matchAll(/<details[^>]*>([\s\S]*?)<\/details>/g)) {
    const body = d[1];
    const sm = body.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
    if (!sm) continue;
    const wordM = sm[1].match(/<span[^>]*font-size:2\d[^>]*>([\s\S]*?)<\/span>/);
    const word = wordM ? text(wordM[1]) : '';
    const audioM = sm[1].match(/<audio[^>]*src="([^"]+\.mp3)"/);
    const after = body.slice(sm.index + sm[0].length);
    const rd = after.match(/<b[^>]*>([\s\S]*?)<\/b>\s*·\s*([^<]*)/);
    const ex = after.match(/<div[^>]*font-size:14px[^>]*>([\s\S]*?)<\/div>/);
    const exLines = ex ? text(ex[1]).split('\n').map((s) => s.trim()).filter(Boolean) : [];
    if (!word) continue;
    out.items.push({ word, reading: rd ? text(rd[1]) : '', meaning: rd ? text(rd[2]) : '', example: exLines[0] || '', translation: exLines[1] || '', audio: audioM ? rel(audioM[1]) : null });
  }
  return out;
}
