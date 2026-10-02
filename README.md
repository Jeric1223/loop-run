# 루프런 (Loop Run)

> 출발점과 목표 거리(또는 페이스 × 시간)만 정하면, **출발점으로 돌아오는 러닝 코스 3개**를 만들어 준다.
> 경사, 횡단보도 수, 계단, 같은 길을 되돌아오는 비율을 따져서 고른다.

**[데모 열기 → loop-run-eight.vercel.app](https://loop-run-eight.vercel.app/)** · [개발기 (velog)](https://velog.io/@hoohoo0889/%EB%91%94%EC%82%B0%EB%8F%99-%EB%9F%B0%EB%8B%9D-%EC%BD%94%EC%8A%A4-%EA%B2%80%EC%83%89%ED%95%98%EB%8B%A4-%EC%A7%80%EC%B3%90%EC%84%9C-%EC%BD%94%EC%8A%A4-%EC%B6%94%EC%B2%9C-%EC%95%B1%EC%9D%84-%EB%A7%8C%EB%93%A4%EC%97%88%EC%96%B4%EC%9A%94) https://velog.io/@hoohoo0889/토이-프로젝트-발표-코스-추천-앱을-만들었어요 · 모바일 화면 기준 · 한국 지역만 지원

| | |
| --- | --- |
| 상태 | 1차(코스 추천) 웹 MVP 배포됨 · 2차(GPS 트래킹)는 설계만 해 두고 보류 |
| 기준일 | 2026-10-02 |
| 운영 방침 | 개인 프로젝트, **월 0원** (Vercel Hobby + 무료 API) |

---

## 화면

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/screens/readme-board-dark.png">
  <img alt="루프런 화면 보드: 홈, 로딩, 코스 결과, 내 코스, 시트, 권한·오류 상태" src="assets/screens/readme-board.png">
</picture>

GitHub 테마에 맞춰 라이트/다크 이미지가 바뀐다.

---

## 1. 왜 만들었나

지도 앱은 A→B 길찾기만 해 준다. "오늘 5km 뛰고 싶은데 어디로 가지?"에는 답이 없다. 거리가 같은 5km라도 오르막과 신호 대기가 얼마나 있느냐에 따라 체감이 크게 다르다.

## 2. 기능

**입력**
- 출발점: 현재 위치(GPS), 지도에서 핀 찍기, 장소 검색(카카오)
- 도착점(선택): 비워 두면 출발점으로 돌아오는 **루프**, 지정하면 **편도**
- 목표: `거리(0.5~30km)` 또는 `페이스 + 시간`(예: 6:00/km로 40분이면 6.67km). 거리 모드에서도 페이스를 넣으면 예상 시간을 함께 보여 준다

**결과: 서로 다른 코스 3개**

| | 기준 |
| --- | --- |
| ① 종합 추천 | 거리 오차, 경사, 횡단보도, 계단, 겹침을 종합한 점수가 가장 낮은 코스 |
| ② 경사 최소 | 누적 상승고도가 가장 낮은 코스 |
| ③ 횡단보도 최소 | 횡단보도가 가장 적은 코스 |

- 같은 코스가 여러 기준에서 1위를 하면 앞 슬롯이 가져가고, 뒤 슬롯에는 차순위 코스를 안내 문구와 함께 보여 준다.
- 지도에서는 코스를 경사 색(초록: 평지, 노랑: 완만, 빨강: 언덕)으로 칠하고, 진행 방향 화살표와 고도 차트를 함께 보여 준다.
- 경사는 절대 숫자 대신 **평지 / 완만 / 언덕** 등급으로 표시한다(이유는 6장).
- 신호 데이터가 없어서 "신호등"이 아니라 **"횡단보도 N개"** 로 표기한다.
- **내 코스**: 마음에 드는 코스를 브라우저(localStorage)에 최대 30개까지 저장한다. 로그인은 없다.
- 라이트/다크 테마를 지원한다.

## 3. 동작 원리

러닝 코스는 "A→B 최단 경로"가 아니라 **"출발점으로 돌아오는, 길이가 D인 좋은 경로"** 를 찾는 문제다. TMAP 보행자 API는 A→B(경유지 포함)만 지원하기 때문에, 경유지를 배치해서 루프를 만든다.

```
목표 거리 D
  → 6개 방향으로 후보 생성 (병렬)
      · 루프 4개: 출발점을 지나는 원 위에 경유지 2개 → TMAP 출발→경유지→출발
      · 반환 2개: 한 방향으로 D/2 만큼 갔다가 같은 길로 되돌아오기 (일직선 코스용)
  → 거리가 ±10% 밖이면 보정계수 k 를 √(실제/목표) 로 조정해 1회 재시도
  → 경유지를 찍고 되돌아 나오는 돌출 구간 제거, 중복 경로 제거
  → 거리 ±20% 안의 상위 4개만 고도 조회 (100m 간격 샘플)
  → 점수 계산 → 역할별로 3개 선택
```

| 항목 | 계산 |
| --- | --- |
| 횡단보도·계단 | TMAP 응답의 `turnType`(횡단보도 211~217, 계단 127·129, 육교·지하보도 125·126) 개수 |
| 상승고도 | 기준 고도보다 2m 이상 변해야 오르막으로 인정해 DEM 잡음을 거른다 |
| 경사 등급 | km당 상승 10m 미만은 평지, 25m 미만은 완만, 그 이상은 언덕 (임시값) |
| 겹침 | 30m 격자 기준으로 같은 길을 오간 비율. 반환 코스는 의도된 왕복이라 감점하지 않는다 |
| 예상 시간 | `거리 × 입력 페이스`. TMAP의 소요 시간은 걷기 기준이라 쓰지 않는다 |

점수 함수(낮을수록 좋음):

```
score = w_dev·|d−D|/D
      + (w_gain·상승m + w_cross·횡단보도 + w_stairs·계단) / km
      + w_overlap·겹침 + w_spur·돌출 + w_turns·km당 회전 수 + w_straight·(1 − 직진 비율)
      − w_calm·보행자도로 비율 + w_poor·쾌적하지 않은 도로 비율
```

후보를 고를 때는 먼저 목표 ±10% 안에서 3개를 찾고, 부족하면 ±20%, 그래도 부족하면 거리 제한 없이 고른다.

가중치는 `PRESET_WEIGHTS`([web/src/lib/course/lib.ts](web/src/lib/course/lib.ts))에 있고 **모두 임시값**이다.

## 4. 기술 스택

```
[Next.js 16 App Router · Vercel Hobby (icn1)]
  ├─ 화면: React 19, 카카오맵 JS SDK (지도 · 장소 검색 · 역지오코딩)
  └─ POST /api/courses (Route Handler)
        ├─ TMAP 보행자 경로안내    무료 하루 1,000건
        └─ AWS Terrain Tiles      키·한도 없음, Terrarium PNG(z13)를 직접 디코딩
```

| 결정 | 이유 |
| --- | --- |
| 카카오 도보 길찾기 **제외** | 제휴 파트너 전용이고, 응답에 경사·횡단보도 정보가 없다 |
| **TMAP 보행자 API** 사용 | 개인도 키를 받을 수 있고, 응답에 횡단보도·계단·육교 정보(`turnType`)가 있다 |
| 고도는 **AWS Terrain Tiles** | 처음에는 Open-Meteo를 썼지만 분·시간 단위 한도(429)에 걸렸다. 타일 방식은 키와 한도가 없고, 한 장(약 3.9km)으로 주변 코스를 모두 처리할 수 있어 캐시 효율이 좋다 |
| 서버·DB **없이** 시작 | 월 0원이 제약이다. 캐시와 요청 제한은 우선 인스턴스 메모리로 처리한다 |
| 1차는 **웹**, 2차는 **앱(Expo)** | 코스 추천에는 GPS 추적이 필요 없다. 트래킹은 화면이 꺼져도 위치를 받아야 해서 PWA로는 부족하다 |

**무료 한도 보호**: 코스 요청 1건이 TMAP을 6~10회 호출한다(루프 4개 × 최대 2회 + 반환 2개 × 1회). 그래서 IP당 10분에 6회로 제한하고(초과 시 429), 한반도 밖 좌표나 범위를 벗어난 목표는 API를 호출하기 전에 걸러 낸다. 이 제한은 서버리스 인스턴스마다 따로 세기 때문에 임시 방어선이다(7장).

## 5. 로컬 실행

Node 20.6 이상이 필요하다.

```bash
git clone https://github.com/Jeric1223/loop-run.git
cd loop-run/web
npm install
cp .env.example .env.local   # 키 2개 입력
npm run dev                  # http://localhost:3000
```

| 환경 변수 | 설명 |
| --- | --- |
| `TMAP_APP_KEY` | **서버 전용.** [SK open API](https://openapi.sk.com/)에서 앱을 만들고 TMAP 무료 플랜을 연결한 뒤 받은 APP Key |
| `NEXT_PUBLIC_KAKAO_JS_KEY` | 브라우저에 공개되는 키. [카카오 개발자](https://developers.kakao.com/) 콘솔의 플랫폼 > Web에 `http://localhost:3000`과 배포 도메인을 등록해야 한다 |
| `TMAP_SEARCH_OPTION` | 선택. TMAP `searchOption` (기본 `0`) |

### 테스트와 CLI 스크립트 (저장소 루트)

```bash
npm install
npx tsx selftest.ts      # 네트워크 없이 코스 로직 검증 → "selftest 통과 ✔"
npx tsc --noEmit --target es2022 --module nodenext --strict --types node poc.ts selftest.ts

# 터미널에서 코스 생성 (루트 .env 에 TMAP_APP_KEY 필요, TMAP 호출 발생)
npx tsx --env-file=.env poc.ts 36.3504 127.3845 --km 5 --mode pick
```

`poc.ts`는 초기 검증용 CLI로, 웹과 같은 `web/src/lib/course`를 쓴다. 결과는 `out/*.geojson`으로 저장되고, [geojson.io](https://geojson.io)에 끌어다 놓으면 지도로 볼 수 있다. 같은 입력은 `.cache/`에서 다시 읽어 API를 반복 호출하지 않는다.

## 6. 구조

```
web/src/
├─ app/api/courses/route.ts   입력 검증, IP 요청 제한, 오류 → HTTP 상태 매핑
├─ lib/course/
│  ├─ lib.ts        순수 로직: 경유지 생성, TMAP 응답 해석, 재샘플링, 상승고도, 겹침, 점수, 3개 선택
│  ├─ build.ts      후보 병렬 생성 → 고도 조회 → 3개 선택 (파이프라인)
│  ├─ providers.ts  TMAP 호출, Terrain 타일 다운로드·PNG 디코딩·쌍선형 보간
│  ├─ slope.ts      경사 구간 분석 (지도 색칠, 고도 차트, 요약 문구)
│  ├─ cache.ts      응답 캐시 (현재 메모리)
│  └─ saved.ts      내 코스 (localStorage)
├─ components/home/  출발·도착·목표 입력 화면
└─ components/flow/  로딩 → 결과(지도·카드·고도 차트) → 내 코스, 오류 상태 화면
poc.ts · selftest.ts  CLI 검증 스크립트
```

## 7. 알려진 한계

| 이슈 | 내용 |
| --- | --- |
| 고도 정확도 | 공개 DEM이라 도심에서는 건물·고가가 오르막처럼 찍힐 수 있다. 그래서 절대 숫자 대신 후보 간 비교와 등급으로만 쓴다. PoC에서 평지에 DEM 오차만 섞어 시뮬레이션했을 때도 5km에 수십 m의 가짜 상승이 나왔다 |
| 횡단보도 ≠ 신호 대기 | 신호 유무나 대기 시간 데이터가 없다 |
| 가중치·등급 기준 | 점수 가중치, 경사 등급 기준, 보정계수 k는 모두 임시값이다. 대전·서울 일부 지역 실측으로만 맞췄다 |
| 요청 제한·캐시 | 서버리스 인스턴스 메모리에 있어서 인스턴스가 바뀌면 초기화된다. 전역 TMAP 한도 보호는 공유 저장소(Supabase 등)를 붙인 뒤에 할 예정이다 |
| 거리 오차 | TMAP 경로 길이가 경유지 배치에 비례하지 않아서, 지역에 따라 목표 ±10%를 못 맞추고 허용 범위를 넓혀 고르는 경우가 있다 |
| 출처 표기 | 화면에는 "AWS Terrain Tiles · TMAP · 카카오맵"으로 표기한다. Terrain Tiles 원천 데이터별 고지 문구가 필요한지는 확인이 필요하다 |

## 8. 다음 계획

- **1차 마무리**: 공유 저장소 기반 캐시와 전역 TMAP 한도, 다양한 지역에서 가중치 튜닝, 계단 제외 옵션(`searchOption`) 확인
- **2차 (보류)**: Expo 앱으로 저장한 코스를 따라 뛰는 GPS 트래킹. 시작/일시정지/완료, 페이스와 km 스플릿, 코스 이탈 알림(30m 초과), 칼로리 추정까지 포함한다. 코스 생성 API는 1차 것을 그대로 쓴다.

## 참고

- [SK open API — TMAP 요금](https://openapi.sk.com/products/calc?svcSeq=4&menuSeq=5)
- [AWS Terrain Tiles (Registry of Open Data)](https://registry.opendata.aws/terrain-tiles/)
- [Vercel Hobby 플랜](https://vercel.com/docs/plans/hobby): 개인·비상업 용도로만 쓸 수 있다
- [Kakaomobility 도보 길찾기 (제휴 전용)](https://developers.kakaomobility.com/affiliate/walking/directions)
