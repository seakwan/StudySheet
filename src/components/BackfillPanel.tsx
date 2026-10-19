import { useState } from "react";
import dayjs from "dayjs";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { backfillSession } from "../db/repo";
import { useTimer } from "../state/timer";

/**
 * 忘了点开始是这类工具最高频的失败，所以补录必须和计时器同等顺手。
 * 时长由起止时间算出，不让人直接填分钟数 —— 少一个可以填错的地方。
 */
export function BackfillPanel() {
  const profile = useTimer((s) => s.profile);
  const [open, setOpen] = useState(false);
  const [subjectId, setSubjectId] = useState("");
  const [taskTypeId, setTaskTypeId] = useState<string | null>(null);
  const [start, setStart] = useState(() => dayjs().subtract(1, "hour").format("YYYY-MM-DDTHH:mm"));
  const [end, setEnd] = useState(() => dayjs().format("YYYY-MM-DDTHH:mm"));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const subjects = useLiveQuery(() => db.subjects.toArray(), []);
  const tasks = useLiveQuery(() => db.taskTypes.toArray(), []);
  const visibleTasks = (tasks ?? []).filter(
    (t) => t.subjectId === null || t.subjectId === subjectId,
  );

  if (!profile) return null;

  const startMs = dayjs(start).valueOf();
  const endMs = dayjs(end).valueOf();
  const spanMin = Math.round((endMs - startMs) / 60_000);

  const submit = async () => {
    if (!subjectId) return setError("选一个大科目");
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return setError("时间格式不对");
    if (endMs <= startMs) return setError("结束时间要晚于开始时间");
    if (spanMin > 12 * 60) return setError("单次不超过 12 小时，请拆成几条");

    await backfillSession({
      profileId: profile.id,
      subjectId,
      taskTypeId,
      startAt: startMs,
      endAt: endMs,
      note,
    });
    setNote("");
    setError("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-dashed border-slate-300 bg-white/60 py-2.5 text-sm text-slate-500"
      >
        补录一条（刚才忘了开始计时）
      </button>
    );
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-500">补录 · {profile.name}</h2>

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
                ? "rounded-lg px-3 py-1.5 text-sm text-white"
                : "rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
            }
            style={subjectId === s.id ? { backgroundColor: s.color } : undefined}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {subjectId &&
          visibleTasks.map((t) => (
            <button
              key={t.id}
              onClick={() => setTaskTypeId(t.id)}
              className={
                taskTypeId === t.id
                  ? "rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white"
                  : "rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
              }
            >
              {t.name}
            </button>
          ))}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <label className="text-xs text-slate-500">
          开始
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none"
          />
        </label>
        <label className="text-xs text-slate-500">
          结束
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none"
          />
        </label>
      </div>

      <p className="mb-2 text-xs text-slate-400">
        时长 {spanMin > 0 ? `${spanMin} 分钟` : "—"}
        （补录不含暂停明细，周报里可信度低于计时记录）
      </p>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="备注（可选）"
        className="mb-3 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none"
      />

      {error && <p className="mb-2 text-xs text-red-500">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => void submit()}
          className="flex-1 rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white"
        >
          保存
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600"
        >
          取消
        </button>
      </div>
    </section>
  );
}
