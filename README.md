# 데이팁 (daytip.kr) — 정적 사이트

워드프레스(cafe24)에서 옮긴 데이팁. 작은 Node 생성기로 `dist/` 를 만들고 GitHub Actions 가 GitHub Pages 에 올린다. 주소는 워드프레스 때와 똑같아서 네이버 블로그에 박힌 소리 파일 링크(`/wp-content/uploads/연/월/파일.mp3`)와 글 링크(`/<slug>/`)가 그대로 열린다.

```
npm run export   # tools/export-wp.mjs — 워드프레스 REST 에서 data/ 와 public/ 을 받는다 (다시 실행하면 받은 파일은 건너뜀)
npm run build    # tools/build.mjs    — data/ + public/ → dist/   (BASE_PATH=/daytip 이면 모든 주소 앞에 붙임)
npm run check    # tools/check-links.mjs — dist/ 안 링크·그림·소리 파일이 다 있는지
npm run serve    # server.js          — http://localhost:8327/
```

## 자료 배치

| 위치 | 내용 |
|---|---|
| `data/posts.json` | 워드프레스에서 받은 글 176편 (배열). 한 글의 꼴은 아래 |
| `data/posts/*.json` | **새 글은 여기에 파일 하나씩** (한 글 객체, 또는 배열). 빌드가 `posts.json` 과 합치고 slug 가 같으면 이 쪽이 이긴다. 황금키워드(VM 101)가 `SITE_PUBLISH_TARGET=static` 이면 여기에 쓴다 |
| `data/pages.json` | 고정 페이지 6장 (소개·문의·개인정보처리방침·중국어 과정·일본어 과정·기준 중위소득 계산기) |
| `data/pages/*.json` | 다시 쓴 고정 페이지 (수업 목차 등). `pages.json` 과 합치고 slug 가 같으면 이 쪽이 이긴다 |
| `data/categories.json` | 분류 11개 — `id`, `slug`, `name`, `parent`. 글은 `categories: [id]` 로 가리킨다 |
| `data/tags.json`, `data/users.json`, `data/site.json` | 태그 5개(글 없음), 작성자, 사이트 이름·설명·아이콘 |
| `data/media.json` | 워드프레스 미디어 목록 4,443건 — `featured_media` id 를 파일 경로로 푸는 데만 쓴다. 새 글은 이 목록에 넣을 필요 없음 |
| `public/wp-content/uploads/연/월/파일` | 업로드 파일 5,271개(이미지·mp3). `dist/` 에 그대로 복사된다. **새 글의 그림·소리도 같은 규칙으로 여기에** |
| `src/style.css` | 테마. 본문은 워드프레스에서 쓰던 인라인 스타일 그대로 |
| `src/calc-median-income.{js,css}` | 기준 중위소득 계산기 페이지에만 붙는 스크립트 |

글 하나의 꼴 (`data/posts/*.json`):

```json
{
  "id": 6001,
  "slug": "chinese-day-45-example",
  "status": "publish",
  "date": "2026-11-20T07:00:00",
  "modified": "2026-11-10T12:00:00",
  "title": "[중국어 45일차] 제목",
  "content": "<p>본문 HTML …</p>",
  "excerpt": "<p>한 줄 요약 (meta description·목록·RSS 에 쓴다)</p>",
  "categories": [24],
  "tags": [],
  "featured_media": 0,
  "featured_image": "/wp-content/uploads/2026/11/cover-45.png",
  "author": "켄치"
}
```

