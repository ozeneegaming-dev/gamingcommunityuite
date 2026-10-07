import type { GcsLegacyPassword } from "@gcs/core";
import type {
  GcsBatch,
  GcsForumAction,
  GcsImportEntity,
  GcsSourceAdapter,
  GcsSourceRole,
  GcsVisibility,
  SrcAttachment,
  SrcConversation,
  SrcFollow,
  SrcForum,
  SrcForumPermission,
  SrcGroup,
  SrcIgnore,
  SrcMember,
  SrcPost,
  SrcPrefix,
  SrcProfileField,
  SrcProfileValue,
  SrcReaction,
  SrcReactionType,
  SrcStatus,
  SrcTopic,
  SrcWarning,
} from "../types";
import { cleanName, GcsSourceTables, nextPhaseCursor, phaseCursor } from "./base";
import type { GcsRow, GcsSourceReader } from "./reader";
import { hexColor, id, idList, ipString, num, phpUnserialize, plainText, str, unixDate } from "./values";

/** Grupurile create la instalarea platformei vechi, cu id-uri fixe. */
const DEFAULT_ROLES: Record<string, GcsSourceRole> = { "1": "guest", "2": "member", "3": "admin", "4": "moderator" };

/** Permisiunile (grup, cheie) → acțiunile GCS pe forum. */
const PERMISSIONS: [string, string, GcsForumAction][] = [
  ["general", "viewNode", "view"],
  ["forum", "viewContent", "read"],
  ["forum", "postThread", "create"],
  ["forum", "postReply", "reply"],
  ["forum", "uploadAttachment", "upload"],
  ["forum", "viewAttachment", "download"],
];

/** Culorile etichetelor de prefix (clasele `label--…`). */
const LABEL_COLORS: Record<string, string> = {
  red: "#E03E3E",
  orange: "#F08C00",
  yellow: "#F4B740",
  green: "#2F9E44",
  olive: "#5C940D",
  lightgreen: "#69DB7C",
  blue: "#1C7ED6",
  royalblue: "#3B5BDB",
  skyblue: "#4DABF7",
  gray: "#868E96",
  silver: "#CED4DA",
  primary: "#5EA2FF",
  accent: "#F4B740",
};

function state(v: unknown): GcsVisibility {
  const s = str(v);
  if (s === "moderated") return "PENDING";
  if (s === "deleted") return "HIDDEN";
  return "VISIBLE";
}

/** Parola din `xf_user_authenticate`: schema `…:Core12` (bcrypt) sau `…:Core` (sha256/sha1 cu sare). */
function password(row: GcsRow | undefined): GcsLegacyPassword | null {
  if (!row) return null;
  const scheme = str(row.scheme_class);
  const data = phpUnserialize(row.data);
  if (!data || typeof data !== "object") return null;
  const hash = str(data.hash);
  if (/:Core12$/.test(scheme) && /^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) return { scheme: "bcrypt", hash };
  if (/:Core$/.test(scheme)) {
    const fn = str(data.hashFunc) || "sha256";
    if (fn === "sha256" && /^[0-9a-f]{64}$/i.test(hash)) return { scheme: "sha256s", hash, salt: str(data.salt) };
    if (fn === "sha1" && /^[0-9a-f]{40}$/i.test(hash)) return { scheme: "sha1s", hash, salt: str(data.salt) };
  }
  return null;
}

function fieldType(type: string, match: string): SrcProfileField["type"] {
  if (match === "url") return "URL";
  if (match === "number" || type === "stars") return "NUMBER";
  if (type === "textarea" || type === "bbcode") return "TEXTAREA";
  if (type === "select" || type === "radio") return "SELECT";
  return "TEXT";
}

/** Folderul unui fișier numerotat: `floor(id / 1000)`. */
const group = (n: string) => Math.floor(Number(n) / 1000);

/**
 * Adaptorul pentru schema `xf_*` (tabele `xf_user`, `xf_user_group`, `xf_node`, `xf_thread`, `xf_post`…).
 * Conținutul e BBCode, convertit de `convert/bbcode.ts`.
 */
