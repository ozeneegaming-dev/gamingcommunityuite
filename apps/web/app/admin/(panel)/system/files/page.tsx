import { FILES_ACP_SECTION, GCS_FILE_KINDS, type GcsFileFilter, type GcsFileKind, type GcsFileRow, type GcsFileUse } from "@gcs/modules";
import { GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { GcsMemberLink } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { deleteFile } from "./actions";
import { FILES_BULK_FORM_ID, GcsFileBulkBar } from "./GcsFileBulkBar";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.files"))("title") };
}

type Search = { q?: string; kind?: string; area?: string; owner?: string; sort?: string; page?: string };
type Props = { searchParams: Promise<Search> };

const KIND_ICONS: Record<GcsFileKind, string> = {
  image: "fa-solid fa-image",
  video: "fa-solid fa-film",
  audio: "fa-solid fa-music",
  archive: "fa-solid fa-file-zipper",
  document: "fa-solid fa-file-lines",
  other: "fa-solid fa-file",
};

/** Linkul spre locul în care e folosit un fișier, dacă are o pagină. */
function useHref(u: GcsFileUse): string | null {
  if (u.kind === "forums.post") return `/p/${encodeURIComponent(u.id)}`;
  if (u.kind.startsWith("user.")) return `/admin/members/${encodeURIComponent(u.id)}`;
  if (u.kind.startsWith("theme.")) return "/admin/appearance/themes";
  if (u.kind === "rank") return "/admin/members/achievements/ranks";
  if (u.kind === "badge") return "/admin/members/achievements/badges";
  if (u.kind === "frame") return "/admin/vip/frames";
  if (u.kind === "emote" || u.kind === "chat.emote") return "/admin/community/chat-pro/emotes";
  if (u.kind === "server") return `/admin/gaming/servers/${encodeURIComponent(u.id)}`;
  if (u.kind === "clan") return `/admin/gaming/clans/${encodeURIComponent(u.id)}`;
  if (u.kind === "map") return "/admin/gaming/server-maps";
  return null;
}

/**
 * ACP › Sistem › Fișiere: toate fișierele încărcate, cu totalurile pe tip, filtre (nume, tip, zonă, nelegate),
 * sortare și paginare. Rândul deschide panoul fișierului (previzualizare, detalii, unde e folosit, descărcare,
 * ștergere); bifele permit ștergerea în masă. Setările încărcărilor (tipuri, mărimi, fișiere orfane) au pagina lor.
 */
