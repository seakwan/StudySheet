import { describe, it, expect } from "vitest";
import {
  BACKUP_VERSION,
  BOM,
  buildBackup,
  buildCsv,
  describeBackup,
  exportFilename,
  parseBackup,
  serializeBackup,
  type ExportInput,
} from "./export";
import type {
  PauseReason,
  Profile,
  SessionSegment,
  StudySession,
  Subject,
  TaskType,
} from "../db/types";

const at = (iso: string): number => new Date(iso).getTime();

const profiles: Profile[] = [
  { id: "p1", name: "小海", color: "#111", createdAt: 0, archived: false },
  { id: "p2", name: "阿,雨", color: "#222", createdAt: 0, archived: false },
];
const subjects: Subject[] = [
  { id: "s1", name: "语文", color: "#aaa", createdAt: 0 },
  { id: "s2", name: "数学", color: "#bbb", createdAt: 0 },
];
const tasks: TaskType[] = [{ id: "t1", subjectId: null, name: "默写", createdAt: 0 }];
const reasons: PauseReason[] = [
  { id: "r1", label: "走神", builtin: true, useCount: 0, createdAt: 0 },
];

const session = (over: Partial<StudySession> & Pick<StudySession, "id" | "startAt">): StudySession => ({
  profileId: "p1",
  subjectId: "s1",
  taskTypeId: "t1",
  endAt: null,
  status: "done",
  plannedMinutes: null,
  note: "",
  source: "timer",
  netMs: 0,
  gapsMs: 0,
  breaksCount: 0,
  ...over,
});

const NOW = at("2026-10-19T12:00:00+08:00");

const input = (
  sessions: StudySession[],
  segments: SessionSegment[],
): ExportInput => ({ profiles, subjects, taskTypes: tasks, pauseReasons: reasons, sessions, segments, now: NOW });

/** 一条 23:40→00:20、中间暂停 5 分钟的记录 */
const crossMidnight = (): { sessions: StudySession[]; segments: SessionSegment[] } => {
  const sessions = [
    session({
      id: "c1",
      profileId: "p2",
      subjectId: "s2",
      startAt: at("2026-10-18T23:40:00+08:00"),
      endAt: at("2026-10-19T00:20:00+08:00"),
      plannedMinutes: 45,
      note: '含逗号,和"引号"\n换行',
      netMs: 35 * 60_000,
      gapsMs: 5 * 60_000,
      breaksCount: 1,
    }),
  ];
  const segments: SessionSegment[] = [
    { id: 1, sessionId: "c1", kind: "work", startAt: at("2026-10-18T23:40:00+08:00"), endAt: at("2026-10-18T23:50:00+08:00"), pauseReasonId: null },
    { id: 2, sessionId: "c1", kind: "break", startAt: at("2026-10-18T23:50:00+08:00"), endAt: at("2026-10-18T23:55:00+08:00"), pauseReasonId: "r1" },
    { id: 3, sessionId: "c1", kind: "work", startAt: at("2026-10-18T23:55:00+08:00"), endAt: at("2026-10-19T00:20:00+08:00"), pauseReasonId: null },
  ];
  return { sessions, segments };
};