export class GcsPrefixedSchemaAdapter implements GcsSourceAdapter {
  readonly schema = "prefixed-schema" as const;
  readonly format = "bbcode" as const;
  private readonly db: GcsSourceTables;
  private phraseCache = new Map<string, string>();

  constructor(reader: GcsSourceReader, prefix = "xf_") {
    this.db = new GcsSourceTables(reader, prefix);
  }

  private async phrases(titles: string[]): Promise<Map<string, string>> {
    const missing = titles.filter((t) => !this.phraseCache.has(t));
    if (missing.length > 0) {
      const rows = await this.db.whereIn("phrase", "title", missing, { language_id: 0 });
      for (const r of rows) this.phraseCache.set(str(r.title), str(r.phrase_text));
      for (const t of missing) if (!this.phraseCache.has(t)) this.phraseCache.set(t, "");
    }
    return new Map(titles.map((t) => [t, this.phraseCache.get(t) ?? ""]));
  }

  private async option(name: string): Promise<string | null> {
    const [row] = await this.db.all("option", { option_id: name });
    return row ? str(row.option_value) : null;
  }

  /** IP-urile după id-ul lor din `xf_ip`. */
  private async ips(ids: number[]): Promise<Map<string, string>> {
    const rows = await this.db.whereIn("ip", "ip_id", ids.filter((n) => n > 0));
    return new Map(rows.map((r) => [id(r.ip_id), ipString(r.ip) ?? ""]));
  }

  private async attachmentsFor(contentType: string, contentIds: number[]): Promise<Map<string, string[]>> {
    const rows = await this.db.whereIn("attachment", "content_id", contentIds, { content_type: contentType });
    const map = new Map<string, string[]>();
    for (const r of rows.sort((a, b) => num(a.attachment_id) - num(b.attachment_id))) {
      map.set(id(r.content_id), [...(map.get(id(r.content_id)) ?? []), id(r.attachment_id)]);
    }
    return map;
  }

  async version(): Promise<string> {
    // Rândul principal din tabelul de add-on-uri are id-ul egal cu prefixul tabelelor, fără `_`, cu majuscule.
    const core = this.db.prefix.replace(/_$/, "").toUpperCase();
    const [row] = await this.db.all("addon", { addon_id: core });
    return str(row?.version_string) || "?";
  }

  async postsPerPage(): Promise<number> {
    const v = num(await this.option("messagesPerPage"), 20);
    return v > 0 ? v : 20;
  }

  async counts(): Promise<Record<GcsImportEntity, number>> {
    const c = (t: string, where?: Parameters<GcsSourceTables["count"]>[1]) => this.db.count(t, where);
    const [groups, members, fields, forums, prefixes, topics, attachments, posts, reactions, conversations, fw, tw, uf, warnings, statuses] = await Promise.all([
      c("user_group"),
      c("user"),
      c("user_field"),
      c("node", { node_type_id: { in: ["Category", "Forum", "LinkForum"] } }),
      c("thread_prefix"),
      c("thread"),
      c("attachment", { content_type: { in: ["post", "conversation_message"] } }),
      c("post"),
      c("reaction_content", { content_type: "post" }),
      c("conversation_master"),
      c("forum_watch"),
      c("thread_watch"),
      c("user_follow"),
      c("warning"),
      c("profile_post"),
    ]);
    return {
      groups,
      members,
      profile_fields: fields,
      forums,
      prefixes,
      topics,
      attachments,
      posts,
      reactions,
      conversations,
      follows: fw + tw + uf,
      warnings,
      statuses,
    };
  }

  async groups(): Promise<SrcGroup[]> {
    const rows = await this.db.all("user_group", undefined, [["user_group_id", "asc"]]);
    return rows.map((r) => {
      const gid = id(r.user_group_id);
      return { id: gid, name: cleanName(str(r.title), 60, `Grup ${gid}`), color: hexColor(r.username_css), role: DEFAULT_ROLES[gid] ?? "other" };
    });
  }

