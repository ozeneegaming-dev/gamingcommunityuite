import { GcsIcon } from "@gcs/ui/icons";
import type { ReactNode } from "react";

/** Culorile cardurilor din dashboard (identitatea fiecărui card, tokenurile `--gcs-acp-c1…c6`). */
export type GcsAcpTone = 1 | 2 | 3 | 4 | 5 | 6;

/** Variația față de perioada anterioară, în procente (perioada anterioară goală: +100% dacă acum există date). */
export function changePct(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

type KpiProps = {
  label: string;
  value: string;
  icon: string;
  tone: GcsAcpTone;
  /** Variația în procente; `good` spune dacă o creștere e de bine (la rapoarte, nu). */
  change: { pct: number; good: "up" | "down"; text: string };
  /** Bara colorată: procentul (0–100) și textul ei. */
  bar: { pct: number; text: string };
  testId: string;
};

/**
 * Cardul KPI al dashboard-ului (etapa 6 §1.2, după Nalika): eticheta, valoarea, insigna verde/roșie cu săgeată
 * pentru variația față de cele 30 de zile anterioare și o bară colorată cu un raport explicat dedesubt.
 */
export function GcsAcpKpiCard({ label, value, icon, tone, change, bar, testId }: KpiProps) {
  const dir = change.pct > 0 ? "up" : change.pct < 0 ? "down" : "flat";
  const mood = dir === "flat" ? "flat" : dir === change.good ? "good" : "bad";
  const pct = Math.max(0, Math.min(100, bar.pct));
  return (
    <section className={`gcs-acpKpi gcs-acpKpi--${tone}`} aria-label={label} data-testid={testId}>
      <div className="gcs-acpKpi__head">
        <span className="gcs-acpKpi__icon" aria-hidden="true">
          <GcsIcon name={icon} />
        </span>
        <h2 className="gcs-acpKpi__label">{label}</h2>
      </div>
      <div className="gcs-acpKpi__row">
        <span className={`gcs-acpPill gcs-acpPill--${mood}`} title={change.text}>
          <GcsIcon name={dir === "up" ? "fa-solid fa-arrow-up" : dir === "down" ? "fa-solid fa-arrow-down" : "fa-solid fa-minus"} />
          {`${change.pct > 0 ? "+" : ""}${change.pct}%`}
          <span className="gcs-srOnly">{change.text}</span>
        </span>
        <strong className="gcs-acpKpi__value gcs-display" data-testid={`${testId}-value`}>
          {value}
        </strong>
      </div>
      <div className="gcs-acpKpi__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={bar.text}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="gcs-acpKpi__note">{bar.text}</p>
    </section>
  );
}

type SparkProps = {
  title: string;
  values: number[];
  days: string[];
  total: string;
  hint: ReactNode;
  icon: string;
  tone: GcsAcpTone;
  testId: string;
};

const SW = 160;
const SH = 48;

/**
 * Un mini-grafic (sparkline) pe 30 de zile: titlul, linia cu aria de sub ea și totalul. Fiecare zi are un `<title>`
 * (tooltip la hover); valorile complete stau în textul alternativ.
 */
export function GcsAcpSparkCard({ title, values, days, total, hint, icon, tone, testId }: SparkProps) {
  const n = values.length;
  const max = Math.max(1, ...values);
  const x = (i: number) => (n <= 1 ? SW / 2 : 2 + (i * (SW - 4)) / (n - 1));
  const y = (v: number) => SH - 3 - (v / max) * (SH - 8);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[n - 1] ?? 0;
  return (
    <section className={`gcs-acpSpark gcs-acpSpark--${tone}`} aria-label={title} data-testid={testId}>
      <div className="gcs-acpSpark__head">
        <h2 className="gcs-acpSpark__title">
          <GcsIcon name={icon} className="gcs-acpSpark__icon" />
          {title}
        </h2>
        <strong className="gcs-acpSpark__total gcs-display">{total}</strong>
      </div>
      <svg viewBox={`0 0 ${SW} ${SH}`} className="gcs-acpSpark__svg" role="img" aria-label={`${title}: ${values.join(", ")}`} preserveAspectRatio="none">
        <path d={`${line} L${x(n - 1).toFixed(1)},${SH} L${x(0).toFixed(1)},${SH} Z`} className="gcs-acpSpark__area" />
        <path d={line} className="gcs-acpSpark__line" vectorEffect="non-scaling-stroke" />
        {values.map((v, i) => (
          <rect key={days[i] ?? i} x={x(i) - SW / n / 2} y={0} width={SW / n} height={SH} className="gcs-acpSpark__hit">
            <title>{`${days[i] ?? ""}: ${v}`}</title>
          </rect>
        ))}
        <circle cx={x(n - 1)} cy={y(last)} r="2.5" className="gcs-acpSpark__end" />
      </svg>
      <p className="gcs-acpSpark__hint">{hint}</p>
    </section>
  );
}
