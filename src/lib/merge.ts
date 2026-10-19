import { db } from "../db";
import type { Backup, ExportTables } from "./export";
import { breaksCount, gapsMs, netMs } from "./time";
import type {
  PauseReason,
  Profile,
  SessionSegment,
  StudySession,
  Subject,
  TaskType,
} from "../db/types";

/**
 * 导入。备份文件来自别的设备甚至别的程序，属于系统边界：
 * 两种模式都必须先看后写，任何一步失败都在事务里回滚，
 * 不能出现「清了库但没写进去」这种丢数据的情况。
 */

export type ImportMode = "merge" | "replace";

export interface ImportResult {
  added: number;
  skipped: number;
  segments: number;
  /** 备份里带着未结束的计时，导入时被收尾的条数 */
  settled: number;
  /** 按名字并进本机、没有新增的字典项条数 */
  mergedDicts: number;
}

/**
 * 自增段 id 不能跨设备复用：本机的 12 号段和备份里的 12 号段是两条不同的东西。
 * 去掉 id 让 Dexie 重新分配，段与记录的关联靠 sessionId，不受影响。
 */
const stripId = (seg: SessionSegment): SessionSegment => {
  const { id: _id, ...rest } = seg;
  return rest as SessionSegment;
};

/** 备份里未结束的记录 —— 收尾数只该按「真的写进去的那些」算。 */
const isOpen = (s: StudySession): boolean => s.status === "running" || s.status === "paused";

interface DictMerge<T> {
  /** 备份 id → 本机 id，写记录前照着改引用 */
  remap: Map<string, string>;
  toAdd: T[];
  merged: number;
}

/**
 * 备份里可能带着一个「进行中」的计时。换到另一台设备导入时 boot() 会把它捡起来，
 * 从 startAt 一路数到现在 —— 三天前导出的备份能凭空变出 70 小时学习时长。
 * 所以导入时按导出的那一刻收尾：开放段截到 exportedAt，会话置为已完成。
 */
export function settleOpen(backup: Backup): { tables: ExportTables; settled: number } {
  const t = backup.tables;
  if (!t.sessions.some(isOpen)) return { tables: t, settled: 0 };

  const cutoff = backup.exportedAt > 0 ? backup.exportedAt : Date.now();
  const segments = t.segments.map((seg) =>
    seg.endAt === null ? { ...seg, endAt: Math.max(seg.startAt, cutoff) } : seg,
  );
  const sessions = t.sessions.map((s): StudySession => {
    if (!isOpen(s)) return s;
    const own = segments.filter((x) => x.sessionId === s.id);
    return {
      ...s,
      status: "done",
      endAt: Math.max(s.startAt, cutoff),
      netMs: netMs(own, cutoff),
      gapsMs: gapsMs(own, cutoff),
      breaksCount: breaksCount(own),
    };
  });

  return {
    tables: { ...t, sessions, segments },
    settled: t.sessions.filter(isOpen).length,
  };
}

/**
 * 字典按名字合并，不按 id。
 *
 * 新设备一打开就自动铺了一套默认科目，备份里也有一套同名的 —— 只按 id 认会变成
 * 两个「语文」，图表和周报把同一门课拆成两半，用户看不出原因。名字是这个工具里
 * 字典唯一的身份（没有别的区分字段），所以同名即同一项。
 *
 * 代价说清楚：两台设备上真不同的「物理」会被并成一条。这能靠改名补救，
 * 而重复科目不会提示你，只会让数字悄悄变难看。
 */
function mergeDict<T>(
  local: T[],
  incoming: T[],
  idOf: (row: T) => string,
  nameOf: (row: T) => string,
): DictMerge<T> {
  const localIds = new Set(local.map(idOf));
  const idByName = new Map<string, string>();
  for (const row of local) {
    const name = nameOf(row).trim();
    if (!idByName.has(name)) idByName.set(name, idOf(row));
  }

  const remap = new Map<string, string>();
  const toAdd: T[] = [];
  let merged = 0;
  for (const row of incoming) {
    const id = idOf(row);
    if (localIds.has(id)) {
      remap.set(id, id); // 本来就是同一条，不用动
      continue;
    }
    const hit = idByName.get(nameOf(row).trim());
    if (hit) {
      remap.set(id, hit);
      merged += 1;
      continue;
    }
    remap.set(id, id);
    toAdd.push(row);
  }
  return { remap, toAdd, merged };
}

const follow = (map: Map<string, string>, id: string | null): string | null =>
  id === null ? null : map.get(id) ?? id;

