import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import type { Profile } from "../db/types";
import { addProfile, recordCount, renameProfile, setProfileArchived } from "../db/repo";
import { useTimer } from "../state/timer";

/**
 * 共用设备上的身份切换。刻意做成「必须点一下人名」，
 * 不记住上次的身份 —— 否则很容易把 A 的学习记到 B 头上。
 */
export function ProfileSwitcher() {
  const profiles = useLiveQuery(() => db.profiles.filter((p) => !p.archived).toArray(), []);
  const active = useTimer((s) => s.profile);
  const session = useTimer((s) => s.session);
  const selectProfile = useTimer((s) => s.selectProfile);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [manage, setManage] = useState(false);

  if (!profiles) return null;

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const created = await addProfile(trimmed);
    if (!session) selectProfile(created);
    setName("");
    setAdding(false);
  };

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-500">谁在学习</h2>
        <button
          className="text-xs text-slate-400 underline-offset-2 hover:underline"
          onClick={() => setManage((v) => !v)}
        >
          {manage ? "收起管理" : "管理"}
        </button>
      </header>

      <div className="flex flex-wrap gap-2">
        {profiles.map((p) => (
          <Chip
            key={p.id}
            profile={p}
            selected={active?.id === p.id}
            busy={Boolean(session) && active?.id !== p.id}
            onSelect={() => {
              // 计时进行中换人会把这条记到错的人头上，直接拦住。
              if (session && active?.id !== p.id) return;
              selectProfile(p);
            }}
          />
        ))}

        {adding ? (
          <span className="flex items-center gap-1">
            <input
              autoFocus
              value={name}
              placeholder="名字"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-slate-400"
            />
            <button
              onClick={() => void submit()}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white"
            >
              添加
            </button>
          </span>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-500"
          >
            + 新同学
          </button>
        )}
      </div>

      {session && !active && (
        <p className="mt-3 text-xs text-amber-600">
          有一个未结束的计时，先选回它对应的人才能继续。
        </p>
      )}

      {manage && (
        <ProfileManager
          profiles={profiles}
          onRename={async (id, next) => void renameProfile(id, next)}
          onArchive={async (id) => void setProfileArchived(id, true)}
        />
      )}
    </section>
  );
}

function Chip({
  profile,
  selected,
  busy,
  onSelect,
}: {
  profile: Profile;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={
        selected
          ? "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-white shadow"
          : "flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600"
      }
      style={selected ? { backgroundColor: profile.color } : undefined}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: selected ? "#fff" : profile.color }}
      />
      {profile.name}
      {busy && <span className="text-[10px] opacity-60">计时中不可切</span>}
    </button>
  );
}

function ProfileManager({
  profiles,
  onRename,
  onArchive,
}: {
  profiles: Profile[];
  onRename: (id: string, name: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    void Promise.all(profiles.map(async (p) => [p.id, await recordCount(p.id)] as const)).then(
      (pairs) => {
        if (alive) setCounts(Object.fromEntries(pairs));
      },
    );
    return () => {
      alive = false;
    };
  }, [profiles]);

  return (
    <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 pt-2">
      {profiles.map((p) => (
        <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
          <input
            defaultValue={p.name}
            onBlur={(e) => e.target.value !== p.name && void onRename(p.id, e.target.value)}
            className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 hover:border-slate-200 focus:border-slate-300 focus:outline-none"
          />
          <span className="text-xs text-slate-400">{counts[p.id] ?? 0} 条</span>
          <button
            onClick={() => void onArchive(p.id)}
            className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-50 hover:text-red-500"
          >
            归档
          </button>
        </li>
      ))}
      <li className="pt-2 text-[11px] leading-relaxed text-slate-400">
        归档只是从列表隐藏，历史记录全部保留。这台设备上没有账号隔离，任何拿到它的人都能看到全部记录。
      </li>
    </ul>
  );
}
