import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { db } from "../db";
import { importBackup } from "./merge";
import { buildBackup, serializeBackup, parseBackup, type Backup } from "./export";
import type { Profile, SessionSegment, StudySession, Subject, TaskType, PauseReason } from "../db/types";

/**
 * 两台设备互相备份，是 M6 轻量版唯一的用法。
 * 这里验的是最要命的一条性质：来回导两次以后，两台设备是不是真的变成同一份数据，
 * 而不是各自多出一个「语文」、多出一个「小海」。
 */

const at = (iso: string): number => new Date(iso).getTime();
const T0 = at("2026-10-18T20:00:00+08:00");
const MIN = 60_000;

const session = (
  id: string,
  profileId: string,
  subjectId: string,
  startAt: number,
): StudySession => ({
  id,
  profileId,
  subjectId,
  taskTypeId: null,
  startAt,
  endAt: startAt + 30 * MIN,
  status: "done",
  plannedMinutes: null,
  note: "",
  source: "timer",
  netMs: 30 * MIN,
  gapsMs: 0,
  breaksCount: 0,
});

const clearAll = async () => {
  await Promise.all([
    db.segments.clear(),
    db.sessions.clear(),
    db.pauseReasons.clear(),
    db.taskTypes.clear(),
    db.subjects.clear(),
    db.profiles.clear(),
  ]);
};

/** 把本机现状导出成备份，等价于用户点「导出备份」。 */
const dump = async (exportedAt: number): Promise<Backup> => {
  const [profiles, subjects, taskTypes, pauseReasons, sessions, segments] = await Promise.all([
    db.profiles.toArray(),
    db.subjects.toArray(),
    db.taskTypes.toArray(),
    db.pauseReasons.toArray(),
    db.sessions.toArray(),
    db.segments.toArray(),
  ]);
  return parseBackup(
    serializeBackup(
      buildBackup({ profiles, subjects, taskTypes, pauseReasons, sessions, segments, now: exportedAt }),
    ),
  );
};

const snapshot = async () => {
  const [sessions, subjects, profiles, segments] = await Promise.all([
    db.sessions.toArray(),
    db.subjects.toArray(),
    db.profiles.toArray(),
    db.segments.toArray(),
  ]);
  return {
    sessionIds: sessions.map((s) => s.id).sort(),
    subjectNames: subjects.map((s) => s.name).sort(),
    profileNames: profiles.map((p) => p.name).sort(),
    totalNet: sessions.reduce((a, s) => a + s.netMs, 0),
    segCount: segments.length,
  };
};

beforeEach(async () => {
  await clearAll();
});

