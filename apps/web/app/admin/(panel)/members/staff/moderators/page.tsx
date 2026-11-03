import { MOD_POWER_PRESETS, MOD_POWERS, MODERATORS_ACP_SECTION, toRef, userRefSelect, type GcsUserRef } from "@gcs/modules";
import { GcsAvatar, GcsCard, GcsGroupPill, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { removeModerator } from "../../../moderation-actions";
import { GcsModeratorAddForm, GcsModeratorEditForm, type GcsModForumCategory } from "./GcsModeratorForms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.moderators"))("title") };
}

/** Permisiunea de grup a moderatorilor globali (toate forumurile, toate puterile). */
const MODERATE_ALL = "forums.moderate_all";
/** Câte avataruri apar lângă un moderator global. */
const AVATARS = 5;

type Sample = { id: string; name: string; image: string | null };

function Avatars({ users }: { users: Sample[] }) {
  return (
    <span className="gcs-acpMods__avatars" aria-hidden="true">
      {users.map((u) => (
        <GcsAvatar key={u.id} name={u.name} size="xs" {...(u.image ? { src: u.image } : {})} />
      ))}
    </span>
  );
}

/**
 * ACP → Membri → Staff → Moderatori: sus moderatorii globali (grupurile cu „Moderator pe toate forumurile”, cu membrii
 * lor), dedesubt moderatorii pe forum (un membru sau un grup, cu puterile lor), fiecare cu editare în panou și „Scoate”.
 * „Adaugă moderator” din antet deschide același panou, gol.
 */