- `date` 는 KST 로컬 시각(워드프레스 꼴, 시간대 표기 없음). **빌드 시각보다 뒤면 그 글은 빠진다** — 워크플로가 매일 07:30 KST 에 다시 빌드하므로 06:00·07:00 발행 글은 그날 아침에 나온다. 즉시 내보내려면 `workflow_dispatch` 로 돌린다.
- `id` 는 안 겹치게만 (본문의 `/?p=ID` 링크를 slug 로 바꿀 때 쓴다). `featured_media` 대신 `featured_image` 에 업로드 경로를 바로 적어도 된다(둘 다 없으면 본문 첫 그림).
- 본문의 그림·소리 주소는 `https://daytip.kr/wp-content/uploads/…` 절대 주소든 `/wp-content/uploads/…` 루트 상대든 빌드가 BASE_PATH 에 맞춰 고친다. `srcset` 은 없는 파일을 빼 준다.
- 분류 id: 정부지원금 19 · 부동산·세금 20 · 생활법률·안전 21 · 명절·생활상식 22 · 공부합시다 23(중국어 24, 일본어 25) · 세계 이야기 26(일본이야기 27, 중국이야기 28).

## 공부 사이트 꼴 (2026-11-08)

홈·메뉴는 중국어·일본어 공부 중심이다. 아래 페이지는 모두 **빌드 때마다 수업 글 본문에서 뽑아** 만든다(`tools/lessons.mjs`가 글 하나를 `{ day, allAudio, words:[{word, reading, meaning, audio, exampleAudio}] }`로 읽는다 — "오늘 배운 것" 표를 기준으로, 그림 카드 `alt="낱말 읽기 · 뜻"`와 바로 뒤의 `dayN-i-word/example.mp3`를 맞춘다. 소리 파일 경로는 본문에 적힌 전체 경로를 쓴다).

| 주소 | 내용 |
|---|---|
| `/` | 오늘(최근)의 중국어·일본어 수업 카드(핵심 낱말·전체 듣기·이어서 공부하기), 도구, 최근 수업, 읽을거리 |
| `/chinese-course/` `/japanese-course/` | 과정 목차. `data/pages*.json`의 페이지 본문은 **안 쓰고** 소개 문단과 단원(`<h2>발음<span>1~10일차 …</span></h2><p>설명</p>`) 구조만 읽는다. 공개 수업은 링크+전체 듣기+"공부했어요" 체크(localStorage), 예약 글은 "N월 N일 공개", 복습은 범위 끝 뒤에 |
| `/vocabulary/` `/vocabulary/chinese/` `/vocabulary/japanese/` | 단어장 — 낱말·읽기·뜻·출처 수업·녹음, 예문은 복습 글에서. JS 없이도 일차별 목록, JS 있으면 찾기·언어·일차 거르기(`?q=`) |
| `/kana/` `/pinyin/` | 히라가나·가타카나 표 / 성조·성모·운모 표. 수업에 그 글자 하나짜리 낱말 녹음이 있으면 녹음(초록 점), 없으면 브라우저 `speechSynthesis`(기계 음성이라고 표시) |
| `/life/` | 정부지원금·생활법률·부동산·명절 모음 — 홈·메뉴에서 빠지고 메뉴 끝 "생활정보"로만 |
| `/admin/` | 운영자용 관리 현황 (noindex·robots Disallow, 메뉴·사이트맵에 없음) — 아래 "관리 현황" |

본문의 인라인 스타일은 색·배경·테두리만 테마 클래스(`.c-* .bg-* .bd*`)로 바꿔 넣어 어두운 모드에서도 읽힌다(`restyle()`); 배치용 속성은 그대로. 수업 글은 맨 위 "전체 듣기" 상자와 맨 아래 "지난 수업" 꼬리를 떼고 빌드가 다시 그린다. `src/study.js`가 소리 재생·진도·단어장 찾기를 맡는다(프레임워크 없음).

## 관리 현황 `/admin/` (2026-11-10)

운영자용 요약 한 장 — 방문자 · 수업 현황(최신 공개·다음 예약·소리 점검·복습·단어장) · 글 현황(묶음별 편수·최근 글·깨진 링크·빌드 시각·커밋) · 바로가기(서치 콘솔·애널리틱스·서치어드바이저·Actions·저장소·애드센스). `tools/build.mjs` 맨 끝에서 만들고 `src/admin.css` 가 이 페이지에만 붙는다.

