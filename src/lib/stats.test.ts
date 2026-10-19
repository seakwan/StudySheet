import { describe, it, expect } from "vitest";
import {
  aggregate,
  resolveWindow,
  weekRange,
  dayRange,
  prevRange,
  prevRangeAligned,
  ratioChange,
  type AggregateInput,
} from "../lib/stats";
import type { PauseReason, Profile, SessionSegment, StudySession, Subject, TaskType } from "../db/types";

const at = (iso: string): number => new Date(iso).getTime();

const subjects: Subject[] = [
  { id: "s1", name: "语文", color: "#aaa", createdAt: 0 },
  { id: "s2", name: "数学", color: "#bbb", createdAt: 0 },
];
const tasks: TaskType[] = [{ id: "t1", subjectId: null, name: "预习", createdAt: 0 }];
const reasons: PauseReason[] = [{ id: "r1", label: "走神", builtin: true, useCount: 0, createdAt: 0 }];
const profiles: Profile[] = [
  { id: "p1", name: "小海", color: "#111", createdAt: 0, archived: false },
  { id: "p2", name: "阿雨", color: "#222", createdAt: 0, archived: false },
];

const session = (over: Partial<StudySession> & Pick<StudySession, "id" | "startAt">): StudySession => ({
  profileId: "p1",
  subjectId: "s1",
  taskTypeId: "t1",
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

const run = (
  sessions: StudySession[],
  segments: SessionSegment[],
  mode: "day" | "week" | "month" | "total",
  anchor: number,
) => {
  const { range, days } = resolveWindow(mode, anchor, sessions);
  const bySession = new Map<string, SessionSegment[]>();
  for (const s of sessions) bySession.set(s.id, segments.filter((x) => x.sessionId === s.id));
  const input: AggregateInput = {
    sessions,
    segmentsBySession: bySession,
    range,
    days,
    now: anchor,
    subjects,
    tasks,
    reasons,
    profiles,
  };
  return aggregate(input);
};

describe("跨零点归属", () => {
  // 23:40 开始，23:50 暂停 5 分钟，23:55 继续到次日 00:20
  const s = session({ id: "c1", startAt: at("2026-10-18T23:40:00+08:00"), endAt: at("2026-10-19T00:20:00+08:00") });
  const segs: SessionSegment[] = [
    { sessionId: "c1", kind: "work", startAt: at("2026-10-18T23:40:00+08:00"), endAt: at("2026-10-18T23:50:00+08:00"), pauseReasonId: null },
    { sessionId: "c1", kind: "break", startAt: at("2026-10-18T23:50:00+08:00"), endAt: at("2026-10-18T23:55:00+08:00"), pauseReasonId: "r1" },
    { sessionId: "c1", kind: "work", startAt: at("2026-10-18T23:55:00+08:00"), endAt: at("2026-10-19T00:20:00+08:00"), pauseReasonId: null },
  ];
  const now = at("2026-10-19T12:00:00+08:00");

  it("净时长扣除暂停", () => {
    const st = run([s], segs, "total", now);
    expect(st.totalMinutes).toBe(35); // 10 + 25
    expect(st.breakMinutes).toBe(5);
  });

  it("最长专注段取单段最长而非合计", () => {
    expect(run([s], segs, "total", now).longestWorkMinutes).toBe(25);
  });

  it("按天窗口各自只算落在当天的部分", () => {
    // 10-19 当天窗口只含 00:00→00:20 这段
    const day19 = run([s], segs, "day", at("2026-10-19T12:00:00+08:00"));
    expect(day19.totalMinutes).toBe(20);
    const day18 = run([s], segs, "day", at("2026-10-18T23:59:00+08:00"));
    expect(day18.totalMinutes).toBe(15); // 23:40-23:50 + 23:55-24:00
  });

  it("暂停发生在开始后第几分钟要单独可查", () => {
    const st = run([s], segs, "total", now);
    expect(st.focusBuckets.reduce((sum, b) => sum + b.count, 0)).toBe(1);
    // 第 10 分钟暂停，只能落在 10-20 这一桶，不能同时落进多个桶
    expect(st.focusBuckets.find((b) => b.label === "10-20 分钟")?.count).toBe(1);
    expect(st.focusBuckets.find((b) => b.label === "0-10 分钟")?.count).toBe(0);
  });
});

describe("补录记录", () => {
  it("没有事件流时整段按 startAt→endAt 计入", () => {
    const s = session({
      id: "b1",
      profileId: "p2",
      subjectId: "s2",
      source: "backfill",
      startAt: at("2026-10-19T09:00:00+08:00"),
      endAt: at("2026-10-19T09:30:00+08:00"),
    });
    const now = at("2026-10-19T12:00:00+08:00");
    const st = run([s], [], "day", now);
    expect(st.totalMinutes).toBe(30);
    expect(st.perPerson.find((p) => p.profileId === "p2")?.minutes).toBe(30);
    // 补录没有暂停明细，但必须出现在图表里，否则和今日列表数字对不上
    expect(st.breakCount).toBe(0);
    expect(st.bySubject.find((x) => x.key === "s2")?.minutes).toBe(30);
  });

  it("进行中（无 endAt）的会话按当前时刻计算", () => {
    const now = at("2026-10-19T12:00:00+08:00");
    const s = session({ id: "l1", status: "running", startAt: at("2026-10-19T11:00:00+08:00") });
    const segs: SessionSegment[] = [
      { sessionId: "l1", kind: "work", startAt: at("2026-10-19T11:00:00+08:00"), endAt: null, pauseReasonId: null },
    ];
    expect(run([s], segs, "day", now).totalMinutes).toBe(60);
  });
});

describe("窗口", () => {
  const wed = at("2026-10-21T10:00:00+08:00");

  it("本周从周一起算", () => {
    expect(weekRange(wed).from).toBe(at("2026-10-19T00:00:00+08:00"));
    expect(weekRange(wed).to - weekRange(wed).from).toBe(7 * 86_400_000);
  });

  it("上一周期紧邻且不重叠", () => {
    const cur = weekRange(wed);
    const prev = prevRange("week", wed)!;
    expect(prev.to).toBe(cur.from);
    expect(cur.from - prev.from).toBe(7 * 86_400_000);
  });

  it("月度窗口跨年正确", () => {
    const jan = at("2027-01-05T10:00:00+08:00");
    expect(prevRange("month", jan)!.from).toBe(at("2026-12-01T00:00:00+08:00"));
  });

  it("今天窗口只含当天", () => {
    const d = dayRange(wed);
    expect(d.to - d.from).toBe(86_400_000);
  });
});

describe("环比", () => {
  it("基期为 0 时不给百分比", () => {
    expect(ratioChange(120, 0)).toBeNull();
    expect(ratioChange(120, 100)).toBe(20);
    expect(ratioChange(80, 100)).toBe(-20);
  });

  it("本周期没过完时，上期也截成同样的天数", () => {
    // 2026-10-21 是周三，本周已过 3 天（周一/二/三）
    const wed = at("2026-10-21T10:00:00+08:00");
    const aligned = prevRangeAligned("week", wed)!;
    expect(aligned.from).toBe(at("2026-10-12T00:00:00+08:00"));
    expect(aligned.to - aligned.from).toBe(3 * 86_400_000);
    // 完整上周是 7 天，直接用会把「1 天 vs 7 天」当成暴跌
    expect(prevRange("week", wed)!.to - prevRange("week", wed)!.from).toBe(7 * 86_400_000);
  });

  it("整月已过完时上期保持完整", () => {
    // 10-31 是本月最后一天，本月已过 31 天，上月应给完整 30 天
    const last = at("2026-10-31T23:00:00+08:00");
    const aligned = prevRangeAligned("month", last)!;
    expect(aligned.from).toBe(at("2026-09-01T00:00:00+08:00"));
    expect(aligned.to).toBe(at("2026-10-01T00:00:00+08:00"));
  });
});

describe("未来日期", () => {
  it("还没到的日子不画成 0，避免假断崖", () => {
    const now = at("2026-10-21T12:00:00+08:00"); // 周三
    const s = session({
      id: "f1",
      startAt: at("2026-10-19T09:00:00+08:00"),
      endAt: at("2026-10-19T09:30:00+08:00"),
    });
    const segs: SessionSegment[] = [
      { sessionId: "f1", kind: "work", startAt: at("2026-10-19T09:00:00+08:00"), endAt: at("2026-10-19T09:30:00+08:00"), pauseReasonId: null },
    ];
    const st = run([s], segs, "week", now);
    const subj = st.subjectSeries[0];
    expect(subj.points.find((p) => p.day === "2026-10-19")?.minutes).toBe(30);
    // 周四到周日属于未来，应为 null 而不是 0
    expect(subj.points.filter((p) => p.day > "2026-10-21").every((p) => p.minutes === null)).toBe(true);
    expect(subj.points.find((p) => p.day === "2026-10-25")?.minutes).toBeNull();
  });
});

describe("日均", () => {
  it("分母只数已经过去的天，不拿未来摊薄", () => {
    // 本周有 3 天记录，今天是周三
    const days = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
    const sessions = days.slice(0, 3).map((d, i) =>
      session({ id: `d${i}`, startAt: at(`${d}T09:00:00+08:00`), endAt: at(`${d}T09:30:00+08:00`) }),
    );
    const segments: SessionSegment[] = days.slice(0, 3).flatMap((d, i) => [
      { sessionId: `d${i}`, kind: "work" as const, startAt: at(`${d}T09:00:00+08:00`), endAt: at(`${d}T09:30:00+08:00`), pauseReasonId: null },
    ]);
    const st = run(sessions, segments, "week", at("2026-10-21T12:00:00+08:00"));
    expect(st.activeDays).toBe(3);
    expect(st.elapsedDays).toBe(3);
    expect(st.avgPerDay).toBe(30); // 90 分钟 / 3 天，而不是 /7
  });
});
