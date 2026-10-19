import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useTimer } from "../state/timer";

/** 开始面板：选「大科目 → 事项」，可选计划时长。 */
export function StartPanel() {
  const profile = useTimer((s) => s.profile);
  const session = useTimer((s) => s.session);
  const start = useTimer((s) => s.start);

  const subjects = useLiveQuery(() => db.subjects.toArray(), []);
  const taskTypes = useLiveQuery(() => db.taskTypes.toArray(), []);

  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [taskTypeId, setTaskTypeId] = useState<string | null>(null);
  const [planned, setPlanned] = useState<string>("");

  const visibleTasks = useMemo(() => {
    if (!taskTypes) return [];
    return taskTypes.filter((t) => t.subjectId === null || t.subjectId === subjectId);
  }, [taskTypes, subjectId]);

  if (!profile) {
    return (
      <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm">
        先在上方选择或添加一个名字，再开始记录。
      </p>
    );
  }

  if (session) return null;

  const canStart = Boolean(subjectId && taskTypeId);

  const submit = async () => {
    if (!canStart || !subjectId) return;
    await start({
      subjectId,
      taskTypeId,
      plannedMinutes: planned ? Number(planned) : null,
    });
    setPlanned("");
  };

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-500">
        开始记录 · <span style={{ color: profile.color }}>{profile.name}</span>
      </h2>

      <div className="mb-3 flex flex-wrap gap-2">
        {(subjects ?? []).map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setSubjectId(s.id);
              setTaskTypeId(null);
            }}
            className={
              subjectId === s.id
                ? "rounded-lg px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
            }
            style={subjectId === s.id ? { backgroundColor: s.color } : undefined}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {visibleTasks.map((t) => (
          <button
            key={t.id}
            disabled={!subjectId}
            onClick={() => setTaskTypeId(t.id)}
            className={
              taskTypeId === t.id
                ? "rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                : "rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 disabled:opacity-40"
            }
          >
            {t.name}
          </button>
        ))}
        {!subjectId && (
          <span className="self-center text-xs text-slate-400">先选上面的大科目</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-500">
          计划
          <input
            type="number"
            min={0}
            step={5}
            value={planned}
            onChange={(e) => setPlanned(e.target.value)}
            placeholder="30"
            className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-slate-400"
          />
          分钟
        </label>
        <button
          onClick={() => void submit()}
          disabled={!canStart}
          className="ml-auto rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400"
        >
          开始学习
        </button>
      </div>
    </section>
  );
}
