# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

러닝 코스 추천 PoC. 출발점과 목표(거리 또는 페이스×시간)를 받아 출발점으로 돌아오는 루프 코스 후보를 만들고, 경사·횡단보도·계단·겹침으로 평가한다. 현재는 CLI 스크립트 단계이며, 이후 `lib.ts`를 Next.js Route Handler(Vercel Hobby) + Supabase Free로 옮길 계획이다(월 0원 운영이 제약 조건). 설계·결정 배경·실측 결과·열린 이슈는 전부 [README.md](README.md)에 있다 — 수정 전에 해당 장을 먼저 읽는다.

## 명령어

tsconfig.json과 npm 스크립트가 없다. 모두 `npx`로 직접 실행한다.

```bash
npx tsx selftest.ts                                   # 네트워크 없는 lib.ts 검증 ("selftest 통과 ✔")
npx tsc --noEmit --target es2022 --module nodenext --strict --types node lib.ts poc.ts selftest.ts   # 타입 체크

# PoC 실행 (Node 20.6+, .env에 TMAP_APP_KEY 필요)
npx tsx --env-file=.env poc.ts 36.3504 127.3845 --km 5                  # rank 모드 (기본), --preset FLAT|HILL|FEW_CROSSINGS|BALANCED
npx tsx --env-file=.env poc.ts 36.3504 127.3845 --pace 6:00 --min 40    # 페이스×시간 → 거리
npx tsx --env-file=.env poc.ts 36.3504 127.3845 --km 5 --mode pick      # ① 종합 ② 경사 최소 ③ 횡단보도 최소
```

선택 환경 변수: `POOL_SIZE`(pick 방향 수 3~8, 기본 6), `TMAP_SEARCH_OPTION`, `END_OFFSET_M`, `HEADING_OFFSET` — 설명은 [poc.ts](poc.ts) 상단 주석.

selftest는 단일 스크립트(`node:assert/strict`)라 개별 테스트 실행 옵션이 없다. 첫 실패 assert에서 멈춘다.

## 아키텍처

- [lib.ts](lib.ts) — **순수 로직, 네트워크·fs 없음.** 루프 경유지 생성(`generateLoopWaypoints`), TMAP 응답 해석(`parseTmapRoute`, `turnType` 집합으로 횡단보도/계단/육교 카운트), 50m 재샘플링, 상승고도(`calcElevationGain`, 2m 임계값), 겹침(`overlapRatio`, 30m 격자), 점수(`scoreCourse` + `PRESET_WEIGHTS`), 3개 선택(`pickThree`). Route Handler로 그대로 이식할 코드이므로 I/O를 넣지 않는다.
- [poc.ts](poc.ts) — I/O 담당. TMAP 보행자 API·Open-Meteo 고도 API 호출, `.cache/`에 요청 키 sha256 기반 파일 캐시, 콘솔 리포트, `out/*.geojson`·`out/elevation-*.csv` 출력. 고도 조회(`fetchElevations`)는 이후 `ElevationProvider` 인터페이스로 분리 예정.
- [selftest.ts](selftest.ts) — 가짜 TMAP 응답과 합성 데이터로 `lib.ts`만 검증.

흐름: 목표 거리 D → 반지름 `D/(2π·k)`(k=1.3) 원 위에 경유지 4개 → TMAP `출발→경유지4→출발` → 거리가 ±10% 밖이면 `k` 보정해 **1회만** 재시도 → 파싱 → 재샘플링 → 고도 → 겹침 → 점수 → rank(3방향 줄세우기) 또는 pick(풀에서 역할별 3개).

## 작업 시 주의

- **TMAP 무료 한도 하루 1,000건.** `poc.ts` 실행은 rank 3~6회, pick 6~12회 호출한다. 캐시(`.cache/`)를 지우거나 캐시 키를 바꾸면 재호출이 발생하므로, 실제 API 실행은 사용자 확인 후에 한다. 로직 변경 검증은 selftest로.
- 점수 가중치(`PRESET_WEIGHTS`)는 모두 임시값이다. 절대 상승고도 수치는 90m DSM 오차로 신뢰도가 낮아(README 8장) 후보 간 상대 비교용으로만 쓴다.
- `pick` 모드는 가짜 응답으로만 검증됐고 실제 API로는 미검증.
- 화면/출력 표기는 "신호등"이 아니라 "횡단보도 N개"(신호 데이터 없음). 예상 시간은 TMAP 소요시간(걷기 기준)이 아니라 `거리 × 페이스`.
- `.env`, `.cache/`, `out/`은 gitignore 대상 — 캐시에는 키를 저장하지 않는다.