  async members(cursor: string | null, limit: number): Promise<GcsBatch<SrcMember>> {
    const { rows, next } = await this.db.idBatch("user", "user_id", cursor, limit);
    const ids = rows.map((r) => num(r.user_id));
    const [profiles, options, auths, bans, regIps] = await Promise.all([
      this.db.whereIn("user_profile", "user_id", ids),
      this.db.whereIn("user_option", "user_id", ids),
      this.db.whereIn("user_authenticate", "user_id", ids),
      this.db.whereIn("user_ban", "user_id", ids),
      this.db.whereIn("ip", "user_id", ids, { content_type: "user", action: "register" }),
    ]);
    const by = (list: GcsRow[]) => new Map(list.map((r) => [id(r.user_id), r]));
    const [profileOf, optionOf, authOf, banOf] = [by(profiles), by(options), by(auths), by(bans)];
    const ipOf = new Map(regIps.map((r) => [id(r.user_id), ipString(r.ip)]));
    const now = Date.now();
    return {
      next,
      rows: rows.map((r) => {
        const uid = id(r.user_id);
        const profile = profileOf.get(uid);
        const option = optionOf.get(uid);
        const ban = banOf.get(uid);
        const showDate = num(option?.show_dob_date) === 1 && num(profile?.dob_day) > 0 && num(profile?.dob_month) > 0;
        const g = group(uid);
        const banEnd = num(ban?.end_date);
        return {
          id: uid,
          name: str(r.username),
          email: str(r.email),
          emailConfirmed: !["email_confirm", "email_confirm_edit"].includes(str(r.user_state)),
          joinedAt: unixDate(r.register_date) ?? new Date(0),
          lastVisitAt: unixDate(r.last_activity),
          registrationIp: ipOf.get(uid) ?? null,
          primaryGroupId: id(r.user_group_id),
          secondaryGroupIds: idList(r.secondary_group_ids),
          avatarPaths: num(r.avatar_date) > 0 ? ["o", "h", "l"].map((size) => `data/avatars/${size}/${g}/${uid}.jpg`) : [],
          coverPaths: num(profile?.banner_date) > 0 ? [`data/profile_banners/l/${g}/${uid}.jpg`] : [],
          signature: str(profile?.signature),
          birthday: showDate
            ? { day: num(profile?.dob_day), month: num(profile?.dob_month), year: num(option?.show_dob_year) === 1 && num(profile?.dob_year) > 0 ? num(profile?.dob_year) : null }
            : null,
          reputation: num(r.reaction_score),
          title: str(r.custom_title) || null,
          ban:
            num(r.is_banned) === 1 && (!ban || banEnd === 0 || banEnd * 1000 > now)
              ? { reason: str(ban?.user_reason), expiresAt: ban && banEnd > 0 ? new Date(banEnd * 1000) : null }
              : null,
          password: password(authOf.get(uid)),
        };
      }),
    };
  }

  async profileFields(): Promise<SrcProfileField[]> {
    const rows = await this.db.all("user_field", undefined, [["display_order", "asc"]]);
    const names = await this.phrases(rows.map((r) => `user_field_title.${str(r.field_id)}`));
    return rows.map((r, i) => {
      const fid = str(r.field_id);
      const choices = phpUnserialize(r.field_choices);
      return {
        id: fid,
        name: cleanName(names.get(`user_field_title.${fid}`) || fid, 60, fid),
        type: fieldType(str(r.field_type), str(r.match_type)),
        options: choices && typeof choices === "object" ? Object.values(choices).map((c) => str(c)).filter(Boolean).slice(0, 50) : [],
        required: num(r.required) === 1,
        visibility: num(r.viewable_profile, 1) === 1 ? "PUBLIC" : "STAFF",
        position: num(r.display_order, i),
        maxLength: num(r.max_length) > 0 ? Math.min(num(r.max_length), 2000) : 200,
      };
    });
  }

