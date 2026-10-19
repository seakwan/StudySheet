import type { Stats } from "./stats";
import { ratioChange, streakDays } from "./stats";

/**
 * 周报生成。全部是确定性规则，不接大模型：
 * 这是一个纯本地应用，没有服务端也没有 API Key，而且「建议」必须能被
 * 追溯到具体数字，否则用户无法判断它是不是在胡说。
 *
 * 每条结论都带 evidence，UI 直接显示它，规则改动也能被测试锁住。
 */

export type Tone = "good" | "bad" | "neutral";

export interface Finding {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  /** 支撑这条结论的数字，UI 上原样列出 */
  evidence: string[];
}

export interface Report {
  /** 覆盖天数不足时结论不可靠，要明确说出来而不是硬凑 */
  reliable: boolean;
  coverageNote: string;
  headline: string;
  findings: Finding[];
  suggestions: Finding[];
}

const fmt = (n: number): string => `${Math.round(n)}`;

const hoursOf = (minutes: number): string => (minutes >= 60 ? `${(minutes / 60).toFixed(1)} 小时` : `${fmt(minutes)} 分钟`);

/**
 * 分钟数是四舍五入后的值，一条 5 秒的记录会显示成 0 分钟。
 * 这时说「还没有记录」是假话 —— 明明记了，只是短到看不见。
 */
const amount = (stats: Stats): string =>
  stats.totalMinutes > 0
    ? hoursOf(stats.totalMinutes)
    : stats.sessions > 0
      ? "不到 1 分钟"
      : "0 分钟";

/** 暂停密度 = 每小时学习的暂停次数 */
const density = (breakCount: number, minutes: number): number =>
  minutes > 0 ? (breakCount / minutes) * 60 : 0;

const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 只在样本足够时给结论，避免拿 1 条记录说「你下午效率低」。 */
const MIN_SESSIONS = 3;
const MIN_DAYS_FOR_STABLE = 3;

