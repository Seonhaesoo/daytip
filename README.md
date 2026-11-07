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
| `data/posts/*.json` | **새 글은 여기에 파일 하나씩** (한 글 객체, 또는 배열). 빌드가 `posts.json` 과 합치고 slug 가 같으면 이 쪽이 이긴다 |
| `data/pages.json` | 고정 페이지 6장 (소개·문의·개인정보처리방침·중국어 과정·일본어 과정·기준 중위소득 계산기) |
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
