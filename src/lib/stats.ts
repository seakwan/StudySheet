import type { PauseReason, Profile, SessionSegment, StudySession, Subject, TaskType } from "../db/types";
import { dayKey, MINUTE } from "./time";

/**
 * 统计内核。所有指标都从 work/break 事件流现场算，不读 StudySession 上冻结的
 * netMs —— 冻结值是整段的合计，跨零点时不等于「归属于某天」的时长。
 * M3 周报复用 aggregate()，口径只在这里写一遍。
 */

const MS_DAY = 86_400_000;

export interface DayRange {
  from: number;
  to: number; // 不含
}

export type RangeMode = "day" | "week" | "month" | "total";

const midnight = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const addDays = (ts: number, n: number): number => {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

/** 周一为一周之始，符合课表习惯。 */
const mondayOf = (ts: number): number => addDays(midnight(ts), -((new Date(ts).getDay() + 6) % 7));

export const dayRange = (anchor: number): DayRange => ({
  from: midnight(anchor),
  to: midnight(anchor) + MS_DAY,
});

export const weekRange = (anchor: number): DayRange => ({
  from: mondayOf(anchor),
  to: mondayOf(anchor) + 7 * MS_DAY,
});

export const monthRange = (anchor: number): DayRange => {
  const d = new Date(anchor);
  return {
    from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
    to: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(),
  };
};

export const prevRange = (mode: RangeMode, anchor: number): DayRange | null => {
  if (mode === "day") return dayRange(addDays(midnight(anchor), -1));
  if (mode === "week") {
    const from = mondayOf(anchor);
    return { from: from - 7 * MS_DAY, to: from };
  }
  if (mode === "month") {
    const prev = new Date(monthRange(anchor).from - 1);
    return monthRange(prev.getTime());
  }
  return null;
};

/**
 * 与上一周期「同期」对比：本周期通常还没过完，拿本周已过的 1 天去比上周
 * 完整 7 天，环比必然暴跌，是误导性的数字。所以把上期也截成同样的天数。
 */
export const prevRangeAligned = (mode: RangeMode, anchor: number): DayRange | null => {
  const full = prevRange(mode, anchor);
  if (!full) return null;
  if (mode === "day") return full;

  const cur = mode === "week" ? weekRange(anchor) : monthRange(anchor);
  const elapsed = elapsedDaysOf(enumerateDays(cur), anchor);
  if (elapsed <= 0) return full;
  return { from: full.from, to: Math.min(full.to, full.from + elapsed * MS_DAY) };
};

export const windowOf = (range: DayRange): { range: DayRange; days: string[] } => ({
  range,
  days: enumerateDays(range),
});

const enumerateDays = (range: DayRange): string[] => {
  const out: string[] = [];
  for (let t = range.from; t < range.to; t = addDays(t, 1)) out.push(dayKey(t));
  return out;
};

/** 窗口里已经过去的天数，未来的日子还没有数据，不该参与均值与环比。 */
const elapsedDaysOf = (days: string[], now: number): number => {
  const todayKey = dayKey(now);
  return days.filter((d) => d <= todayKey).length;
};

/**
 * 解析窗口与 x 轴。「全部」模式没有固定边界，用最早一条记录当作起点，
 * 否则图表就没有横轴可用。
 */
export function resolveWindow(mode: RangeMode, anchor: number, sessions: StudySession[]): {
  range: DayRange;
  days: string[];
} {
  if (mode !== "total") {
    const range = mode === "day" ? dayRange(anchor) : mode === "week" ? weekRange(anchor) : monthRange(anchor);
    return { range, days: enumerateDays(range) };
  }
  const earliest = sessions.reduce<number | null>(
    (min, s) => (min === null || s.startAt < min ? s.startAt : min),
    null,
  );
  // 最多回溯 180 天，再久的历史横轴上也读不出东西
  const from = midnight(Math.max(earliest ?? anchor, anchor - 180 * MS_DAY));
  const range = { from, to: dayRange(anchor).to };
  return { range, days: enumerateDays(range) };
}

const workSpans = (segments: SessionSegment[], now: number, capAt: number | null) =>
  segments
    .filter((s) => s.kind === "work")
    .map((s) => ({ start: s.startAt, end: Math.min(s.endAt ?? now, capAt ?? now) }))
    .filter((s) => s.end > s.start);

/**
 * 把 work 段裁剪进窗口，再按自然日切开。跨零点（23:40→00:20）和
 * 「本周从周三才开始记」都靠这里正确归属。
 *
 * 补录的记录没有事件流，整段 startAt→endAt 视为一段 work —— 否则补录
 * 在图表里会完全消失，而今日列表又能看到它，两处数字对不上。
 */
function attributedSpans(
  session: StudySession,
  segments: SessionSegment[],
  range: DayRange,
  now: number,
): Array<{ start: number; end: number }> {
  const spans = workSpans(segments, now, session.endAt ?? null);
  const effective =
    spans.length > 0
      ? spans
      : session.endAt
        ? [{ start: session.startAt, end: session.endAt }]
        : [];
  return effective
    .map((s) => ({ start: Math.max(s.start, range.from), end: Math.min(s.end, range.to) }))
    .filter((s) => s.end > s.start);
}

function attributeByDay(
  session: StudySession,
  segments: SessionSegment[],
  range: DayRange,
  now: number,
): Array<{ day: string; ms: number }> {
  const out: Array<{ day: string; ms: number }> = [];
  for (const span of attributedSpans(session, segments, range, now)) {
    let cursor = span.start;
    while (cursor < span.end) {
      const stop = Math.min(span.end, addDays(midnight(cursor), 1));
      out.push({ day: dayKey(cursor), ms: stop - cursor });
      cursor = stop;
    }
  }
  return out;
}

/** 把时间区间按本地整点切开，用于统计「几点钟学得最多」。 */
function splitByHour(start: number, end: number): Array<{ hour: number; ms: number }> {
  const out: Array<{ hour: number; ms: number }> = [];
  let cursor = start;
  while (cursor < end) {
    const d = new Date(cursor);
    const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
    const stop = Math.min(end, nextHour);
    out.push({ hour: d.getHours(), ms: stop - cursor });
    cursor = stop;
  }
  return out;
}

/** 周一=0 … 周日=6，getDay() 的偏移只在这里处理一次。 */
const weekdayIndex = (ts: number): number => (new Date(ts).getDay() + 6) % 7;

/** "YYYY-MM-DD" → 本地正午的时间戳，避开 UTC 解析和夏令时边界。 */
const dayKeyToNoon = (key: string): number => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getTime();
};

