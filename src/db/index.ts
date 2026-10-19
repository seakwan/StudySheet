import Dexie, { type Table } from "dexie";
import type {
  PauseReason,
  Profile,
  SessionSegment,
  StudySession,
  Subject,
  TaskType,
} from "./types";

class StudySheetDB extends Dexie {
  profiles!: Table<Profile, string>;
  subjects!: Table<Subject, string>;
  taskTypes!: Table<TaskType, string>;
  pauseReasons!: Table<PauseReason, string>;
  sessions!: Table<StudySession, string>;
  segments!: Table<SessionSegment, number>;

  constructor() {
    super("studysheet");
    this.version(1).stores({
      profiles: "id, name, archived",
      subjects: "id, name",
      taskTypes: "id, subjectId, name",
      pauseReasons: "id, label, useCount",
      sessions: "id, profileId, subjectId, startAt, status, [profileId+startAt]",
      segments: "++id, sessionId, kind, [sessionId+kind]",
    });
  }
}

export const db = new StudySheetDB();

/** 首次打开时把字典铺好，避免用户面对空白表单。 */
const DEFAULT_SUBJECTS = [
  "语文",
  "数学",
  "英语",
  "物理",
  "化学",
  "生物",
  "历史",
  "地理",
  "政治",
];

const DEFAULT_TASKS = ["预习", "默写", "刷题", "错题整理", "背诵", "复习", "听课"];

const DEFAULT_PAUSE_REASONS = [
  "喝水",
  "上厕所",
  "接电话",
  "走神",
  "找东西",
  "休息眼睛",
];

const PALETTE = [
  "#6366f1",
  "#f97316",
  "#10b981",
  "#e11d48",
  "#0ea5e9",
  "#a855f7",
  "#eab308",
  "#14b8a6",
  "#f43f5e",
  "#8b5cf6",
];

export const colorAt = (i: number): string => PALETTE[i % PALETTE.length];

export async function seedIfNeeded(): Promise<void> {
  const subjectCount = await db.subjects.count();
  if (subjectCount > 0) return;

  await db.transaction("rw", db.subjects, db.taskTypes, db.pauseReasons, async () => {
    const now = Date.now();
    const subjectIds = new Map<string, string>();

    for (let i = 0; i < DEFAULT_SUBJECTS.length; i += 1) {
      const name = DEFAULT_SUBJECTS[i];
      const subject: Subject = {
        id: crypto.randomUUID(),
        name,
        color: colorAt(i),
        createdAt: now,
      };
      await db.subjects.add(subject);
      subjectIds.set(name, subject.id);
    }

    // 通用事项 subjectId = null，任何科目都能选。
    for (const name of DEFAULT_TASKS) {
      await db.taskTypes.add({
        id: crypto.randomUUID(),
        subjectId: null,
        name,
        createdAt: now,
      });
    }

    // 每个科目再挂一个专属事项，演示「大科目-事项」的层级。
    const perSubject: Record<string, string> = { 语文: "课文默写", 数学: "计算训练" };
    for (const [subjectName, taskName] of Object.entries(perSubject)) {
      const subjectId = subjectIds.get(subjectName);
      if (!subjectId) continue;
      await db.taskTypes.add({
        id: crypto.randomUUID(),
        subjectId,
        name: taskName,
        createdAt: now,
      });
    }

    for (const label of DEFAULT_PAUSE_REASONS) {
      await db.pauseReasons.add({
        id: crypto.randomUUID(),
        label,
        builtin: true,
        useCount: 0,
        createdAt: now,
      });
    }
  });
}
