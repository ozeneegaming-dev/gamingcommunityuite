import type { JSONContent } from "@tiptap/core";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsSignatureForm } from "../../_components/settings/GcsSettingsExtra";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.signature") };
}

/** Setări → Semnătură (specul etapei 5): textul de sub postări, formatat, sanitizat de server, cu limită de lungime. */
export default async function SignatureSettingsPage() {
  const actor = await currentActor();
  const { db, settings } = services();
  const [t, user, max] = await Promise.all([
    getTranslations("settings.signature"),
    db.user.findUniqueOrThrow({ where: { id: actor.userId! }, select: { signatureJson: true, signatureHtml: true } }),
    settings.get<number>("profile.signature_max_chars"),
  ]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="gcs-settingsTitle">{t("title")}</h2>
      <GcsSignatureForm
        initial={(user.signatureJson as JSONContent | null) ?? null}
        maxLength={max}
        labels={{ save: t("save"), remove: t("remove"), saved: t("saved"), hint: t("hint", { max }) }}
      />
      {user.signatureHtml && (
        <div>
          <h3 className="gcs-settingsSubtitle">{t("preview")}</h3>
          <div className="gcs-post__signature gcs-postBody" data-testid="gcs-signature-preview" dangerouslySetInnerHTML={{ __html: user.signatureHtml }} />
        </div>
      )}
    </div>
  );
}