describe("两台设备互相备份", () => {
  it("来回各导一次后，两边的记录和字典都并齐了", async () => {
    // A 设备：自己的「语文」和一条记录
    await db.subjects.add({ id: "sA", name: "语文", color: "#aaa", createdAt: 0 } as Subject);
    await db.profiles.add({ id: "pA", name: "小海", color: "#111", createdAt: 0, archived: false } as Profile);
    await db.sessions.add(session("recA", "pA", "sA", T0 - 2 * MIN));

    // B 设备：同名但 id 完全不同的「语文」，另一天记的一条
    const bSubjects: Subject[] = [{ id: "sB", name: "语文", color: "#bbb", createdAt: 0 }];
    const bProfiles: Profile[] = [{ id: "pB", name: "小海", color: "#222", createdAt: 0, archived: false }];
    const bSessions = [session("recB", "pB", "sB", T0 + 2 * MIN)];

    // A -> B
    const fromA = await dump(T0);
    await clearAll();
    await db.subjects.bulkAdd(bSubjects);
    await db.profiles.bulkAdd(bProfiles);
    await db.sessions.bulkAdd(bSessions);
    const ab = await importBackup(fromA, "merge");
    expect(ab.added).toBe(1);
    expect(ab.mergedDicts).toBeGreaterThan(0); // 语文 / 小海 并到本机同名项，而不是新增

    // B(已含 A) -> A
    const fromB = await dump(T0 + MIN);
    await clearAll();
    await db.subjects.add({ id: "sA", name: "语文", color: "#aaa", createdAt: 0 } as Subject);
    await db.profiles.add({ id: "pA", name: "小海", color: "#111", createdAt: 0, archived: false } as Profile);
    await db.sessions.add(session("recA", "pA", "sA", T0 - 2 * MIN));
    const ba = await importBackup(fromB, "merge");
    expect(ba.added).toBe(1); // 只补进 recB，recA 被跳过
    expect(ba.skipped).toBe(1);

    const a = await snapshot();
    expect(a.sessionIds).toEqual(["recA", "recB"]);
    expect(a.subjectNames).toEqual(["语文"]); // 没有变成两个语文
    expect(a.profileNames).toEqual(["小海"]);

    // B 端此时也已经是这两条
    await clearAll();
    await db.subjects.bulkAdd(bSubjects);
    await db.profiles.bulkAdd(bProfiles);
    await db.sessions.bulkAdd(bSessions);
    await importBackup(fromA, "merge");
    const b = await snapshot();
    expect(b.sessionIds).toEqual(a.sessionIds);
    expect(b.subjectNames).toEqual(a.subjectNames);
    expect(b.totalNet).toBe(a.totalNet);
  });

  it("重复互相导入不会让记录翻倍", async () => {
    await db.subjects.add({ id: "sA", name: "数学", color: "#aaa", createdAt: 0 } as Subject);
    await db.profiles.add({ id: "pA", name: "阿雨", color: "#111", createdAt: 0, archived: false } as Profile);
    await db.sessions.add(session("r1", "pA", "sA", T0));
    const one = await dump(T0);

    for (let i = 0; i < 3; i += 1) {
      const res = await importBackup(one, "merge");
      expect(res.added).toBe(0); // 本机已有，一条都不该新增
      expect(res.skipped).toBe(1);
    }
    expect(await db.sessions.count()).toBe(1);
    expect(await db.segments.count()).toBe(0);
  });

  it("带暂停段的记录跨设备后段数不变，净时长不变", async () => {
    await db.subjects.add({ id: "sA", name: "英语", color: "#aaa", createdAt: 0 } as Subject);
    await db.profiles.add({ id: "pA", name: "小海", color: "#111", createdAt: 0, archived: false } as Profile);
    await db.pauseReasons.add({ id: "rA", label: "喝水", builtin: true, useCount: 2, createdAt: 0 } as PauseReason);
    await db.sessions.add(session("r2", "pA", "sA", T0));
    const segs: SessionSegment[] = [
      { sessionId: "r2", kind: "work", startAt: T0, endAt: T0 + 20 * MIN, pauseReasonId: null },
      { sessionId: "r2", kind: "break", startAt: T0 + 20 * MIN, endAt: T0 + 25 * MIN, pauseReasonId: "rA" },
      { sessionId: "r2", kind: "work", startAt: T0 + 25 * MIN, endAt: T0 + 30 * MIN, pauseReasonId: null },
    ];
    await db.segments.bulkAdd(segs);
    const withSegs = await dump(T0);

    await clearAll();
    // 新设备自己铺了一套同名默认字典
    await db.subjects.add({ id: "sNew", name: "英语", color: "#ccc", createdAt: 0 } as Subject);
    await db.pauseReasons.add({ id: "rNew", label: "喝水", builtin: true, useCount: 0, createdAt: 0 } as PauseReason);
    const res = await importBackup(withSegs, "merge");
    expect(res.segments).toBe(3);

    const got = await db.segments.toArray();
    expect(got.length).toBe(3);
    expect(got.every((x) => x.sessionId === "r2")).toBe(true);
    // 暂停原因改挂到本机那条，而不是留下一个查无此因的 id
    expect(got.filter((x) => x.kind === "break").map((x) => x.pauseReasonId)).toEqual(["rNew"]);
    expect((await db.sessions.get("r2"))?.subjectId).toBe("sNew");
    expect((await db.sessions.get("r2"))?.netMs).toBe(30 * MIN);
  });

  it("事项按「科目+名字」去重，跨设备后仍挂在正确科目下", async () => {
    const subjects: Subject[] = [
      { id: "sA1", name: "语文", color: "#aaa", createdAt: 0 },
      { id: "sA2", name: "数学", color: "#bbb", createdAt: 0 },
    ];
    const tasks: TaskType[] = [
      { id: "tA1", subjectId: "sA1", name: "默写", createdAt: 0 },
      { id: "tA2", subjectId: "sA2", name: "默写", createdAt: 0 },
    ];
    await db.subjects.bulkAdd(subjects);
    await db.taskTypes.bulkAdd(tasks);
    const snap = await dump(T0);

    await clearAll();
    await db.subjects.bulkAdd([
      { id: "sB1", name: "语文", color: "#ccc", createdAt: 0 },
      { id: "sB2", name: "数学", color: "#ddd", createdAt: 0 },
    ] as Subject[]);
    await db.taskTypes.bulkAdd([
      { id: "tB1", subjectId: "sB1", name: "默写", createdAt: 0 },
      { id: "tB2", subjectId: "sB2", name: "默写", createdAt: 0 },
    ] as TaskType[]);
    await importBackup(snap, "merge");

    const after = await db.taskTypes.toArray();
    expect(after.length).toBe(2);
    const byName = new Map(after.map((t) => [`${t.name}@${t.subjectId}`, t.id]));
    expect(byName.size).toBe(2); // 两个「默写」各自还在，没被并成一个
    expect(new Set(after.map((t) => t.subjectId))).toEqual(new Set(["sB1", "sB2"]));
  });
});
