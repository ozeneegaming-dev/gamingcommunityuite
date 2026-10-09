import { FOOTER_ACP_SECTION, FOOTER_MAX_COLUMNS, FOOTER_MAX_LINKS } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { footerView } from "@/lib/footer";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsFooterEditor } from "./GcsFooterEditor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.footer"))("title") };
}

/**
 * ACP → Aspect → Subsol (specul 2026-10-10-tema-nova §5): coloana „Despre”, cele cel mult 4 coloane de linkuri și bara de
 * jos. Fără o configurație salvată, formularul pornește de la subsolul implicit (tradus în limba adminului, construit
 * din aplicațiile pornite), pe care site-ul îl arată deja.
 */
export default async function AcpFooterPage() {
  const panel = await requireAcpSection(FOOTER_ACP_SECTION);
  const [t, view] = await Promise.all([getTranslations("acp.footer"), footerView(panel.actor)]);
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-shoe-prints">{t("title")}</GcsAcpTitle>
      <GcsCard as="section" style={{ padding: 20, maxWidth: 1000, display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>
          {t("intro")}{" "}
          <Link href="/" target="_blank" rel="noopener">
            <GcsIcon name="fa-solid fa-arrow-up-right-from-square" className="gcs-hIcon" />
            {t("preview")}
          </Link>
        </p>
        {view.isDefault && (
          <p className="gcs-notice" role="status" data-testid="gcs-footer-defaults">
            {t("usingDefaults")}
          </p>
        )}
        <GcsFooterEditor initial={view.config} isDefault={view.isDefault} maxColumns={FOOTER_MAX_COLUMNS} maxLinks={FOOTER_MAX_LINKS} />
      </GcsCard>
    </>
  );
}