  async profileValues(cursor: string | null, limit: number): Promise<GcsBatch<SrcProfileValue>> {
    const { rows, next } = await this.db.rangeBatch("user_field_value", "user_id", cursor, Math.max(1, Math.floor(limit / 5)));
    const fields = await this.db.all("user_field");
    const choicesOf = new Map(fields.map((f) => [str(f.field_id), phpUnserialize(f.field_choices)]));
    const out: SrcProfileValue[] = [];
    for (const r of rows) {
      const fieldId = str(r.field_id);
      const choices = choicesOf.get(fieldId);
      const raw = str(r.field_value);
      // Valorile multiple sunt serializate; cele cu opțiuni păstrează cheia opțiunii.
      const decoded = raw.startsWith("a:") ? phpUnserialize(raw) : raw;
      const keys = decoded && typeof decoded === "object" ? Object.values(decoded).map((v) => str(v)) : [str(decoded)];
      const labels = keys.map((k) => (choices && typeof choices === "object" && k in choices ? str((choices as Record<string, unknown>)[k]) : k)).filter(Boolean);
      const value = labels.join(", ").trim();
      if (value) out.push({ memberId: id(r.user_id), fieldId, value });
    }
    return { rows: out, next };
  }

  async forums(): Promise<SrcForum[]> {
    const nodes = (await this.db.all("node", undefined, [["lft", "asc"], ["node_id", "asc"]])).filter((n) => ["Category", "Forum", "LinkForum"].includes(str(n.node_type_id)));
    const links = await this.db.whereIn("link_forum", "node_id", nodes.map((n) => num(n.node_id)));
    const linkOf = new Map(links.map((l) => [id(l.node_id), str(l.link_url)]));
    const known = new Set(nodes.map((n) => id(n.node_id)));
    return nodes.map((n) => {
      const nid = id(n.node_id);
      const parent = num(n.parent_node_id) > 0 && known.has(id(n.parent_node_id)) ? id(n.parent_node_id) : null;
      const kind = str(n.node_type_id);
      // O categorie în altă categorie devine un forum-container (în GCS categoriile stau doar la rădăcină).
      const type = kind === "LinkForum" ? "LINK" : kind === "Category" && parent === null ? "CATEGORY" : "FORUM";
      return {
        id: nid,
        parentId: parent,
        type,
        name: cleanName(str(n.title), 100, `Forum ${nid}`),
        description: plainText(str(n.description)).slice(0, 500),
        position: num(n.display_order),
        linkUrl: type === "LINK" ? (linkOf.get(nid) ?? null) : null,
      };
    });
  }

  /**
   * Matricea efectivă pe forum: permisiunile globale ale grupului, apoi cele pe nod, de la rădăcină spre forum
   * (`content_allow`/`allow` = da, `reset` = nu de aici în jos, `deny` = niciodată).
   */
  async forumPermissions(): Promise<SrcForumPermission[]> {
    const [forums, groups, globalRows, nodeRows] = await Promise.all([
      this.forums(),
      this.groups(),
      this.db.all("permission_entry", { user_id: 0 }),
      this.db.all("permission_entry_content", { content_type: "node", user_id: 0 }),
    ]);
    const key = (g: string, pg: string, p: string) => `${g}|${pg}|${p}`;
    const global = new Map(globalRows.map((r) => [key(id(r.user_group_id), str(r.permission_group_id), str(r.permission_id)), str(r.permission_value)]));
    const node = new Map(nodeRows.map((r) => [`${id(r.content_id)}|${key(id(r.user_group_id), str(r.permission_group_id), str(r.permission_id))}`, str(r.permission_value)]));
    const parentOf = new Map(forums.map((f) => [f.id, f.parentId]));
    const chain = (fid: string) => {
      const out: string[] = [];
      for (let cur: string | null = fid; cur !== null && out.length < 32; cur = parentOf.get(cur) ?? null) out.unshift(cur);
      return out;
    };
    const result: SrcForumPermission[] = [];
    for (const f of forums) {
      for (const g of groups) {
        const actions: GcsForumAction[] = [];
        for (const [pg, p, action] of PERMISSIONS) {
          const base = global.get(key(g.id, pg, p));
          let allowed = base === "allow";
          let never = base === "deny";
          for (const nid of chain(f.id)) {
            const v = node.get(`${nid}|${key(g.id, pg, p)}`);
            if (v === "deny") never = true;
            else if (v === "reset") allowed = false;
            else if (v === "content_allow" || v === "allow") allowed = true;
          }
          if (allowed && !never) actions.push(action);
        }
        if (actions.length > 0) result.push({ forumId: f.id, groupId: g.id, actions });
      }
    }
    return result;
  }

