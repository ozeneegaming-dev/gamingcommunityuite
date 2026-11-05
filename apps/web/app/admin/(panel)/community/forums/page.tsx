import { FORUMS_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { resolveIcon } from "@gcs/ui/icon-registry";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsIconInput } from "@/lib/ui-inputs";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { createForum } from "./actions";
import { ForumTree } from "./ForumTree";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.forums"))("title") };
}

/** ACP → Comunitate → Forumuri: arborele (ordine și părinți) și crearea unui forum nou. */
export default async function AcpForumsPage() {
  await requireAcpSection(FORUMS_ACP_SECTION);
  const t = await getTranslations("acp.forums");
  const tw = await getTranslations("acp.serverWizard");
  const forums = await services().db.forum.findMany({
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, parentId: true, type: true, name: true, slug: true, position: true, icon: true },
  });
  const parents = forums.filter((f) => f.type !== "LINK");
  // Iconița fiecărui forum se rezolvă aici: la client ajung doar datele SVG (fără pachetele Font Awesome).
  const nodes = forums.map(({ icon, ...f }) => {
    const def = resolveIcon(icon);
    return { ...f, icon: def ? { prefix: def.prefix, iconName: def.iconName, icon: def.icon } : null };
  });

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-comments"
        actions={
          // Asistentul „Creează categorie” (simplă sau, cu aplicația Servere, de servere).
          <Link href="/admin/community/forums/new-category" className="gcs-btn gcs-btn--primary" data-testid="gcs-forum-wizard-open">
            <GcsIcon name="fa-solid fa-folder-plus" />
            {tw("createButton")}
          </Link>
        }
      >
        {t("title")}
      </GcsAcpTitle>
      <GcsCard as="section" aria-label={t("tree")} style={{ padding: 16 }}>
        {/* Lista se reinițializează când se schimbă structura (ex. după „Creează”). */}
        <ForumTree key={forums.map((f) => `${f.id}:${f.parentId}:${f.position}:${f.name}:${f.icon ?? ""}`).join(",")} forums={nodes} />
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
              {(["CATEGORY", "FORUM", "QA", "LINK", "PAGE"] as const).map((type) => (
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
          <div className="gcs-field" role="group" aria-label={t("form.icon")}>
            <span>{t("form.icon")}</span>
            <GcsIconInput name="icon" value={null} testId="gcs-forum-icon" />
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
