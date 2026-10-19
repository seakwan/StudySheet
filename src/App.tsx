import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { useTimer } from "./state/timer";
import { ProfileSwitcher } from "./components/ProfileSwitcher";
import { StartPanel } from "./components/StartPanel";
import { TimerCard } from "./components/TimerCard";
import { TodayList } from "./components/TodayList";
import { BackfillPanel } from "./components/BackfillPanel";
import { DictionaryPanel } from "./components/DictionaryPanel";

type Tab = "record" | "settings";

export default function App() {
  const boot = useTimer((s) => s.boot);
  const ready = useTimer((s) => s.ready);
  const profileCount = useLiveQuery(() => db.profiles.filter((p) => !p.archived).count(), []);
  const [tab, setTab] = useState<Tab>("record");

  useEffect(() => {
    void boot();
  }, [boot]);

  if (!ready) {
    return <p className="p-6 text-sm text-slate-400">载入中…</p>;
  }

  return (
    <div className="mx-auto max-w-md px-3 pb-10 pt-4">
      <header className="mb-3 flex items-end justify-between">
        <h1 className="text-lg font-semibold">学习记录</h1>
        <nav className="flex gap-1 text-sm">
          <TabButton active={tab === "record"} onClick={() => setTab("record")}>
            记录
          </TabButton>
          <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
            科目设置
          </TabButton>
        </nav>
      </header>

      {tab === "record" ? (
        <div className="space-y-3">
          <ProfileSwitcher />
          {profileCount === 0 ? (
            <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm">
              先添加一个名字才能开始记录。名字只是共用这台设备时的分组标签，不需要账号密码。
            </p>
          ) : (
            <>
              <TimerCard />
              <StartPanel />
              <BackfillPanel />
              <TodayList />
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <DictionaryPanel />
          <p className="px-1 text-xs leading-relaxed text-slate-400">
            所有数据都存在这台设备的浏览器里。M2 会在这里加「本周」视图（按科目、按事项的时长曲线和暂停原因统计），M3 加周报。
          </p>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "rounded-lg bg-slate-900 px-3 py-1.5 text-white"
          : "rounded-lg px-3 py-1.5 text-slate-500"
      }
    >
      {children}
    </button>
  );
}