  async prefixes(): Promise<SrcPrefix[]> {
    const rows = await this.db.all("thread_prefix", undefined, [["display_order", "asc"]]);
    const names = await this.phrases(rows.map((r) => `thread_prefix.${id(r.prefix_id)}`));
    return rows.map((r) => {
      const pid = id(r.prefix_id);
      const label = /label--([A-Za-z]+)/.exec(str(r.css_class))?.[1]?.toLowerCase() ?? "";
      return { id: pid, name: cleanName(names.get(`thread_prefix.${pid}`) || `Prefix ${pid}`, 40, `Prefix ${pid}`), color: LABEL_COLORS[label] ?? null };
    });
  }

  async topics(cursor: string | null, limit: number): Promise<GcsBatch<SrcTopic>> {
    const { rows, next } = await this.db.idBatch("thread", "thread_id", cursor, limit);
    const ids = rows.map((r) => num(r.thread_id));
    const [tagLinks, polls] = await Promise.all([this.db.whereIn("tag_content", "content_id", ids, { content_type: "thread" }), this.db.whereIn("poll", "content_id", ids, { content_type: "thread" })]);
    const pollIds = polls.map((p) => num(p.poll_id));
    const [tags, responses, votes] = await Promise.all([
      this.db.whereIn("tag", "tag_id", [...new Set(tagLinks.map((t) => num(t.tag_id)))]),
      this.db.whereIn("poll_response", "poll_id", pollIds),
      this.db.whereIn("poll_vote", "poll_id", pollIds),
    ]);
    const tagText = new Map(tags.map((t) => [id(t.tag_id), str(t.tag)]));
    return {
      next,
      rows: rows.map((r) => {
        const tid = id(r.thread_id);
        const poll = polls.find((p) => id(p.content_id) === tid);
        return {
          id: tid,
          forumId: id(r.node_id),
          title: str(r.title),
          authorId: num(r.user_id) > 0 ? id(r.user_id) : null,
          createdAt: unixDate(r.post_date) ?? new Date(0),
          views: num(r.view_count),
          pinned: num(r.sticky) === 1,
          locked: num(r.discussion_open, 1) === 0,
          visibility: state(r.discussion_state),
          prefixId: num(r.prefix_id) > 0 ? id(r.prefix_id) : null,
          tags: tagLinks.filter((t) => id(t.content_id) === tid).map((t) => tagText.get(id(t.tag_id)) ?? "").filter(Boolean),
          poll: poll
            ? {
                question: plainText(str(poll.question)),
                multiple: num(poll.max_votes, 1) !== 1,
                closesAt: unixDate(poll.close_date),
                options: responses
                  .filter((o) => id(o.poll_id) === id(poll.poll_id))
                  .sort((a, b) => num(a.poll_response_id) - num(b.poll_response_id))
                  .map((o) => ({ id: id(o.poll_response_id), text: plainText(str(o.response)) })),
                votes: votes.filter((v) => id(v.poll_id) === id(poll.poll_id)).map((v) => ({ optionId: id(v.poll_response_id), memberId: id(v.user_id) })),
              }
            : null,
          isRedirect: str(r.discussion_type) === "redirect",
        };
      }),
    };
  }

