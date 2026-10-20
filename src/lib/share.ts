import type { Backup } from "./export";
import { parseBackup } from "./export";

/**
 * 把备份从 A 设备弄到 B 设备。没有服务器，所以只有三条路，
 * 按体验好坏排：系统分享 → 剪贴板 → 粘贴文本。
 *
 * 三条路都只是搬运同一份 JSON，落库仍走 merge.ts，
 * 所以这里不碰任何数据，只负责「怎么把字符串交出去 / 收回来」。
 */

export type ShareChannel = "share" | "clipboard" | "download";

export interface ShareDeps {
  /** navigator.share / canShare 的窄接口，方便测试注入 */
  canShareFile?: (file: File) => boolean;
  share?: (data: { files: File[]; title: string; text: string }) => Promise<void>;
  clipboardWrite?: (text: string) => Promise<void>;
  download: (blob: Blob, filename: string) => void;
  filename: string;
}

/** 备份体积到了手机上贴文本不现实，超过这个数就不提供剪贴板这条路。 */
export const CLIPBOARD_LIMIT = 200_000;

/**
 * 挑一条能用的通道并走到底，返回实际用了哪条。
 * 系统分享在 iOS / Android 上能直接进微信、隔空投送、文件 App，
 * 用户不用去下载目录里找文件名，这是它排第一的原因。
 */
export async function sendBackup(
  text: string,
  deps: ShareDeps,
): Promise<{ channel: ShareChannel; note?: string }> {
  const blob = new Blob([text], { type: "application/json" });
  const file = new File([blob], deps.filename, { type: "application/json" });

  if (deps.canShareFile?.(file) && deps.share) {
    try {
      await deps.share({ files: [file], title: "学习记录备份", text: deps.filename });
      return { channel: "share" };
    } catch (e) {
      // 用户按「取消」也算异常，不能弹错误吓他；但备份确实还没交出去，
      // 所以这里要真的落一个文件，而不是只说一句「改用下载」。
      if (isAbort(e)) {
        deps.download(blob, deps.filename);
        return { channel: "download", note: "已取消分享，改为存成文件。" };
      }
      throw e;
    }
  }

  if (deps.clipboardWrite && text.length <= CLIPBOARD_LIMIT) {
    try {
      await deps.clipboardWrite(text);
      return {
        channel: "clipboard",
        note: "备份已复制，去另一台设备粘贴导入。",
      };
    } catch {
      // 非安全上下文（http://局域网 IP）下剪贴板会被拒，退回下载
    }
  }

  deps.download(blob, deps.filename);
  // 两种失败原因要分开说：一个是「这台浏览器不行」，一个是「东西太大」，
  // 后者换台设备也不会变好，用户该知道是备份长大了。
  if (text.length > CLIPBOARD_LIMIT) {
    return { channel: "download", note: "备份太大，贴文本不方便，已存成文件。" };
  }
  return { channel: "download", note: "这台浏览器不支持直接分享，已存成文件。" };
}

const isAbort = (e: unknown): boolean =>
  e instanceof DOMException ? e.name === "AbortError" : /abort/i.test(String(e));

/** 粘贴进来的内容常见毛病：被聊天软件加了引号、掉了首尾、中间塞了换行。 */
const tidy = (raw: string): string =>
  raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim()
    .replace(/^"|"$/g, "");

/**
 * 解析用户手抄 / 粘贴进来的备份文本。
 * 报错要指出「像是被截断了」，因为粘贴 30 KB 掉尾巴是最常见的失败方式，
 * 只说「不是合法 JSON」等于没帮上忙。
 */
export function parsePasted(raw: string): Backup {
  const text = tidy(raw);
  if (!text) throw new Error("还没有粘贴内容。");
  try {
    return parseBackup(text);
  } catch (e) {
    const opens = (text.match(/[[{]/g) ?? []).length;
    const closes = (text.match(/[\]}]/g) ?? []).length;
    if (opens !== closes) {
      throw new Error("内容不完整，括号对不上 —— 粘贴时很可能掉了尾巴，请重新完整复制一次。");
    }
    throw e;
  }
}

/** 界面上的通道差异说明，说人话，不提 API 名字。 */
export const channelLabel = (channel: ShareChannel): string =>
  channel === "share" ? "已打开系统分享" : channel === "clipboard" ? "已复制到剪贴板" : "已下载文件";