const longestWorkMs = (segments: SessionSegment[], now: number, session: StudySession): number =>
  workSpans(segments, now, session.endAt ?? null).reduce((max, s) => Math.max(max, s.end - s.start), 0);

const breakMs = (segments: SessionSegment[], now: number, session: StudySession): number =>
  segments
    .filter((s) => s.kind === "break")
    .reduce(
      (sum, s) => sum + Math.max(0, Math.min(s.endAt ?? now, session.endAt ?? now) - s.startAt),
      0,
    );

/** 每次暂停发生在开始后第几分钟；补录没有事件流，不参与统计。 */
const focusDepths = (session: StudySession, segments: SessionSegment[]): number[] =>
  session.source === "timer"
    ? segments.filter((s) => s.kind === "break").map((s) => (s.startAt - session.startAt) / MINUTE)
    : [];

export interface NamedMinutes {
  key: string;
  name: string;
  color: string;
  minutes: number;
}

export interface Series {
  key: string;
  name: string;
  color: string;
  /** 还没到的日子是 null，折线到此为止，而不是画成断崖跌到 0 */
  points: Array<{ day: string; minutes: number | null }>;
}

export interface PauseStat extends NamedMinutes {
  count: number;
}

export interface PersonStat {
  profileId: string;
  name: string;
  color: string;
  minutes: number;
  sessions: number;
  breakMinutes: number;
  breakCount: number;
  longestWorkMinutes: number;
}

