import { DAY, HOUR, MINUTE } from "./time";

/**
 * 备份状态。轻量跨设备方案的全部风险其实是一句话：
 * 数据只在一台设备上，而人不会主动想起来去备份。
 * 所以这里不做什么高深的事，只回答「现在该不该再导一次」。
 */

const KEY = "studysheet:lastExport";

/** 上次成功导出的凭据。存在 localStorage 而不是 IndexedDB：
 *  它是关于备份的事实，不该被卷进备份本身。 */
export interface ExportMark {
  at: number;
  sessions: number;
}

/** 存储可能是隐私模式下的 localStorage —— 写它会抛异常，不能因此让导出失败。 */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const memory = new Map<string, string>();
const memoryStore: KV = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
};

export function backupStore(): KV {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return memoryStore;
    // 有些浏览器允许读、写时抛配额异常，先试一次再决定用不用它
    ls.setItem(`${KEY}:probe`, "1");
    ls.removeItem(`${KEY}:probe`);
    return ls;
  } catch {
    return memoryStore;
  }
}

export function readMark(store: KV = backupStore()): ExportMark | null {
  let raw: string | null = null;
  try {
    raw = store.getItem(KEY);
  } catch {
    return null; // 读不了存储（隐私模式）就当没有标记，不能让界面崩掉
  }
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<ExportMark>;
    if (typeof obj.at !== "number" || typeof obj.sessions !== "number") return null;
    return { at: obj.at, sessions: obj.sessions };
  } catch {
    return null; // 读不出来的标记就当没有，别拿坏数据去判断
  }
}

export function writeMark(mark: ExportMark, store: KV = backupStore()): void {
  try {
    store.setItem(KEY, JSON.stringify(mark));
  } catch {
    // 存不下只是下次不提醒，不影响已经导出的文件
  }
}

export type BackupLevel = "ok" | "warn" | "bad";

export interface BackupStatus {
  level: BackupLevel;
  text: string;
}

/** 「3 天前」而不是具体日期：这里要的是紧迫感，不是日历。 */
function ago(ms: number, now: number): string {
  const gap = Math.max(0, now - ms);
  const days = Math.floor(gap / DAY);
  if (days > 0) return `${days} 天前`;
  const hours = Math.floor(gap / HOUR);
  if (hours > 0) return `${hours} 小时前`;
  const minutes = Math.floor(gap / MINUTE);
  return minutes <= 0 ? "刚刚" : `${minutes} 分钟前`;
}

/**
 * 判断依据只有「上次导出的时间」和「当时的记录数」。
 * 记录数变少（删过记录）不算新增，所以这里说的是「可能」，
 * 不假装知道具体哪几条没备份。
 *
 * ago() 的结果会接在中文后面（「刚刚导出过」「3 天前导出过」），
 * 所以不能写成需要介词引导的形式。
 */
export function backupStatus(
  mark: ExportMark | null,
  current: { sessions: number },
  now: number,
): BackupStatus {
  if (current.sessions === 0) return { level: "ok", text: "还没有记录，暂时不用备份。" };
  if (!mark) return { level: "bad", text: "这台设备上的记录从来没导出过，清缓存就全没了。" };

  const days = Math.floor((now - mark.at) / DAY);
  const since = current.sessions - mark.sessions;

  if (since > 0) {
    return {
      level: days >= 3 ? "bad" : "warn",
      text: `${ago(mark.at, now)}导出过，之后又记了 ${since} 条，建议再导一次。`,
    };
  }
  if (days >= 7) {
    return { level: "warn", text: `已经 ${days} 天没导出备份了，虽然没发现新记录。` };
  }
  return { level: "ok", text: `${ago(mark.at, now)}备份过，暂时没发现新记录。` };
}

/** 迁移两步说明，写进界面而不是藏在文档里 —— 需要它的人正在两台设备之间。 */
export const MIGRATION_STEPS: string[] = [
  "旧设备：导出备份（或「把备份发出去」），通过微信 / 文件 / 剪贴板传到新设备。",
  "新设备：导入同一份备份，选「合并导入」即可；两边都记过时，互相导入一次就并齐。",
];

/**
 * 提醒被关掉的时间。关掉只顶 3 天：这条提醒说的是「数据可能全丢」，
 * 永久静音不合适，但每次切回记录页都弹一遍也只会被无视。
 */
const DISMISS_KEY = "studysheet:nudgeOff";
const SNOOZE = 3 * DAY;

export function nudgeSnoozed(now: number, store: KV = backupStore()): boolean {
  try {
    const raw = store.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && now - at < SNOOZE;
  } catch {
    return false;
  }
}

export function snoozeNudge(now = Date.now(), store: KV = backupStore()): void {
  try {
    store.setItem(DISMISS_KEY, String(now));
  } catch {
    // 存不下就下次继续提醒
  }
}