  async attachments(cursor: string | null, limit: number): Promise<GcsBatch<SrcAttachment>> {
    const { rows, next } = await this.db.idBatch("attachment", "attachment_id", cursor, limit, { content_type: { in: ["post", "conversation_message"] } });
    const data = await this.db.whereIn("attachment_data", "data_id", [...new Set(rows.map((r) => num(r.data_id)))]);
    const dataOf = new Map(data.map((d) => [id(d.data_id), d]));
    return {
      next,
      rows: rows.flatMap((r) => {
        const d = dataOf.get(id(r.data_id));
        if (!d) return [];
        const dataId = id(d.data_id);
        return [
          {
            id: id(r.attachment_id),
            ownerId: num(d.user_id) > 0 ? id(d.user_id) : null,
            filename: str(d.filename) || `fisier-${dataId}`,
            path: `internal_data/attachments/${group(dataId)}/${dataId}-${str(d.file_hash)}.data`,
            size: num(d.file_size),
          },
        ];
      }),
    };
  }

  async posts(cursor: string | null, limit: number): Promise<GcsBatch<SrcPost>> {
    const { rows, next } = await this.db.idBatch("post", "post_id", cursor, limit);
    const [ips, attached] = await Promise.all([this.ips(rows.map((r) => num(r.ip_id))), this.attachmentsFor("post", rows.map((r) => num(r.post_id)))]);
    return {
      next,
      rows: rows.map((r) => ({
        id: id(r.post_id),
        topicId: id(r.thread_id),
        authorId: num(r.user_id) > 0 ? id(r.user_id) : null,
        authorName: str(r.username),
        content: str(r.message),
        createdAt: unixDate(r.post_date) ?? new Date(0),
        ip: ips.get(id(r.ip_id)) || null,
        visibility: state(r.message_state),
        editedAt: unixDate(r.last_edit_date),
        editedById: num(r.last_edit_user_id) > 0 ? id(r.last_edit_user_id) : null,
        attachmentIds: attached.get(id(r.post_id)) ?? [],
      })),
    };
  }

  async reactionTypes(): Promise<SrcReactionType[]> {
    const rows = await this.db.all("reaction", undefined, [["display_order", "asc"]]);
    const names = await this.phrases(rows.map((r) => `reaction_title.${id(r.reaction_id)}`));
    return rows.map((r) => ({ id: id(r.reaction_id), name: names.get(`reaction_title.${id(r.reaction_id)}`) || `reaction-${id(r.reaction_id)}` }));
  }

  async reactions(cursor: string | null, limit: number): Promise<GcsBatch<SrcReaction>> {
    const { rows, next } = await this.db.idBatch("reaction_content", "reaction_content_id", cursor, limit, { content_type: "post" });
    return {
      next,
      rows: rows.map((r) => ({
        id: id(r.reaction_content_id),
        typeId: id(r.reaction_id),
        postId: id(r.content_id),
        memberId: id(r.reaction_user_id),
        createdAt: unixDate(r.reaction_date) ?? new Date(0),
      })),
    };
  }

  async conversations(cursor: string | null, limit: number): Promise<GcsBatch<SrcConversation>> {
    const { rows, next } = await this.db.idBatch("conversation_master", "conversation_id", cursor, limit);
    const ids = rows.map((r) => num(r.conversation_id));
    const [recipients, messages] = await Promise.all([this.db.whereIn("conversation_recipient", "conversation_id", ids), this.db.whereIn("conversation_message", "conversation_id", ids)]);
    const [ips, attached] = await Promise.all([
      this.ips(messages.map((m) => num(m.ip_id))),
      this.attachmentsFor("conversation_message", messages.map((m) => num(m.message_id))),
    ]);
    return {
      next,
      rows: rows.map((r) => {
        const cid = id(r.conversation_id);
        return {
          id: cid,
          title: str(r.title),
          starterId: num(r.user_id) > 0 ? id(r.user_id) : null,
          createdAt: unixDate(r.start_date) ?? new Date(0),
          participants: recipients
            .filter((p) => id(p.conversation_id) === cid)
            .map((p) => ({ memberId: id(p.user_id), lastReadAt: unixDate(p.last_read_date), left: str(p.recipient_state) !== "active" })),
          messages: messages
            .filter((m) => id(m.conversation_id) === cid)
            .sort((a, b) => num(a.message_id) - num(b.message_id))
            .map((m) => ({
              id: id(m.message_id),
              authorId: num(m.user_id) > 0 ? id(m.user_id) : null,
              content: str(m.message),
              createdAt: unixDate(m.message_date) ?? new Date(0),
              ip: ips.get(id(m.ip_id)) || null,
              attachmentIds: attached.get(id(m.message_id)) ?? [],
            })),
        };
      }),
    };
  }

