import { useEffect, useState } from "react";

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
