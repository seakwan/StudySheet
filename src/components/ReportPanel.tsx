import { useMemo } from "react";
import { buildReport, type Finding, type Tone } from "../lib/report";
import type { RangeMode, Stats } from "../lib/stats";

const MODE_LABEL: Record<RangeMode, string> = {
  day: "今天",
  week: "本周",
  month: "本月",
  total: "全部",
};

const DOT: Record<Tone, string> = {
  good: "bg-emerald-500",
  bad: "bg-red-400",
  neutral: "bg-slate-300",
};

/**
 * 分析报告。放在图表页最上面：先说结论，再往下看支撑结论的图。
 * 数据来自 useStats 已经算好的 current/previous，不额外查一次库。
 */
export function ReportPanel({
  current,
  previous,
  mode,
  anchor,
  scopeLabel,
}: {
  current: Stats;
  previous: Stats | null;
  mode: RangeMode;
  anchor: number;
  /** 只看某个人时标出来，免得把单人的结论当成全家平均 */
  scopeLabel?: string;
}) {
  const report = useMemo(() => buildReport(current, previous, anchor), [current, previous, anchor]);

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-500">
          {MODE_LABEL[mode]}分析{scopeLabel ? ` · ${scopeLabel}` : ""}
        </h3>
        {!report.reliable && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">样本偏少</span>
        )}
      </div>

      <p className="mt-1.5 text-lg leading-snug font-semibold text-slate-900">{report.headline}</p>
      <p className="mt-0.5 text-xs text-slate-400">{report.coverageNote}</p>

      <ul className="mt-3 space-y-2.5">
        {report.findings.map((f) => (
          <FindingRow key={f.id} finding={f} />
        ))}
      </ul>

      {report.suggestions.length > 0 && (
        <div className="mt-3.5 border-t border-slate-100 pt-3">
          <h4 className="mb-2 text-xs font-semibold text-slate-500">下一步怎么改</h4>
          <ol className="space-y-2.5">
            {report.suggestions.map((s, i) => (
              <li key={s.id} className="flex gap-2">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] text-white">
                  {i + 1}
                </span>
                <FindingRow finding={s} plain />
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function FindingRow({ finding, plain }: { finding: Finding; plain?: boolean }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="flex items-start gap-1.5 text-sm font-medium text-slate-800">
        {!plain && <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[finding.tone]}`} />}
        <span>{finding.title}</span>
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{finding.detail}</p>
      {finding.evidence.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {finding.evidence.map((e) => (
            <span key={e} className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">
              {e}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
