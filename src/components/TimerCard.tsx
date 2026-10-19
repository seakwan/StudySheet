import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import type { SessionSegment } from "../db/types";
import { useNow } from "../hooks/useNow";
import { formatClock, formatDuration, gapsMs, minutesOf, netMs } from "../lib/time";
import { useTimer } from "../state/timer";

/** 暂停原因做成预设 chips + 一个自定义输入，新增的会进字典并按使用次数前置。 */
export function TimerCard() {
  const session = useTimer((s) => s.session);
  const segments = useTimer((s) => s.segments);
  const profile = useTimer((s) => s.profile);
  const now = useNow();
  const subject = useLiveQuery(
    () => (session ? db.subjects.get(session.subjectId) : undefined),
    [session?.subjectId],
  );
  const task = useLiveQuery(
    () => (session?.taskTypeId ? db.taskTypes.get(session.taskTypeId) : undefined),
    [session?.taskTypeId],
  );

  if (!session) return null;

  const net = netMs(segments, now);
  const gaps = gapsMs(segments, now);
  const paused = session.status === "paused";

  return (
    <section
      className="rounded-2xl bg-white p-4 shadow-sm"
      style={{ borderTop: `3px solid ${subject?.color ?? "#94a3b8"}` }}
    >
      <header className="flex items-baseline justify-between">
        <div className="text-sm">
          <span style={{ color: profile?.color }}>{profile?.name}</span>
          <span className="mx-1.5 text-slate-300">/</span>
          <span className="font-medium">{subject?.name ?? "—"}</span>
          <span className="mx-1.5 text-slate-300">·</span>
          <span className="text-slate-500">{task?.name ?? "—"}</span>
        </div>
        <span className="text-xs text-slate-400">{paused ? "已暂停" : "进行中"}</span>
      </header>

      <div className="my-3 text-center">
        <div className={`clock text-5xl font-semibold ${paused ? "text-slate-300" : "text-slate-900"}`}>
          {formatClock(net)}
        </div>
        <div className="mt-1 text-xs text-slate-400">
          暂停累计 {formatDuration(gaps)} · {segments.filter((s) => s.kind === "break").length} 次
          {session.plannedMinutes
            ? ` · 计划 ${session.plannedMinutes} 分钟（已达成 ${Math.min(
                100,
                Math.round((minutesOf(net) / session.plannedMinutes) * 100),
              )}%）`
            : ""}
        </div>
      </div>

      <SegmentRail segments={segments} now={now} />

      <ActionBar paused={paused} />
    </section>
  );
}

/**
 * 分段轨道。一眼看出这段学习被打断在哪里、第几分钟开始走神，
 * 这是把 event stream 存下来的意义，压缩成一个 pauseMs 就看不到了。
 */
function SegmentRail({ segments, now }: { segments: SessionSegment[]; now: number }) {
  const reasons = useLiveQuery(() => db.pauseReasons.toArray(), []);
  if (segments.length === 0) return null;
  const total = Math.max(1, now - segments[0].startAt);

  return (
    <div className="mb-4">
      <div className="flex h-2 overflow-hidden rounded-full">
        {segments.map((s) => (
          <div
            key={s.id}
            title={`${s.kind === "work" ? "学习" : "暂停"} ${formatDuration(
              Math.max(0, (s.endAt ?? now) - s.startAt),
            )}`}
            style={{
              width: `${(Math.max(0, (s.endAt ?? now) - s.startAt) / total) * 100}%`,
              backgroundColor: s.kind === "work" ? "#10b981" : "#f59e0b",
            }}
          />
        ))}
      </div>
      <ul className="mt-2 space-y-0.5 text-[11px] text-slate-400">
        {segments
          .filter((s) => s.kind === "break")
          .map((s) => (
            <li key={s.id}>
              第 {minutesOf(s.startAt - segments[0].startAt)} 分钟暂停 ·{" "}
              {reasons?.find((r) => r.id === s.pauseReasonId)?.label ?? "未填原因"}
              {s.endAt ? ` → 停 ${formatDuration(s.endAt - s.startAt)}` : "（暂停中）"}
            </li>
          ))}
      </ul>
    </div>
  );
}

/**
 * 运行中和暂停中都能直接结束 —— 否则「学完了」还要多点一次暂停，
 * 是这套流程里最容易让人放弃记录的地方。
 */
function ActionBar({ paused }: { paused: boolean }) {
  const resume = useTimer((s) => s.resume);
  const [pickingReason, setPickingReason] = useState(false);
  const [ending, setEnding] = useState(false);

  if (ending) return <EndDialog onBack={() => setEnding(false)} />;

  return (
    <div className="space-y-2">
      {pickingReason ? (
        <PauseReasonPicker onDone={() => setPickingReason(false)} />
      ) : (
        <div className="flex gap-2">
          {paused ? (
            <button
              onClick={() => void resume()}
              className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white"
            >
              继续学习
            </button>
          ) : (
            <button
              onClick={() => setPickingReason(true)}
              className="flex-1 rounded-xl border border-amber-200 bg-amber-50 py-2.5 text-sm font-semibold text-amber-700"
            >
              暂停
            </button>
          )}
          <button
            onClick={() => setEnding(true)}
            className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm text-slate-600"
          >
            结束
          </button>
        </div>
      )}
    </div>
  );
}

function PauseReasonPicker({ onDone }: { onDone: () => void }) {
  const pause = useTimer((s) => s.pause);
  const [custom, setCustom] = useState("");
  // 用过的原因排前面，高频项基本不用打字。
  const reasons = useLiveQuery(
    () => db.pauseReasons.orderBy("useCount").reverse().toArray(),
    [],
  );

  const pick = async (choice: Parameters<typeof pause>[0]) => {
    await pause(choice);
    onDone();
  };

  return (
    <div className="rounded-xl bg-amber-50/60 p-3">
      <p className="mb-2 text-xs font-medium text-amber-700">为什么暂停？</p>
      <div className="flex flex-wrap gap-2">
        {(reasons ?? []).slice(0, 8).map((r) => (
          <button
            key={r.id}
            onClick={() => void pick({ reasonId: r.id })}
            className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-sm text-slate-600"
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && custom.trim() && void pick({ newLabel: custom })}
          placeholder="其他原因，回车确认"
          className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-sm outline-none"
        />
        <button
          disabled={!custom.trim()}
          onClick={() => void pick({ newLabel: custom })}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          确定
        </button>
      </div>
      <button onClick={onDone} className="mt-2 text-xs text-slate-400">
        取消，继续学习
      </button>
    </div>
  );
}

function EndDialog({ onBack }: { onBack: () => void }) {
  const finish = useTimer((s) => s.finish);
  const discard = useTimer((s) => s.discard);
  const [note, setNote] = useState("");

  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <textarea
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="备注：今天状态怎样、卡在哪（可留空）"
        className="w-full resize-none rounded-lg border border-slate-200 p-2 text-sm outline-none focus:border-slate-400"
      />
      <div className="mt-2 flex gap-2">
        <button
          onClick={async () => {
            await finish(note);
          }}
          className="flex-1 rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white"
        >
          保存并结束
        </button>
        <button
          onClick={onBack}
          className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600"
        >
          返回
        </button>
        <button
          onClick={async () => {
            if (confirm("这条记录整条丢弃，不保存？")) await discard();
          }}
          className="rounded-xl px-3 py-2.5 text-sm text-red-500"
        >
          丢弃
        </button>
      </div>
    </div>
  );
}