export interface Stats {
  range: DayRange;
  days: string[];
  totalMinutes: number;
  /** 窗口内已经过去的天数，日均用它，避免拿未来的天数摊薄。 */
  elapsedDays: number;
  activeDays: number;
  /** 有记录的自然日，连续天数由它算 */
  activeDayKeys: string[];
  avgPerDay: number;
  sessions: number;
  /** 计时器记录数 / 补录数：补录占比高说明时长可信度低 */
  timerSessions: number;
  backfillSessions: number;
  breakMinutes: number;
  breakCount: number;
  longestWorkMinutes: number;
  plannedMinutes: number;
  plannedAchievedMinutes: number;
  bySubject: NamedMinutes[];
  byTask: NamedMinutes[];
  subjectSeries: Series[];
  taskSeries: Series[];
  /** 对比视图用：每人的每日净时长 */
  personSeries: Series[];
  pauseReasons: PauseStat[];
  /** 暂停发生的时机分布 */
  focusBuckets: Array<{ label: string; count: number }>;
  /** 0-23 点，各小时的净学习分钟，用于找「几点最容易进入状态」 */
  hourHistogram: number[];
  /** 周一=0 … 周日=6 的净学习分钟 */
  weekdayMinutes: number[];
  /** 窗口内每个星期几实际出现过几天，用于把 weekdayMinutes 折成「平均每个周六」 */
  weekdayCounts: number[];
  perPerson: PersonStat[];
}

const r = (n: number): number => Math.round(n);

const BUCKET_EDGES = [10, 20, 30, 40];
const BUCKET_LABELS = ["0-10 分钟", "10-20 分钟", "20-30 分钟", "30-40 分钟", "40 分钟后"];

export interface AggregateInput {
  sessions: StudySession[];
  segmentsBySession: Map<string, SessionSegment[]>;
  range: DayRange;
  days: string[];
  now: number;
  subjects: Subject[];
  tasks: TaskType[];
  reasons: PauseReason[];
  profiles: Profile[];
}