/** 把四张字典并到本机，返回各表的 id 映射。 */
async function mergeDictionaries(t: ExportTables): Promise<{
  profiles: Map<string, string>;
  subjects: Map<string, string>;
  taskTypes: Map<string, string>;
  pauseReasons: Map<string, string>;
  merged: number;
}> {
  const [localProfiles, localSubjects, localTasks, localReasons] = await Promise.all([
    db.profiles.toArray(),
    db.subjects.toArray(),
    db.taskTypes.toArray(),
    db.pauseReasons.toArray(),
  ]);

  const subjects = mergeDict<Subject>(localSubjects, t.subjects, (r) => r.id, (r) => r.name);

  // 事项要先挂到合并后的科目上，再按「科目 + 事项名」去重，
  // 否则两个不同科目下的同名事项会被错并成一条。
  const tasksIn = t.taskTypes.map((x): TaskType => ({ ...x, subjectId: follow(subjects.remap, x.subjectId) }));
  const tasks = mergeDict<TaskType>(
    localTasks,
    tasksIn,
    (r) => r.id,
    (r) => `${r.subjectId ?? "*"}\u0000${r.name}`,
  );

  const reasons = mergeDict<PauseReason>(localReasons, t.pauseReasons, (r) => r.id, (r) => r.label);
  const profiles = mergeDict<Profile>(localProfiles, t.profiles, (r) => r.id, (r) => r.name);

  await Promise.all([
    profiles.toAdd.length ? db.profiles.bulkAdd(profiles.toAdd) : Promise.resolve(),
    subjects.toAdd.length ? db.subjects.bulkAdd(subjects.toAdd) : Promise.resolve(),
    tasks.toAdd.length ? db.taskTypes.bulkAdd(tasks.toAdd) : Promise.resolve(),
    reasons.toAdd.length ? db.pauseReasons.bulkAdd(reasons.toAdd) : Promise.resolve(),
  ]);

  return {
    profiles: profiles.remap,
    subjects: subjects.remap,
    taskTypes: tasks.remap,
    pauseReasons: reasons.remap,
    merged: subjects.merged + tasks.merged + reasons.merged + profiles.merged,
  };
}

/**
 * 字典对不上不该丢学习记录：改不到本机的引用就留空，
 * 记录照样导入，界面上显示成「已删除」。
 */
const repoint = (s: StudySession, maps: Awaited<ReturnType<typeof mergeDictionaries>>): StudySession => ({
  ...s,
  profileId: maps.profiles.get(s.profileId) ?? s.profileId,
  subjectId: maps.subjects.get(s.subjectId) ?? s.subjectId,
  taskTypeId: follow(maps.taskTypes, s.taskTypeId) ?? null,
});

const repointSeg = (
  seg: SessionSegment,
  maps: Awaited<ReturnType<typeof mergeDictionaries>>,
): SessionSegment => ({ ...seg, pauseReasonId: follow(maps.pauseReasons, seg.pauseReasonId) });

/** 合并 = 记录按 id 去重，字典按名字并入。 */
export async function importBackup(backup: Backup, mode: ImportMode): Promise<ImportResult> {
  const { tables: t, settled } = settleOpen(backup);

  // 表多于 5 张时用数组重载，逐个传参会撞上 Dexie 的 5 参上限
  return db.transaction(
    "rw",
    [db.profiles, db.subjects, db.taskTypes, db.pauseReasons, db.sessions, db.segments],
    async () => {
      if (mode === "replace") {
        // 顺序不能反：先清后写，万一写入失败整个事务回滚，
        // 反过来会留下「库清空了但没写进去」的空档。
        await Promise.all([
          db.segments.clear(),
          db.sessions.clear(),
          db.pauseReasons.clear(),
          db.taskTypes.clear(),
          db.subjects.clear(),
          db.profiles.clear(),
        ]);
        await db.profiles.bulkAdd(t.profiles);
        await db.subjects.bulkAdd(t.subjects);
        await db.taskTypes.bulkAdd(t.taskTypes);
        await db.pauseReasons.bulkAdd(t.pauseReasons);
        await db.sessions.bulkAdd(t.sessions);
        await db.segments.bulkAdd(t.segments.map(stripId));
        return {
          added: t.sessions.length,
          skipped: 0,
          segments: t.segments.length,
          settled,
          mergedDicts: 0,
        };
      }

      const maps = await mergeDictionaries(t);

      const localSessionIds = new Set(await db.sessions.toCollection().primaryKeys());
      const openBefore = new Set(backup.tables.sessions.filter(isOpen).map((s) => s.id));
      const fresh = t.sessions.filter((s) => !localSessionIds.has(s.id));
      const freshIds = new Set(fresh.map((s) => s.id));
      const segs = t.segments.filter((x) => freshIds.has(x.sessionId));
      // t.sessions 已经被 settleOpen 改过了，要回到原始备份里认「哪些本来没结束」。
      // 被跳过的那条即使备份里是进行中也没写进本机，收尾数不能算它。
      const settledNow = fresh.filter((s) => openBefore.has(s.id)).length;

      if (fresh.length) await db.sessions.bulkAdd(fresh.map((s) => repoint(s, maps)));
      if (segs.length) await db.segments.bulkAdd(segs.map((x) => stripId(repointSeg(x, maps))));

      return {
        added: fresh.length,
        skipped: t.sessions.length - fresh.length,
        segments: segs.length,
        settled: settledNow,
        mergedDicts: maps.merged,
      };
    },
  );
}

/** 导入前给用户看一眼：只说记录数的变化，字典怎么并由 mergeDictionaries 决定。 */
export async function previewImport(backup: Backup, mode: ImportMode): Promise<string> {
  const local = await db.sessions.toCollection().primaryKeys();
  const have = new Set(local);
  const incoming = backup.tables.sessions;
  const fresh = mode === "replace" ? incoming : incoming.filter((s) => !have.has(s.id));
  const added = fresh.length;
  const skipped = incoming.length - added;
  // 和 importBackup 同一口径：只数真的会写进来的那些
  const running = fresh.filter(isOpen).length;
  const note = running > 0 ? `其中 ${running} 条未结束的计时会被收尾。` : "";

  return mode === "replace"
    ? `将清空本机 ${local.length} 条记录，换成备份里的 ${added} 条。${note}这一步不能撤销。`
    : `将新增 ${added} 条${skipped > 0 ? `，跳过 ${skipped} 条已存在的` : ""}；本机现有 ${local.length} 条。${note}`;
}
