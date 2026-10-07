import type { JSONContent } from "@tiptap/core";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsSignatureForm } from "../../_components/settings/GcsSettingsExtra";
import { GcsIcon } from "@gcs/ui/icons";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

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
  const [t, user, limits] = await Promise.all([
    getTranslations("settings.signature"),
    db.user.findUniqueOrThrow({ where: { id: actor.userId! }, select: { signatureJson: true, signatureHtml: true } }),
    profiles.signatureLimits(actor),
  ]);
  const max = limits.maxChars;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.signature} className="gcs-hIcon" />
        {t("title")}
      </h2>
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
          <div className="gcs-post__signature gcs-postBody" data-testid="gcs-signature-preview" dangerouslySetInnerHTML={{ __html: user.signatureHtml }} />
        </div>
      )}
    </div>
  );
}
