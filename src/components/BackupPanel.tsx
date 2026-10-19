import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import {
  buildBackup,
  buildCsv,
  describeBackup,
  exportFilename,
  parseBackup,
  serializeBackup,
  type Backup,
} from "../lib/export";
import { importBackup, previewImport, type ImportMode, type ImportResult } from "../lib/merge";
import { useTimer } from "../state/timer";

interface Pending {
  backup: Backup;
  merge: string;
  replace: string;
  summary: string;
}

/** 备份与导出。数据只在本机浏览器里，不换出去就等于没有。 */
export function BackupPanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const boot = useTimer((s) => s.boot);

  const counts = useLiveQuery(async () => ({ sessions: await db.sessions.count(), profiles: await db.profiles.count() }), []);

  const download = async (kind: "csv" | "json") => {
    setBusy(true);
    setMessage(null);
    try {
      const [profiles, subjects, taskTypes, pauseReasons, sessions, segments] = await Promise.all([
        db.profiles.toArray(),
        db.subjects.toArray(),
        db.taskTypes.toArray(),
        db.pauseReasons.toArray(),
        db.sessions.toArray(),
        db.segments.toArray(),
      ]);
      const data = { profiles, subjects, taskTypes, pauseReasons, sessions, segments, now: Date.now() };
      const text = kind === "csv" ? buildCsv(data) : serializeBackup(buildBackup(data));
      saveBlob(
        new Blob([text], {
          type: kind === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
        }),
        exportFilename(kind),
      );
      setMessage(`已生成 ${exportFilename(kind)}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };

  const onPicked = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    try {
      const backup = parseBackup(await file.text());
      setPending({
        backup,
        merge: await previewImport(backup, "merge"),
        replace: await previewImport(backup, "replace"),
        summary: describeBackup(backup),
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "读取文件失败");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const run = async (mode: ImportMode) => {
    if (!pending) return;
    setBusy(true);
    try {
      const res: ImportResult = await importBackup(pending.backup, mode);
      // 替换导入可能把正在计时的会话换掉，store 必须重新对齐
      await boot();
      setPending(null);
      setMessage(
        `已导入：新增 ${res.added} 条` +
          (res.skipped ? `，跳过重复 ${res.skipped} 条` : "") +
          (res.settled ? `，收尾 ${res.settled} 条未结束的计时` : "") +
          (res.mergedDicts ? `，${res.mergedDicts} 个同名科目/事项已合并` : ""),
      );
    } catch (e) {
      setPending(null);
      setMessage(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-slate-500">备份与导出</h2>
      <p className="mb-3 text-xs leading-relaxed text-slate-400">
        {counts ? `本机现有 ${counts.sessions} 条记录 / ${counts.profiles} 人。` : "统计中…"}
        数据只存在这台设备的浏览器里，清缓存或换设备前请先导出。
      </p>

      <div className="flex gap-2">
        <button
          onClick={() => void download("csv")}
          disabled={busy}
          className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 disabled:opacity-50"
        >
          导出 CSV
        </button>
        <button
          onClick={() => void download("json")}
          disabled={busy}
          className="flex-1 rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          导出备份
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">CSV 给 Excel / Numbers 看；备份 JSON 能原样导回，换设备用它。</p>

      {!pending ? (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="mt-4 w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-sm text-slate-500 disabled:opacity-50"
        >
          从备份文件导入
        </button>
      ) : (
        <div className="mt-4 rounded-xl bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-600">{pending.summary}</p>
          <div className="mt-2.5 space-y-2">
            <button
              onClick={() => void run("merge")}
              disabled={busy}
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-left text-sm text-white disabled:opacity-50"
            >
              合并导入
              <span className="mt-0.5 block text-[11px] font-normal text-slate-300">{pending.merge}</span>
            </button>
            <button
              onClick={() => void run("replace")}
              disabled={busy}
              className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-left text-sm text-red-600 disabled:opacity-50"
            >
              整库替换
              <span className="mt-0.5 block text-[11px] font-normal text-slate-400">{pending.replace}</span>
            </button>
            <button onClick={() => setPending(null)} className="w-full py-1 text-xs text-slate-400">
              取消
            </button>
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void onPicked(e.target.files?.[0])} />

      {message && <p className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-600">{message}</p>}
    </section>
  );
}

/**
 * 用 <a download> 而不是 window.open：手机上后者经常被拦，而且用户看不到文件名。
 */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻 revoke 会让部分浏览器来不及取数据
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