  /** Urmăririle de forumuri, apoi de topicuri, apoi de membri (cursor cu faze, pe intervale de user). */
  async follows(cursor: string | null, limit: number): Promise<GcsBatch<SrcFollow>> {
    const phases = ["f", "t", "u"] as const;
    const { phase, value } = phaseCursor(cursor, phases);
    const span = Math.max(1, Math.floor(limit / 10));
    const table = phase === "f" ? "forum_watch" : phase === "t" ? "thread_watch" : "user_follow";
    const { rows, next } = await this.db.rangeBatch(table, "user_id", value, span);
    const out: SrcFollow[] = rows.map((r) =>
      phase === "f"
        ? { memberId: id(r.user_id), type: "forum", targetId: id(r.node_id) }
        : phase === "t"
          ? { memberId: id(r.user_id), type: "topic", targetId: id(r.thread_id) }
          : { memberId: id(r.user_id), type: "user", targetId: id(r.follow_user_id) },
    );
    return { rows: out, next: nextPhaseCursor(phase, next, phases) };
  }

  async ignores(cursor: string | null, limit: number): Promise<GcsBatch<SrcIgnore>> {
    const { rows, next } = await this.db.rangeBatch("user_ignored", "user_id", cursor, Math.max(1, Math.floor(limit / 10)));
    return { next, rows: rows.map((r) => ({ memberId: id(r.user_id), ignoredId: id(r.ignored_user_id) })) };
  }

  async warnings(cursor: string | null, limit: number): Promise<GcsBatch<SrcWarning>> {
    const { rows, next } = await this.db.idBatch("warning", "warning_id", cursor, limit);
    return {
      next,
      rows: rows.map((r) => ({
        id: id(r.warning_id),
        memberId: id(r.user_id),
        issuerId: num(r.warning_user_id) > 0 ? id(r.warning_user_id) : null,
        points: num(r.points),
        reason: plainText(str(r.title) || str(r.notes)),
        createdAt: unixDate(r.warning_date) ?? new Date(0),
        expiresAt: num(r.expiry_date) > 0 ? unixDate(r.expiry_date) : null,
      })),
    };
  }

  /** Postările de profil, apoi comentariile lor (id-urile comentariilor au prefixul `c`). */
  async statuses(cursor: string | null, limit: number): Promise<GcsBatch<SrcStatus>> {
    const phases = ["p", "c"] as const;
    const { phase, value } = phaseCursor(cursor, phases);
    if (phase === "p") {
      const { rows, next } = await this.db.idBatch("profile_post", "profile_post_id", value, limit);
      const ips = await this.ips(rows.map((r) => num(r.ip_id)));
      return {
        next: nextPhaseCursor(phase, next, phases),
        rows: rows.map((r) => ({
          id: id(r.profile_post_id),
          profileId: id(r.profile_user_id),
          authorId: num(r.user_id) > 0 ? id(r.user_id) : null,
          parentId: null,
          content: str(r.message),
          createdAt: unixDate(r.post_date) ?? new Date(0),
          ip: ips.get(id(r.ip_id)) || null,
          visibility: state(r.message_state),
        })),
      };
    }
    const { rows, next } = await this.db.idBatch("profile_post_comment", "profile_post_comment_id", value, limit);
    const ips = await this.ips(rows.map((r) => num(r.ip_id)));
    return {
      next: nextPhaseCursor(phase, next, phases),
      rows: rows.map((r) => ({
        id: `c${id(r.profile_post_comment_id)}`,
        profileId: "",
        authorId: num(r.user_id) > 0 ? id(r.user_id) : null,
        parentId: id(r.profile_post_id),
        content: str(r.message),
        createdAt: unixDate(r.comment_date) ?? new Date(0),
        ip: ips.get(id(r.ip_id)) || null,
        visibility: state(r.message_state),
      })),
    };
  }
}
