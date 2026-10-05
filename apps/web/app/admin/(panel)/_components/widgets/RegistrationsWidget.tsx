"use client";

import { GcsChart, type GcsChartType } from "@gcs/ui";
import { useState } from "react";

type Props = {
  data: { x: string; y: number }[];
  labels: { area: string; column: string; bar: string; csv: string; series: string; subtitle: string };
};

/** Widgetul „Înregistrări noi”: grafic pe ultimele 14 zile, cu tipul de grafic și export CSV. */
export function RegistrationsWidget({ data, labels }: Props) {
  const [type, setType] = useState<GcsChartType>("column");
  const short = data.map((d) => ({ x: d.x.slice(5).split("-").reverse().join("."), y: d.y }));
  return (
    <div style={{ padding: "16px 20px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 12, color: "var(--gcs-muted)" }}>{labels.subtitle}</span>
      <GcsChart data={short} type={type} onTypeChange={setType} csvHref="/admin/registrations.csv" labels={labels} height={220} />
    </div>
  );
}
