/* 방문자 자료 받기 — node tools/fetch-ga.mjs  → data/admin/stats.json  (/admin/ 의 "방문자" 칸이 읽는다)
 * GA4 Data API(runReport)를 서비스 계정으로 부른다. npm 의존성 없음: JWT 는 node:crypto 로 서명하고 fetch 로 토큰을 바꾼다.
 *
 * 환경 변수
 *   GA_PROPERTY_ID  GA4 속성 ID (숫자만, 예: 123456789 — "G-…" 측정 ID 가 아니다)
 *   GA_KEY_JSON     서비스 계정 키 JSON 전체(그대로 또는 base64).  GitHub Actions 비밀 값으로 넣는다
 *   GA_KEY_FILE     (로컬 시험용) 키 JSON 파일 경로 — GA_KEY_JSON 이 없을 때 쓴다
 * 서비스 계정 메일(client_email)에 GA4 속성의 "뷰어" 권한이 있어야 한다.
 *
 * 조용히 실패한다: 환경 변수가 없거나 API 가 오류를 내면 알림만 찍고 종료 코드 0, 기존 파일은 건드리지 않는다(배포를 막지 않는다).
 * 키·토큰은 어디에도 찍지 않는다. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = process.env.STATS_FILE || path.join(ROOT, 'data', 'admin', 'stats.json');
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

const soft = (msg) => { console.log(`[fetch-ga] ${msg}`); if (process.env.GITHUB_ACTIONS) console.log(`::warning title=방문자 자료::${msg}`); process.exit(0); };

function loadKey() {
  let raw = (process.env.GA_KEY_JSON || '').trim();
  if (!raw && process.env.GA_KEY_FILE) {
    try { raw = fs.readFileSync(process.env.GA_KEY_FILE, 'utf8').trim(); } catch { soft('GA_KEY_FILE 파일을 읽지 못했습니다 — 건너뜁니다.'); }
  }
  if (!raw) return null;
  if (!raw.startsWith('{')) { try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch { /* 아래에서 걸린다 */ } }
  try { const k = JSON.parse(raw); if (k.client_email && k.private_key) return k; } catch { /* 아래로 */ }
  soft('서비스 계정 키(JSON)를 읽지 못했습니다 — client_email·private_key 가 든 키 파일 전체여야 합니다. 건너뜁니다.');
}

const b64url = (v) => Buffer.from(v).toString('base64url');
async function accessToken(key) {
  const aud = key.token_uri || 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud, iat: now, exp: now + 600 }))}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
  const res = await fetch(aud, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`토큰 교환 실패 (${res.status} ${j.error || ''} ${j.error_description || ''})`.trim());
  return j.access_token;
}

async function main() {
  const property = (process.env.GA_PROPERTY_ID || '').trim().replace(/^properties\//, '');
  const key = loadKey();
  if (!key || !property) soft(`${[!key && 'GA_KEY_JSON(또는 GA_KEY_FILE)', !property && 'GA_PROPERTY_ID'].filter(Boolean).join(' · ')} 가 없어 방문자 자료를 받지 않습니다.`);
  if (!/^\d+$/.test(property)) soft('GA_PROPERTY_ID 는 숫자로 된 GA4 속성 ID 여야 합니다(G-… 측정 ID 가 아님). 건너뜁니다.');

  const token = await accessToken(key);
  const run = async (body) => {
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`runReport 실패 (${res.status} ${j.error?.status || ''}) ${j.error?.message || ''}`.trim());
    return j;
  };
  const rows = (rep) => (rep.rows || []).map((r) => ({ d: (r.dimensionValues || []).map((x) => x.value), m: (r.metricValues || []).map((x) => +x.value || 0) }));
  const metrics3 = [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'sessions' }];
  const last30 = [{ startDate: '30daysAgo', endDate: 'yesterday' }];

  /* 기간 합계 — 사용자 수는 날마다 더하면 겹치므로(같은 사람이 이틀 오면 2) 기간별로 따로 묻는다. 한 요청에 기간은 4개까지 */
  const PERIODS = [
    ['yesterday', 'yesterday', 'yesterday'], ['yesterdayPrev', '2daysAgo', '2daysAgo'], ['last7', '7daysAgo', 'yesterday'], ['prev7', '14daysAgo', '8daysAgo'],
    ['last30', '30daysAgo', 'yesterday'], ['prev30', '60daysAgo', '31daysAgo'],
  ];
  const periodReport = (list) => run({ dateRanges: list.map(([name, startDate, endDate]) => ({ name, startDate, endDate })), metrics: metrics3 });

  const [daily, pA, pB, pages, sources, devices] = await Promise.all([
    run({ dateRanges: [{ startDate: '60daysAgo', endDate: 'yesterday' }], dimensions: [{ name: 'date' }], metrics: metrics3, orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 100 }),
    periodReport(PERIODS.slice(0, 4)),
    periodReport(PERIODS.slice(4)),
    run({ dateRanges: last30, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 20 }),
    run({ dateRanges: last30, dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 }),
    run({ dateRanges: last30, dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }], orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }] }),
  ]);

  const periods = Object.fromEntries(PERIODS.map(([name, startDate, endDate]) => [name, { start: startDate, end: endDate, users: 0, pageviews: 0, sessions: 0 }]));
  for (const rep of [pA, pB]) for (const r of rows(rep)) { const p = periods[r.d[r.d.length - 1]]; if (p) [p.users, p.pageviews, p.sessions] = r.m; }

  const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19) + '+09:00';
  const stats = {
    fetchedAt: kst,
    fetchedAtNote: '한국 시간(KST, +09:00). 날짜별 숫자는 GA4 속성의 시간대 기준이고 오늘(집계 중)은 뺐다.',
    source: 'GA4 Data API v1beta runReport',
    timeZone: daily.metadata?.timeZone || null,
    periods,
    daily: rows(daily).map((r) => ({ date: `${r.d[0].slice(0, 4)}-${r.d[0].slice(4, 6)}-${r.d[0].slice(6, 8)}`, users: r.m[0], pageviews: r.m[1], sessions: r.m[2] })),
    pages: rows(pages).map((r) => ({ path: r.d[0], pageviews: r.m[0], users: r.m[1] })),
    sources: rows(sources).map((r) => ({ source: r.d[0], medium: r.d[1], sessions: r.m[0], users: r.m[1] })),
    devices: rows(devices).map((r) => ({ device: r.d[0], users: r.m[0], sessions: r.m[1] })),
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(stats, null, 1) + '\n');
  console.log(`[fetch-ga] ${path.relative(ROOT, OUT_FILE)} 에 썼습니다 — 날짜 ${stats.daily.length}일, 페이지 ${stats.pages.length}, 유입 ${stats.sources.length}, 기기 ${stats.devices.length}`);   /* 숫자는 찍지 않는다 — 공개 저장소의 Actions 로그는 누구나 본다 */
}

main().catch((e) => soft(`방문자 자료를 받지 못했습니다 — ${String(e.message || e).slice(0, 300)} (기존 파일은 그대로 둡니다)`));
