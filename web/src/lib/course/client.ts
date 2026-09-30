import type { BuildOutput, CourseResult } from "./build";

export type CourseRequest = {
  start: { lat: number; lng: number };
  end: { lat: number; lng: number } | null;
  targetM: number;
  paceSecPerKm: number | null;
};

/** 화면이 어떤 상태 화면으로 보낼지 결정하는 분류 */
export type FailKind = "quota" | "offline" | "fail" | "aborted";

export class CourseRequestError extends Error {
  constructor(readonly kind: FailKind) {
    super(kind);
  }
}

export async function requestCourses(body: CourseRequest, signal: AbortSignal): Promise<CourseResult[]> {
  let res: Response;
  try {
    res = await fetch("/api/courses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new CourseRequestError("aborted");
    throw new CourseRequestError(navigator.onLine ? "fail" : "offline");
  }
  if (res.status === 429) throw new CourseRequestError("quota");
  if (!res.ok) throw new CourseRequestError("fail");
  try {
    const out = (await res.json()) as BuildOutput;
    if (!Array.isArray(out.courses) || out.courses.length === 0) throw new Error("empty");
    return out.courses;
  } catch {
    throw new CourseRequestError("fail");
  }
}