/** 按 CSV 规则切一行，引号内的逗号不算分隔符。 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

describe("CSV", () => {
  const { sessions, segments } = crossMidnight();
  const csv = buildCsv(input(sessions, segments));
  const lines = csv.replace(BOM, "").trimEnd().split("\r\n");
  const cells = splitCsvLine(lines[1]);
  const col = (name: string): string => cells[lines[0].split(",").indexOf(name)];

  it("带 BOM，否则 Excel 会把中文按 GBK 猜成乱码", () => {
    // 断言字面码点，不用 BOM 常量 —— 常量退化成空串时 startsWith 恒真，就测不出来了
    expect(csv.codePointAt(0)).toBe(0xfeff);
  });

  it("表头是中文，Excel 里直接可读", () => {
    expect(lines[0]).toContain("净学习(分)");
    expect(lines[0]).toContain("暂停明细");
  });

  it("时长带 1 位小数，短记录不会被写成 0", () => {
    expect(col("净学习(分)")).toBe("35");
    expect(col("暂停(分)")).toBe("5");
    expect(col("暂停次数")).toBe("1");
    const tiny = buildCsv(input([session({ id: "z", startAt: NOW, endAt: NOW + 24_000, netMs: 24_000 })], []));
    const tinyCells = splitCsvLine(tiny.replace(BOM, "").trimEnd().split("\r\n")[1]);
    expect(tinyCells[lines[0].split(",").indexOf("净学习(分)")]).toBe("0.4");
  });

  it("暂停明细里的时长和「暂停(分)」同一口径", () => {
    const start = at("2026-10-19T10:00:00+08:00");
    const s = session({ id: "sh", startAt: start, endAt: start + 30_000, netMs: 25_000, gapsMs: 5_000, breaksCount: 1 });
    const segs: SessionSegment[] = [
      { sessionId: "sh", kind: "work", startAt: start, endAt: start + 25_000, pauseReasonId: null },
      { sessionId: "sh", kind: "break", startAt: start + 25_000, endAt: start + 30_000, pauseReasonId: "r1" },
    ];
    const row = splitCsvLine(buildCsv(input([s], segs)).replace(BOM, "").trimEnd().split("\r\n")[1]);
    const idx = (n: string) => row[lines[0].split(",").indexOf(n)];
    // 一个 5 秒的暂停写成 (0分) 是在骗人，也和左边 0.1 对不上
    expect(idx("暂停(分)")).toBe("0.1");
    expect(idx("暂停明细")).toBe("10:00 走神(0.1分)");
  });

  it("逗号、引号、换行都被正确转义", () => {
    expect(col("人")).toBe("阿,雨");
    expect(col("备注")).toBe('含逗号,和"引号"\n换行');
    // 含换行的字段必须整体在引号内，所以它不能占据单独一行
    expect(csv.split("\r\n").length).toBe(2 + 1);
  });

  it("暂停明细带时间和原因，Excel 里也能还原", () => {
    expect(col("暂停明细")).toBe("23:50 走神(5分)");
  });

  it("日期取开始所在自然日，跨零点不拆开", () => {
    // 导出的是原始事实；按天摊开是图表的口径，混在一张表里没法核对
    expect(col("日期")).toBe("2026-10-18");
    expect(col("星期")).toBe("日");
    expect(col("开始")).toBe("23:40");
    expect(col("结束")).toBe("00:20");
  });

  it("补录记录没有事件流时按冻结字段导出", () => {
    const bf = session({
      id: "b1",
      source: "backfill",
      startAt: at("2026-10-19T09:00:00+08:00"),
      endAt: at("2026-10-19T09:30:00+08:00"),
      netMs: 30 * 60_000,
    });
    const text = buildCsv(input([bf], []));
    const row = splitCsvLine(text.replace(BOM, "").trimEnd().split("\r\n")[1]);
    const idx = (n: string) => row[lines[0].split(",").indexOf(n)];
    expect(idx("来源")).toBe("补录");
    expect(idx("净学习(分)")).toBe("30");
    expect(idx("暂停明细")).toBe("");
  });

  it("未结束的会话按 now 算，和界面显示一致", () => {
    const running = session({ id: "l1", status: "running", startAt: at("2026-10-19T11:30:00+08:00") });
    const segs: SessionSegment[] = [
      { sessionId: "l1", kind: "work", startAt: at("2026-10-19T11:30:00+08:00"), endAt: null, pauseReasonId: null },
    ];
    const row = splitCsvLine(buildCsv(input([running], segs)).replace(BOM, "").trimEnd().split("\r\n")[1]);
    expect(row[lines[0].split(",").indexOf("净学习(分)")]).toBe("30");
    expect(row[lines[0].split(",").indexOf("状态")]).toBe("进行中");
    expect(row[lines[0].split(",").indexOf("结束")]).toBe("");
  });

  it("字典被删掉后记录仍然导出，标成已删除", () => {
    const orphan = session({ id: "o1", subjectId: "gone", taskTypeId: null, startAt: NOW, endAt: NOW + 60_000 * 30 });
    const row = splitCsvLine(buildCsv(input([orphan], [])).replace(BOM, "").trimEnd().split("\r\n")[1]);
    expect(row[lines[0].split(",").indexOf("大科目")]).toBe("已删除");
    expect(row[lines[0].split(",").indexOf("事项")]).toBe("");
  });

  it("按开始时间排序", () => {
    const text = buildCsv(
      input(
        [session({ id: "x2", startAt: NOW, endAt: NOW + 60000 }), session({ id: "x1", startAt: NOW - 7200000, endAt: NOW - 7100000 })],
        [],
      ),
    );
    const body = text.replace(BOM, "").trimEnd().split("\r\n").slice(1);
    expect(body[0]).toContain("10:00");
    expect(body[1]).toContain("12:00");
  });
});

describe("备份文件", () => {
  const { sessions, segments } = crossMidnight();
  const backup = buildBackup(input(sessions, segments));

  it("写出后能原样读回，数据一条不少", () => {
    const parsed = parseBackup(serializeBackup(backup));
    expect(parsed.tables.sessions).toEqual(sessions);
    expect(parsed.tables.segments).toEqual(segments);
    expect(parsed.tables.profiles).toEqual(profiles);
  });

  it("不含 now 字段，时长由事件流还原", () => {
    expect(JSON.stringify(backup)).not.toContain('"now"');
    expect(backup.tables.sessions[0].netMs).toBe(35 * 60_000);
  });

  it("记录文件名带日期", () => {
    expect(exportFilename("csv", NOW)).toBe("studysheet-2026-10-19.csv");
    expect(exportFilename("json", NOW)).toBe("studysheet-2026-10-19.json");
  });

  it("摘要说清条数和时间", () => {
    expect(describeBackup(backup)).toContain("1 条记录 / 2 人");
  });

  it("记下导出时的时区偏移，跨时区恢复时提醒日期归属可能变", () => {
    const shifted = { ...backup, utcOffsetMinutes: 480 };
    expect(describeBackup(shifted, 480)).not.toContain("跨时区");
    expect(describeBackup(shifted, 0)).toContain("UTC+8");
    expect(describeBackup(shifted, 0)).toContain("跨时区恢复后记录归属的日期可能不同");
    // 半小时时区要写成 UTC+5:30，而不是丢掉那 30 分钟
    expect(describeBackup({ ...shifted, utcOffsetMinutes: 330 }, 330)).toContain("UTC+5:30");
    // 时区名本身就等于偏移时不重复拼：「UTC UTC」很难读
    expect(describeBackup({ ...shifted, timezone: "UTC", utcOffsetMinutes: 0 }, 0)).not.toContain("UTC UTC");
    expect(describeBackup({ ...shifted, timezone: "unknown", utcOffsetMinutes: 0 }, 0)).not.toContain("unknown");
    expect(describeBackup({ ...shifted, timezone: "Asia/Shanghai" }, 480)).toContain("Asia/Shanghai（UTC+8）");
  });

  it("偏移量随备份一起走，读回不丢", () => {
    const parsed = parseBackup(serializeBackup(backup));
    expect(parsed.utcOffsetMinutes).toBe(backup.utcOffsetMinutes);
  });

  it("备份不带 BOM —— JSON 加了 BOM 会让 jq 和标准解析器报错", () => {
    const text = serializeBackup(backup);
    expect(text.codePointAt(0)).not.toBe(0xfeff);
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe("解析外部文件", () => {
  const fixture = crossMidnight();
  // 不带 BOM 的裸 JSON：这些用例要 JSON.parse 改字段，BOM 会让 parse 先炸
  const plain = JSON.stringify(buildBackup(input(fixture.sessions, fixture.segments)));

  it("不是 JSON 时明确报错", () => {
    expect(() => parseBackup("hello")).toThrow(/不是合法的 JSON/);
  });

  it("不是本工具的备份时拒绝", () => {
    expect(() => parseBackup(JSON.stringify({ foo: 1 }))).toThrow(/不是 StudySheet/);
  });

  it("版本比程序新时要求先升级，而不是导入半截", () => {
    const future = JSON.parse(plain);
    future.version = BACKUP_VERSION + 1;
    expect(() => parseBackup(JSON.stringify(future))).toThrow(/请先升级/);
  });

  it("缺表时指出缺哪张", () => {
    const broken = JSON.parse(plain);
    delete broken.tables.segments;
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(/缺少 segments/);
  });

  it("记录缺关键字段时拒绝，而不是导入后崩溃", () => {
    const broken = JSON.parse(plain);
    delete broken.tables.sessions[0].startAt;
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(/无法导入/);
  });

  it("容忍带 BOM 的文件", () => {
    expect(() => parseBackup(BOM + plain)).not.toThrow();
    // 导出自带 BOM，读回同一条路径
    expect(() => parseBackup(serializeBackup(buildBackup(input(fixture.sessions, fixture.segments))))).not.toThrow();
  });
});
