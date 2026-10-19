import { describe, it, expect } from "vitest";
import { aggregate, resolveWindow, type Stats } from "./stats";
import { buildReport, type Finding, type Report } from "./report";
import type { PauseReason, Profile, SessionSegment, StudySession, Subject } from "../db/types";

/**
 * 周报的输入一律来自 aggregate()，而不是手搓 Stats ——
 * 这样 report ↔ stats 的字段接线（activeDayKeys / hourHistogram / 补录计数）也一起被锁住。
 */

const at = (iso: string): number => new Date(iso).getTime();

// 2026-10-21 是周三：本周窗口 10-19 ~ 10-25，已过 3 天
const NOW = at("2026-10-21T12:00:00+08:00");
const DAYS = ["2026-10-19", "2026-10-20", "2026-10-21"];
const WEEK = 7 * 86_400_000;

const subjects: Subject[] = [
  { id: "s1", name: "语文", color: "#aaa", createdAt: 0 },
  { id: "s2", name: "数学", color: "#bbb", createdAt: 0 },
  { id: "s3", name: "英语", color: "#ccc", createdAt: 0 },
];
const reasons: PauseReason[] = [
  { id: "r1", label: "走神", builtin: true, useCount: 0, createdAt: 0 },
  { id: "r2", label: "喝水", builtin: true, useCount: 0, createdAt: 0 },
];
const profiles: Profile[] = [{ id: "p1", name: "小海", color: "#111", createdAt: 0, archived: false }];

const base = (over: Partial<StudySession> & Pick<StudySession, "id" | "startAt">): StudySession => ({
  profileId: "p1",
  subjectId: "s1",
  taskTypeId: null,
  endAt: null,
  status: "done",
  plannedMinutes: null,
  note: "",
  source: "timer",
  netMs: 0,
  gapsMs: 0,
  breaksCount: 0,
  ...over,
});

interface Entry {
  session: StudySession;
  segments: SessionSegment[];
}

/** 一次「学 pauseAt 分钟 → 暂停 breakMin 分钟 → 再学 tail 分钟」的计时记录 */
function paused(
  id: string,
  day: string,
  opts: { pauseAt: number; breakMin?: number; tail?: number; subjectId?: string; planned?: number; reason?: string },
): Entry {
  const { pauseAt, breakMin = 5, tail = pauseAt, subjectId = "s1", planned, reason = "r1" } = opts;
  const start = at(`${day}T09:00:00+08:00`);
  const pauseStart = start + pauseAt * 60_000;
  const resume = pauseStart + breakMin * 60_000;
  const end = resume + tail * 60_000;
  const seg = (kind: SessionSegment["kind"], a: number, b: number): SessionSegment => ({
    sessionId: id,
    kind,
    startAt: a,
    endAt: b,
    pauseReasonId: kind === "break" ? reason : null,
  });
  return {
    session: base({
      id,
      subjectId,
      startAt: start,
      endAt: end,
      plannedMinutes: planned ?? null,
      netMs: (pauseAt + tail) * 60_000,
      breaksCount: 1,
    }),
    segments: [seg("work", start, pauseStart), seg("break", pauseStart, resume), seg("work", resume, end)],
  };
}

/** 一段没有暂停的学习；segments = false 用来模拟补录（没有事件流） */
function block(id: string, day: string, minutes: number, subjectId = "s1", planned?: number, withSegments = true): Entry {
  const start = at(`${day}T09:00:00+08:00`);
  const end = start + minutes * 60_000;
  const session = base({
    id,
    subjectId,
    startAt: start,
    endAt: end,
    plannedMinutes: planned ?? null,
    source: withSegments ? "timer" : "backfill",
    netMs: minutes * 60_000,
  });
  const segments: SessionSegment[] = withSegments
    ? [{ sessionId: id, kind: "work", startAt: start, endAt: end, pauseReasonId: null }]
    : [];
  return { session, segments };
}

