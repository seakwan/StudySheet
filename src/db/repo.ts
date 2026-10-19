import { db } from "./index";
import type { Profile } from "./types";
import { colorAt } from "./index";

/**
 * 所有写操作都经过这一层，UI 不直接碰 Dexie。
 * 将来要做多端同步（B 场景）时，只替换本文件为后端 API 调用，其余代码不动。
 */

export async function addProfile(name: string): Promise<Profile> {
  const count = await db.profiles.count();
  const profile: Profile = {
    id: crypto.randomUUID(),
    name: name.trim(),
    color: colorAt(count),
    createdAt: Date.now(),
    archived: false,
  };
  await db.profiles.add(profile);
  return profile;
}

export async function renameProfile(id: string, name: string): Promise<void> {
  await db.profiles.update(id, { name: name.trim() });
}

/** 归档而非删除：误删学习记录在这个工具里是不可接受的。 */
export async function setProfileArchived(id: string, archived: boolean): Promise<void> {
  await db.profiles.update(id, { archived });
}

export async function recordCount(profileId: string): Promise<number> {
  return db.sessions.where("profileId").equals(profileId).count();
}

/**
 * 补录 / 手动录入。和计时器写入同一张表，只是 source 不同，
 * 周报里可以把「补录」的数据单独看待（时长的可信度更低）。
 */
export async function backfillSession(input: {
  profileId: string;
  subjectId: string;
  taskTypeId: string | null;
  startAt: number;
  endAt: number;
  note: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const ms = Math.max(0, input.endAt - input.startAt);
  await db.sessions.add({
    id,
    profileId: input.profileId,
    subjectId: input.subjectId,
    taskTypeId: input.taskTypeId,
    startAt: input.startAt,
    endAt: input.endAt,
    status: "done",
    plannedMinutes: null,
    note: input.note,
    source: "backfill",
    netMs: ms,
    gapsMs: 0,
    breaksCount: 0,
  });
  return id;
}

export async function deleteSession(id: string): Promise<void> {
  await db.transaction("rw", db.sessions, db.segments, async () => {
    await db.segments.where("sessionId").equals(id).delete();
    await db.sessions.delete(id);
  });
}
