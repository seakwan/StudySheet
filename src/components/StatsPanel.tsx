import { useState } from "react";
import { Chart, AXIS, type ChartOption } from "./Chart";
import { useStats, type Scope } from "../hooks/useStats";
import { useDayAnchor } from "../hooks/useNow";
import type { RangeMode } from "../lib/stats";
import type { Series, Stats } from "../lib/stats";

const MODES: Array<{ key: RangeMode; label: string }> = [
  { key: "day", label: "今天" },
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
  { key: "total", label: "全部" },
];

/** 横轴日期短标签：月/日，全部模式下更密就只显示日。 */
const shortDay = (d: string): string => {
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
};

export function StatsPanel() {
  const [mode, setMode] = useState<RangeMode>("week");
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  const anchor = useDayAnchor();

  const data = useStats(mode, scope, anchor);
  if (!data) return <p className="rounded-2xl bg-white p-4 text-sm text-slate-400 shadow-sm">统计载入中…</p>;

  const { current, previous, change, profiles } = data;

  return (
    <div className="space-y-3">
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={
                mode === m.key
                  ? "rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white"
                  : "rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-500"
              }
            >
              {m.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <select
            value={scope.kind === "one" ? scope.profileId : scope.kind}
            onChange={(e) =>
              setScope(
                e.target.value === "all"
                  ? { kind: "all" }
                  : e.target.value === "compare"
                    ? { kind: "compare" }
                    : { kind: "one", profileId: e.target.value },
              )
            }
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-600"
          >
            <option value="all">全部人员</option>
            <option value="compare">人员对比</option>
            {profiles
              .filter((p) => !p.archived)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>

        <Summary current={current} change={change} mode={mode} />
      </section>

      {current.totalMinutes === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400 shadow-sm">
          这个时段还没有记录
        </p>
      ) : (
        <>
          {scope.kind === "compare" ? (
            <>
              <Card title="每日净学习时长（按人）">
                <Chart option={seriesOption(current.personSeries, current.days)} height={230} />
              </Card>
              <Card title="总量对比">
                <Chart option={compareOption(current)} height={Math.max(150, current.perPerson.length * 40 + 40)} />
                <PersonTable stats={current} />
              </Card>
            </>
          ) : (
            <>
              <Card title="每日净学习时长（按科目堆叠）">
                <Chart option={stackedOption(current)} height={220} />
              </Card>

              <Card title="按科目曲线">
                <Chart option={seriesOption(current.subjectSeries, current.days)} height={230} />
              </Card>

              <Card title="按事项曲线">
                <Chart option={seriesOption(current.taskSeries, current.days)} height={230} />
              </Card>

              <Card title="科目占比">
                <Chart option={pieOption(current)} height={210} />
              </Card>
            </>
          )}

          {current.pauseReasons.length > 0 && (
            <Card title="暂停原因">
              <Chart option={pauseOption(current)} height={Math.max(140, current.pauseReasons.length * 34 + 40)} />
              <FocusBuckets stats={current} />
            </Card>
          )}

          {scope.kind === "all" && current.perPerson.length > 1 && (
            <Card title="人员对比">
              <PersonTable stats={current} />
            </Card>
          )}

          {previous && previous.sessions > 0 && (
            <Card title="与上一周期对比">
              <CompareTable current={current} previous={previous} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Summary({ current, change, mode }: { current: Stats; change: number | null; mode: RangeMode }) {
  const achieve =
    current.plannedMinutes > 0
      ? Math.round((current.plannedAchievedMinutes / current.plannedMinutes) * 100)
      : null;

  return (
    <div>
      <div className="flex items-end gap-3">
        <div className="text-3xl font-semibold text-slate-900">{current.totalMinutes}</div>
        <div className="pb-1 text-sm text-slate-400">分钟净学习</div>
        {change !== null && (
          <div
            className={`pb-1 text-sm ${change >= 0 ? "text-emerald-600" : "text-red-500"}`}
          >
            {change >= 0 ? "↑" : "↓"} {Math.abs(change)}% 环比同期
          </div>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Metric
          label={mode === "day" ? "记录数" : "有效天数"}
          value={mode === "day" ? `${current.sessions} 条` : `${current.activeDays}/${current.elapsedDays}`}
        />
        {/* 单日窗口下「日均」等于总量，换成更有信息量的专注占比 */}
        {mode === "day" ? (
          <Metric label="专注占比" value={`${focusShare(current.totalMinutes, current.breakMinutes)}%`} />
        ) : (
          <Metric label="日均" value={`${current.avgPerDay} 分`} />
        )}
        <Metric label="最长专注" value={`${current.longestWorkMinutes} 分`} />
        <Metric label="暂停次数" value={`${current.breakCount} 次`} />
        <Metric label="暂停时长" value={`${current.breakMinutes} 分`} />
        <Metric label="暂停密度" value={`${pauseDensity(current.breakCount, current.totalMinutes)}/时`} />
      </dl>
      {achieve !== null && (
        <p className="mt-2 text-xs text-slate-500">
          计划达成率 {achieve}%（计划 {current.plannedMinutes} 分 / 实际计入 {current.plannedAchievedMinutes} 分）
        </p>
      )}
    </div>
  );
}

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg bg-slate-50 px-1 py-2">
    <dt className="text-[10px] text-slate-400">{label}</dt>
    <dd className="text-sm font-medium text-slate-700">{value}</dd>
  </div>
);

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-2xl bg-white p-4 shadow-sm">
    <h3 className="mb-2 text-sm font-semibold text-slate-500">{title}</h3>
    {children}
  </section>
);

/** 每日时长：按科目堆叠，柱状。科目随日的构成变化比纯折线直观。 */
function stackedOption(stats: Stats): ChartOption {
  const days = stats.days.map(shortDay);
  const series = stats.subjectSeries.map((s) => ({
    name: s.name,
    type: "bar" as const,
    stack: "total",
    barMaxWidth: 28,
    itemStyle: { color: s.color },
    data: s.points.map((p) => p.minutes),
  }));

  return {
    ...AXIS,
    legend: {
      type: "scroll",
      bottom: 0,
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { fontSize: 10, color: "#64748b" },
    },
    grid: { ...AXIS.grid, bottom: 28 },
    xAxis: { type: "category", data: days, ...AXIS.axisLabel, axisTick: { show: false } },
    yAxis: { type: "value", name: "分钟", nameTextStyle: { fontSize: 10 }, ...AXIS.axisLabel, splitLine: AXIS.splitLine },
    series,
  };
}

/**
 * 曲线图。科目多的时候 legend 收着会让人看不出趋势，
 * 所以折线默认全显示，legend 可滚动，点一下即单独看某一科。
 */
function seriesOption(series: Series[], days: string[]): ChartOption {
  return {
    ...AXIS,
    legend: {
      type: "scroll",
      bottom: 0,
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { fontSize: 10, color: "#64748b" },
    },
    grid: { ...AXIS.grid, bottom: 28 },
    tooltip: { ...AXIS.tooltip, axisPointer: { type: "line" as const } },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: days.map(shortDay),
      ...AXIS.axisLabel,
      axisTick: { show: false },
    },
    yAxis: { type: "value", name: "分钟", nameTextStyle: { fontSize: 10 }, ...AXIS.axisLabel, splitLine: AXIS.splitLine },
    series: series.map((s) => ({
      name: s.name,
      type: "line" as const,
      smooth: true,
      symbolSize: 4,
      lineStyle: { width: 2, color: s.color },
      itemStyle: { color: s.color },
      data: s.points.map((p) => p.minutes),
    })),
  };
}

function pieOption(stats: Stats): ChartOption {
  return {
    tooltip: { trigger: "item", textStyle: { fontSize: 11 }, formatter: "{b} {c} 分（{d}%）" },
    legend: {
      type: "scroll",
      orient: "vertical",
      right: 0,
      top: "middle",
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { fontSize: 10, color: "#64748b" },
    },
    series: [
      {
        type: "pie" as const,
        radius: ["42%", "66%"],
        center: ["34%", "50%"],
        avoidLabelOverlap: true,
        label: { show: false },
        data: stats.bySubject.map((s) => ({ name: s.name, value: s.minutes, itemStyle: { color: s.color } })),
      },
    ],
  };
}

function pauseOption(stats: Stats): ChartOption {
  const items = [...stats.pauseReasons].reverse();
  return {
    grid: { left: 8, right: 40, top: 8, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, textStyle: { fontSize: 11 } },
    xAxis: { type: "value", ...AXIS.axisLabel, splitLine: AXIS.splitLine },
    yAxis: { type: "category", data: items.map((p) => p.name), ...AXIS.axisLabel, axisTick: { show: false } },
    series: [
      {
        type: "bar" as const,
        barMaxWidth: 16,
        itemStyle: { color: "#f59e0b", borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", fontSize: 10, color: "#94a3b8", formatter: "{c} 分" },
        data: items.map((p) => p.minutes),
      },
    ],
  };
}

function compareOption(stats: Stats): ChartOption {
  const people = [...stats.perPerson].reverse();
  return {
    grid: { left: 8, right: 44, top: 8, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, textStyle: { fontSize: 11 } },
    xAxis: { type: "value", name: "分钟", nameTextStyle: { fontSize: 10 }, ...AXIS.axisLabel, splitLine: AXIS.splitLine },
    yAxis: { type: "category", data: people.map((p) => p.name), ...AXIS.axisLabel },
    series: [
      {
        type: "bar" as const,
        barMaxWidth: 18,
        // 每人用自己的颜色，和上方曲线、下方表格的色点一致，不用来回对照
        data: people.map((p) => ({ value: p.minutes, itemStyle: { color: p.color, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: "right", fontSize: 10, color: "#94a3b8", formatter: "{c} 分" },
      },
    ],
  };
}

/**
 * 暂停时机。回答「能坐住多久」——如果绝大多数暂停都落在 0-10 分钟，
 * 问题通常在开始阶段（没进入状态），而不是耐力不够。
 */
function FocusBuckets({ stats }: { stats: Stats }) {
  const total = stats.focusBuckets.reduce((sum, b) => sum + b.count, 0);
  if (total === 0) return null;

  return (
    <div className="mt-3 border-t border-slate-50 pt-3">
      <p className="mb-2 text-xs text-slate-400">暂停发生在开始后第几分钟（{total} 次）</p>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
        {stats.focusBuckets.map((b, i) => (
          <div
            key={b.label}
            title={`${b.label}：${b.count} 次`}
            style={{
              width: `${(b.count / total) * 100}%`,
              backgroundColor: ["#fca5a5", "#fdba74", "#fde047", "#86efac", "#5eead4"][i],
            }}
          />
        ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
        {stats.focusBuckets.map((b, i) => (
          <li key={b.label} className="flex items-center gap-1">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: ["#fca5a5", "#fdba74", "#fde047", "#86efac", "#5eead4"][i] }}
            />
            {b.label} {b.count}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PersonTable({ stats }: { stats: Stats }) {
  return (
    <table className="mt-3 w-full text-xs">
      <thead>
        <tr className="text-left text-slate-400">
          <th className="font-normal">人</th>
          <th className="text-right font-normal">净时长</th>
          <th className="text-right font-normal">暂停/小时</th>
          <th className="text-right font-normal">最长专注</th>
        </tr>
      </thead>
      <tbody>
        {stats.perPerson.map((p) => (
          <tr key={p.profileId} className="border-t border-slate-50">
            <td className="py-1.5">
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
              {p.name}
            </td>
            <td className="text-right">{p.minutes}分</td>
            <td className="text-right">{pauseDensity(p.breakCount, p.minutes)}</td>
            <td className="text-right">{p.longestWorkMinutes}分</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 归一化到每小时，人数不同才可比。 */
const pauseDensity = (breakCount: number, minutes: number): string => {
  if (minutes <= 0) return "—";
  return (breakCount / (minutes / 60)).toFixed(1);
};

/** 净学习 / (净学习 + 暂停)。比「暂停时长」更直观地说明这段时间的成色。 */
const focusShare = (netMinutes: number, breakMinutes: number): number => {
  const wall = netMinutes + breakMinutes;
  return wall <= 0 ? 100 : Math.round((netMinutes / wall) * 100);
};

function CompareTable({ current, previous }: { current: Stats; previous: Stats }) {
  const rows = [
    { label: "净学习", now: `${current.totalMinutes}分`, prev: `${previous.totalMinutes}分` },
    { label: "记录数", now: `${current.sessions}条`, prev: `${previous.sessions}条` },
    { label: "暂停次数", now: `${current.breakCount}`, prev: `${previous.breakCount}` },
    { label: "暂停时长", now: `${current.breakMinutes}分`, prev: `${previous.breakMinutes}分` },
    {
      label: "暂停/小时",
      now: pauseDensity(current.breakCount, current.totalMinutes),
      prev: pauseDensity(previous.breakCount, previous.totalMinutes),
    },
    { label: "最长专注", now: `${current.longestWorkMinutes}分`, prev: `${previous.longestWorkMinutes}分` },
  ];

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-slate-400">
          <th className="font-normal">指标</th>
          <th className="text-right font-normal">本期</th>
          <th className="text-right font-normal">上期同期</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-t border-slate-50">
            <td className="py-1.5 text-slate-500">{row.label}</td>
            <td className="text-right font-medium">{row.now}</td>
            <td className="text-right text-slate-400">{row.prev}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
