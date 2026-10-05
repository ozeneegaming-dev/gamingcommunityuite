/** Disponibilitatea unui stil de nume sau a unei rame: pentru toți, pe grupuri sau pe badge-uri. */
export function Availability({
  value,
  groups,
  badges,
  labels,
}: {
  value: { allGroups: boolean; groupIds: number[]; badgeIds: number[] };
  groups: { id: number; name: string }[];
  badges: { id: number; name: string; symbol: string | null }[];
  labels: { title: string; all: string; groups: string; badges: string };
}) {
  return (
    <fieldset style={{ border: "1px solid var(--gcs-border)", borderRadius: 10, padding: 12, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <legend style={{ padding: "0 6px", fontWeight: 700 }}>{labels.title}</legend>
      <label className="gcs-check">
        <input type="checkbox" name="allGroups" defaultChecked={value.allGroups} />
        {labels.all}
      </label>
      <span className="gcs-muted" style={{ fontSize: 12 }}>
        {labels.groups}
      </span>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {groups.map((g) => (
          <label key={g.id} className="gcs-check">
            <input type="checkbox" name="groupIds" value={g.id} defaultChecked={value.groupIds.includes(g.id)} />
            {g.name}
          </label>
        ))}
      </div>
      <span className="gcs-muted" style={{ fontSize: 12 }}>
        {labels.badges}
      </span>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {badges.map((b) => (
          <label key={b.id} className="gcs-check">
            <input type="checkbox" name="badgeIds" value={b.id} defaultChecked={value.badgeIds.includes(b.id)} />
            {b.symbol} {b.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
