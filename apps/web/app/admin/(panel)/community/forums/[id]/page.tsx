import { FORUMS_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsIconPicker } from "@gcs/ui";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { deleteForum, setForumPrefixes, updateForum } from "../actions";

type Props = { params: Promise<{ id: string }> };

async function load(raw: string) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) return null;
  return services().db.forum.findUnique({ where: { id }, include: { prefixes: { select: { prefixId: true } }, _count: { select: { topics: true } } } });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const forum = await load((await params).id);
  return forum ? { title: (await getTranslations("acp.forums"))("form.title", { name: forum.name }) } : {};
}

/** Editarea unui forum: detalii, prefixe permise, permisiuni și ștergere. */
export default async function AcpForumPage({ params }: Props) {
  await requireAcpSection(FORUMS_ACP_SECTION);
  const forum = await load((await params).id);
  if (!forum) notFound();
  const t = await getTranslations("acp.forums");
  const { db, prefixes } = services();
  const [allPrefixes, targets] = await Promise.all([
    prefixes.list(),
    db.forum.findMany({ where: { type: { in: ["FORUM", "QA"] }, id: { not: forum.id } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const allowed = new Set(forum.prefixes.map((p) => p.prefixId));
  const isCategory = forum.type === "CATEGORY";
  const hostsTopics = forum.type === "FORUM" || forum.type === "QA";

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("form.title", { name: forum.name })}
      </h1>
      <p style={{ margin: 0, display: "flex", gap: 16 }}>
        <Link href="/admin/community/forums">{t("title")}</Link>
        <Link href={`/admin/permissions/forum/${forum.id}`}>{t("permissions")}</Link>
        <Link href={`/forum/${forum.id}-${forum.slug}`}>{t("view")}</Link>
      </p>

      <GcsCard as="section" aria-label={t("form.title", { name: forum.name })} style={{ padding: 16, maxWidth: 640 }}>
        <GcsActionForm action={updateForum.bind(null, forum.id)} submitLabel={t("form.save")}>
          <label className="gcs-field">
            {t("form.name")}
            <input className="gcs-input" name="name" defaultValue={forum.name} required maxLength={100} />
          </label>
          <label className="gcs-field">
            {t("form.description")}
            <textarea className="gcs-input" name="description" defaultValue={forum.description} maxLength={500} rows={3} />
          </label>
          {!isCategory && (
            <div className="gcs-field">
              <label htmlFor="gcs-acp-type">{t("form.type")}</label>
              <select id="gcs-acp-type" className="gcs-input" name="type" defaultValue={forum.type}>
                {(["FORUM", "QA", "LINK"] as const).map((type) => (
                  <option key={type} value={type}>
                    {t(`types.${type}`)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="gcs-field" role="group" aria-label={t("form.icon")}>
            <span>{t("form.icon")}</span>
            <GcsIconPicker
              name="icon"
              value={forum.icon}
              searchUrl="/api/icons/search"
              labels={{ search: t("form.iconSearch"), none: t("form.iconNone"), noResults: t("form.iconNoResults") }}
            />
          </div>
          {!isCategory && (
            <div className="gcs-field">
              <label htmlFor="gcs-acp-subcols">{t("form.subforumColumns")}</label>
              <select id="gcs-acp-subcols" className="gcs-input" name="subforumColumns" defaultValue={String(forum.subforumColumns)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label className="gcs-field">
            {t("form.color")}
            <input className="gcs-input" name="color" defaultValue={forum.color ?? ""} placeholder="#D62839" pattern="#[0-9A-Fa-f]{6}" />
          </label>
          {!isCategory && (
            <label className="gcs-field">
              {t("form.linkUrl")}
              <input className="gcs-input" name="linkUrl" type="url" defaultValue={forum.linkUrl ?? ""} />
            </label>
          )}
          {hostsTopics && (
            <label className="gcs-check">
              <input type="checkbox" name="requireApproval" defaultChecked={forum.requireApproval} />
              {t("form.requireApproval")}
            </label>
          )}
        </GcsActionForm>
      </GcsCard>

      {hostsTopics && allPrefixes.length > 0 && (
        <GcsCard as="section" aria-label={t("form.prefixes")} style={{ padding: 16, maxWidth: 640 }}>
          <GcsActionForm action={setForumPrefixes.bind(null, forum.id)} submitLabel={t("form.savePrefixes")}>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <legend style={{ marginBottom: 8 }}>{t("form.prefixes")}</legend>
              {allPrefixes.map((p) => (
                <label key={p.id} className="gcs-check">
                  <input type="checkbox" name="prefixId" value={p.id} defaultChecked={allowed.has(p.id)} />
                  <span style={{ color: p.color, fontWeight: 700 }}>{p.name}</span>
                </label>
              ))}
            </fieldset>
          </GcsActionForm>
        </GcsCard>
      )}

      <GcsCard as="section" aria-label={t("form.delete")} style={{ padding: 16, maxWidth: 640 }}>
        <p className="gcs-muted" style={{ marginTop: 0 }}>
          {t("form.deleteHelp")}
        </p>
        <GcsActionForm action={deleteForum.bind(null, forum.id)} submitLabel={t("form.delete")} variant="ghost" redirectTo="/admin/community/forums" confirm={t("form.confirmDelete")}>
          {forum._count.topics > 0 ? (
            <div className="gcs-field">
              <label htmlFor="gcs-acp-moveContentTo">{t("form.moveContentTo")}</label>
              <select id="gcs-acp-moveContentTo" className="gcs-input" name="moveContentTo" required>
                {targets.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <span className="gcs-muted">{t("form.noMove")}</span>
          )}
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
