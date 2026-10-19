import type { SessionSegment } from "../db/types";

export const MINUTE = 60_000;

/**
 * 净学习时长 = Σ work 段。now 用于运行中的会话：最后一段没有 endAt 时按当前时刻算，
 * 所以计时器每次渲染只要传 Date.now() 进来，不依赖 setInterval 累加。
 */
export function netMs(segments: SessionSegment[], now: number = Date.now()): number {
  return segments
    .filter((s) => s.kind === "work")
    .reduce((sum, s) => sum + Math.max(0, (s.endAt ?? now) - s.startAt), 0);
}

export function gapsMs(segments: SessionSegment[], now: number = Date.now()): number {
  return segments
    .filter((s) => s.kind === "break")
    .reduce((sum, s) => sum + Math.max(0, (s.endAt ?? now) - s.startAt), 0);
}

export function breaksCount(segments: SessionSegment[]): number {
  return segments.filter((s) => s.kind === "break").length;
}

/** 1h23m / 23m / 45s，列表和标题都用它。 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** 计时器大字，固定 hh:mm:ss 或 mm:ss。 */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export const minutesOf = (ms: number): number => Math.round(ms / MINUTE);

/**
 * 本地日期的 YYYY-MM-DD。不能用 toISOString()，那是 UTC：
 * UTC+8 的用户在 10-19 00:30 学习，会错标成 10-18。
 */
export const dayKey = (ts: number): string => {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
