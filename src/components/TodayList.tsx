import dayjs from "dayjs";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import type { StudySession } from "../db/types";
import { deleteSession } from "../db/repo";
import { dayKey, formatDuration } from "../lib/time";
import { useTimer } from "../state/timer";

/** 今日流水。计时中和补录的记录混排，按开始时间倒序。 */
export function TodayList() {
  const profile = useTimer((s) => s.profile);
  const sessions = useLiveQuery(async () => {
    if (!profile) return [];
    const all = await db.sessions.where("profileId").equals(profile.id).toArray();
    return all
      .filter((s) => dayKey(s.startAt) === dayKey(Date.now()))
      .sort((a, b) => b.startAt - a.startAt);
  }, [profile?.id]);

  const subjects = useLiveQuery(() => db.subjects.toArray(), []);
  const tasks = useLiveQuery(() => db.taskTypes.toArray(), []);

  if (!profile) return null;

  const total = (sessions ?? [])
    .filter((s) => s.status === "done")
    .reduce((sum, s) => sum + s.netMs, 0);

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-500">今日记录</h2>
        <span className="text-xs text-slate-400">
          净学习 {formatDuration(total)} · {(sessions ?? []).length} 条
        </span>
      </header>

      {!sessions || sessions.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">今天还没有记录</p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {sessions.map((s) => (
            <Row
              key={s.id}
              session={s}
              subjectName={subjects?.find((x) => x.id === s.subjectId)?.name ?? "?"}
              color={subjects?.find((x) => x.id === s.subjectId)?.color ?? "#94a3b8"}
              taskName={tasks?.find((x) => x.id === s.taskTypeId)?.name}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({
  session,
  subjectName,
  color,
  taskName,
}: {
  session: StudySession;
  subjectName: string;
  color: string;
  taskName?: string;
}) {
  const live = session.status === "running" || session.status === "paused";

  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          <span className="font-medium">{subjectName}</span>
          {taskName && <span className="text-slate-500"> · {taskName}</span>}
          {session.source === "backfill" && (
            <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] text-slate-500">补录</span>
          )}
        </p>
        <p className="text-[11px] text-slate-400">
          {dayjs(session.startAt).format("HH:mm")}
          {session.endAt ? ` → ${dayjs(session.endAt).format("HH:mm")}` : " 进行中"}
          {session.breaksCount > 0 && ` · 暂停 ${session.breaksCount} 次`}
          {session.note && ` · ${session.note}`}
        </p>
      </div>
      <span className="clock shrink-0 text-sm text-slate-600">
        {live ? "—" : formatDuration(session.netMs)}
      </span>
      {!live && (
        <button
          onClick={() => confirm("删除这条记录？") && void deleteSession(session.id)}
          className="shrink-0 px-1 text-slate-300 hover:text-red-500"
          title="删除"
        >
          ×
        </button>
      )}
    </li>
  );
}
