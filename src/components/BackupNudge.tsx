import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { nudgeSnoozed, readMark, snoozeNudge } from "../lib/sync";

/**
 * 记录页顶部的备份提醒。
 *
 * 只报「从来没导出过」这一种情况：那是唯一会让数据全丢、而用户至今没做任何防护
 * 的路径。「又记了几条」这类提醒天天看会被无视，留在设置页里就够了。
 */
export function BackupNudge({ onGoSettings }: { onGoSettings: () => void }) {
  const [snoozed, setSnoozed] = useState(() => nudgeSnoozed(Date.now()));
  const sessions = useLiveQuery(() => db.sessions.count(), []);

  if (snoozed || !sessions || readMark()) return null;

  return (
    <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-3 py-2.5">
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-red-700">
        已有 {sessions} 条记录，但从来没导出过备份。
      </p>
      <button onClick={onGoSettings} className="shrink-0 rounded-lg bg-red-600 px-2.5 py-1 text-xs text-white">
        去备份
      </button>
      <button
        onClick={() => {
          snoozeNudge();
          setSnoozed(true);
        }}
        className="shrink-0 px-1 text-sm text-red-300"
        title="三天内不再提示"
      >
        ×
      </button>
    </div>
  );
}
