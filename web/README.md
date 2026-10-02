# 루프런 웹

루프런의 Next.js 앱입니다. 서비스 설명, 동작 원리, 환경 변수는 [루트 README](../README.md)에 있습니다.

```bash
npm install
cp .env.example .env.local   # TMAP_APP_KEY, NEXT_PUBLIC_KAKAO_JS_KEY 입력
npm run dev                  # http://localhost:3000
npm run lint
npx tsc --noEmit
```

배포는 Vercel(리전 `icn1`, [vercel.json](vercel.json))입니다. Vercel 프로젝트 환경 변수에 위 키 2개를 넣고, 카카오 콘솔의 Web 플랫폼에 배포 도메인을 등록해야 지도가 뜹니다.
