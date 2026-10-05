import { PREFIXES_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { createPrefix, deletePrefix, updatePrefix } from "../forums/actions";
import { PrefixOrder } from "./PrefixOrder";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.prefixes"))("title") };
}

/** ACP → Comunitate → Prefixe: lista (ordine, nume, culoare) și adăugarea unui prefix. */
export default async function AcpPrefixesPage() {
  await requireAcpSection(PREFIXES_ACP_SECTION);
  const t = await getTranslations("acp.prefixes");
  const prefixes = await services().prefixes.list();

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("title")}
      </h1>
      <GcsCard as="section" aria-label={t("title")} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {prefixes.length === 0 ? (
          <p className="gcs-muted">{t("empty")}</p>
        ) : (
          <PrefixOrder key={prefixes.map((p) => p.id).join(",")} prefixes={prefixes.map((p) => ({ id: p.id, name: p.name, color: p.color }))} />
        )}
        {prefixes.map((p) => (
          <div key={p.id} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <GcsActionForm action={updatePrefix.bind(null, p.id)} submitLabel={t("save")} compact>
              <label className="gcs-field">
                <span className="gcs-srOnly">{t("name")}</span>
                <input className="gcs-input" name="name" defaultValue={p.name} required maxLength={30} aria-label={`${t("name")}: ${p.name}`} />
              </label>
              <label className="gcs-field">
                <span className="gcs-srOnly">{t("color")}</span>
                <input className="gcs-input" name="color" defaultValue={p.color} pattern="#[0-9A-Fa-f]{6}" aria-label={`${t("color")}: ${p.name}`} style={{ width: 110 }} />
              </label>
            </GcsActionForm>
            <GcsActionForm action={deletePrefix.bind(null, p.id)} submitLabel={t("delete")} variant="ghost" compact />
          </div>
        ))}
      </GcsCard>
      <GcsCard as="section" aria-labelledby="gcs-prefix-create" style={{ padding: 16, maxWidth: 520 }}>
        <h2 id="gcs-prefix-create" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          {t("create")}
        </h2>
        <GcsActionForm action={createPrefix} submitLabel={t("create")}>
          <label className="gcs-field">
            {t("name")}
            <input className="gcs-input" name="name" required maxLength={30} />
          </label>
          <label className="gcs-field">
            {t("color")}
            <input className="gcs-input" name="color" defaultValue="#5EA2FF" pattern="#[0-9A-Fa-f]{6}" required />
          </label>
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
