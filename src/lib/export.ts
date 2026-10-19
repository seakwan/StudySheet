import { MINUTE, breaksCount, dayKey, gapsMs, netMs } from "./time";
import type {
  PauseReason,
  Profile,
  SessionSegment,
  StudySession,
  Subject,
  TaskType,
} from "../db/types";

/**
 * 导出。数据只存在本机 IndexedDB，换设备或清缓存就全没了，
 * 所以导出必须能原样导回来（见 lib/merge.ts）。
 *
 * 两种格式用途不同：CSV 给人拿去 Excel 透视，JSON 备份给程序读回。
 */

export interface ExportInput {
  profiles: Profile[];
  subjects: Subject[];
  taskTypes: TaskType[];
  pauseReasons: PauseReason[];
  sessions: StudySession[];
  segments: SessionSegment[];
  /** 未结束的会话按这个时刻算时长，与界面显示保持一致 */
  now: number;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const pad = (n: number): string => String(n).padStart(2, "0");

/** 本地 HH:MM。CSV 里不写时区偏移，因为全部是导出者本机时间。 */
const hhmm = (ts: number): string => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 保留 1 位小数：一条 24 秒的记录写成整数分钟是 0，会被当成没学。 */
const minutes = (ms: number): number => Math.round((ms / MINUTE) * 10) / 10;

/** Excel 在没有 BOM 时会按 GBK 猜编码，中文直接变乱码。写成转义而不是字面字符。 */
export const BOM = "\uFEFF";

const esc = (v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const HEADER = [
  "日期",
  "星期",
  "人",
  "大科目",
  "事项",
  "状态",
  "来源",
  "开始",
  "结束",
  "净学习(分)",
  "暂停(分)",
  "暂停次数",
  "计划(分)",
  "备注",
  "暂停明细",
];

const STATUS_LABEL: Record<StudySession["status"], string> = {
  running: "进行中",
  paused: "暂停中",
  done: "已完成",
  aborted: "已放弃",
};

const SOURCE_LABEL: Record<StudySession["source"], string> = {
  manual: "手动",
  timer: "计时",
  backfill: "补录",
};

/**
 * 一行一条记录，日期取开始所在自然日。
 * 跨零点的记录在这里不拆开 —— 导出的是原始事实，按天摊开是图表的口径，
 * 两者混在一张表里反而没法核对。
 */
export function buildCsv(input: ExportInput): string {
  const { profiles, subjects, taskTypes, pauseReasons, sessions, segments, now } = input;
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const taskById = new Map(taskTypes.map((t) => [t.id, t]));
  const reasonById = new Map(pauseReasons.map((r) => [r.id, r]));

  const bySession = new Map<string, SessionSegment[]>();
  for (const seg of segments) {
    const list = bySession.get(seg.sessionId) ?? [];
    list.push(seg);
    bySession.set(seg.sessionId, list);
  }
  for (const list of bySession.values()) list.sort((a, b) => a.startAt - b.startAt);

  const rows = [...sessions]
    .sort((a, b) => a.startAt - b.startAt)
    .map((s) => {
      const segs = bySession.get(s.id) ?? [];
      const hasStream = segs.length > 0;
      const net = hasStream ? netMs(segs, now) : s.netMs;
      const gaps = hasStream ? gapsMs(segs, now) : s.gapsMs;
      const pauses = hasStream ? breaksCount(segs) : s.breaksCount;
      // 明细里的时长用同一套舍入：写成整数会出现「暂停(分) 0.1，明细里 (0分)」这种自相矛盾
      const detail = segs
        .filter((x) => x.kind === "break")
        .map((x) => {
          const until = Math.min(x.endAt ?? now, s.endAt ?? now);
          return `${hhmm(x.startAt)} ${reasonById.get(x.pauseReasonId ?? "")?.label ?? "未填原因"}(${minutes(Math.max(0, until - x.startAt))}分)`;
        })
        .join("; ");

      return [
        dayKey(s.startAt),
        WEEKDAYS[new Date(s.startAt).getDay()],
        profileById.get(s.profileId)?.name ?? "已删除",
        subjectById.get(s.subjectId)?.name ?? "已删除",
        s.taskTypeId ? taskById.get(s.taskTypeId)?.name ?? "已删除" : "",
        STATUS_LABEL[s.status],
        SOURCE_LABEL[s.source],
        hhmm(s.startAt),
        s.endAt === null ? "" : hhmm(s.endAt),
        minutes(net),
        minutes(gaps),
        pauses,
        s.plannedMinutes ?? "",
        s.note,
        detail,
      ];
    });

  return BOM + [HEADER, ...rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

export const BACKUP_VERSION = 1;

export interface ExportTables {
  profiles: Profile[];
  subjects: Subject[];
  taskTypes: TaskType[];
  pauseReasons: PauseReason[];
  sessions: StudySession[];
  segments: SessionSegment[];
}

export interface Backup {
  app: "studysheet";
  version: number;
  exportedAt: number;
  timezone: string;
  /** 导出时的 UTC 偏移（分钟，东为正）。记录存的是 epoch 毫秒，
   *  但「算哪一天」按本机日历 —— 换到别的时区恢复，同一条记录可能落到前一天。 */
  utcOffsetMinutes: number;
  tables: ExportTables;
}

/** Intl 拿不到时区名时至少还有偏移量可用。 */
const utcOffsetMinutes = (): number => -new Date().getTimezoneOffset();

const offsetLabel = (minutes: number): string => {
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const half = abs % 60 === 30 ? ":30" : "";
  return `UTC${sign}${Math.floor(abs / 60)}${half}`;
};

/** `now` 只用于算时长，不进备份文件 —— 备份里存的是原始事件流。 */
export function buildBackup(input: ExportInput): Backup {
  return {
    app: "studysheet",
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "unknown",
    utcOffsetMinutes: utcOffsetMinutes(),
    tables: {
      profiles: input.profiles,
      subjects: input.subjects,
      taskTypes: input.taskTypes,
      pauseReasons: input.pauseReasons,
      sessions: input.sessions,
      segments: input.segments,
    },
  };
}

/**
 * 备份不加 BOM：CSV 加是为了 Excel 认编码，JSON 加了反而让 jq / 标准 JSON.parse 报错，
 * 而自己写的 parseBackup 两种都能读。
 */
export const serializeBackup = (backup: Backup): string => JSON.stringify(backup, null, 2);

/**
 * 文件名带上日期，多次导出时按名字就能认出是哪天的。
 */
export function exportFilename(kind: "csv" | "json", now = Date.now()): string {
  return `studysheet-${dayKey(now)}.${kind}`;
}

/** 外部文件属于系统边界，任何一步不对都要说清楚，不能默默导入半截数据。 */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("这个文件不是合法的 JSON，可能不是本工具导出的备份。");
  }
  if (typeof raw !== "object" || raw === null) throw new Error("文件内容不是一个对象。");

  const obj = raw as Record<string, unknown>;
  if (obj.app !== "studysheet") throw new Error("这不是 StudySheet 导出的备份文件。");
  if (typeof obj.version !== "number") throw new Error("备份缺少版本号。");
  if (obj.version > BACKUP_VERSION) {
    throw new Error(`备份版本是 ${obj.version}，当前程序只支持到 ${BACKUP_VERSION}，请先升级。`);
  }

  const tables = obj.tables as Record<string, unknown> | undefined;
  if (!tables) throw new Error("备份里没有 tables 字段。");
  for (const key of ["profiles", "subjects", "taskTypes", "pauseReasons", "sessions", "segments"]) {
    if (!Array.isArray(tables[key])) throw new Error(`备份缺少 ${key} 表。`);
  }

  const sessions = tables.sessions as unknown[];
  for (const s of sessions) {
    const x = s as Partial<StudySession>;
    if (!x || typeof x.id !== "string" || typeof x.startAt !== "number" || typeof x.profileId !== "string" || typeof x.subjectId !== "string") {
      throw new Error("备份里有记录缺少 id / startAt / profileId / subjectId，无法导入。");
    }
  }

  return {
    app: "studysheet",
    version: obj.version,
    exportedAt: typeof obj.exportedAt === "number" ? obj.exportedAt : 0,
    timezone: typeof obj.timezone === "string" ? obj.timezone : "unknown",
    utcOffsetMinutes: typeof obj.utcOffsetMinutes === "number" ? obj.utcOffsetMinutes : 0,
    tables: {
      profiles: tables.profiles as Profile[],
      subjects: tables.subjects as Subject[],
      taskTypes: tables.taskTypes as TaskType[],
      pauseReasons: tables.pauseReasons as PauseReason[],
      sessions: sessions as StudySession[],
      segments: tables.segments as SessionSegment[],
    },
  };
}

/** 界面上的摘要，导入前给用户看一眼。 */
export function describeBackup(backup: Backup, nowOffset = utcOffsetMinutes()): string {
  const when = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString("zh-CN") : "未知时间";
  const label = offsetLabel(backup.utcOffsetMinutes);
  // 时区名可能本身就写成 "UTC" / "unknown"，再拼一次偏移就成了「UTC UTC」
  const name = backup.timezone && backup.timezone !== label && backup.timezone !== "unknown" ? backup.timezone : "";
  const zone = name ? `${name}（${label}）` : label;
  // 时区不同要说出来：时长不会变，但「这条算周几」会变，周报的口径跟着变
  const drift =
    backup.utcOffsetMinutes !== nowOffset
      ? `，本机 ${offsetLabel(nowOffset)} —— 跨时区恢复后记录归属的日期可能不同`
      : "";
  return `${backup.tables.sessions.length} 条记录 / ${backup.tables.profiles.length} 人，导出于 ${when} ${zone}${drift}`;
}
