import { getLocale, getTranslations } from "next-intl/server";
import { GCS_LOCALES } from "@/i18n";
import { setLocale } from "../actions";

export async function GcsSiteFooter() {
  const t = await getTranslations("site");
  const locale = await getLocale();
  return (
    <footer style={{ borderTop: "1px solid var(--gcs-border)", marginTop: 48 }}>
      <div
        style={{
          maxWidth: 1320,
          margin: "0 auto",
          padding: "20px 24px",
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          justifyContent: "space-between",
          alignItems: "center",
          color: "var(--gcs-muted)",
          fontSize: 13,
        }}
      >
        <span>{t("footer")}</span>
        <form action={setLocale} style={{ display: "flex", gap: 4, alignItems: "center" }} aria-label={t("language")}>
          {GCS_LOCALES.map((l) => (
            <button
              key={l}
              type="submit"
              name="locale"
              value={l}
              className={l === locale ? "gcs-seg gcs-seg--active" : "gcs-seg"}
              aria-pressed={l === locale}
              lang={l}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </form>
      </div>
    </footer>
  );
}