const backfill = (id: string, day: string, minutes: number): Entry => block(id, day, minutes, "s1", undefined, false);

function statsOf(entries: Entry[], anchorTs: number, now: number, mode: "week" | "month"): Stats {
  const sessions = entries.map((e) => e.session);
  const { range, days } = resolveWindow(mode, anchorTs, sessions);
  const bySession = new Map<string, SessionSegment[]>();
  for (const e of entries) bySession.set(e.session.id, e.segments);
  return aggregate({
    sessions,
    segmentsBySession: bySession,
    range,
    days,
    now,
    subjects,
    tasks: [],
    reasons,
    profiles,
  });
}

/** 把一批记录整体平移到上一周期，用于造「上期同期」数据 */
const shift = (entries: Entry[], days: number): Entry[] => {
  const d = days * 86_400_000;
  return entries.map((e) => ({
    session: { ...e.session, startAt: e.session.startAt + d, endAt: e.session.endAt === null ? null : e.session.endAt + d },
    segments: e.segments.map((s) => ({ ...s, startAt: s.startAt + d, endAt: s.endAt === null ? null : s.endAt + d })),
  }));
};

function review(
  current: Entry[],
  opts: { mode?: "week" | "month"; now?: number; previous?: Entry[] } = {},
): { cur: Stats; prev: Stats; rep: Report } {
  const mode = opts.mode ?? "week";
  const now = opts.now ?? NOW;
  const cur = statsOf(current, now, now, mode);
  // 上周：窗口取上一周期，聚合的「现在」仍是本周期，才和 prevRangeAligned 的口径一致
  const prev = statsOf(shift(opts.previous ?? current, -7), now - WEEK, now, mode);
  return { cur, prev, rep: buildReport(cur, prev, now) };
}

const find = (list: Finding[], id: string): Finding | undefined => list.find((x) => x.id === id);

describe("样本不足", () => {
  it("记录太少时明确标注结论不可靠", () => {
    const { rep } = review([block("a1", DAYS[0], 40)]);
    expect(rep.reliable).toBe(false);
    expect(rep.coverageNote).toContain("样本还不足");
  });

  it("3 条记录 / 3 天时结论可靠", () => {
    const { rep } = review(DAYS.map((d, i) => block(`a${i}`, d, 40)));
    expect(rep.reliable).toBe(true);
    expect(rep.coverageNote).toContain("3 天有记录");
  });

  it("完全没有记录时给一句实话而不是硬凑", () => {
    const { rep } = review([]);
    expect(rep.headline).toBe("这个时段还没有记录");
  });

  it("记录短到不足 1 分钟时，不说「还没有记录」", () => {
    // 24 秒在分钟精度下是 0，但确实记了一条 —— 两句话不能互相打架
    const { cur, rep } = review([block("z1", DAYS[0], 0.4)]);
    expect(cur.totalMinutes).toBe(0);
    expect(cur.sessions).toBe(1);
    expect(rep.headline).toContain("不到 1 分钟");
    expect(rep.headline).not.toContain("还没有记录");
    expect(find(rep.findings, "level")?.title).toContain("不到 1 分钟");
  });

  it("本期不足 1 分钟时不报「环比减少 100%」", () => {
    // 上期 180 分钟、本期四舍五入成 0 → 数字上是 -100%，但那不是趋势
    const { rep } = review([block("z2", DAYS[0], 0.4)], {
      previous: DAYS.map((d, i) => block(`z3${i}`, d, 60)),
    });
    expect(find(rep.findings, "trend")).toBeUndefined();
    expect(rep.headline).not.toContain("环比");
  });
});