- **비공개가 아니다.** 정적 호스팅이라 주소를 알면 누구나 본다. `noindex,nofollow` + `robots.txt` 의 `Disallow: /admin/`, 사이트맵·메뉴·바닥·피드에 없음, 통계·광고 스크립트 없음. **비밀 값·메일·키·토큰은 절대 넣지 않는다.**
- 깨진 링크 수는 빌드가 `tools/check-links.mjs` 의 `checkLinks()` 로 `dist/` 전체를 훑어 적는다(로컬에서는 `dist/` 에 남은 옛 파일도 세므로 CI 숫자가 기준).
- 소리 점검은 수업·복습 글(공개+예약) 본문의 `<audio>` `src` 가 `public/` 에 있는지 본다.

### 방문자 자료 (GA4 → `data/admin/stats.json`)

`tools/fetch-ga.mjs` 가 GA4 Data API(`runReport`)에서 받아 `data/admin/stats.json` 에 쓰고, 빌드가 그 파일을 읽어 어제·최근 7일·최근 30일(앞선 기간 대비), 30일 막대그래프, 많이 본 페이지 20, 유입 10, 기기를 그린다(`dist/admin/stats.json` 으로도 복사). **파일이 없으면 "아직 방문자 자료가 없어요", 마지막 갱신이 이틀을 넘으면 "오래됐어요" 알림**이 뜨고 나머지 칸은 그대로 나온다. npm 의존성은 없다(JWT 는 `node:crypto` 로 서명).

켜는 법 — 한 번만:

1. Google Cloud 프로젝트에서 **Google Analytics Data API** 를 켜고, 서비스 계정을 만들어 JSON 키를 받는다.
2. GA4 관리 → 속성 액세스 관리에서 그 **서비스 계정 메일(`…@….iam.gserviceaccount.com`)을 "뷰어"로 추가**한다. (이게 없으면 403 `PERMISSION_DENIED`)
3. 저장소 Settings → Secrets and variables → Actions 에 두 개를 넣는다:
   - `GA_KEY_JSON` — 받은 키 JSON 파일 내용 전체(그대로 붙여 넣기, base64 로 넣어도 읽는다)
   - `GA_PROPERTY_ID` — GA4 **속성 ID(숫자만**, 관리 → 속성 설정). `G-…`/`GT-…` 측정 ID 가 아니다
4. 다음 배포부터 워크플로의 "Fetch visitor stats" 단계가 빌드 앞에서 돈다. 두 값 중 하나라도 없으면 그 단계는 건너뛰고, 받다가 실패해도 경고만 남기고 배포는 계속한다. CI 는 받은 파일을 **커밋하지 않는다** — 매일 아침(06:05·07:05 KST) 배포 때마다 새로 받는다.

로컬 시험 (키 파일은 저장소 밖에 둔다 — 커밋 금지):

```
# bash
GA_KEY_FILE=~/keys/daytip-ga.json GA_PROPERTY_ID=123456789 node tools/fetch-ga.mjs && npm run build
# PowerShell
$env:GA_KEY_FILE='C:\keys\daytip-ga.json'; $env:GA_PROPERTY_ID='123456789'; node tools/fetch-ga.mjs; npm run build
```

