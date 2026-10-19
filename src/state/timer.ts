import { create } from "zustand";
import { db } from "../db";
import type { PauseReason, Profile, SessionSegment, StudySession } from "../db/types";
import { breaksCount, gapsMs, netMs } from "../lib/time";

/**
 * 计时器状态机。两个刻意的设计：
 * 1) 不靠 setInterval 累加。只存时间戳，每次渲染用 Date.now() 反算，
 *    所以切后台 / 锁屏多久都不会丢时间，回前台校时也不需要特殊处理。
 * 2) 每个动作立刻落 IndexedDB，页面被系统回收后 boot() 能原样恢复。
 */

export type PauseChoice = { reasonId: string } | { newLabel: string };

interface TimerStore {
  ready: boolean;
  profile: Profile | null;
  session: StudySession | null;
  segments: SessionSegment[];

  boot: () => Promise<void>;
  selectProfile: (profile: Profile | null) => void;

  start: (input: {
    subjectId: string;
    taskTypeId: string | null;
    plannedMinutes: number | null;
  }) => Promise<void>;
  pause: (choice: PauseChoice) => Promise<void>;
  resume: () => Promise<void>;
  finish: (note: string) => Promise<StudySession | null>;
  discard: () => Promise<void>;
}

const openOf = (segments: SessionSegment[]): SessionSegment | undefined =>
  segments.find((s) => s.endAt === null);

export const useTimer = create<TimerStore>((set, get) => {
  /** 关掉当前开放段并返回新数组，DB 与内存同步推进。 */
  const closeOpen = async (segment: SessionSegment, now: number): Promise<SessionSegment[]> => {
    await db.segments.update(segment.id as number, { endAt: now });
    return get().segments.map((s) => (s.id === segment.id ? { ...s, endAt: now } : s));
  };

  const append = async (segment: Omit<SessionSegment, "id">): Promise<SessionSegment[]> => {
    const id = await db.segments.add(segment);
    return [...get().segments, { ...segment, id }];
  };

  return {
    ready: false,
    profile: null,
    session: null,
    segments: [],

    boot: async () => {
      const session = await db.sessions.where("status").anyOf("running", "paused").first();
      if (!session) {
        // 导入替换全库后，原先选中的人可能已经不存在了。留着它会把新记录
        // 记到一个查无此人的 id 上，所以重新校验一次。
        const selected = get().profile;
        const stillThere = selected ? await db.profiles.get(selected.id) : undefined;
        set({
          ready: true,
          session: null,
          segments: [],
          profile: stillThere && !stillThere.archived ? selected : null,
        });
        return;
      }
      const [segments, profile] = await Promise.all([
        db.segments.where("sessionId").equals(session.id).sortBy("startAt"),
        db.profiles.get(session.profileId),
      ]);
      set({ ready: true, session, segments, profile: profile ?? null });
    },

    selectProfile: (profile) => set({ profile }),

    start: async (input) => {
      const { profile } = get();
      if (!profile || get().session) return;
      const now = Date.now();
      const session: StudySession = {
        id: crypto.randomUUID(),
        profileId: profile.id,
        subjectId: input.subjectId,
        taskTypeId: input.taskTypeId,
        startAt: now,
        endAt: null,
        status: "running",
        plannedMinutes: input.plannedMinutes,
        note: "",
        source: "timer",
        netMs: 0,
        gapsMs: 0,
        breaksCount: 0,
      };

      await db.sessions.add(session);
      const segments = await append({
        sessionId: session.id,
        kind: "work",
        startAt: now,
        endAt: null,
        pauseReasonId: null,
      });
      set({ session, segments });
    },

    pause: async (choice) => {
      const { session } = get();
      const open = openOf(get().segments);
      if (!session || session.status !== "running" || !open) return;
      const now = Date.now();

      let reasonId: string;
      if ("reasonId" in choice) {
        reasonId = choice.reasonId;
        await db.pauseReasons.where("id").equals(reasonId).modify((r) => {
          r.useCount += 1;
        });
      } else {
        // 自定义原因要存进字典，下次直接点，这是高频项复用的关键。
        const created: PauseReason = {
          id: crypto.randomUUID(),
          label: choice.newLabel.trim(),
          builtin: false,
          useCount: 1,
          createdAt: now,
        };
        await db.pauseReasons.add(created);
        reasonId = created.id;
      }

      const closed = await closeOpen(open, now);
      set({ segments: closed });
      const segments = await append({
        sessionId: session.id,
        kind: "break",
        startAt: now,
        endAt: null,
        pauseReasonId: reasonId,
      });

      const next: StudySession = { ...session, status: "paused" };
      await db.sessions.put(next);
      set({ session: next, segments });
    },

    resume: async () => {
      const { session } = get();
      const open = openOf(get().segments);
      if (!session || session.status !== "paused" || !open) return;
      const now = Date.now();

      const closed = await closeOpen(open, now);
      set({ segments: closed });
      const segments = await append({
        sessionId: session.id,
        kind: "work",
        startAt: now,
        endAt: null,
        pauseReasonId: null,
      });

      const next: StudySession = { ...session, status: "running" };
      await db.sessions.put(next);
      set({ session: next, segments });
    },

    finish: async (note) => {
      const { session } = get();
      if (!session) return null;
      const now = Date.now();
      const open = openOf(get().segments);
      const segments = open
        ? await closeOpen(open, now)
        : get().segments;
      if (open) set({ segments });

      // 结束时冻结结果指标，之后读列表不必再重算分段。
      const next: StudySession = {
        ...session,
        status: "done",
        endAt: now,
        note,
        netMs: netMs(segments, now),
        gapsMs: gapsMs(segments, now),
        breaksCount: breaksCount(segments),
      };
      await db.sessions.put(next);
      set({ session: null, segments: [] });
      return next;
    },

    discard: async () => {
      const { session } = get();
      if (!session) return;
      await db.transaction("rw", db.sessions, db.segments, async () => {
        await db.segments.where("sessionId").equals(session.id).delete();
        await db.sessions.delete(session.id);
      });
      set({ session: null, segments: [] });
    },
  };
});
