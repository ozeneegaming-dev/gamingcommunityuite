import { services } from "@/lib/services";

/** Grupurile site-ului (fără Banat), pentru căsuțele de acces din ACP › Pagini. */
export async function pagesGroups() {
  return services().db.group.findMany({ where: { key: { notIn: ["banned"] } }, orderBy: { position: "asc" }, select: { id: true, name: true, key: true } });
}

/** Căsuțele unui set de grupuri (gol = toți), cu ajutorul de sub titlu. */
export function GroupChecks({ name, groups, selected, legend, hint }: { name: string; groups: { id: number; name: string }[]; selected: number[]; legend: string; hint?: string }) {
  const set = new Set(selected);
  return (
    <fieldset className="gcs-formSec">
      <legend>{legend}</legend>
      <input type="hidden" name={`has.${name}`} value="1" />
      {hint && <p className="gcs-muted gcs-acpHint">{hint}</p>}
      <div className="gcs-forumAudience">
        {groups.map((g) => (
          <label key={g.id} className="gcs-check">
            <input type="checkbox" name={name} value={g.id} defaultChecked={set.has(g.id)} />
            {g.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Un comutator (căsuța + `has.<nume>`, ca o căsuță debifată să conteze și ea). */
export function Toggle({ name, label, hint, checked }: { name: string; label: string; hint?: string; checked: boolean }) {
  return (
    <label className="gcs-toggleRow">
      <span>
        {label}
        {hint && <small className="gcs-achHint">{hint}</small>}
      </span>
      <input type="hidden" name={`has.${name}`} value="1" />
      <input type="checkbox" name={name} defaultChecked={checked} />
    </label>
  );
}

/** Imaginile din biblioteca media (selectul imaginii de distribuire, al copertei unei categorii). */
export async function mediaImages() {
  const rows = await services().db.pagesMedia.findMany({ orderBy: { createdAt: "desc" }, take: 300, select: { id: true, title: true, attachmentId: true } });
  const images = new Set((await services().db.attachment.findMany({ where: { id: { in: rows.map((r) => r.attachmentId) }, mime: { startsWith: "image/" } }, select: { id: true } })).map((a) => a.id));
  return rows.filter((r) => images.has(r.attachmentId));
}