- 환경 변수: `GA_KEY_JSON`(키 JSON 내용) 또는 `GA_KEY_FILE`(키 파일 경로, `GA_KEY_JSON` 이 없을 때), `GA_PROPERTY_ID`. 없으면 알림만 찍고 종료 코드 0, 파일은 건드리지 않는다.
- `STATS_FILE=경로` 를 주면 fetch-ga 는 그 파일에 쓰고 빌드는 그 파일을 읽는다(시험용 자료를 저장소 밖에 둘 때).
- 로컬에서 받은 `data/admin/stats.json` 을 커밋하면 그 숫자가 사이트에 남고, 비밀 값이 들어온 뒤에는 CI 가 매번 덮어쓴다. 평소에는 커밋하지 않는 편이 낫다.
- 파일 꼴: `fetchedAt`(KST ISO, `+09:00`), `periods.{yesterday,yesterdayPrev,last7,prev7,last30,prev30}.{users,pageviews,sessions}`, `daily[{date,users,pageviews,sessions}]`(60일, 어제까지), `pages[{path,pageviews,users}]`, `sources[{source,medium,sessions,users}]`, `devices[{device,users,sessions}]`. 방문자(활성 사용자)는 날마다 더하면 겹치므로 기간 합계는 GA 에 기간별로 따로 묻는다.

## 주소 (워드프레스와 동일)

`/<slug>/`, `/page/N/`, `/category/<slug>/`·`/category/study/chinese/`(상위 분류는 하위 글 포함)와 `/page/N/`, `/author/tjsgotn/`(noindex), `/feed/`(RSS, `/feed.xml` 도 같음), `/sitemap.xml`(`/sitemaps.xml` 도), `/robots.txt`(`Disallow: /admin/`), `/ads.txt`, `/404.html`, `/wp-content/uploads/…`. canonical 은 늘 `https://daytip.kr/…`.

## 배포

`.github/workflows/deploy.yml` — push·매일 07:30 KST·수동. 지금은 `BASE_PATH=/daytip` 으로 테스트 주소 https://seonhaesoo.github.io/daytip/ 에 올린다. daytip.kr 로 바꿀 때: 워크플로의 `BASE_PATH` 를 비우고, `public/CNAME` 에 `daytip.kr` 을 넣고, DNS 를 GitHub Pages 로 돌린다. 통계(GT-MBGF2V3V)·애드센스(ca-pub-1562244199345682) 스크립트는 BASE_PATH 가 빈 빌드에만 들어간다.

## 황금키워드가 쓰는 법 (VM 101)

`/opt/golden-keyword/backend` 의 `app/publish/static_site.py` 가 워드프레스 REST 대신 이 저장소에 쓴다. 두 길은 `app/publish/site.py` 에서 `SITE_PUBLISH_TARGET` 설정으로 갈린다 — 부르는 쪽(그림 배치·초안 업로드·수업 발행·대장 맞추기)은 바뀌지 않았다.

- 저장소 복제본: `/home/tjsgotn/daytip-site` (`STATIC_REPO_DIR`). 배포 키 `~/.ssh/daytip_deploy` (GitHub 쪽 이름 "101 GoldenKeywords", 쓰기 가능), `~/.ssh/config` 의 `Host github.com-daytip` 별칭으로만 쓴다. 커밋 작성자 `GoldenKeywords bot <tjsgotn15@gmail.com>`.
- 그림·소리 → `public/wp-content/uploads/연/월/` (올린 달, KST). 같은 이름에 다른 파일이면 `-2`, `-3`; 같은 바이트가 어디든 이미 있으면 그 주소를 다시 쓴다. 글 → `data/posts/<slug>.json`, `date` = 예약 시각(KST). 글 한 편과 그 그림은 **한 커밋**이고 바로 push 한다 — push 가 안 되면 커밋은 남겨 두고 15분마다 다시 민다(ntfy 알림, 6시간에 한 번).
- 2026-11-08 시험: 글 #258(`/sick-leave-unemployment-benefit-documents/`)을 테스트 주소에 올려 글·그림·mp3 가 200 으로 나오는 것을 확인했다. **이 글은 대장(ledger)에 없다** — 전환 뒤 도구가 다시 올리려 하면 "주소를 쓰는 글이 이미 있습니다" 로 막히므로, 그날 `data/posts/sick-leave-unemployment-benefit-documents.json` 을 지우거나 대장에 `external_id=1291579` 로 백필한다.

## 전환 날 순서 (daytip.kr → GitHub Pages)

