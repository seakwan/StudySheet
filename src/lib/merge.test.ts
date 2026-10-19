import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { db } from "../db";
import { importBackup, previewImport, settleOpen } from "./merge";
import type { Backup } from "./export";
import type { PauseReason, Profile, SessionSegment, StudySession, Subject, TaskType } from "../db/types";

/**
 * 导入是唯一会写坏用户数据的路径，所以直接对着真的 Dexie 表跑
 * （fake-indexeddb），而不是 mock 掉。
 */

const at = (iso: string): number => new Date(iso).getTime();

const NOW = at("2026-10-19T12:00:00+08:00");

const profiles: Profile[] = [
  { id: "p1", name: "小海", color: "#111", createdAt: 0, archived: false },
];
const subjects: Subject[] = [{ id: "s1", name: "语文", color: "#aaa", createdAt: 0 }];
const tasks = [{ id: "t1", subjectId: null, name: "默写", createdAt: 0 }];
const reasons: PauseReason[] = [
  { id: "r1", label: "走神", builtin: true, useCount: 0, createdAt: 0 },
];

const session = (over: Partial<StudySession> & Pick<StudySession, "id">): StudySession => ({
  profileId: "p1",
  subjectId: "s1",
  taskTypeId: "t1",
  startAt: NOW,
  endAt: NOW + 30 * 60_000,
  status: "done",
  plannedMinutes: null,
  note: "",
  source: "timer",
  netMs: 30 * 60_000,
  gapsMs: 0,
  breaksCount: 0,
  ...over,
});

const backupOf = (sessions: StudySession[], segments: SessionSegment[] = [], exportedAt = NOW): Backup => ({
  app: "studysheet",
  version: 1,
  exportedAt,
  timezone: "Asia/Shanghai",
  utcOffsetMinutes: 480,
  tables: { profiles, subjects, taskTypes: tasks, pauseReasons: reasons, sessions, segments },
});

beforeEach(async () => {
  await Promise.all([
    db.segments.clear(),
    db.sessions.clear(),
    db.pauseReasons.clear(),
    db.taskTypes.clear(),
    db.subjects.clear(),
    db.profiles.clear(),
  ]);
});