export function aggregate(input: AggregateInput): Stats {
  const { sessions, segmentsBySession, range, days, now, subjects, tasks, reasons, profiles } = input;

  const byId = Object.fromEntries(subjects.map((s) => [s.id, s]));
  const taskById = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const reasonById = Object.fromEntries(reasons.map((x) => [x.id, x]));

  const perDay = new Map<string, number>(days.map((d) => [d, 0]));
  // 按 dayKey 字符串比较，避免 new Date("2026-10-19") 按 UTC 解析带来的时区偏移
  const todayKey = dayKey(now);
  const subjectSeries = new Map<string, Map<string, number>>();
  const taskSeries = new Map<string, Map<string, number>>();
  const personSeries = new Map<string, Map<string, number>>();
  const subjectTotal = new Map<string, number>();  const taskTotal = new Map<string, number>();
  const pauseTotal = new Map<string, { ms: number; count: number }>();
  const personStat = new Map<string, PersonStat>();
  const depths: number[] = [];
  const hourHistogram = new Array<number>(24).fill(0);
  const weekdayMinutes = new Array<number>(7).fill(0);

  let totalMinutes = 0;
  let breakMinutes = 0;
  let breakCount = 0;
  let longestWorkMinutes = 0;
  let plannedMinutes = 0;
  let plannedAchievedMinutes = 0;
  let counted = 0;
  let timerSessions = 0;
  let backfillSessions = 0;

  const bump = (store: Map<string, Map<string, number>>, key: string, day: string, ms: number) => {
    const inner = store.get(key) ?? new Map<string, number>();
    inner.set(day, (inner.get(day) ?? 0) + ms / MINUTE);
    store.set(key, inner);
  };

  const personLabel = (id: string): { name: string; color: string } => {
    const p = profiles.find((x) => x.id === id);
    return { name: p?.name ?? "已归档", color: p?.color ?? "#94a3b8" };
  };

  for (const session of sessions) {
    const segments = segmentsBySession.get(session.id) ?? [];
    const attributed = attributeByDay(session, segments, range, now);
    const windowMs = attributed.reduce((sum, a) => sum + a.ms, 0);
    if (windowMs <= 0) continue;

    counted += 1;
    if (session.source === "backfill") backfillSessions += 1;
    else timerSessions += 1;
    totalMinutes += windowMs / MINUTE;

    for (const span of attributedSpans(session, segments, range, now)) {
      for (const h of splitByHour(span.start, span.end)) {
        hourHistogram[h.hour] += h.ms / MINUTE;
      }
    }
    // 星期归属用已按天切分的结果，跨零点的段才不会整段算给前一天
    for (const a of attributed) {
      weekdayMinutes[weekdayIndex(dayKeyToNoon(a.day))] += a.ms / MINUTE;
    }

    for (const a of attributed) {
      perDay.set(a.day, (perDay.get(a.day) ?? 0) + a.ms / MINUTE);
      bump(subjectSeries, session.subjectId, a.day, a.ms);
      bump(personSeries, session.profileId, a.day, a.ms);
      if (session.taskTypeId) bump(taskSeries, session.taskTypeId, a.day, a.ms);
    }
    subjectTotal.set(session.subjectId, (subjectTotal.get(session.subjectId) ?? 0) + windowMs);
    if (session.taskTypeId) {
      taskTotal.set(session.taskTypeId, (taskTotal.get(session.taskTypeId) ?? 0) + windowMs);
    }

    const breaks = segments.filter((s) => s.kind === "break");
    const bm = breakMs(segments, now, session);
    breakMinutes += bm / MINUTE;
    breakCount += breaks.length;
    longestWorkMinutes = Math.max(longestWorkMinutes, longestWorkMs(segments, now, session) / MINUTE);
    depths.push(...focusDepths(session, segments));

    for (const b of breaks) {
      if (!b.pauseReasonId) continue;
      const dur = Math.max(0, Math.min(b.endAt ?? now, session.endAt ?? now) - b.startAt);
      const prev = pauseTotal.get(b.pauseReasonId) ?? { ms: 0, count: 0 };
      pauseTotal.set(b.pauseReasonId, { ms: prev.ms + dur, count: prev.count + 1 });
    }

    if (session.plannedMinutes) {
      plannedMinutes += session.plannedMinutes;
      plannedAchievedMinutes += Math.min(session.plannedMinutes, windowMs / MINUTE);
    }

    let person = personStat.get(session.profileId);
    if (!person) {
      const { name, color } = personLabel(session.profileId);
      person = {
        profileId: session.profileId,
        name,
        color,
        minutes: 0,
        sessions: 0,
        breakMinutes: 0,
        breakCount: 0,
        longestWorkMinutes: 0,
      };
      personStat.set(session.profileId, person);
    }
    person.minutes += windowMs / MINUTE;
    person.sessions += 1;
    person.breakMinutes += bm / MINUTE;
    person.breakCount += breaks.length;
    person.longestWorkMinutes = Math.max(
      person.longestWorkMinutes,
      longestWorkMs(segments, now, session) / MINUTE,
    );
  }

  const subjectLabel = (id: string): { name: string; color: string } => {
    const s = byId[id];
    return { name: s?.name ?? "已删除科目", color: s?.color ?? "#94a3b8" };
  };

  const taskLabel = (id: string): { name: string; color: string } => {
    const t = taskById[id];
    if (!t) return { name: "已删除事项", color: "#94a3b8" };
    const parent = t.subjectId ? byId[t.subjectId] : null;
    return {
      name: parent ? `${parent.name}·${t.name}` : `通用·${t.name}`,
      // 事项沿用科目色，同一科目的事项在图上一眼能归组
      color: parent?.color ?? "#64748b",
    };
  };

  const toSeries = (
    store: Map<string, Map<string, number>>,
    label: (id: string) => { name: string; color: string },
  ): Series[] =>
    [...store.entries()]
      .map(([key, inner]) => {
        const { name, color } = label(key);
        return {
          key,
          name,
          color,
          points: days.map((day) => ({
            day,
            minutes: day <= todayKey ? r(inner.get(day) ?? 0) : null,
          })),
        };
      })
      .sort((a, b) => sumMinutes(b) - sumMinutes(a));

  const sumMinutes = (s: { points: Array<{ minutes: number | null }> }): number =>
    s.points.reduce((acc, p) => acc + (p.minutes ?? 0), 0);

  const toNamed = (store: Map<string, number>, label: (id: string) => { name: string; color: string }) =>
    [...store.entries()]
      .map(([key, ms]) => ({ key, ...label(key), minutes: r(ms / MINUTE) }))
      .sort((a, b) => b.minutes - a.minutes);

  const activeDayKeys = [...perDay.entries()].filter(([, m]) => m > 0).map(([d]) => d).sort();
  const activeDays = activeDayKeys.length;
  const elapsedDays = elapsedDaysOf(days, now);
  // 每个星期几在本窗口出现过几次（只数已过去的天）。跨周求和的量和单日
  // 均值不可比 —— 本月有 5 个周六时，周六的总量天然高于只有 4 个的周三。
  const weekdayCounts = new Array<number>(7).fill(0);
  for (const d of days) {
    if (d > todayKey) break;
    weekdayCounts[weekdayIndex(dayKeyToNoon(d))] += 1;
  }

  return {
    range,
    days,
    totalMinutes: r(totalMinutes),
    elapsedDays,
    activeDays,
    activeDayKeys,
    avgPerDay: elapsedDays ? r(totalMinutes / elapsedDays) : 0,
    sessions: counted,
    timerSessions,
    backfillSessions,
    breakMinutes: r(breakMinutes),
    breakCount,
    longestWorkMinutes: r(longestWorkMinutes),
    plannedMinutes: r(plannedMinutes),
    plannedAchievedMinutes: r(plannedAchievedMinutes),
    bySubject: toNamed(subjectTotal, subjectLabel),
    byTask: toNamed(taskTotal, taskLabel),
    subjectSeries: toSeries(subjectSeries, subjectLabel),
    taskSeries: toSeries(taskSeries, taskLabel),
    personSeries: toSeries(personSeries, personLabel),
    pauseReasons: [...pauseTotal.entries()]
      .map(([id, v]) => ({
        key: id,
        name: reasonById[id]?.label ?? "未知原因",
        color: "#f59e0b",
        minutes: r(v.ms / MINUTE),
        count: v.count,
      }))
      .sort((a, b) => b.count - a.count),
    focusBuckets: BUCKET_LABELS.map((label, i) => {
      const lower = i === 0 ? 0 : BUCKET_EDGES[i - 1];
      const upper = BUCKET_EDGES[i];
      return {
        label,
        // 必须同时卡上下界，否则第 10 分钟的暂停会被算进三个桶里
        count: depths.filter((d) => (i === BUCKET_LABELS.length - 1 ? d >= lower : d >= lower && d < upper)).length,
      };
    }),
    hourHistogram: hourHistogram.map(r),
    weekdayMinutes: weekdayMinutes.map(r),
    weekdayCounts,
    perPerson: [...personStat.values()].sort((a, b) => b.minutes - a.minutes),
  };
}

/** 连续记录天数。从今天或昨天往前数，中断即停 —— 断签的挫败感是留存杀手。 */
export function streakDays(activeDayKeys: string[], now: number): number {
  const set = new Set(activeDayKeys);
  let cursor = midnight(now);
  // 今天还没记不算断签，从昨天开始数
  if (!set.has(dayKey(cursor))) cursor = addDays(cursor, -1);
  let count = 0;
  while (set.has(dayKey(cursor))) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

/** 环比：正数为增长。上期为 0 时返回 null，避免「+∞%」这种没意义的数字。 */
export function ratioChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