describe("暂停密度", () => {
  // 3 条各净 20 分钟、各暂停 1 次 → 60 分钟 / 3 次 = 每小时 3 次
  const dense = DAYS.map((d, i) => paused(`d${i}`, d, { pauseAt: 10, tail: 10, reason: i === 0 ? "r2" : "r1" }));

  it("每小时 3 次以上算「打断偏密」，并点名最高频的暂停原因", () => {
    const { cur, rep } = review(dense);
    expect(cur.breakCount).toBe(3);
    expect(find(rep.findings, "dense-pauses")?.tone).toBe("bad");
    const cut = find(rep.suggestions, "cut-pauses");
    expect(cut?.title).toContain("走神");
    expect(cut?.evidence.some((e) => e.includes("次"))).toBe(true);
  });

  it("节奏稳时给正向结论", () => {
    // 3 条各净 60 分钟 → 每小时 1 次
    const calm = DAYS.map((d, i) => paused(`c${i}`, d, { pauseAt: 30, tail: 30 }));
    const { rep } = review(calm);
    expect(find(rep.findings, "calm")?.tone).toBe("good");
    expect(find(rep.findings, "dense-pauses")).toBeUndefined();
    expect(find(rep.suggestions, "cut-pauses")).toBeUndefined();
  });

  it("只暂停一两次时不下判断", () => {
    const { rep } = review([paused("f0", DAYS[0], { pauseAt: 10 }), block("f1", DAYS[1], 30)]);
    expect(find(rep.findings, "dense-pauses")).toBeUndefined();
    expect(find(rep.findings, "calm")).toBeUndefined();
  });
});

describe("暂停时机", () => {
  it("暂停集中在开始前 10 分钟时定性为启动问题", () => {
    const { cur, rep } = review(DAYS.map((d, i) => paused(`e${i}`, d, { pauseAt: 5, tail: 40 })));
    expect(cur.focusBuckets[0].count).toBe(3);
    expect(find(rep.findings, "early-pause")?.detail).toContain("3/3");
    expect(find(rep.suggestions, "fix-start")).toBeDefined();
    // 3 次 / 135 分钟 → 密度不到 3，不该同时报「打断偏密」
    expect(find(rep.findings, "dense-pauses")).toBeUndefined();
  });

  it("暂停发生在 10 分钟之后时不报启动问题", () => {
    const { rep } = review(DAYS.map((d, i) => paused(`l${i}`, d, { pauseAt: 25, tail: 20 })));
    expect(find(rep.findings, "early-pause")).toBeUndefined();
  });
});

describe("时段与星期", () => {
  it("学得最多的时段会被点名", () => {
    const { cur, rep } = review(DAYS.map((d, i) => block(`h${i}`, d, 45)));
    expect(cur.hourHistogram[9]).toBe(135);
    expect(find(rep.findings, "peak-hours")?.title).toContain("9:00-10:00");
    expect(find(rep.suggestions, "schedule-hard")?.title).toContain("9:00");
  });

  it("计时记录太少时不猜时段规律", () => {
    const { rep } = review([block("h1", DAYS[0], 45), block("h2", DAYS[0], 45)]);
    expect(find(rep.findings, "peak-hours")).toBeUndefined();
  });

  it("星期分布差距大时，建议给最弱那天安排短任务", () => {
    const { rep } = review([block("w1", DAYS[0], 60), block("w2", DAYS[1], 60), block("w3", DAYS[2], 5)]);
    expect(find(rep.findings, "weekday")).toBeDefined();
    expect(find(rep.suggestions, "fix-weekday")?.title).toContain("周三");
  });

  it("比的是「平均每个周几」而不是这个月有几天", () => {
    // 2026-10 到 10-31：周六出现 5 次、周三 4 次。
    // 周六 5×30=150 分（平均 30），周三 4×32=128 分（平均 32）。
    // 按总量会把周六说成最能学，其实周三单日更多。
    const saturdays = ["2026-10-03", "2026-10-10", "2026-10-17", "2026-10-24", "2026-10-31"];
    const wednesdays = ["2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28"];
    const mondays = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"];
    const { cur, rep } = review(
      [
        ...saturdays.map((d, i) => block(`sa${i}`, d, 30)),
        ...wednesdays.map((d, i) => block(`we${i}`, d, 32)),
        ...mondays.map((d, i) => block(`mo${i}`, d, 10)),
      ],
      { mode: "month", now: at("2026-10-31T12:00:00+08:00"), previous: [] },
    );
    expect(cur.weekdayCounts[5]).toBe(5); // 周六 5 天
    expect(cur.weekdayCounts[2]).toBe(4); // 周三 4 天
    const wd = find(rep.findings, "weekday")!;
    expect(wd.title).toContain("周三最能学");
    expect(wd.title).toContain("周一最少");
    expect(wd.evidence[0]).toContain("周三 4 天共 128 分");
  });
});

