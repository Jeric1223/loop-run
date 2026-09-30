import { buildCourses } from "@/lib/course/build";
import { MemoryCache } from "@/lib/course/cache";
import { UpstreamError } from "@/lib/course/providers";

// 제한 시간은 Vercel Hobby 기준 확인 필요 — 후보 6개를 병렬로 만들어 시간을 줄인다
export const maxDuration = 60;

const store = new MemoryCache();

// IP당 요청 제한. TMAP 무료 한도(하루 1,000건)를 요청 1번이 10건 안팎으로 쓰기 때문에 공개 URL 에서는 필수.
// 서버리스 인스턴스마다 따로 세는 임시 방어선이다 — 전체 한도 보호는 공유 저장소(Supabase 등) 도입 후 교체한다.
const LIMIT = 6;
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();

function overLimit(request: Request): boolean {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1] >= WINDOW_MS) hits.delete(k);
  return recent.length > LIMIT;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
// 한반도 대략 범위. 잘못된 좌표로 TMAP 한도를 쓰지 않게 입구에서 거른다
const parsePoint = (v: unknown) => {
  const p = v as { lat?: unknown; lng?: unknown } | null;
  if (!p || !isNum(p.lat) || !isNum(p.lng)) return null;
  if (p.lat < 33 || p.lat > 39 || p.lng < 124 || p.lng > 132) return null;
  return { lat: p.lat, lng: p.lng };
};

const bad = (message: string) => Response.json({ error: "bad-request", message }, { status: 400 });

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad("요청 형식이 올바르지 않아요.");
  }

  const start = parsePoint(body.start);
  if (!start) return bad("출발 위치가 올바르지 않아요.");
  const end = body.end == null ? null : parsePoint(body.end);
  if (body.end != null && !end) return bad("도착 위치가 올바르지 않아요.");

  const targetM = body.targetM;
  if (!isNum(targetM) || targetM < 500 || targetM > 30_000) return bad("목표 거리는 0.5~30km 안이어야 해요.");
  const pace = body.paceSecPerKm;
  if (pace != null && (!isNum(pace) || pace < 150 || pace > 1200)) return bad("페이스는 2:30~20:00 /km 안이어야 해요.");

  if (overLimit(request)) {
    return Response.json({ error: "rate-limit", message: "요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요." }, { status: 429 });
  }

  try {
    const out = await buildCourses(store, { start, end, targetM, paceSecPerKm: pace ?? null });
    return Response.json(out);
  } catch (e) {
    if (e instanceof UpstreamError) {
      const status = e.kind === "tmap-quota" ? 429 : e.kind === "config" ? 500 : 502;
      console.error("[api/courses]", e.kind, e.message);
      return Response.json({ error: e.kind, message: "코스를 만들지 못했어요. 잠시 뒤에 다시 시도해 주세요." }, { status });
    }
    console.error("[api/courses]", e);
    return Response.json({ error: "internal", message: "코스를 만들지 못했어요." }, { status: 500 });
  }
}
