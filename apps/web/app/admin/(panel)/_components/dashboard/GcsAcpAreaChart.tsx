"use client";

import { useId, useState, type PointerEvent } from "react";

type Series = { key: string; label: string; values: number[] };

type Props = {
  /** Zilele (`YYYY-MM-DD`), cea mai veche prima; aceeași lungime ca fiecare serie. */
  days: string[];
  /** Două serii pe aceeași scară (aceeași unitate: număr pe zi). */
  series: [Series, Series];
  labels: { title: string; caption: string; day: string };
  /** Numerele formatate în limba paginii (vin de pe server). */
  locale: string;
};

const W = 720;
const H = 260;
const PAD = { top: 16, right: 16, bottom: 30, left: 40 };
const CW = W - PAD.left - PAD.right;
const CH = H - PAD.top - PAD.bottom;

/** Un maxim „rotund” pentru axa Y (1, 2, 5 × 10ⁿ), ca liniile de grilă să cadă pe valori ușor de citit. */
function niceMax(max: number): number {
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

const shortDay = (d: string) => d.slice(5).split("-").reverse().join(".");

/**
 * Graficul de arie al dashboard-ului (etapa 6 §1.2), desenat direct în SVG: două serii pe 30 de zile, legendă,
 * linie de urmărire cu tooltip la hover / focus (săgețile mută ziua) și un tabel ascuns vizual pentru cititoarele
 * de ecran. Curbele nu depășesc valorile reale (tangente orizontale în puncte).
 */
export function GcsAcpAreaChart({ days, series, labels, locale }: Props) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const n = days.length;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const fmt = new Intl.NumberFormat(locale);
  const x = (i: number) => PAD.left + (n <= 1 ? CW / 2 : (i * CW) / (n - 1));
  const y = (v: number) => PAD.top + CH - (v / max) * CH;
  const baseline = PAD.top + CH;

  const line = (values: number[]) =>
    values
      .map((v, i) => {
        if (i === 0) return `M${x(0).toFixed(1)},${y(v).toFixed(1)}`;
        const xm = ((x(i - 1) + x(i)) / 2).toFixed(1);
        return `C${xm},${y(values[i - 1]!).toFixed(1)} ${xm},${y(v).toFixed(1)} ${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      })
      .join(" ");
  const area = (values: number[]) => `${line(values)} L${x(n - 1).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const step = Math.max(1, Math.ceil(n / 6));

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.left) / CW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  }

  const tip = hover !== null ? { left: `${(x(hover) / W) * 100}%`, flip: hover > n * 0.6 } : null;

  return (
    <figure className="gcs-acpArea" data-testid="gcs-acp-area-chart">
      <ul className="gcs-acpArea__legend">
        {series.map((s, i) => (
          <li key={s.key}>
            <span className={`gcs-acpArea__swatch gcs-acpArea__swatch--${i + 1}`} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="gcs-acpArea__plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="gcs-acpArea__svg"
          role="img"
          aria-labelledby={`${id}-title`}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover((h) => h ?? n - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              setHover((h) => Math.min(n - 1, Math.max(0, (h ?? n - 1) + (e.key === "ArrowLeft" ? -1 : 1))));
            } else if (e.key === "Escape") {
              setHover(null);
            }
          }}
        >
          <title id={`${id}-title`}>{labels.title}</title>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`${id}-fill-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" className={`gcs-acpArea__stop gcs-acpArea__stop--${i + 1}`} stopOpacity="0.32" />
                <stop offset="100%" className={`gcs-acpArea__stop gcs-acpArea__stop--${i + 1}`} stopOpacity="0.02" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((v) => (
            <g key={v} className="gcs-acpArea__grid">
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
              <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end">
                {fmt.format(v)}
              </text>
            </g>
          ))}
          {days.map((d, i) =>
            i % step === 0 || i === n - 1 ? (
              <text key={d} className="gcs-acpArea__xLabel" x={x(i)} y={H - 8} textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"}>
                {shortDay(d)}
              </text>
            ) : null,
          )}
          {series.map((s, i) => (
            <path key={`a-${s.key}`} d={area(s.values)} fill={`url(#${id}-fill-${i})`} />
          ))}
          {series.map((s, i) => (
            <path key={`l-${s.key}`} d={line(s.values)} className={`gcs-acpArea__line gcs-acpArea__line--${i + 1}`} />
          ))}
          {hover !== null && (
            <g className="gcs-acpArea__cursor" aria-hidden="true">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={baseline} />
              {series.map((s, i) => (
                <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="5" className={`gcs-acpArea__dot gcs-acpArea__dot--${i + 1}`} />
              ))}
            </g>
          )}
        </svg>
        {hover !== null && tip && (
          <div className={`gcs-acpArea__tip${tip.flip ? " gcs-acpArea__tip--flip" : ""}`} style={{ left: tip.left }} aria-hidden="true">
            <strong>{shortDay(days[hover]!)}</strong>
            {series.map((s, i) => (
              <span key={s.key}>
                <span className={`gcs-acpArea__swatch gcs-acpArea__swatch--${i + 1}`} />
                {s.label}: <b>{fmt.format(s.values[hover] ?? 0)}</b>
              </span>
            ))}
          </div>
        )}
      </div>
      <table className="gcs-srOnly">
        <caption>{labels.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.day}</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d, i) => (
            <tr key={d}>
              <th scope="row">{d}</th>
              {series.map((s) => (
                <td key={s.key}>{s.values[i] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