describe("结构偏差", () => {
  it("单科占一半以上时算偏科", () => {
    const { rep } = review([block("k0", DAYS[0], 70), block("k1", DAYS[1], 30, "s2"), block("k2", DAYS[2], 20, "s3")]);
    const skew = find(rep.findings, "skew");
    expect(skew?.title).toContain("语文");
    // 70 / (70+30+20)
    expect(skew?.detail).toContain("58%");
    expect(find(rep.suggestions, "fix-skew")?.title).toContain("英语");
  });

  it("只有两科时不下偏科结论", () => {
    const { rep } = review([block("n0", DAYS[0], 70), block("n1", DAYS[1], 10, "s2"), block("n2", DAYS[2], 5, "s2")]);
    expect(find(rep.findings, "skew")).toBeUndefined();
  });
});

describe("计划达成", () => {
  it("达成率低于 70% 时建议把计划调小", () => {
    const { cur, rep } = review(DAYS.map((d, i) => block(`p${i}`, d, 30, "s1", 60)));
    expect(cur.plannedMinutes).toBe(180);
    expect(cur.plannedAchievedMinutes).toBe(90);
    expect(find(rep.findings, "plan-miss")?.title).toContain("50%");
    expect(find(rep.suggestions, "fix-plan")).toBeDefined();
  });

  it("达成率 95% 以上给正向结论", () => {
    const { rep } = review(DAYS.map((d, i) => block(`q${i}`, d, 30, "s1", 30)));
    expect(find(rep.findings, "plan-hit")?.title).toContain("100%");
    expect(find(rep.findings, "plan-miss")).toBeUndefined();
  });

  it("没填计划时不谈达成率", () => {
    const { rep } = review(DAYS.map((d, i) => block(`r${i}`, d, 30)));
    expect(find(rep.findings, "plan-miss")).toBeUndefined();
    expect(find(rep.findings, "plan-hit")).toBeUndefined();
  });
});

describe("连续与漏记", () => {
  it("连续 3 天以上优先肯定坚持", () => {
    const { rep } = review(DAYS.map((d, i) => block(`s${i}`, d, 30)));
    expect(find(rep.findings, "streak")?.title).toContain("连续记录 3 天");
    expect(find(rep.findings, "gaps")).toBeUndefined();
  });

  it("月窗口里漏记天数会被点名，哪怕最近连着记了 3 天", () => {
    const { rep } = review(DAYS.map((d, i) => block(`g${i}`, d, 30)), { mode: "month" });
    // 10 月已过 21 天，只有 3 天有记录
    expect(find(rep.findings, "gaps")?.title).toContain("21 天里有 18 天没记录");
    expect(find(rep.suggestions, "fix-gaps")).toBeDefined();
    // 「连续 3 天」和「一个月只记了 3 天」是两件事，不能只报好听的那条
    expect(find(rep.findings, "streak")).toBeDefined();
  });
});

describe("数据可信度", () => {
  it("补录占比过高时提醒时长只能看趋势", () => {
    const { cur, rep } = review([block("z0", DAYS[0], 40), ...DAYS.map((d, i) => backfill(`b${i}`, d, 30))]);
    expect(cur.backfillSessions).toBe(3);
    expect(find(rep.findings, "backfill-heavy")?.detail).toContain("补录 3 条");
  });

  it("补录没有事件流也要计入时长，但不能编出暂停明细", () => {
    const { cur } = review(DAYS.map((d, i) => backfill(`x${i}`, d, 60)));
    expect(cur.totalMinutes).toBe(180);
    expect(cur.breakCount).toBe(0);
    expect(cur.hourHistogram[9]).toBe(180);
    expect(find(review(DAYS.map((d, i) => backfill(`x${i}`, d, 60))).rep.findings, "dense-pauses")).toBeUndefined();
  });
});