export function buildReport(current: Stats, previous: Stats | null, now: number): Report {
  const findings: Finding[] = [];
  const suggestions: Finding[] = [];

  const coverage = current.elapsedDays > 0 ? current.activeDays / current.elapsedDays : 0;
  const reliable = current.sessions >= MIN_SESSIONS && current.activeDays >= MIN_DAYS_FOR_STABLE;
  const coverageNote = !reliable
    ? `样本还不足（${current.sessions} 条记录 / ${current.activeDays} 天有记录），下面的结论仅供参考`
    : `${current.activeDays} 天有记录 / 已过 ${current.elapsedDays} 天，共 ${current.sessions} 条`;

  // —— 时长与趋势 ——
  // 两侧都要够大：一条 5 秒的记录会让环比变成「减少 100%」，那是四舍五入
  // 造出来的数字，不是趋势。
  const change = previous ? ratioChange(current.totalMinutes, previous.totalMinutes) : null;
  const trendMeaningful =
    change !== null && Math.abs(change) >= 15 && previous!.totalMinutes >= 30 && current.totalMinutes >= 30;
  if (trendMeaningful) {
    const up = change > 0;
    findings.push({
      id: "trend",
      tone: up ? "good" : "bad",
      title: `净学习时长${up ? "增加" : "减少"} ${Math.abs(change)}%`,
      detail: `本期 ${hoursOf(current.totalMinutes)}，上期同期 ${hoursOf(previous!.totalMinutes)}。`,
      evidence: [
        `本期 ${fmt(current.totalMinutes)} 分钟`,
        `上期同期 ${fmt(previous!.totalMinutes)} 分钟`,
      ],
    });
  } else {
    findings.push({
      id: "level",
      tone: "neutral",
      title: `本期净学习 ${amount(current)}`,
      detail: `日均 ${fmt(current.avgPerDay)} 分钟，${current.activeDays}/${current.elapsedDays} 天有记录。`,
      evidence: [`日均 ${fmt(current.avgPerDay)} 分钟`, `记录 ${current.sessions} 条`],
    });
  }

  // —— 坚持度 ——
  const streak = streakDays(current.activeDayKeys, now);
  if (streak >= 3) {
    findings.push({
      id: "streak",
      tone: "good",
      title: `连续记录 ${streak} 天`,
      detail: "记录本身在稳定下来，这比某一天的时长更重要。",
      evidence: [`连续 ${streak} 天`, `本期覆盖 ${Math.round(coverage * 100)}% 的天数`],
    });
  }
  // 连续天数和漏记要分开说：连着记了 3 天、但一个月只记了 3 天，
  // 只报「连续 3 天」就是把问题藏起来了。
  if (reliable && coverage < 0.6) {
    const missed = current.elapsedDays - current.activeDays;
    findings.push({
      id: "gaps",
      tone: "bad",
      title: `${current.elapsedDays} 天里有 ${missed} 天没记录`,
      detail: "漏记会让周均值失真，补录一条比空着强得多。",
      evidence: [`有记录 ${current.activeDays} 天`, `空档 ${missed} 天`, `当前连续 ${streak} 天`],
    });
    suggestions.push({
      id: "fix-gaps",
      tone: "neutral",
      title: "把记录挂到固定动作上",
      detail: "坐在书桌前第一件事就点开始，忘了也没关系，事后用补录补上。",
      evidence: [`空档 ${missed} 天`],
    });
  }

  // —— 专注成色 ——
  const curDensity = density(current.breakCount, current.totalMinutes);
  const wallClock = current.totalMinutes + current.breakMinutes;
  const focusShare = wallClock > 0 ? (current.totalMinutes / wallClock) * 100 : 100;

  if (current.breakCount >= 3) {
    if (curDensity >= 3) {
      findings.push({
        id: "dense-pauses",
        tone: "bad",
        title: `每小时暂停 ${curDensity.toFixed(1)} 次，打断偏密`,
        detail: `本期暂停 ${current.breakCount} 次共 ${fmt(current.breakMinutes)} 分钟，坐不住比学得少更影响效果。`,
        evidence: [
          `暂停 ${current.breakCount} 次`,
          `净学习 ${fmt(current.totalMinutes)} 分钟`,
          `专注占比 ${fmt(focusShare)}%`,
        ],
      });
      const top = current.pauseReasons[0];
      suggestions.push({
        id: "cut-pauses",
        tone: "neutral",
        title: top ? `先处理「${top.name}」这一类暂停` : "先压住最高频的那类暂停",
        detail: top
          ? `它出现 ${top.count} 次、占 ${fmt(top.minutes)} 分钟。开始前把手机放到另一个房间、水和水杯先备好，能直接消掉一部分。`
          : "暂停时选一个原因，下次就能针对性处理。",
        evidence: top
          ? [`「${top.name}」${top.count} 次 / ${fmt(top.minutes)} 分钟`, `全部暂停 ${current.breakCount} 次`]
          : [`暂停 ${current.breakCount} 次`],
      });
    } else {
      findings.push({
        id: "calm",
        tone: "good",
        title: `每小时暂停 ${curDensity.toFixed(1)} 次，节奏稳`,
        detail: `专注占比 ${fmt(focusShare)}%，暂停没有吃掉太多时间。`,
        evidence: [`暂停 ${current.breakCount} 次`, `专注占比 ${fmt(focusShare)}%`],
      });
    }
  }

  // —— 暂停发生在什么时候 ——
  const early = current.focusBuckets[0]?.count ?? 0;
  const totalDepth = current.focusBuckets.reduce((sum, b) => sum + b.count, 0);
  if (totalDepth >= 3 && early / totalDepth >= 0.5) {
    findings.push({
      id: "early-pause",
      tone: "bad",
      title: "暂停集中在开始前 10 分钟",
      detail: `${early}/${totalDepth} 次暂停发生在开始后的前 10 分钟。这不是耐力问题，是启动问题。`,
      evidence: [`0-10 分钟 ${early} 次`, `暂停时机样本 ${totalDepth} 次`],
    });
    suggestions.push({
      id: "fix-start",
      tone: "neutral",
      title: "用 5 分钟低门槛启动",
      detail: "第一段只承诺 5 分钟、只做最简单的事（比如把上次的错题抄一遍），跨过启动点后再自然延长。",
      evidence: [`0-10 分钟暂停 ${early} 次`],
    });
  }

  // —— 时段 ——
  const peakHours = topIndices(current.hourHistogram, 2);
  const hasHours = current.hourHistogram.some((m) => m > 0);
  if (hasHours && current.timerSessions >= MIN_SESSIONS) {
    const labels = peakHours.map((h) => `${h}:00-${h + 1}:00`);
    findings.push({
      id: "peak-hours",
      tone: "neutral",
      title: `学得最多的时段是 ${labels.join(" 和 ")}`,
      detail: `这两段合计 ${fmt(peakHours.reduce((s, h) => s + current.hourHistogram[h], 0))} 分钟。把最难的科目挪到这里，比硬撑弱时段划算。`,
      evidence: peakHours.map((h) => `${h}:00 段 ${fmt(current.hourHistogram[h])} 分钟`),
    });
    suggestions.push({
      id: "schedule-hard",
      tone: "neutral",
      title: `把难题安排在 ${peakHours[0]}:00 前后`,
      detail: "弱势时段只做机械性任务（整理错题、抄写、听听力），别拿最难的题跟自己较劲。",
      evidence: peakHours.map((h) => `${h}:00 段 ${fmt(current.hourHistogram[h])} 分钟`),
    });
  }

  // —— 星期 ——
  // 必须折成「平均每个周几」再比：本月的周六可能有 5 个、周三只有 4 个，
  // 直接拿各自的总量比，比的其实是这个月有几天。
  const weekday = weekdayAverages(current);
  if (weekday.length >= 3) {
    const best = weekday[0];
    const worst = weekday[weekday.length - 1];
    findings.push({
      id: "weekday",
      tone: "neutral",
      title: `${best.label}最能学，${worst.label}最少`,
      detail: `平均每个${best.label} ${fmt(best.avg)} 分钟，每个${worst.label}只有 ${fmt(worst.avg)} 分钟。差距大说明日程安排不均匀。`,
      evidence: [
        `${best.label} ${best.days} 天共 ${fmt(best.minutes)} 分`,
        `${worst.label} ${worst.days} 天共 ${fmt(worst.minutes)} 分`,
        `日均 ${fmt(current.avgPerDay)} 分钟`,
      ],
    });
    if (worst.avg < current.avgPerDay * 0.4) {
      suggestions.push({
        id: "fix-weekday",
        tone: "neutral",
        title: `给${worst.label}安排一个短任务`,
        detail: `那天平均只有 ${fmt(worst.avg)} 分钟，远低于日均 ${fmt(current.avgPerDay)} 分钟。安排一个 20 分钟就能完成的小事项，比空着更容易恢复节奏。`,
        evidence: [`${worst.label}平均 ${fmt(worst.avg)} 分钟`, `日均 ${fmt(current.avgPerDay)} 分钟`],
      });
    }
  }

  // —— 科目结构 ——
  if (current.bySubject.length >= 2) {
    const total = current.bySubject.reduce((s, x) => s + x.minutes, 0);
    const top = current.bySubject[0];
    const share = total > 0 ? (top.minutes / total) * 100 : 0;
    if (share >= 50 && current.bySubject.length >= 3) {
      findings.push({
        id: "skew",
        tone: "bad",
        title: `${top.name} 占了一半以上的时间`,
        detail: `${top.name} ${fmt(top.minutes)} 分钟（${fmt(share)}%），其余 ${current.bySubject.length - 1} 科分掉剩下的。偏科时长时间多不等于有效。`,
        evidence: current.bySubject.slice(0, 4).map((x) => `${x.name} ${fmt(x.minutes)} 分`),
      });
      const least = current.bySubject[current.bySubject.length - 1];
      suggestions.push({
        id: "fix-skew",
        tone: "neutral",
        title: `给${least.name}固定一个每日小段`,
        detail: `它本期只有 ${fmt(least.minutes)} 分钟。每天固定 15 分钟比周末补两小时有效，也更容易坚持。`,
        evidence: [`${least.name} ${fmt(least.minutes)} 分钟`, `${top.name} ${fmt(top.minutes)} 分钟`],
      });
    }
  }

  // —— 计划达成 ——
  if (current.plannedMinutes > 0) {
    const rate = (current.plannedAchievedMinutes / current.plannedMinutes) * 100;
    if (rate < 70) {
      findings.push({
        id: "plan-miss",
        tone: "bad",
        title: `计划达成率 ${fmt(rate)}%`,
        detail: `计划 ${fmt(current.plannedMinutes)} 分钟，实际计入 ${fmt(current.plannedAchievedMinutes)} 分钟。计划普遍偏大时，完不成会变成常态。`,
        evidence: [`计划 ${fmt(current.plannedMinutes)} 分钟`, `实际 ${fmt(current.plannedAchievedMinutes)} 分钟`],
      });
      suggestions.push({
        id: "fix-plan",
        tone: "neutral",
        title: "把计划时长调到实际的 1.1 倍",
        detail: `本期实际日均 ${fmt(current.avgPerDay)} 分钟，按这个数定计划，先让「完成」变成常事。`,
        evidence: [`达成率 ${fmt(rate)}%`, `日均 ${fmt(current.avgPerDay)} 分钟`],
      });
    } else if (rate >= 95) {
      findings.push({
        id: "plan-hit",
        tone: "good",
        title: `计划达成率 ${fmt(rate)}%`,
        detail: "计划定得准，执行也跟得上。可以适当加量或加难度。",
        evidence: [`计划 ${fmt(current.plannedMinutes)} 分钟`, `实际 ${fmt(current.plannedAchievedMinutes)} 分钟`],
      });
    }
  }

  // —— 最长专注 ——
  if (current.longestWorkMinutes >= 25) {
    findings.push({
      id: "deep-work",
      tone: "good",
      title: `最长一段连续专注 ${fmt(current.longestWorkMinutes)} 分钟`,
      detail: "说明有这个耐力，问题只是能不能稳定进入这个状态。",
      evidence: [`最长专注 ${fmt(current.longestWorkMinutes)} 分钟`],
    });
  }

  // —— 数据可信度 ——
  if (current.backfillSessions > 0 && current.backfillSessions / Math.max(1, current.sessions) > 0.4) {
    findings.push({
      id: "backfill-heavy",
      tone: "neutral",
      title: "四成以上的记录是补录的",
      detail: `补录 ${current.backfillSessions} 条 / 共 ${current.sessions} 条。补录没有暂停明细，时长也偏粗，看趋势可以，别当成精确统计。`,
      evidence: [`补录 ${current.backfillSessions} 条`, `计时 ${current.timerSessions} 条`],
    });
  }

  // 建议不要多于 3 条，多了不会执行
  const topSuggestions = suggestions.slice(0, 3);

  return {
    reliable,
    coverageNote,
    headline: buildHeadline(current, streak, trendMeaningful ? change : null),
    findings,
    suggestions: topSuggestions,
  };
}

