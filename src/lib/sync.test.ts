import { describe, it, expect } from "vitest";
import { DAY, HOUR, MINUTE } from "./time";
import { backupStatus, nudgeSnoozed, readMark, snoozeNudge, writeMark, type KV } from "./sync";

const NOW = new Date("2026-10-20T12:00:00+08:00").getTime();

const memStore = (): KV => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe("备份标记", () => {
  it("写得进去也读得出来", () => {
    const store = memStore();
    writeMark({ at: NOW, sessions: 12 }, store);
    expect(readMark(store)).toEqual({ at: NOW, sessions: 12 });
  });

  it("没标记时返回 null，而不是抛异常", () => {
    expect(readMark(memStore())).toBeNull();
  });

  it("坏数据当作没有标记", () => {
    const store = memStore();
    store.setItem("studysheet:lastExport", "{ not json");
    expect(readMark(store)).toBeNull();
    store.setItem("studysheet:lastExport", JSON.stringify({ at: "昨天" }));
    expect(readMark(store)).toBeNull();
  });

  it("存储写不进去时不影响导出流程", () => {
    const broken: KV = {
      getItem: () => {
        throw new Error("QuotaExceeded");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    expect(() => writeMark({ at: NOW, sessions: 1 }, broken)).not.toThrow();
    expect(readMark(broken)).toBeNull();
  });
});

describe("该不该再备份", () => {
  const st = (mark: Parameters<typeof backupStatus>[0], sessions: number, now = NOW) =>
    backupStatus(mark, { sessions }, now);

  it("一条记录都没有时不催", () => {
    expect(st(null, 0).level).toBe("ok");
  });

  it("从没导出过时说得直接，不用「建议」这种软话", () => {
    const s = st(null, 5);
    expect(s.level).toBe("bad");
    expect(s.text).toContain("从来没导出过");
  });

  it("导出后又记了新条数就提醒", () => {
    const s = st({ at: NOW - 2 * HOUR, sessions: 10 }, 13);
    expect(s.level).toBe("warn");
    expect(s.text).toContain("又记了 3 条");
  });

  it("新记录攒着超过三天不导，升级为严重", () => {
    expect(st({ at: NOW - 4 * DAY, sessions: 10 }, 13).level).toBe("bad");
  });

  it("删过记录不算新增，不谎报条数", () => {
    const s = st({ at: NOW - HOUR, sessions: 10 }, 8);
    expect(s.text).not.toContain("又记了");
    expect(s.level).toBe("ok");
  });

  it("没新记录但太久没导，还是提一句", () => {
    const s = st({ at: NOW - 9 * DAY, sessions: 10 }, 10);
    expect(s.level).toBe("warn");
    expect(s.text).toContain("9 天没导出");
  });

  it("时间说法用相对值，刚导完不会写成「0 天前」", () => {
    expect(st({ at: NOW - 30 * MINUTE, sessions: 3 }, 3).text).toContain("30 分钟前");
    expect(st({ at: NOW - 20_000, sessions: 3 }, 3).text).toContain("刚刚");
    expect(st({ at: NOW - 3 * HOUR, sessions: 3 }, 3).text).toContain("3 小时前");
    expect(st({ at: NOW - 2 * DAY - 5 * HOUR, sessions: 3 }, 3).text).toContain("2 天前");
    // 设备时钟跳了一下也不能写出「-3 天前」
    expect(st({ at: NOW + DAY, sessions: 3 }, 3).text).toContain("刚刚");
  });

  it("拼出来的句子读得通，不出现「是 刚刚」这种断句", () => {
    expect(st({ at: NOW - 20_000, sessions: 3 }, 3).text).toBe("刚刚备份过，暂时没发现新记录。");
    expect(st({ at: NOW - 3 * DAY, sessions: 3 }, 4).text).toBe("3 天前导出过，之后又记了 1 条，建议再导一次。");
  });
});

describe("记录页提醒的静音", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it("没关过就不静音", () => {
    expect(nudgeSnoozed(NOW, memStore())).toBe(false);
  });

  it("关掉只顶三天，之后重新提醒", () => {
    const store = memStore();
    snoozeNudge(NOW, store);
    expect(nudgeSnoozed(NOW + DAY_MS, store)).toBe(true);
    expect(nudgeSnoozed(NOW + 3 * DAY_MS + 1, store)).toBe(false);
  });

  it("存坏了当作没静音，宁可多提醒一次", () => {
    const store = memStore();
    store.setItem("studysheet:nudgeOff", "昨天");
    expect(nudgeSnoozed(NOW, store)).toBe(false);
  });
});
