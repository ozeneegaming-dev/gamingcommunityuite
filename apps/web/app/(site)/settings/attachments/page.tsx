import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.attachments") };
}

const SHOWN = 100;

/** Mărimea unui fișier, scurt (KB / MB). */
const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * „Atașamentele mele” (meniul contului, specul 2026-10-10-hero-cockpit §3): fișierele încărcate de membru, cele noi
 * primele, cu tipul, mărimea și data; imaginile au o miniatură și se deschid.
 */
export default async function AttachmentsSettingsPage() {
  const actor = await currentActor();
  const [t, format] = await Promise.all([getTranslations("settings.attachments"), getFormatter()]);
  const [files, total] = await Promise.all([
    services().db.attachment.findMany({
      where: { ownerId: actor.userId! },
      orderBy: { createdAt: "desc" },
      take: SHOWN,
      select: { id: true, filename: true, mime: true, size: true, createdAt: true },
    }),
    services().db.attachment.count({ where: { ownerId: actor.userId! } }),
  ]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid="gcs-settings-attachments">
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.attachments} className="gcs-hIcon" />
        {t("title")}
      </h2>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("intro", { count: total })}
      </p>
      {files.length === 0 ? (
        <p className="gcs-emptyState">{t("empty")}</p>
      ) : (
        <ul className="gcs-attachList">
          {files.map((f) => (
            <li key={f.id} className="gcs-attachList__item">
              {f.mime.startsWith("image/") ? (
                <a href={`/files/${f.id}`} target="_blank" rel="noopener" className="gcs-attachList__thumb">
                  <img src={`/files/${f.id}`} alt="" loading="lazy" />
                </a>
              ) : (
                <span className="gcs-attachList__thumb" aria-hidden="true">
                  <GcsIcon name="fa-solid fa-file" />
                </span>
              )}
              <span className="gcs-attachList__text">
                <a href={`/files/${f.id}`} target="_blank" rel="noopener">
                  {f.filename}
                </a>
                <span className="gcs-muted">
                  {size(f.size)} · {format.dateTime(f.createdAt, { dateStyle: "medium" })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