export default async function AcpModeratorsPage() {
  await requireAcpSection(MODERATORS_ACP_SECTION);
  const t = await getTranslations("acp.moderators");
  const { forumModerators, db, registry } = services();
  const [rows, forums, groups] = await Promise.all([
    forumModerators.list(),
    db.forum.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true, parentId: true, type: true } }),
    db.group.findMany({
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        color: true,
        settings: { where: { key: MODERATE_ALL }, select: { value: true } },
        _count: { select: { primaryUsers: true, members: true } },
      },
    }),
  ]);

  // ─── Arborele forumurilor: categoriile în ordinea lui, cu forumurile (și subforumurile) moderabile ───
  const known = new Set(forums.map((f) => f.id));
  const children = new Map<number | null, typeof forums>();
  for (const f of forums) {
    const parent = f.parentId !== null && known.has(f.parentId) ? f.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), f]);
  }
  const order = new Map<number, number>();
  const categoryOf = new Map<number, string>();
  const loose: GcsModForumCategory = { id: 0, name: t("noCategory"), forums: [] };
  const categories: GcsModForumCategory[] = [];
  const seen = new Set<number>();
  const walk = (parentId: number | null, category: GcsModForumCategory | null, depth: number) => {
    for (const f of children.get(parentId) ?? []) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      order.set(f.id, order.size);
      if (f.type === "CATEGORY") {
        const c: GcsModForumCategory = { id: f.id, name: f.name, forums: [] };
        categories.push(c);
        walk(f.id, c, 0);
        continue;
      }
      if (f.type === "FORUM" || f.type === "QA") {
        (category ?? loose).forums.push({ id: f.id, name: f.name, depth });
        if (category) categoryOf.set(f.id, category.name);
      }
      walk(f.id, category, depth + 1);
    }
  };
  walk(null, null, 0);
  const forumGroups = [...(loose.forums.length > 0 ? [loose] : []), ...categories.filter((c) => c.forums.length > 0)];

  // ─── Moderatorii globali: valoarea efectivă a permisiunii (salvată sau implicită a grupului) ───
  const def = registry.permissionDef(MODERATE_ALL);
  const defaults = (def?.default ?? {}) as Record<string, unknown>;
  const globalGroups = groups.filter((g) => (g.settings[0] ? g.settings[0].value : (defaults[g.key] ?? def?.fallback)) === true);
  const samples = globalGroups.length
    ? await db.group.findMany({
        where: { id: { in: globalGroups.map((g) => g.id) } },
        select: {
          id: true,
          primaryUsers: { take: AVATARS, orderBy: { createdAt: "asc" }, select: { id: true, name: true, image: true } },
          members: { take: AVATARS, orderBy: { addedAt: "asc" }, select: { user: { select: { id: true, name: true, image: true } } } },
        },
      })
    : [];
  const sampleOf = new Map(
    samples.map((s) => {
      const users = [...s.primaryUsers, ...s.members.map((m) => m.user)];
      return [s.id, users.filter((u, i) => users.findIndex((x) => x.id === u.id) === i).slice(0, AVATARS)];
    }),
  );

  // ─── Moderatorii pe forum, în ordinea arborelui ───
  const userIds = [...new Set(rows.flatMap((r) => (r.userId ? [r.userId] : [])))];
  const users = new Map<string, GcsUserRef>(
    userIds.length ? (await db.user.findMany({ where: { id: { in: userIds } }, select: userRefSelect })).map((u) => [u.id, toRef(u)]) : [],
  );
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const sorted = [...rows].sort((a, b) => (order.get(a.forumId) ?? Infinity) - (order.get(b.forumId) ?? Infinity) || a.id - b.id);
  const powerLabel = (p: string) => (t.has(`power.${p}` as never) ? t(`power.${p}` as never) : p);
  const presets = { all: [...MOD_POWER_PRESETS.all], basic: [...MOD_POWER_PRESETS.basic], approvals: [...MOD_POWER_PRESETS.approvals] };
  const powers = [...MOD_POWERS];

  const who = (r: (typeof rows)[number]): ReactNode => {
    const user = r.userId ? users.get(r.userId) : undefined;
    if (user) {
      return (
        <span className="gcs-acpMods__pill">
          <GcsAvatar name={user.name} size="xs" {...(user.image ? { src: user.image } : {})} />
          <GcsMemberName userId={user.id} name={user.name} nameKey={user.nameKey} href={`/admin/members/${user.id}`} />
        </span>
      );
    }
    const group = r.groupId !== null ? groupById.get(r.groupId) : undefined;
    if (group) {
      return (
        <GcsGroupPill group={{ id: group.id, name: group.name, color: group.color }} href={`/admin/groups/${group.id}`}>
          <GcsIcon name="fa-solid fa-users" />
          <span className={`gcs-groupPill__name gcs-name--${group.key}`}>{group.name}</span>
        </GcsGroupPill>
      );
    }
    return <span className="gcs-muted">{r.userName ?? r.groupName ?? "—"}</span>;
  };
  const whoText = (r: (typeof rows)[number]) => r.userName ?? r.groupName ?? "—";

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-user-shield"
        actions={
          <GcsAcpEditPanel label={t("add")} variant="primary" buttonIcon={<GcsIcon name="fa-solid fa-user-plus" />} title={t("add")} titleIcon={<GcsIcon name="fa-solid fa-user-plus" />} size="lg" testId="gcs-mod-add">
            <GcsModeratorAddForm categories={forumGroups} groups={groups.map((g) => ({ id: g.id, key: g.key, name: g.name }))} powers={powers} presets={presets} />
          </GcsAcpEditPanel>
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <GcsCard as="section" aria-labelledby="gcs-mods-global" className="gcs-acpMods__card" data-testid="gcs-mods-global">
        <header className="gcs-acpMods__head">
          <GcsIcon name="fa-solid fa-globe" className="gcs-acpMods__headIcon" />
          <h2 id="gcs-mods-global" className="gcs-acpMods__title">
            {t("globalTitle")}
          </h2>
          <span className="gcs-acpMods__hint">{t("globalHint")}</span>
        </header>
        {globalGroups.length === 0 ? (
          <p className="gcs-acpMods__empty">{t("globalEmpty")}</p>
        ) : (
          <ul className="gcs-acpMods__list">
            {globalGroups.map((g) => {
              const total = g._count.primaryUsers + g._count.members;
              return (
                <li key={g.id} className="gcs-acpMods__row gcs-acpMods__row--global" data-testid="gcs-mods-global-group" data-group={g.key}>
                  <span className="gcs-acpMods__who">
                    <span className="gcs-acpMods__dot" style={g.color ? { background: g.color } : undefined} aria-hidden="true" />
                    <b className={`gcs-name--${g.key}`}>{g.name}</b>
                  </span>
                  <span className="gcs-acpMods__members">
                    <Avatars users={sampleOf.get(g.id) ?? []} />
                    <span className="gcs-acpMods__hint">{t("members", { count: total })}</span>
                  </span>
                  <Link href={`/admin/groups/${g.id}`} className="gcs-btn gcs-btn--ghost gcs-btn--sm" aria-label={t("groupLink", { group: g.name })}>
                    <span className="gcs-btn__icon" aria-hidden="true">
                      <GcsIcon name="fa-solid fa-users" />
                    </span>
                    {t("group")}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </GcsCard>

      <GcsCard as="section" aria-labelledby="gcs-mods-forum" className="gcs-acpMods__card">
        <header className="gcs-acpMods__head">
          <GcsIcon name="fa-solid fa-folder" className="gcs-acpMods__headIcon" />
          <h2 id="gcs-mods-forum" className="gcs-acpMods__title">
            {t("forumTitle")}
          </h2>
          <span className="gcs-acpMods__badge">{sorted.length}</span>
        </header>
        {sorted.length === 0 ? (
          <p className="gcs-acpMods__empty">{t("empty")}</p>
        ) : (
          <ul className="gcs-acpMods__list">
            {sorted.map((r) => {
              const all = MOD_POWERS.every((p) => r.powers.includes(p));
              const category = categoryOf.get(r.forumId);
              return (
                <li key={r.id} className="gcs-acpMods__row gcs-acpMods__row--forum" data-testid="gcs-acp-moderator" data-forum={r.forumName}>
                  <span className="gcs-acpMods__forumName">
                    <b>{r.forumName}</b>
                    {category && <span>{category}</span>}
                  </span>
                  <span className="gcs-acpMods__chips">
                    {who(r)}
                    {all ? (
                      <span className="gcs-acpMods__chip gcs-acpMods__chip--all">{t("allPowers")}</span>
                    ) : (
                      r.powers.map((p) => (
                        <span key={p} className="gcs-acpMods__chip">
                          {powerLabel(p)}
                        </span>
                      ))
                    )}
                  </span>
                  <span className="gcs-acpMods__actions">
                    <GcsAcpEditPanel iconOnly label={t("editRow", { forum: r.forumName, who: whoText(r) })} title={t("editTitle", { forum: r.forumName })} titleIcon={<GcsIcon name="fa-solid fa-user-shield" />} testId="gcs-mod-edit">
                      <GcsModeratorEditForm
                        id={r.id}
                        initial={r.powers}
                        powers={powers}
                        presets={presets}
                        summary={
                          <>
                            <span className="gcs-acpMods__forumName">
                              <b>{r.forumName}</b>
                              {category && <span>{category}</span>}
                            </span>
                            {who(r)}
                          </>
                        }
                      />
                    </GcsAcpEditPanel>
                    <GcsActionForm
                      action={removeModerator.bind(null, r.id)}
                      submitLabel={t("remove")}
                      submitKind="remove"
                      variant="ghost"
                      compact
                      confirm={t("removeConfirm", { forum: r.forumName, who: whoText(r) })}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </GcsCard>
    </>
  );
}
