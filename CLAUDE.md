# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

루프런 — 러닝 코스 추천 웹. 출발점과 목표(거리 또는 페이스×시간)를 받아 출발점으로 돌아오는 루프(또는 도착점까지 편도) 코스 후보를 만들고, 경사·횡단보도·계단·겹침으로 평가해 3개를 고른다. Next.js(`web/`)로 Vercel Hobby에 배포되어 있고, 월 0원 운영이 제약 조건이다. 서비스 설명·결정 배경·알려진 한계는 [README.md](README.md)에 있다 — 수정 전에 해당 장을 먼저 읽는다.

## 명령어

```bash
# 웹 (web/, .env.local 에 TMAP_APP_KEY · NEXT_PUBLIC_KAKAO_JS_KEY)
cd web && npm run dev
cd web && npx tsc --noEmit && npm run lint

# 루트: 네트워크 없는 코스 로직 검증 ("selftest 통과 ✔") + 타입 체크
npx tsx selftest.ts
npx tsc --noEmit --target es2022 --module nodenext --strict --types node poc.ts selftest.ts

# CLI PoC (Node 20.6+, 루트 .env 에 TMAP_APP_KEY, 실제 TMAP 호출)
npx tsx --env-file=.env poc.ts 36.3504 127.3845 --km 5 --mode pick
```

poc.ts 옵션과 환경 변수(`POOL_SIZE`, `TMAP_SEARCH_OPTION`, `END_OFFSET_M`, `HEADING_OFFSET`)는 [poc.ts](poc.ts) 상단 주석. selftest는 단일 스크립트(`node:assert/strict`)라 첫 실패 assert에서 멈춘다.

## 아키텍처

- [web/src/lib/course/lib.ts](web/src/lib/course/lib.ts) — **순수 로직, 네트워크·fs 없음.** 경유지 생성, TMAP 응답 해석(`turnType`으로 횡단보도/계단/육교 카운트), 재샘플링, 상승고도(2m 임계값), 겹침, 점수(`scoreCourse` + `PRESET_WEIGHTS`), 3개 선택(`pickThree`). I/O를 넣지 않는다.
- [web/src/lib/course/build.ts](web/src/lib/course/build.ts) — 파이프라인. 6방향(루프 4 + 반환 2) 병렬 생성 → 거리 ±10% 밖이면 k 보정 1회 재시도 → 돌출·중복 제거 → 상위 4개만 고도 조회 → `pickThree`.
- [web/src/lib/course/providers.ts](web/src/lib/course/providers.ts) — TMAP 보행자 API, AWS Terrain Tiles(Terrarium PNG z13 직접 디코딩).
- [web/src/app/api/courses/route.ts](web/src/app/api/courses/route.ts) — 입력 검증, IP당 요청 제한(메모리), 오류 → HTTP 상태.
- [poc.ts](poc.ts) · [selftest.ts](selftest.ts) — `web/src/lib/course`를 그대로 import하는 CLI 검증 스크립트.

## 작업 시 주의

- **TMAP 무료 한도 하루 1,000건.** 코스 요청 1건이 6~10회 호출한다. 실제 API 실행은 사용자 확인 후에 하고, 로직 변경 검증은 selftest로.
- 점수 가중치·경사 등급 기준·보정계수 k는 모두 임시값이다. 절대 상승고도는 DEM 오차로 신뢰도가 낮아 후보 간 비교와 등급(평지/완만/언덕)으로만 쓴다.
- 화면 표기는 "신호등"이 아니라 "횡단보도 N개"(신호 데이터 없음). 예상 시간은 TMAP 소요시간(걷기 기준)이 아니라 `거리 × 페이스`.
- 캐시·요청 제한은 서버리스 인스턴스 메모리라 임시다. 캐시 키에 API 키를 넣지 않는다.
- `.env*`, `.cache/`, `out/`, `docs/`는 gitignore 대상.