export default async function AcpFilesPage({ searchParams }: Props) {
  const panel = await requireAcpSection(FILES_ACP_SECTION);
  const sp = await searchParams;
  const { fileAdmin, acp } = services();
  const kind = (GCS_FILE_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as GcsFileKind) : undefined;
  const sort = sp.sort === "old" || sp.sort === "big" ? sp.sort : "new";
  const filter: GcsFileFilter = {
    page: Number(sp.page) || 1,
    sort,
    ...(sp.q?.trim() ? { q: sp.q.trim().slice(0, 120) } : {}),
    ...(kind ? { kind } : {}),
    ...(sp.area && /^[a-z0-9_.-]{1,60}$/i.test(sp.area) ? { area: sp.area } : {}),
    ...(sp.owner && /^[A-Za-z0-9_-]{1,40}$/.test(sp.owner) ? { ownerId: sp.owner } : {}),
  };
  const [t, format, overview, result, canEdit] = await Promise.all([
    getTranslations("acp.files"),
    getFormatter(),
    fileAdmin.overview(),
    fileAdmin.list(filter),
    acp.can(panel.actor, FILES_ACP_SECTION, "edit"),
  ]);
  const uses = await fileAdmin.usageMany(result.items.map((f) => f.id));

  const bytes = (n: number) =>
    n >= 1e9 ? `${format.number(n / 1e9, { maximumFractionDigits: 2 })} GB` : n >= 1e6 ? `${format.number(n / 1e6, { maximumFractionDigits: 1 })} MB` : `${format.number(Math.max(1, Math.round(n / 1e3)))} KB`;
  const areaLabel = (area: string) => (t.has(`areas.${area.replace(/\./g, "_")}`) ? t(`areas.${area.replace(/\./g, "_")}`) : area);
  const href = (patch: Partial<Search>) => {
    const params = new URLSearchParams(Object.entries({ ...sp, page: undefined, ...patch }).filter(([, v]) => v) as [string, string][]);
    const qs = params.toString();
    return `/admin/system/files${qs ? `?${qs}` : ""}`;
  };
  const preview = (f: GcsFileRow, thumb: boolean) => `/admin/system/files/${encodeURIComponent(f.id)}${thumb ? "?thumb=1" : ""}`;

  const details = (f: GcsFileRow) => {
    const list = uses.get(f.id) ?? [];
    return (
      <div className="gcs-fileDetail">
        <div className="gcs-fileDetail__preview">
          {f.kind === "image" ? (
            <img src={preview(f, false)} alt={f.filename} />
          ) : f.kind === "video" ? (
            <video src={preview(f, false)} controls preload="metadata" />
          ) : (
            <span className="gcs-fileDetail__icon" aria-hidden="true">
              <GcsIcon name={KIND_ICONS[f.kind]} />
            </span>
          )}
        </div>
        <dl className="gcs-sysFacts">
          <div>
            <dt>{t("col.size")}</dt>
            <dd>{bytes(f.size)}</dd>
          </div>
          <div>
            <dt>{t("col.type")}</dt>
            <dd>
              {t(`kinds.${f.kind}`)} · <code>{f.mime}</code>
            </dd>
          </div>
          {f.width && f.height && (
            <div>
              <dt>{t("dimensions")}</dt>
              <dd>
                {f.width} × {f.height}
              </dd>
            </div>
          )}
          <div>
            <dt>{t("col.date")}</dt>
            <dd>{format.dateTime(f.createdAt, { dateStyle: "medium", timeStyle: "short" })}</dd>
          </div>
          <div>
            <dt>{t("col.owner")}</dt>
            <dd>{f.owner ? <GcsMemberLink user={f.owner} href={`/admin/members/${f.owner.id}`} /> : t("noOwner")}</dd>
          </div>
          <div className="gcs-sysFacts__wide">
            <dt>{t("usedIn")}</dt>
            <dd>
              {list.length === 0 ? (
                <span className="gcs-sysMuted">{t("unused")}</span>
              ) : (
                <ul className="gcs-fileUses" data-testid="gcs-file-uses">
                  {list.map((u, i) => {
                    const target = useHref(u);
                    const text = `${areaLabel(u.kind)}${u.label ? ` · ${u.label}` : ""}`;
                    return <li key={i}>{target ? <Link href={target}>{text}</Link> : text}</li>;
                  })}
                </ul>
              )}
            </dd>
          </div>
        </dl>
        <GcsButton variant="ghost" size="sm" asChild icon={<GcsIcon name="fa-solid fa-download" />}>
          <a href={preview(f, false)} download={f.filename}>
            {t("download")}
          </a>
        </GcsButton>
      </div>
    );
  };

  const tiles: { key: string; icon: string; value: string; label: string; href?: string }[] = [
    { key: "all", icon: "fa-solid fa-folder-open", value: format.number(overview.count), label: t("tiles.files", { size: bytes(overview.bytes) }), href: href({ kind: undefined, area: undefined }) },
    ...overview.kinds.map((k) => ({ key: k.kind, icon: KIND_ICONS[k.kind], value: format.number(k.count), label: t("tiles.kind", { kind: t(`kinds.${k.kind}`), size: bytes(k.bytes) }), href: href({ kind: k.kind }) })),
    { key: "none", icon: "fa-solid fa-link-slash", value: format.number(overview.unattached.count), label: t("tiles.unattached", { size: bytes(overview.unattached.bytes) }), href: href({ area: "none" }) },
  ];

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-folder-open"
        description={t("description")}
        actions={
          <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-sliders" />}>
            <Link href="/admin/settings/uploads" data-testid="gcs-files-settings">
              {t("settings")}
            </Link>
          </GcsButton>
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <ul className="gcs-acpTiles gcs-sysTiles" data-testid="gcs-files-tiles">
        {tiles.map((tile) => (
          <li key={tile.key} className="gcs-acpTile" data-tile={tile.key}>
            <Link href={tile.href ?? "#"} className="gcs-acpTile__inner">
              <span className="gcs-acpTile__icon" aria-hidden="true">
                <GcsIcon name={tile.icon} />
              </span>
              <span className="gcs-acpTile__value gcs-display">{tile.value}</span>
              <span className="gcs-acpTile__label">{tile.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="gcs-sysHint gcs-sysHint--page" data-testid="gcs-files-orphans">
        <GcsIcon name="fa-solid fa-broom" />{" "}
        {overview.orphanDays > 0 ? t("orphansOn", { days: overview.orphanDays }) : t("orphansOff")}{" "}
        <Link href="/admin/settings/uploads">{t("orphansChange")}</Link>
      </p>

      <GcsCard className="gcs-memberSearch">
        <form method="get" role="search" className="gcs-memberSearch__form">
          <div className="gcs-memberSearch__row gcs-fileSearch">
            <label className="gcs-field gcs-memberSearch__q">
              {t("search")}
              <input className="gcs-input" type="search" name="q" defaultValue={sp.q ?? ""} placeholder={t("searchPlaceholder")} />
            </label>
            <label className="gcs-field">
              {t("col.type")}
              <select className="gcs-input" name="kind" defaultValue={kind ?? ""} data-testid="gcs-files-kind">
                <option value="">{t("allKinds")}</option>
                {GCS_FILE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="gcs-field">
              {t("col.area")}
              <select className="gcs-input" name="area" defaultValue={filter.area ?? ""} data-testid="gcs-files-area">
                <option value="">{t("allAreas")}</option>
                <option value="none">{t("areaNone")}</option>
                {overview.areas.map((a) => (
                  <option key={a.area} value={a.area}>
                    {areaLabel(a.area)} ({format.number(a.count)})
                  </option>
                ))}
              </select>
            </label>
            <label className="gcs-field">
              {t("sort")}
              <select className="gcs-input" name="sort" defaultValue={sort}>
                {(["new", "old", "big"] as const).map((s) => (
                  <option key={s} value={s}>
                    {t(`sorts.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            {filter.ownerId && <input type="hidden" name="owner" value={filter.ownerId} />}
            <GcsButton variant="primary" type="submit" icon={<GcsIcon name="fa-solid fa-magnifying-glass" />}>
              {t("filter")}
            </GcsButton>
            <Link href="/admin/system/files" className="gcs-btn gcs-btn--ghost">
              <GcsIcon name="fa-solid fa-rotate-left" className="gcs-btn__icon" />
              {t("reset")}
            </Link>
          </div>
        </form>
      </GcsCard>

      <GcsCard className="gcs-memberList">
        <div className="gcs-memberList__head gcs-fileHead">
          <span className="gcs-memberList__total" data-testid="gcs-files-total">
            {t("total", { count: result.total })}
          </span>
          {canEdit && <GcsFileBulkBar />}
        </div>
        <div className="gcs-memberList__scroll">
          <table className="gcs-table__table gcs-fileTable">
            <caption className="gcs-srOnly">{t("title")}</caption>
            <thead>
              <tr>
                {canEdit && (
                  <th className="gcs-table__th gcs-memberTable__check" scope="col">
                    <input type="checkbox" data-files-all="" aria-label={t("bulk.selectAll")} className="gcs-checkbox" data-testid="gcs-files-select-all" />
                  </th>
                )}
                <th className="gcs-table__th" scope="col">{t("col.file")}</th>
                <th className="gcs-table__th" scope="col">{t("col.owner")}</th>
                <th className="gcs-table__th" scope="col">{t("col.area")}</th>
                <th className="gcs-table__th" scope="col">{t("col.size")}</th>
                <th className="gcs-table__th" scope="col">{t("col.date")}</th>
                <th className="gcs-table__th" scope="col">
                  <span className="gcs-srOnly">{t("col.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {result.items.length === 0 && (
                <tr>
                  <td className="gcs-table__td gcs-memberTable__empty" colSpan={canEdit ? 7 : 6}>
                    {t("empty")}
                  </td>
                </tr>
              )}
              {result.items.map((f) => (
                <tr key={f.id} className="gcs-table__row" data-testid="gcs-file-row" data-file={f.filename}>
                  {canEdit && (
                    <td className="gcs-table__td gcs-memberTable__check">
                      <input type="checkbox" name="ids" value={f.id} form={FILES_BULK_FORM_ID} className="gcs-checkbox" aria-label={t("bulk.select", { name: f.filename })} />
                    </td>
                  )}
                  <td className="gcs-table__td">
                    <span className="gcs-fileCell">
                      <span className="gcs-fileCell__thumb" aria-hidden="true">
                        {f.kind === "image" ? (
                          <img src={preview(f, true)} alt="" loading="lazy" />
                        ) : (
                          <GcsIcon name={KIND_ICONS[f.kind]} />
                        )}
                      </span>
                      <span className="gcs-fileCell__body">
                        <strong title={f.filename}>{f.filename}</strong>
                        <small>
                          {t(`kinds.${f.kind}`)}
                          {f.width && f.height ? ` · ${f.width} × ${f.height}` : ""}
                        </small>
                      </span>
                    </span>
                  </td>
                  <td className="gcs-table__td">
                    {f.owner ? (
                      <span className="gcs-fileOwner">
                        <GcsMemberLink user={f.owner} href={`/admin/members/${f.owner.id}`} />
                        <Link href={href({ owner: f.owner.id })} className="gcs-iconBtn" title={t("ownerFiles")} aria-label={t("ownerFiles")}>
                          <GcsIcon name="fa-solid fa-filter" />
                        </Link>
                      </span>
                    ) : (
                      <span className="gcs-sysMuted">{t("noOwner")}</span>
                    )}
                  </td>
                  <td className="gcs-table__td">{f.contentType ? areaLabel(f.contentType) : <span className="gcs-sysChip gcs-sysChip--warn">{t("areaNone")}</span>}</td>
                  <td className="gcs-table__td gcs-memberTable__num">{bytes(f.size)}</td>
                  <td className="gcs-table__td">{format.relativeTime(f.createdAt)}</td>
                  <td className="gcs-table__td gcs-sysJobs__actions">
                    <GcsAcpEditPanel
                      label={t("open")}
                      iconOnly
                      buttonIcon={<GcsIcon name="fa-solid fa-eye" />}
                      title={f.filename}
                      titleIcon={<GcsIcon name={KIND_ICONS[f.kind]} />}
                      size="lg"
                      testId="gcs-file-panel"
                      footer={
                        canEdit ? (
                          <GcsActionForm action={deleteFile.bind(null, f.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={(uses.get(f.id)?.length ?? 0) > 0 ? t("confirmDeleteUsed") : t("confirmDelete")}>
                            {null}
                          </GcsActionForm>
                        ) : undefined
                      }
                    >
                      {details(f)}
                    </GcsAcpEditPanel>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.pages > 1 && (
          <nav className="gcs-memberList__pages" aria-label={t("pages")}>
            {result.page > 1 && (
              <GcsButton variant="ghost" size="sm" asChild>
                <Link href={href({ page: String(result.page - 1) })}>
                  <GcsIcon name="fa-solid fa-chevron-left" className="gcs-btn__icon" />
                  {t("prev")}
                </Link>
              </GcsButton>
            )}
            <span className="gcs-memberList__page">{t("page", { page: result.page, pages: result.pages })}</span>
            {result.page < result.pages && (
              <GcsButton variant="ghost" size="sm" asChild>
                <Link href={href({ page: String(result.page + 1) })}>
                  {t("next")}
                  <GcsIcon name="fa-solid fa-chevron-right" className="gcs-btn__icon" />
                </Link>
              </GcsButton>
            )}
          </nav>
        )}
      </GcsCard>
    </>
  );
}