1. **워드프레스 마지막 내보내기.** 전환 직전까지 워드프레스에 올라간 글·파일을 받는다: `npm run export` (받은 파일은 건너뛰므로 새것만 온다) → `npm run build && npm run check` 로 빠진 파일이 없는지 → 커밋·push. 예약만 걸려 있던 글은 `date` 가 미래라 그날이 되면 저절로 나온다.
2. **황금키워드를 정적 사이트로.** 101 의 `/opt/golden-keyword/backend/.env` 에 아래를 넣고 (설정 화면 '사이트 발행' 묶음에서도 됨) VM 을 다시 켠다 — 서비스 재시작에 sudo 가 없으므로 218 에서 `qm reboot 101`. 켜진 뒤 `/api/publish/status` 가 `"target": "static"` 이면 된다. 대장 맞추기(wp_sync)는 그때부터 저장소를 읽는다.
   ```
   SITE_PUBLISH_TARGET=static
   STATIC_REPO_DIR=/home/tjsgotn/daytip-site
   STATIC_SITE_URL=https://daytip.kr
   ```
   이미 워드프레스에 올라가 있던 글(`Content.wp_post_id`·`Lesson.wp_post_id`)은 1단계에서 내려받은 `data/posts.json` 에 같은 번호로 있으므로, 도구가 그 글을 다시 올리면 같은 번호로 `data/posts/<slug>.json` 에 고쳐 쓴다.
3. **저장소를 도메인 루트 빌드로.** `.github/workflows/deploy.yml` 의 `BASE_PATH: /daytip` 두 곳을 `BASE_PATH: ''` 로, `public/CNAME` 파일을 만들어 `daytip.kr` 한 줄 → 커밋·push. (저장소 Settings → Pages → Custom domain 에도 `daytip.kr` 이 들어가고 "Enforce HTTPS" 를 켠다 — 인증서는 DNS 가 맞은 뒤 몇 분~한 시간 뒤에 나온다.)
4. **DNS (daytip.kr 등록기관).** 기존 카페24 A 레코드를 지우고:
   ```
   daytip.kr      A     185.199.108.153
   daytip.kr      A     185.199.109.153
   daytip.kr      A     185.199.110.153
   daytip.kr      A     185.199.111.153
   daytip.kr      AAAA  2606:50c0:8000::153
   daytip.kr      AAAA  2606:50c0:8001::153
   daytip.kr      AAAA  2606:50c0:8002::153
   daytip.kr      AAAA  2606:50c0:8003::153
   www.daytip.kr  CNAME seonhaesoo.github.io.
   ```
   TTL 은 미리 낮춰 두면(300) 되돌릴 때 빠르다. 확인: `dig daytip.kr +short` 가 위 네 주소, `curl -I https://daytip.kr/feed/` 가 200, 네이버 글의 소리 주소(`https://daytip.kr/wp-content/uploads/연/월/파일.mp3`)가 그대로 재생되는지.
5. **그 뒤.** 서치콘솔 사이트맵 `https://daytip.kr/sitemap.xml` 다시 제출. 워드프레스는 당분간 끄지 않는다 — 되돌릴 자리다.

### 되돌리기

- DNS 만 카페24 A 레코드로 되돌리면 워드프레스가 다시 나온다 (그 사이 정적 사이트에만 올라간 글은 워드프레스에 없다 — `data/posts/*.json` 을 보고 손으로 올린다).
- 황금키워드는 `.env` 의 `SITE_PUBLISH_TARGET=wp` 로 바꾸고 101 을 다시 켠다. 정적으로 올리는 동안 대장에 적힌 글 번호(10만 이상)는 워드프레스 번호가 아니므로, 그 글들은 `wp_post_id` 를 비우고 다시 올린다.
- 저장소는 `BASE_PATH` 를 `/daytip` 으로 되돌리고 `public/CNAME` 을 지우면 테스트 주소로 돌아간다.