describe("合并导入", () => {
  it("只补本地没有的记录", async () => {
    await db.sessions.add(session({ id: "a" }));
    const res = await importBackup(backupOf([session({ id: "a" }), session({ id: "b" })]), "merge");
    expect(res).toMatchObject({ added: 1, skipped: 1 });
    expect(await db.sessions.count()).toBe(2);
  });

  it("重复导入同一个备份不会翻倍", async () => {
    const b = backupOf([session({ id: "a" }), session({ id: "b" })]);
    await importBackup(b, "merge");
    const again = await importBackup(b, "merge");
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(2);
    expect(await db.sessions.count()).toBe(2);
  });

  it("只带走新记录的暂停段", async () => {
    const segs: SessionSegment[] = [
      { id: 1, sessionId: "a", kind: "work", startAt: NOW, endAt: NOW + 60_000, pauseReasonId: null },
      { id: 2, sessionId: "b", kind: "work", startAt: NOW, endAt: NOW + 60_000, pauseReasonId: null },
    ];
    await db.sessions.add(session({ id: "a" }));
    await db.segments.add({ ...segs[0], id: undefined });
    const res = await importBackup(backupOf([session({ id: "a" }), session({ id: "b" })], segs), "merge");
    expect(res.segments).toBe(1);
    expect(await db.segments.count()).toBe(2);
  });

  it("同名科目并成一条，记录改挂到本机那条上", async () => {
    // 模拟新设备：本机自己铺了一套默认「语文」，备份里也有一个同名的
    await db.subjects.add({ id: "local-s", name: "语文", color: "#ccc", createdAt: 0 });
    const b = backupOf([session({ id: "a", subjectId: "s1" })]);
    const res = await importBackup(b, "merge");
    expect(await db.subjects.count()).toBe(1);
    expect(res.mergedDicts).toBe(1);
    expect((await db.sessions.get("a"))?.subjectId).toBe("local-s");
  });

  it("不同名的科目各自保留", async () => {
    await db.subjects.add({ id: "local-s", name: "数学", color: "#ccc", createdAt: 0 });
    await importBackup(backupOf([session({ id: "a", subjectId: "s1" })]), "merge");
    expect(await db.subjects.count()).toBe(2);
    expect((await db.sessions.get("a"))?.subjectId).toBe("s1");
  });

  it("同名的人不会变成两个人", async () => {
    await db.profiles.add({ id: "pp", name: "小海", color: "#000", createdAt: 0, archived: false });
    await importBackup(backupOf([session({ id: "a", profileId: "p1" })]), "merge");
    expect(await db.profiles.count()).toBe(1);
    expect((await db.sessions.get("a"))?.profileId).toBe("pp");
  });

  it("不同科目下的同名事项不会被错并", async () => {
    const twoSubjects: Subject[] = [
      { id: "s1", name: "语文", color: "#aaa", createdAt: 0 },
      { id: "s2", name: "数学", color: "#bbb", createdAt: 0 },
    ];
    const localTasks: TaskType[] = [
      { id: "lt1", subjectId: "s1", name: "默写", createdAt: 0 },
      { id: "lt2", subjectId: "s2", name: "默写", createdAt: 0 },
    ];
    await db.subjects.bulkAdd(twoSubjects);
    await db.taskTypes.bulkAdd(localTasks);
    // 备份里两个科目下的「默写」用的是另一套 id
    const b = backupOf([session({ id: "a", taskTypeId: "t1" }), session({ id: "b", taskTypeId: "t2" })]);
    b.tables.taskTypes = [
      { id: "t1", subjectId: "s1", name: "默写", createdAt: 0 },
      { id: "t2", subjectId: "s2", name: "默写", createdAt: 0 },
    ];
    await importBackup(b, "merge");
    expect(await db.taskTypes.count()).toBe(2);
    expect((await db.sessions.get("a"))?.taskTypeId).toBe("lt1");
    expect((await db.sessions.get("b"))?.taskTypeId).toBe("lt2");
  });

  it("暂停段的 reasonId 一起改挂", async () => {
    await db.pauseReasons.add({ id: "lr", label: "走神", builtin: true, useCount: 0, createdAt: 0 });
    const segs: SessionSegment[] = [
      { id: 1, sessionId: "a", kind: "break", startAt: NOW, endAt: NOW + 60_000, pauseReasonId: "r1" },
    ];
    await importBackup(backupOf([session({ id: "a" })], segs), "merge");
    expect((await db.segments.toArray())[0].pauseReasonId).toBe("lr");
  });

  it("字典缺项时记录照样导入，不丢学习数据", async () => {
    const b = backupOf([session({ id: "q", subjectId: "gone" })]);
    b.tables.subjects = [];
    await importBackup(b, "merge");
    expect(await db.sessions.count()).toBe(1);
    // 引用改不到就留着，界面上显示成「已删除」
    expect((await db.sessions.get("q"))?.subjectId).toBe("gone");
  });

  it("自增段 id 重新分配，不会和本机的撞号", async () => {
    await db.segments.add({ sessionId: "local", kind: "work", startAt: NOW, endAt: NOW + 1000, pauseReasonId: null });
    const maxLocal = Math.max(...(await db.segments.toCollection().primaryKeys()));
    const segs: SessionSegment[] = [
      { id: 1, sessionId: "n1", kind: "work", startAt: NOW, endAt: NOW + 1000, pauseReasonId: null },
    ];
    await importBackup(backupOf([session({ id: "n1" })], segs), "merge");
    const keys = await db.segments.toCollection().primaryKeys();
    expect(keys.filter((k) => k <= maxLocal).length).toBe(1);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("替换导入", () => {
  it("清空本机后写入备份内容", async () => {
    await db.sessions.add(session({ id: "old" }));
    await db.profiles.add({ id: "px", name: "旧人", color: "#000", createdAt: 0, archived: false });
    const res = await importBackup(backupOf([session({ id: "new" })]), "replace");
    expect(res.added).toBe(1);
    expect(await db.sessions.count()).toBe(1);
    expect((await db.sessions.toCollection().primaryKeys())[0]).toBe("new");
    expect(await db.profiles.count()).toBe(1);
  });

  it("预览里说清会清掉多少条", async () => {
    await db.sessions.add(session({ id: "old" }));
    const text = await previewImport(backupOf([session({ id: "new" })]), "replace");
    expect(text).toContain("清空本机 1 条");
    expect(text).toContain("不能撤销");
  });
});

describe("未结束的计时", () => {
  const running = (): { sessions: StudySession[]; segments: SessionSegment[] } => ({
    sessions: [
      session({
        id: "live",
        startAt: at("2026-10-19T09:00:00+08:00"),
        endAt: null,
        status: "running",
        netMs: 0,
      }),
    ],
    segments: [
      {
        id: 1,
        sessionId: "live",
        kind: "work",
        startAt: at("2026-10-19T09:00:00+08:00"),
        endAt: null,
        pauseReasonId: null,
      },
    ],
  });

  it("导入时按导出那一刻收尾，不留给 boot() 去无限累加", async () => {
    const { sessions, segments } = running();
    const res = await importBackup(backupOf(sessions, segments, NOW), "replace");
    expect(res.settled).toBe(1);
    const s = await db.sessions.get("live");
    expect(s?.status).toBe("done");
    expect(s?.endAt).toBe(NOW);
    expect(s?.netMs).toBe(3 * 60 * 60_000); // 09:00 → 12:00
    const seg = (await db.segments.toArray())[0];
    expect(seg.endAt).toBe(NOW);
  });

  it("收尾后本机不会再有进行中的会话", async () => {
    const { sessions, segments } = running();
    await importBackup(backupOf(sessions, segments, NOW), "replace");
    expect(await db.sessions.where("status").anyOf("running", "paused").count()).toBe(0);
  });

  it("暂停段一起收尾，净时长不含暂停", () => {
    const { sessions, segments } = running();
    const withBreak: SessionSegment[] = [
      { ...segments[0], endAt: at("2026-10-19T09:30:00+08:00") },
      {
        id: 2,
        sessionId: "live",
        kind: "break",
        startAt: at("2026-10-19T09:30:00+08:00"),
        endAt: null,
        pauseReasonId: "r1",
      },
    ];
    const out = settleOpen(backupOf(sessions, withBreak, at("2026-10-19T10:00:00+08:00")));
    expect(out.tables.sessions[0].netMs).toBe(30 * 60_000);
    expect(out.tables.sessions[0].gapsMs).toBe(30 * 60_000);
    expect(out.tables.sessions[0].breaksCount).toBe(1);
  });

  it("没有未结束会话时原样返回", () => {
    const out = settleOpen(backupOf([session({ id: "ok" })]));
    expect(out.settled).toBe(0);
    expect(out.tables.sessions[0].id).toBe("ok");
  });

  it("合并时重复的记录被跳过，不算进收尾数", async () => {
    const { sessions, segments } = running();
    await importBackup(backupOf(sessions, segments, NOW), "replace");
    // 同一份备份再合并一次：一条都写不进去，也就不该声称收尾了什么
    const again = await importBackup(backupOf(sessions, segments, NOW), "merge");
    expect(again).toMatchObject({ added: 0, skipped: 1, settled: 0 });
    const text = await previewImport(backupOf(sessions, segments, NOW), "merge");
    expect(text).not.toContain("会被收尾");
  });
});
