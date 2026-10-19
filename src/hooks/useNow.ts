import { useEffect, useMemo, useState } from "react";
import { dayKey } from "../lib/time";

/**
 * 单一的全局时基。组件只订阅「当前秒」，时长一律由时间戳反算，
 * 因此切后台再回来时第一次渲染就是正确值，不需要补偿逻辑。
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    const sync = () => setNow(Date.now());
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, [intervalMs]);

  return now;
}

/**
 * 只在跨自然日时才变化的锚点。统计视图拿它决定「今天/本周」窗口，
 * 若直接取 useState 初值，页面开着过午夜就会一直在看昨天。
 * 按天变化而不是每秒变化，才不会让数据库查询被反复重跑。
 */
export function useDayAnchor(): number {
  const [anchor, setAnchor] = useState(() => dayKey(Date.now()));

  useEffect(() => {
    const check = () => {
      const key = dayKey(Date.now());
      setAnchor((prev) => (prev === key ? prev : key));
    };
    const id = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return useMemo(() => new Date(`${anchor}T00:00:00`).getTime(), [anchor]);
}