function buildHeadline(current: Stats, streak: number, change: number | null): string {
  if (current.sessions === 0) return "这个时段还没有记录";
  const parts = [`净学习 ${amount(current)}`];
  if (change !== null && Math.abs(change) >= 15) parts.push(`环比${change > 0 ? "增" : "减"} ${Math.abs(change)}%`);
  if (streak >= 3) parts.push(`连续 ${streak} 天`);
  if (current.breakCount >= 3) parts.push(`暂停 ${current.breakCount} 次`);
  return parts.join("，");
}

/** 取分钟数最高的 n 个小时（跳过 0 分钟的小时）。 */
function topIndices(values: number[], n: number): number[] {
  return values
    .map((v, i) => ({ v, i }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((x) => x.i);
}

interface WeekdayAvg {
  label: string;
  minutes: number;
  days: number;
  avg: number;
}

/**
 * 按「平均每个周几」排序，只保留有记录的。
 * 天数用窗口内实际出现过的次数，而不是记录数 —— 否则一周的样本会被月窗口稀释。
 */
function weekdayAverages(stats: Stats): WeekdayAvg[] {
  return stats.weekdayMinutes
    .map((minutes, i): WeekdayAvg => ({
      label: WEEKDAY_LABELS[i],
      minutes,
      days: stats.weekdayCounts[i] ?? 0,
      avg: (stats.weekdayCounts[i] ?? 0) > 0 ? minutes / stats.weekdayCounts[i] : 0,
    }))
    .filter((x) => x.minutes > 0 && x.days > 0)
    .sort((a, b) => b.avg - a.avg);
}
