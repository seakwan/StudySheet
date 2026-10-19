import { useLiveQuery } from "dexie-react-hooks";
import { colorAt, db } from "../db";
import type { Subject, TaskType } from "../db/types";

/** 科目 / 事项字典维护。默认铺的是通用课表，实际每个人都不一样，必须能改。 */
export function DictionaryPanel() {
  const subjects = useLiveQuery(() => db.subjects.toArray(), []);
  const tasks = useLiveQuery(() => db.taskTypes.toArray(), []);

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-500">科目与事项</h2>

      <AddRow
        placeholder="新大科目，如 道德与法治"
        onAdd={async (name) => {
          const count = (subjects ?? []).length;
          const subject: Subject = {
            id: crypto.randomUUID(),
            name,
            color: colorAt(count),
            createdAt: Date.now(),
          };
          await db.subjects.add(subject);
        }}
      />

      <ul className="mt-3 space-y-1">
        {(subjects ?? []).map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-slate-50">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
            <input
              defaultValue={s.name}
              onBlur={(e) => e.target.value !== s.name && void db.subjects.update(s.id, { name: e.target.value.trim() })}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            <span className="shrink-0 text-[11px] text-slate-400">
              {(tasks ?? []).filter((t) => t.subjectId === s.id).length} 项
            </span>
            <Remove
              table={db.subjects}
              id={s.id}
              hint="该科目下专属事项一并删除；已有学习记录不受影响，但会变成无科目。建议只改名不删除。"
              extra={async () => {
                await db.taskTypes.where("subjectId").equals(s.id).delete();
              }}
            />
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="mb-2 text-xs text-slate-400">
          事项：留空科目 = 通用事项（所有科目可选），选定科目 = 该科专属
        </p>
        <AddRow
          placeholder="新事项，如 阅读理解"
          withSubject
          subjects={subjects ?? []}
          onAdd={async (name, subjectId) => {
            const task: TaskType = {
              id: crypto.randomUUID(),
              subjectId,
              name,
              createdAt: Date.now(),
            };
            await db.taskTypes.add(task);
          }}
        />
        <ul className="mt-2 space-y-1">
          {(tasks ?? []).map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-slate-50">
              <input
                defaultValue={t.name}
                onBlur={(e) => e.target.value !== t.name && void db.taskTypes.update(t.id, { name: e.target.value.trim() })}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
              <span className="shrink-0 text-[11px] text-slate-400">
                {t.subjectId ? subjects?.find((s) => s.id === t.subjectId)?.name ?? "?" : "通用"}
              </span>
              <Remove table={db.taskTypes} id={t.id} hint="删除该事项？已有记录不受影响。" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function AddRow({
  placeholder,
  onAdd,
  withSubject,
  subjects = [],
}: {
  placeholder: string;
  onAdd: (name: string, subjectId: string | null) => Promise<void>;
  withSubject?: boolean;
  subjects?: Subject[];
}) {
  const submit = async (value: string, subjectId: string | null) => {
    const name = value.trim();
    if (!name) return;
    await onAdd(name, subjectId);
  };

  return (
    <form
      onSubmit={(e) => {
        const form = e.currentTarget;
        const name = (form.elements.namedItem("name") as HTMLInputElement).value;
        const subject = (form.elements.namedItem("subject") as HTMLSelectElement | null)?.value;
        void submit(name, withSubject ? subject || null : null);
        form.reset();
        e.preventDefault();
      }}
      className="flex gap-2"
    >
      <input
        name="name"
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-slate-400"
      />
      {withSubject && (
        <select
          name="subject"
          className="w-24 shrink-0 rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-500"
        >
          <option value="">通用</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <button className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white">加</button>
    </form>
  );
}

function Remove({
  table,
  id,
  hint,
  extra,
}: {
  table: { delete: (id: string) => Promise<unknown> };
  id: string;
  hint: string;
  extra?: () => Promise<void>;
}) {
  return (
    <button
      onClick={async () => {
        if (!confirm(hint)) return;
        if (extra) await extra();
        await table.delete(id);
      }}
      className="shrink-0 px-1 text-slate-300 hover:text-red-500"
      title="删除"
    >
      ×
    </button>
  );
}
