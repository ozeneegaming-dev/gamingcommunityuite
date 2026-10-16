import { CHAT_ACP_MODERATORS } from "@gcs/modules";
import { GcsCard, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { revokeChatGrant } from "../actions";
import { GcsAcpConfirmAction, GcsChatGrantEdit, GcsChatGrantForm } from "../GcsChatModAcp";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.chatMod"))("moderatorsTitle") };
}

/**
 * ACP → Comunitate → Chat → Moderatori: accesele de moderator în chat (numele cu stilul grupului, drepturile, camerele,
 * expirarea, cine l-a dat), cu editare și „Revocă”, plus „Adaugă moderator de chat” (membrul, setul de drepturi,
 * camerele, expirarea). Aceleași reguli ca `/acces`: nu dai un drept pe care nu-l ai, nu atingi un rang mai mare.
 */
export default async function AcpChatModeratorsPage() {
  const { actor } = await requireAcpSection(CHAT_ACP_MODERATORS);
  const [t, tm, format] = await Promise.all([getTranslations("acp.chatMod"), getTranslations("chat.mod"), getFormatter()]);
  const { chatModeration, db, acp } = services();
  const [grants, channels, canEdit] = await Promise.all([
    chatModeration.grants(actor),
    db.chatChannel.findMany({ where: { enabled: true, type: "PUBLIC" }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { key: true, name: true } }),
    acp.can(actor, CHAT_ACP_MODERATORS, "edit"),
  ]);
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="gcs-acpChatMod" data-testid="gcs-acp-chat-moderators">
      <h1 className="gcs-display gcs-acpChatMod__title">
        <GcsIcon name="fa-solid fa-user-shield" />
        {t("moderatorsTitle")}
      </h1>
      <p className="gcs-muted gcs-acpChatMod__intro">{t("moderatorsIntro")}</p>

      <GcsCard as="section" className="gcs-acpChatMod__card" aria-labelledby="gcs-chatmod-grants">
        <h2 id="gcs-chatmod-grants" className="gcs-acpWidget__title">
          <GcsIcon name="fa-solid fa-users-gear" /> {t("grantsTitle", { count: grants.length })}
        </h2>
        {grants.length === 0 ? (
          <p className="gcs-muted">{t("noGrants")}</p>
        ) : (
          <div className="gcs-table">
            <table className="gcs-table__table">
              <caption className="gcs-srOnly">{t("moderatorsTitle")}</caption>
              <thead>
                <tr>
                  {[t("colMember"), t("rights"), t("rooms"), t("expiry"), t("colGrantedBy"), ""].map((h, i) => (
                    <th key={i} className="gcs-table__th" scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.id} className="gcs-table__row" data-testid="gcs-acp-chat-grant">
                    <td className="gcs-table__td">
                      <GcsMemberName userId={g.user.id} name={g.user.name} nameKey={g.user.nameKey} href={memberHref(g.user)} />
                    </td>
                    <td className="gcs-table__td">
                      <span className="gcs-acpChatMod__rights">
                        {g.rights.map((r) => (
                          <span key={r} className="gcs-acpChatMod__right">
                            {tm(`rights.${r}`)}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="gcs-table__td">{g.rooms.length > 0 ? g.rooms.map((r) => `#${r}`).join(", ") : tm("allRooms")}</td>
                    <td className="gcs-table__td">{g.expiresAt ? when(g.expiresAt) : t("expiries.none")}</td>
                    <td className="gcs-table__td">{g.grantedBy ? <GcsMemberName userId={g.grantedBy.id} name={g.grantedBy.name} nameKey={g.grantedBy.nameKey} href={memberHref(g.grantedBy)} /> : "—"}</td>
                    <td className="gcs-table__td gcs-acpChatMod__actions">
                      {canEdit && (
                        <>
                          <GcsChatGrantEdit rooms={channels} initial={{ user: { id: g.user.id, name: g.user.name }, rights: g.rights, rooms: g.rooms, expiresAt: g.expiresAt }} />
                          <GcsAcpConfirmAction
                            label={t("revoke")}
                            title={t("revokeTitle")}
                            body={t("revokeBody", { name: g.user.name })}
                            confirm={t("revoke")}
                            run={revokeChatGrant.bind(null, g.user.id)}
                            testId="gcs-acp-chat-revoke"
                            danger
                          />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GcsCard>

      {canEdit && (
        <GcsCard as="section" className="gcs-acpChatMod__card" aria-labelledby="gcs-chatmod-add">
          <h2 id="gcs-chatmod-add" className="gcs-acpWidget__title">
            <GcsIcon name="fa-solid fa-user-plus" /> {t("addTitle")}
          </h2>
          <GcsChatGrantForm rooms={channels} />
        </GcsCard>
      )}
    </div>
  );
}
