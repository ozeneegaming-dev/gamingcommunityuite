"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cx } from "../cx";

export type GcsChartType = "area" | "column" | "bar";

export type GcsChartProps = {
  data: { x: string; y: number }[];
  type: GcsChartType;
  onTypeChange?: (type: GcsChartType) => void;
  csvHref?: string;
  /** Textele butoanelor (vin din `messages/*.json`; componentele nu conțin texte hardcodate). */
  labels: { area: string; column: string; bar: string; csv: string; series: string };
  height?: number;
  className?: string;
};

const ACCENT = "#D62839";
const GRID = "#262A34";
const MUTED = "#A1A7B4";
const TOOLTIP_STYLE = { background: "#1B1E26", border: "1px solid #262A34", borderRadius: 10, color: "#ECEDF1" };

/** Graficul din ACP (spec §12.3): area, coloane sau bare orizontale, cu schimbarea tipului și export CSV. */
export function GcsChart({ data, type, onTypeChange, csvHref, labels, height = 240, className }: GcsChartProps) {
  const axisProps = { stroke: MUTED, tick: { fill: MUTED, fontSize: 12 }, tickLine: false, axisLine: false };
  const chart =
    type === "area" ? (
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gcsChartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.45} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="x" {...axisProps} />
        <YAxis {...axisProps} width={36} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Area dataKey="y" name={labels.series} stroke={ACCENT} strokeWidth={2} fill="url(#gcsChartFill)" />
      </AreaChart>
    ) : (
      <BarChart data={data} layout={type === "bar" ? "vertical" : "horizontal"}>
        <CartesianGrid stroke={GRID} vertical={type === "bar"} horizontal={type !== "bar"} />
        {type === "bar" ? (
          <>
            <XAxis type="number" {...axisProps} />
            <YAxis type="category" dataKey="x" {...axisProps} width={80} />
          </>
        ) : (
          <>
            <XAxis dataKey="x" {...axisProps} />
            <YAxis {...axisProps} width={36} />
          </>
        )}
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,.04)" }} />
        <Bar dataKey="y" name={labels.series} fill={ACCENT} radius={4} />
      </BarChart>
    );

  return (
    <div className={cx("gcs-chart", className)}>
      {(onTypeChange || csvHref) && (
        <div className="gcs-chart__toolbar">
          {onTypeChange && (
            <div className="gcs-chart__types" role="group">
              {(["area", "column", "bar"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={cx("gcs-seg", t === type && "gcs-seg--active")}
                  aria-pressed={t === type}
                  onClick={() => onTypeChange(t)}
                >
                  {labels[t]}
                </button>
              ))}
            </div>
          )}
          {csvHref && (
            <a className="gcs-btn gcs-btn--ghost gcs-btn--sm" href={csvHref} download>
              {labels.csv}
            </a>
          )}
        </div>
      )}
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>{chart}</ResponsiveContainer>
      </div>
    </div>
  );
}
