import type { JSONContent } from "@tiptap/core";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsSignatureForm } from "../../_components/settings/GcsSettingsExtra";
import { GcsPrefToggle } from "../../_components/settings/GcsSettingsV2";
import { GcsIcon } from "@gcs/ui/icons";
import { SETTINGS_ICONS } from "../../_components/settings/sections";
import { GcsNamedHtml } from "@/lib/member-names";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.signature") };
}

/**
 * Setări → Semnătură (specul `2026-10-07-editor-campuri`): editorul compact (formatare, link, imagini mici din adrese),
 * sanitizat de server, cu limitele site-ului și ale grupului.
 */
export default async function SignatureSettingsPage() {
  const actor = await currentActor();
  const { db, profiles } = services();
  const [t, user, limits, prefs] = await Promise.all([
    getTranslations("settings.signature"),
    db.user.findUniqueOrThrow({ where: { id: actor.userId! }, select: { signatureJson: true, signatureHtml: true } }),
    profiles.signatureLimits(actor),
    services().memberPrefs.get(actor.userId!),
  ]);
  const max = limits.maxChars;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.signature} className="gcs-hIcon" />
        {t("title")}
      </h2>
      {/* Setările contului v2: regulile semnăturii și „arată semnăturile celorlalți”. */}
      <section className="gcs-settingsFieldset" aria-labelledby="gcs-signature-rules" data-testid="gcs-signature-rules">
        <h3 id="gcs-signature-rules" className="gcs-settingsSubtitle">
          <GcsIcon name="fa-solid fa-scale-balanced" className="gcs-hIcon" />
          {t("rules.title")}
        </h3>
        <ul className="gcs-rulesList">
          <li>{max > 0 ? t("rules.chars", { max }) : t("rules.off")}</li>
          <li>{limits.maxImages > 0 ? t("rules.images", { images: limits.maxImages }) : t("rules.noImages")}</li>
          <li>{t("rules.noVideo")}</li>
          <li>{t("rules.links")}</li>
          <li>{t("rules.mentions")}</li>
          <li>{t("rules.conduct")}</li>
        </ul>
      </section>
      <GcsPrefToggle name="showSignatures" value={prefs.showSignatures} label={t("showOthers")} hint={t("showOthersHint")} saved={t("saved")} />
      <GcsSignatureForm
        initial={(user.signatureJson as JSONContent | null) ?? null}
        maxLength={max}
        maxImages={limits.maxImages}
        hasSignature={user.signatureHtml !== ""}
        labels={{
          save: t("save"),
          remove: t("remove"),
          saved: t("saved"),
          hint: limits.maxImages > 0 ? t("hintImages", { max, images: limits.maxImages }) : t("hint", { max }),
          disabled: t("disabled"),
          label: t("label"),
        }}
      />
      {user.signatureHtml && (
        <div>
          <h3 className="gcs-settingsSubtitle">
            <GcsIcon name="fa-solid fa-eye" className="gcs-hIcon" />
            {t("preview")}
          </h3>
          <GcsNamedHtml className="gcs-post__signature gcs-postBody" data-testid="gcs-signature-preview" html={user.signatureHtml} />
        </div>
      )}
    </div>
  );
}
