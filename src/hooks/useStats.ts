import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import type { Profile, SessionSegment, StudySession } from "../db/types";
import {
  aggregate,
  prevRangeAligned,
  ratioChange,
  resolveWindow,
  windowOf,
  type RangeMode,
  type Stats,
} from "../lib/stats";

export type Scope = { kind: "all" } | { kind: "one"; profileId: string } | { kind: "compare" };

/** 一次查询把统计需要的原始数据全取回，图表和环比共用同一份结果。 */
export function useStats(mode: RangeMode, scope: Scope, anchor: number) {
  return useLiveQuery(async () => {
    const [allSessions, profiles, subjects, tasks, reasons] = await Promise.all([
      db.sessions.toArray(),
      db.profiles.toArray(),
      db.subjects.toArray(),
      db.taskTypes.toArray(),
      db.pauseReasons.toArray(),
    ]);

    const visibleIds =
      scope.kind === "one" ? new Set([scope.profileId]) : new Set(profiles.map((p) => p.id));
    const scoped = allSessions.filter((s) => visibleIds.has(s.profileId));

    const segmentsBySession = await loadSegments(scoped);
    const now = Date.now();
    const { range, days } = resolveWindow(mode, anchor, scoped);

    const current = aggregate({
      sessions: scoped,
      segmentsBySession,
      range,
      days,
      now,
      subjects,
      tasks,
      reasons,
      profiles,
    });

    const prev = prevRangeAligned(mode, anchor);
    const previous: Stats | null = prev
      ? aggregate({
          sessions: scoped,
          segmentsBySession,
          ...windowOf(prev),
          now,
          subjects,
          tasks,
          reasons,
          profiles,
        })
      : null;

    return {
      current,
      previous,
      change: previous ? ratioChange(current.totalMinutes, previous.totalMinutes) : null,
      profiles,
    };
  }, [mode, anchor, scope.kind, scope.kind === "one" ? scope.profileId : null]) as
    | {
        current: Stats;
        previous: Stats | null;
        change: number | null;
        profiles: Profile[];
      }
    | undefined;
}

const loadSegments = async (sessions: StudySession[]): Promise<Map<string, SessionSegment[]>> => {
  if (sessions.length === 0) return new Map();
  const ids = sessions.map((s) => s.id);
  const all = await db.segments.where("sessionId").anyOf(ids).toArray();
  const map = new Map<string, SessionSegment[]>();
  for (const seg of all) {
    const list = map.get(seg.sessionId) ?? [];
    list.push(seg);
    map.set(seg.sessionId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.startAt - b.startAt);
  return map;
};
