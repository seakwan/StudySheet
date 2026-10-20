import { describe, it, expect } from "vitest";
import { CLIPBOARD_LIMIT, parsePasted, sendBackup, type ShareDeps } from "./share";
import { buildBackup, serializeBackup, type Backup } from "./export";
import type { StudySession } from "../db/types";

const NOW = new Date("2026-10-20T12:00:00+08:00").getTime();

const session: StudySession = {
  id: "s1",
  profileId: "p1",
  subjectId: "sub1",
  taskTypeId: null,
  startAt: NOW,
  endAt: NOW + 60_000,
  status: "done",
  plannedMinutes: null,
  note: "备注里有 \"引号\" 和,逗号",
  source: "timer",
  netMs: 60_000,
  gapsMs: 0,
  breaksCount: 0,
};

const goodBackup = (): Backup =>
  buildBackup({
    profiles: [],
    subjects: [],
    taskTypes: [],
    pauseReasons: [],
    sessions: [session],
    segments: [],
    now: NOW,
  });

const text = () => serializeBackup(goodBackup());

const base = (over: Partial<ShareDeps> = {}): ShareDeps & { downloads: string[] } => {
  const downloads: string[] = [];
  return {
    downloads,
    filename: "studysheet-2026-10-20.json",
    download: (_blob, name) => void downloads.push(name),
    ...over,
  };
};

describe("发送备份时挑通道", () => {
  it("支持系统分享时优先用它，用户不必去下载目录找文件", async () => {
    const shared: string[] = [];
    const deps = base({
      canShareFile: () => true,
      share: async (data) => void shared.push(data.files[0].name),
    });
    const res = await sendBackup(text(), deps);
    expect(res.channel).toBe("share");
    expect(shared).toEqual(["studysheet-2026-10-20.json"]);
    expect(deps.downloads).toEqual([]);
  });

  it("用户取消分享时退回下载，而不是报错", async () => {
    const deps = base({
      canShareFile: () => true,
      share: async () => {
        throw new DOMException("cancel", "AbortError");
      },
    });
    const res = await sendBackup(text(), deps);
    expect(res.channel).toBe("download");
    expect(res.note).toContain("已取消分享");
    expect(deps.downloads).toEqual(["studysheet-2026-10-20.json"]);
  });

  it("分享里真正的失败要冒出来，不能悄悄吞掉", async () => {
    const deps = base({
      canShareFile: () => true,
      share: async () => {
        throw new Error("NotAllowedError: nope");
      },
    });
    await expect(sendBackup(text(), deps)).rejects.toThrow("NotAllowedError");
  });

  it("没有分享能力时用剪贴板", async () => {
    const copied: string[] = [];
    const deps = base({ clipboardWrite: async (t) => void copied.push(t) });
    const res = await sendBackup(text(), deps);
    expect(res.channel).toBe("clipboard");
    expect(copied[0]).toContain('"app": "studysheet"'); // 与导出用的紧凑度一致
  });

  it("备份太大时不塞剪贴板，并且说的是真实原因", async () => {
    const deps = base({ clipboardWrite: async () => undefined });
    const res = await sendBackup("x".repeat(CLIPBOARD_LIMIT + 1), deps);
    expect(res.channel).toBe("download");
    // 不能说成「浏览器不支持」—— 换台设备也不会变好，是备份长大了
    expect(res.note).toContain("太大");
    expect(deps.downloads.length).toBe(1);
  });

  it("剪贴板被拒（非 https 访问）时退回下载", async () => {
    const deps = base({
      clipboardWrite: async () => {
        throw new Error("Document is not focused");
      },
    });
    const res = await sendBackup(text(), deps);
    expect(res.channel).toBe("download");
    expect(res.note).toContain("不支持直接分享");
  });

  it("三条路都不通时至少留下一个文件", async () => {
    const deps = base();
    expect((await sendBackup(text(), deps)).channel).toBe("download");
  });
});

describe("接收粘贴进来的备份", () => {
  it("正常文本能读回同一条记录", () => {
    expect(parsePasted(text()).tables.sessions[0].id).toBe("s1");
  });

  it("容忍首尾空白、代码块围栏和聊天软件加的引号", () => {
    expect(parsePasted(`\n  ${text()}  \n`).tables.sessions.length).toBe(1);
    expect(parsePasted("```json\n" + text() + "\n```").tables.sessions.length).toBe(1);
    expect(parsePasted('"' + text() + '"').tables.sessions.length).toBe(1);
  });

  it("粘贴掉尾巴时说「不完整」，而不是含糊的「不是合法 JSON」", () => {
    const cut = text().slice(0, text().length - 20);
    expect(() => parsePasted(cut)).toThrow(/不完整/);
    expect(() => parsePasted(cut)).toThrow(/掉了尾巴/);
  });

  it("空的输入框直接说没内容", () => {
    expect(() => parsePasted("   ")).toThrow(/还没有粘贴内容/);
  });

  it("括号对得上的坏内容，仍按原有原因报错", () => {
    expect(() => parsePasted('{"app":"other"}')).toThrow(/不是 StudySheet/);
  });
});
