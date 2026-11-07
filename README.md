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

## 주소 (워드프레스와 동일)

`/<slug>/`, `/page/N/`, `/category/<slug>/`·`/category/study/chinese/`(상위 분류는 하위 글 포함)와 `/page/N/`, `/author/tjsgotn/`(noindex), `/feed/`(RSS, `/feed.xml` 도 같음), `/sitemap.xml`(`/sitemaps.xml` 도), `/robots.txt`, `/ads.txt`, `/404.html`, `/wp-content/uploads/…`. canonical 은 늘 `https://daytip.kr/…`.

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
