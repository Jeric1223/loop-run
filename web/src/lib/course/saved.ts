import { useSyncExternalStore } from "react";
import type { ResultGoal } from "@/components/flow/Result";
import type { CourseResult } from "./build";

/* 저장한 코스 (localStorage).
   경로를 다시 만들지 않고 만들어진 코스(path·profile 포함)를 그대로 보관한다 — 추천 API 호출 한도(route.ts) 때문.
   서버 저장(Supabase)으로 옮길 땐 이 파일의 read/write 와 아래 공개 함수만 바꾸면 화면은 그대로다. */

export type SavedCourse = { id: string; savedAt: number; course: CourseResult; goal: ResultGoal };

const KEY = "rl-saved";
export const SAVED_MAX = 30;
export const SAVE_FAIL = "저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.";

const EMPTY: SavedCourse[] = [];
const listeners = new Set<() => void>();
// useSyncExternalStore 는 같은 상태면 같은 참조를 돌려줘야 해서, 원문이 같으면 파싱 결과를 재사용한다
let cache: { raw: string | null; list: SavedCourse[] } = { raw: null, list: EMPTY };

const valid = (x: unknown): x is SavedCourse => {
  const s = x as SavedCourse | null;
  return !!s && typeof s.id === "string" && Array.isArray(s.course?.path) && !!s.goal?.start;
};

/** 같은 조건(출발·도착·목표·역할·거리)의 코스는 같은 id 라서 다시 눌러도 중복 저장되지 않는다 */
export const savedId = (c: CourseResult, g: ResultGoal) => {
  const p = (l: { lat: number; lng: number } | null) => (l ? `${l.lat.toFixed(5)},${l.lng.toFixed(5)}` : "");
  return [c.role, p(g.start), p(g.end), g.targetM, c.distanceM].join("|");
};

function read(): SavedCourse[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cache.list;
  }
  if (raw === cache.raw) return cache.list;
  let list = EMPTY;
  try {
    const a: unknown = JSON.parse(raw ?? "[]");
    if (Array.isArray(a)) list = a.filter(valid);
  } catch {
    /* 깨진 값은 빈 목록으로 본다 */
  }
  cache = { raw, list };
  return list;
}

function write(list: SavedCourse[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    return false;
  }
  listeners.forEach((l) => l());
  return true;
}

export function saveCourse(item: Omit<SavedCourse, "savedAt">): "ok" | "full" | "error" {
  const list = read();
  if (list.length >= SAVED_MAX) return "full";
  return write([{ ...item, savedAt: Date.now() }, ...list]) ? "ok" : "error";
}

/** 지운 항목과 위치를 돌려줘서 되돌리기에 쓴다. 못 지웠으면 null */
export function removeCourse(id: string): { item: SavedCourse; idx: number } | null {
  const list = read();
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  return write(list.filter((s) => s.id !== id)) ? { item: list[idx], idx } : null;
}

export function restoreCourse(item: SavedCourse, idx: number) {
  const list = read().filter((s) => s.id !== item.id);
  list.splice(Math.min(idx, list.length), 0, item);
  write(list);
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener("storage", cb); // 다른 탭에서 바꾼 경우
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
};

export const useSavedCourses = () => useSyncExternalStore(subscribe, read, () => EMPTY);
