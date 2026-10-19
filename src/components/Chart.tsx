import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  MarkLineComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { BarSeriesOption, LineSeriesOption, PieSeriesOption } from "echarts/charts";
import type {
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
  MarkLineComponentOption,
} from "echarts/components";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export type ChartOption = echarts.ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | PieSeriesOption
  | GridComponentOption
  | LegendComponentOption
  | TooltipComponentOption
  | MarkLineComponentOption
>;

/**
 * 只做「实例复用 + 尺寸跟随」两件事。option 每次变化都全量 setOption，
 * 数据量级（最多 180 天 × 若干科目）不需要增量合并。
 */
export function Chart({ option, height = 200 }: { option: ChartOption; height?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    chart.current = echarts.init(el, undefined, { renderer: "canvas" });

    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  return <div ref={host} style={{ height, width: "100%" }} />;
}

export const AXIS = {
  grid: { left: 8, right: 12, top: 24, bottom: 4, containLabel: true },
  axisLabel: { fontSize: 10, color: "#94a3b8" },
  axisLine: { lineStyle: { color: "#e2e8f0" } },
  splitLine: { lineStyle: { color: "#f1f5f9" } },
  tooltip: {
    trigger: "axis" as const,
    axisPointer: { type: "shadow" as const },
    textStyle: { fontSize: 11 },
  },
};