describe("长时段", () => {
  it("出现 25 分钟以上的连续专注要肯定", () => {
    const { rep } = review(DAYS.map((d, i) => block(`t${i}`, d, 40)));
    expect(find(rep.findings, "deep-work")?.title).toContain("40 分钟");
  });

  it("都是短时段时不编造这条", () => {
    const { rep } = review(DAYS.map((d, i) => block(`u${i}`, d, 20)));
    expect(find(rep.findings, "deep-work")).toBeUndefined();
  });
});

describe("趋势", () => {
  it("环比变化够大时先说变化而不是平均水平", () => {
    // 本期 30×3=90，上期同期 60×3=180 → -50%
    const { cur, prev, rep } = review(DAYS.map((d, i) => block(`v${i}`, d, 30)), {
      previous: DAYS.map((d, i) => block(`p${i}`, d, 60)),
    });
    expect(cur.totalMinutes).toBe(90);
    expect(prev.totalMinutes).toBe(180);
    const trend = find(rep.findings, "trend");
    expect(trend?.title).toContain("减少 50%");
    expect(trend?.tone).toBe("bad");
    expect(find(rep.findings, "level")).toBeUndefined();
    expect(rep.headline).toContain("环比减 50%");
  });

  it("变化不到 15% 时按持平处理", () => {
    const { rep } = review(DAYS.map((d, i) => block(`w${i}`, d, 50)));
    expect(find(rep.findings, "trend")).toBeUndefined();
    expect(find(rep.findings, "level")?.tone).toBe("neutral");
    // 150 分钟 → 用小时表述
    expect(find(rep.findings, "level")?.title).toContain("2.5 小时");
  });

  it("上期为 0 时不给百分比，只报本期", () => {
    const { rep } = review(DAYS.map((d, i) => block(`x${i}`, d, 50)), { previous: [] });
    expect(find(rep.findings, "trend")).toBeUndefined();
    expect(rep.headline).not.toContain("环比");
  });
});

describe("建议数量", () => {
  it("同时命中多条问题时，建议最多 3 条", () => {
    const messy = [
      paused("m0", DAYS[0], { pauseAt: 5, tail: 15 }),
      paused("m1", DAYS[1], { pauseAt: 3, tail: 12, subjectId: "s1", reason: "r2" }),
      paused("m2", DAYS[1], { pauseAt: 4, tail: 8, subjectId: "s2" }),
      backfill("m3", DAYS[2], 10),
    ];
    const { rep } = review(messy, { mode: "month" });
    expect(rep.suggestions.length).toBeLessThanOrEqual(3);
    expect(rep.findings.length).toBeGreaterThanOrEqual(4);
  });

  it("每条建议都带得出数字的证据", () => {
    const { rep } = review(DAYS.map((d, i) => paused(`y${i}`, d, { pauseAt: 10, tail: 10 })));
    expect(rep.suggestions.length).toBeGreaterThan(0);
    for (const s of rep.suggestions) {
      expect(s.evidence.length).toBeGreaterThan(0);
      // 没有数字的建议等于废话
      expect(s.evidence.every((e) => /\d/.test(e))).toBe(true);
    }
  });

  it("结论不会自相矛盾：报「偏密」就不会同时报「节奏稳」", () => {
    const ids = review(DAYS.map((d, i) => paused(`n${i}`, d, { pauseAt: 10, tail: 10 }))).rep.findings.map((f) => f.id);
    expect(ids.includes("dense-pauses") && ids.includes("calm")).toBe(false);
  });
});
