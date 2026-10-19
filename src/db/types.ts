export type SegmentKind = "work" | "break";

export type SessionStatus = "running" | "paused" | "done" | "aborted";

/** 记录对象：一个人名。共用设备上多人切换用，不登录。 */
export interface Profile {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  archived: boolean;
}

/** 大科目，例如「语文」。全局字典，多人共用。 */
export interface Subject {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

/** 事项，例如「默写」「预习」。可挂在科目下，也可全局通用。 */
export interface TaskType {
  id: string;
  subjectId: string | null;
  name: string;
  createdAt: number;
}

/** 暂停原因。builtin 的可删除但不可改名，自定义的按使用次数排序。 */
export interface PauseReason {
  id: string;
  label: string;
  builtin: boolean;
  useCount: number;
  createdAt: number;
}

/**
 * 一次学习记录。时长字段在结束时冻结，读取列表时不必再重算分段。
 * netMs / gapsMs 由 SessionSegment 推导，见 lib/time.ts。
 */
export interface StudySession {
  id: string;
  profileId: string;
  subjectId: string;
  taskTypeId: string | null;
  startAt: number;
  endAt: number | null;
  status: SessionStatus;
  plannedMinutes: number | null;
  note: string;
  source: "manual" | "timer" | "backfill";
  netMs: number;
  gapsMs: number;
  breaksCount: number;
}

/**
 * 事件流：work / break 交替。净时长 = Σ work，这是周报能问出
 * 「走神平均发生在开始后第几分钟」的前提，所以不压缩成单个 pauseMs。
 */
export interface SessionSegment {
  id?: number;
  sessionId: string;
  kind: SegmentKind;
  startAt: number;
  endAt: number | null;
  pauseReasonId: string | null;
}
