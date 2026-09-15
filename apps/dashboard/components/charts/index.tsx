"use client";

/**
 * Interactive Control Plane charts (DEC-001).
 *
 * recharts is isolated entirely behind this module: pages import these
 * components only. Visual language: Paper background, minimal grid, Ink
 * primary series, cobalt accent for selection/state — never rainbow.
 * Dynamic-imported by pages (next/dynamic) so hydration cost stays off
 * the critical path (RSK-002).
 */

import { useId, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const SERIES_COLORS = ["#0b0c0e", "#3d5afe", "#a3a094"] as const;

export interface SeriesDef {
  key: string;
  label: string;
}

export interface TrendRow extends Record<string, string | number> {
  day: string;
}

const AXIS_STYLE = { fontSize: 10.5, fill: "#a3a094", fontFamily: "ui-monospace, monospace" } as const;

function shortDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function longDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function ChartTooltip({
  active,
  payload,
  label,
  series,
  footer,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: string | number; color?: string }>;
  label?: string | number;
  series: SeriesDef[];
  footer?: (row: Record<string, string | number>) => string | null;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row: Record<string, string | number> = {};
  for (const p of payload) {
    if (p.dataKey !== undefined) row[String(p.dataKey)] = Number(p.value ?? 0);
  }
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e4e2d9",
        borderRadius: 10,
        padding: "10px 12px",
        boxShadow: "0 8px 22px rgba(11,12,14,0.09)",
        minWidth: 180,
      }}
    >
      <p style={{ margin: "0 0 7px", fontSize: 11, fontWeight: 700, color: "#0b0c0e" }}>
        {longDay(String(label ?? ""))}
      </p>
      {series.map((s) => {
        const match = payload.find((p) => String(p.dataKey) === s.key);
        if (!match) return null;
        return (
          <div
            key={s.key}
            style={{ display: "flex", justifyContent: "space-between", gap: 18, fontSize: 12 }}
          >
            <span style={{ color: "#737373" }}>{s.label}</span>
            <span className="mono" style={{ fontVariantNumeric: "tabular-nums", color: match.color ?? "#0b0c0e", fontWeight: 600 }}>
              {Number(match.value ?? 0).toLocaleString()}
            </span>
          </div>
        );
      })}
      {footer ? (
        <p style={{ margin: "8px 0 0", fontSize: 11, color: "#a3a094", borderTop: "1px solid #eceae2", paddingTop: 6 }}>
          {footer(row)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Multi-series trend chart with metric toggles (REQ-012/033).
 * Series are togglable via chips rendered above the chart (client state).
 */
export function TrendChart({
  data,
  series,
  height = 320,
  compareKey,
  footer,
}: {
  data: TrendRow[];
  series: Array<SeriesDef & { color: string }>;
  height?: number;
  /** Optional companion series rendered dashed (previous period). */
  compareKey?: string;
  footer?: (row: Record<string, string | number>) => string | null;
}) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const gradId = useId();
  const visible = series.filter((s) => !off.has(s.key));

  if (data.length === 0) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#a3a094",
          fontSize: 13,
          border: "1px dashed #e4e2d9",
          borderRadius: 10,
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <b style={{ color: "#0b0c0e", display: "block", marginBottom: 4 }}>Your growth data will appear here.</b>
          Once visitors start interacting with Calder, we&apos;ll show the trend.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {series.map((s) => (
          <button
            key={s.key}
            type="button"
            className="cp-series"
            data-on={!off.has(s.key)}
            onClick={() =>
              setOff((prev) => {
                const next = new Set(prev);
                if (next.has(s.key)) next.delete(s.key);
                else next.add(s.key);
                return next;
              })
            }
          >
            <span className="swatch" style={{ background: s.color }} aria-hidden />
            {s.label}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`${gradId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={i === 0 ? 0.12 : 0.18} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="#eceae2" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={shortDay}
            tick={AXIS_STYLE}
            axisLine={{ stroke: "#e4e2d9" }}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            content={
              <ChartTooltip
                series={series}
                footer={
                  footer
                    ? (row) => footer(row)
                    : undefined
                }
              />
            }
          />
          {compareKey && !off.has(compareKey) ? (
            <Line
              type="monotone"
              dataKey={compareKey}
              stroke="#a3a094"
              strokeWidth={1.4}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
          {visible.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={i === 0 ? 2 : 1.6}
              fill={`url(#${gradId}-${s.key})`}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Cumulative area chart (waitlist growth, REQ-052). */
export function CumulativeChart({
  data,
  height = 260,
  label = "Total waitlist",
}: {
  data: Array<{ day: string; total: number }>;
  height?: number;
  label?: string;
}) {
  const series: Array<SeriesDef & { color: string }> = [
    { key: "total", label, color: "#0b0c0e" },
  ];
  return (
    <TrendChart data={data} series={series} height={height} />
  );
}

/** Compact bar chart (daily counts). */
export function DailyBars({
  data,
  valueKey = "count",
  label = "Count",
  height = 220,
  color = "#0b0c0e",
}: {
  data: Array<Record<string, string | number>>;
  valueKey?: string;
  label?: string;
  height?: number;
  color?: string;
}) {
  const series: SeriesDef[] = [{ key: valueKey, label }];
  if (data.length === 0) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#a3a094",
          fontSize: 13,
          border: "1px dashed #e4e2d9",
          borderRadius: 10,
        }}
      >
        No data in this window yet.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#eceae2" vertical={false} />
        <XAxis dataKey="day" tickFormatter={shortDay} tick={AXIS_STYLE} axisLine={{ stroke: "#e4e2d9" }} tickLine={false} minTickGap={28} />
        <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={44} />
        <Tooltip content={<ChartTooltip series={series} />} />
        <Bar dataKey={valueKey} fill={color} radius={[2, 2, 0, 0]} maxBarSize={22} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical funnel bars (conversion journey, REQ-036). Client-side hover. */
export function FunnelBars({
  steps,
  height = 220,
}: {
  steps: Array<{ label: string; value: number }>;
  height?: number;
}) {
  const series: SeriesDef[] = [{ key: "value", label: "People" }];
  const data = useMemo(
    () => steps.map((s) => ({ day: s.label, value: s.value })),
    [steps]
  );
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="day"
          tick={{ fontSize: 11.5, fill: "#737373" }}
          axisLine={false}
          tickLine={false}
          width={110}
        />
        <Tooltip content={<ChartTooltip series={series} />} />
        <Bar dataKey="value" fill="#3d5afe" opacity={0.8} radius={[0, 3, 3, 0]} maxBarSize={26} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Restrained daily heatmap (REQ-043): ink intensity, weekday columns. */
export function ActivityHeatmap({
  data,
}: {
  data: Array<{ day: string; value: number }>;
}) {
  const [hover, setHover] = useState<{ day: string; value: number } | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const cells = data.slice(-63); // 9 weeks
  const weeks: Array<Array<{ day: string; value: number } | null>> = [];
  let week: Array<{ day: string; value: number } | null> = [];
  cells.forEach((d, i) => {
    const dow = new Date(`${d.day}T00:00:00Z`).getUTCDay();
    if (i === 0 && dow > 0) week = Array.from({ length: dow }, () => null);
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  });
  if (week.length > 0) weeks.push(week);

  return (
    <div>
      <div style={{ display: "flex", gap: 3 }}>
        {weeks.map((w, wi) => (
          <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {w.map((d, di) =>
              d ? (
                <div
                  key={d.day}
                  onMouseEnter={() => setHover(d)}
                  onMouseLeave={() => setHover(null)}
                  title={`${d.day}: ${d.value.toLocaleString()}`}
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 2.5,
                    background: d.value > 0 ? `rgba(61, 90, 254, ${0.18 + 0.72 * (d.value / max)})` : "#eceae2",
                  }}
                />
              ) : (
                <div key={`pad-${wi}-${di}`} style={{ width: 11, height: 11 }} />
              )
            )}
          </div>
        ))}
      </div>
      <p className="mono" style={{ fontSize: 11, color: "#a3a094", marginTop: 8, minHeight: 14 }}>
        {hover ? `${longDay(hover.day)} · ${hover.value.toLocaleString()}` : "Hover a day for detail"}
      </p>
    </div>
  );
}
