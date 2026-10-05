import { FORUMS_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { createForum } from "./actions";
import { ForumTree } from "./ForumTree";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.forums"))("title") };
}

/** ACP → Comunitate → Forumuri: arborele (ordine și părinți) și crearea unui forum nou. */
export default async function AcpForumsPage() {
  await requireAcpSection(FORUMS_ACP_SECTION);
  const t = await getTranslations("acp.forums");
  const forums = await services().db.forum.findMany({
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, parentId: true, type: true, name: true, slug: true, position: true },
  });
  const parents = forums.filter((f) => f.type !== "LINK");

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("title")}
      </h1>
      <GcsCard as="section" aria-label={t("tree")} style={{ padding: 16 }}>
        {/* Lista se reinițializează când se schimbă structura (ex. după „Creează”). */}
        <ForumTree key={forums.map((f) => `${f.id}:${f.parentId}:${f.position}:${f.name}`).join(",")} forums={forums} />
      </GcsCard>
      <GcsCard as="section" aria-labelledby="gcs-forum-create" style={{ padding: 16, maxWidth: 560 }}>
        <h2 id="gcs-forum-create" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          {t("create.title")}
        </h2>
        <GcsActionForm action={createForum} submitLabel={t("create.submit")}>
          <label className="gcs-field">
            {t("create.name")}
            <input className="gcs-input" name="name" required maxLength={100} />
          </label>
          <div className="gcs-field">
            <label htmlFor="gcs-acp-type">{t("create.type")}</label>
            <select id="gcs-acp-type" className="gcs-input" name="type" defaultValue="FORUM">
              {(["CATEGORY", "FORUM", "QA", "LINK"] as const).map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="gcs-field">
            <label htmlFor="gcs-acp-parentId">{t("create.parent")}</label>
            <select id="gcs-acp-parentId" className="gcs-input" name="parentId" defaultValue="">
              <option value="">{t("root")}</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <label className="gcs-field">
            {t("form.linkUrl")}
            <input className="gcs-input" name="linkUrl" type="url" placeholder="https://" />
          </label>
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
