import { GcsIcon } from "@gcs/ui/icons";
import { getTranslations } from "next-intl/server";
import { GcsNamedHtml } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsAcceptRulesButton } from "./GcsForumGates";

/**
 * Caseta regulilor unui forum (Forum v2, opțiunea „Reguli”): afișată sus pe pagina forumului (și pe formularul unui
 * topic nou); cu „de acceptat”, membrii care nu le-au acceptat văd butonul, iar postarea le e refuzată până atunci.
 */
export async function GcsForumRulesBox({ forumId, html, mode, userId }: { forumId: number; html: string; mode: "show" | "accept"; userId: string | null }) {
  const t = await getTranslations("forum.rules");
  const accepted =
    mode === "accept" && userId ? (await services().db.forumRulesAcceptance.findUnique({ where: { forumId_userId: { forumId, userId } }, select: { forumId: true } })) !== null : false;
  return (
    <details className="gcs-card gcs-forumRules" open={mode === "accept" && !accepted && userId !== null} data-testid="gcs-forum-rules">
      <summary className="gcs-forumRules__head">
        <GcsIcon name="fa-solid fa-scale-balanced" className="gcs-hIcon" />
        <span className="gcs-display">{t("title")}</span>
        {mode === "accept" && accepted && (
          <span className="gcs-forumRules__ok" data-testid="gcs-forum-rules-accepted">
            <GcsIcon name="fa-solid fa-circle-check" />
            {t("accepted")}
          </span>
        )}
      </summary>
      {/* HTML-ul regulilor, randat și sanitizat la salvare (editorul postărilor, cu blocurile staff-ului). */}
      <GcsNamedHtml className="gcs-postBody gcs-forumRules__body" html={html} />
      {mode === "accept" && !accepted && userId !== null && (
        <div className="gcs-forumRules__actions">
          <p className="gcs-muted">{t("mustAccept")}</p>
          <GcsAcceptRulesButton forumId={forumId} />
        </div>
      )}
    </details>
  );
}
