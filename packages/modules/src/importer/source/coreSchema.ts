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
  SrcMessage,
  SrcPoll,
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
import { hexColor, id, idList, ipString, jsonValue, num, plainText, str, unixDate } from "./values";

/** Coloanele permisiunilor pe forum (`core_permission_index`) → acțiunile GCS. */
const PERMISSION_COLUMNS: [string, GcsForumAction][] = [
  ["perm_view", "view"],
  ["perm_2", "read"],
  ["perm_3", "reply"],
  ["perm_4", "create"],
  ["perm_5", "upload"],
  ["perm_6", "download"],
];

const FORUM_ATTACHMENTS = "forums_Forums";
const MESSAGE_ATTACHMENTS = "core_Messaging";

function visibility(v: unknown): GcsVisibility {
  const n = num(v, 1);
  if (n === 1) return "VISIBLE";
  if (n === 0) return "PENDING";
  return "HIDDEN";
}

/** Vizibilitatea unei postări (`queued`): 0 = vizibilă, 1 = în așteptare, -1/2 = ascunsă sau ștearsă. */
function postVisibility(v: unknown): GcsVisibility {
  const n = num(v, 0);
  if (n === 0) return "VISIBLE";
  if (n === 1) return "PENDING";
  return "HIDDEN";
}

/** Parola: bcrypt complet (`$2…`) sau formula md5 cu sare (conturile vechi). */
function password(row: GcsRow): GcsLegacyPassword | null {
  const hash = str(row.members_pass_hash).trim();
  const salt = str(row.members_pass_salt);
  if (/^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) return { scheme: "bcrypt", hash };
  if (/^[0-9a-f]{32}$/i.test(hash) && salt) return { scheme: "md5s", hash, salt };
  return null;
}

function fieldType(t: string): SrcProfileField["type"] {
  switch (t.toLowerCase()) {
    case "textarea":
    case "editor":
      return "TEXTAREA";
    case "url":
      return "URL";
    case "number":
      return "NUMBER";
    case "select":
    case "radio":
      return "SELECT";
    default:
      return "TEXT";
  }
}

/**
 * Adaptorul pentru schema `core_*` (tabele `core_members`, `core_groups`, `forums_forums`, `forums_topics`,
 * `forums_posts`…, cu prefix opțional). Conținutul e HTML cu marcaje proprii, convertit de `convert/html.ts`.
 */
export class GcsCoreSchemaAdapter implements GcsSourceAdapter {
  readonly schema = "core-schema" as const;
  readonly format = "html" as const;
  private readonly db: GcsSourceTables;
  private settingsCache: Promise<Map<string, string>> | null = null;
  private langCache = new Map<string, string>();

  constructor(reader: GcsSourceReader, prefix = "") {
    this.db = new GcsSourceTables(reader, prefix);
  }

  /** Setările site-ului vechi (`conf_value`, altfel `conf_default`). */
  private async setting(key: string): Promise<string | null> {
    this.settingsCache ??= this.db.all("core_sys_conf_settings").then((rows) => {
      const map = new Map<string, string>();
      for (const r of rows) map.set(str(r.conf_key), str(r.conf_value) !== "" ? str(r.conf_value) : str(r.conf_default));
      return map;
    });
    return (await this.settingsCache).get(key) ?? null;
  }

  /** Textele din pachetul de limbă (numele grupurilor, forumurilor, câmpurilor…): cel personalizat, apoi cel implicit. */
  private async words(keys: string[]): Promise<Map<string, string>> {
    const missing = keys.filter((k) => !this.langCache.has(k));
    if (missing.length > 0) {
      const rows = await this.db.whereIn("core_sys_lang_words", "word_key", missing);
      const langs = await this.db.all("core_sys_lang");
      const defaultLang = langs.find((l) => num(l.lang_default) === 1)?.lang_id;
      const ranked = [...rows].sort((a, b) => (a.lang_id === defaultLang ? -1 : 0) - (b.lang_id === defaultLang ? -1 : 0));
      for (const r of ranked) {
        const key = str(r.word_key);
        if (this.langCache.has(key)) continue;
        const text = str(r.word_custom) || str(r.word_default);
        if (text) this.langCache.set(key, text);
      }
      for (const k of missing) if (!this.langCache.has(k)) this.langCache.set(k, "");
    }
    return new Map(keys.map((k) => [k, this.langCache.get(k) ?? ""]));
  }

  async version(): Promise<string> {
    const [row] = await this.db.all("core_applications", { app_directory: "core" });
    return str(row?.app_version) || str(row?.app_long_version) || "?";
  }

  async postsPerPage(): Promise<number> {
    const v = num(await this.setting("forums_posts_per_page"), 25);
    return v > 0 ? v : 25;
  }

  async counts(): Promise<Record<GcsImportEntity, number>> {
    const c = (t: string, where?: Parameters<GcsSourceTables["count"]>[1]) => this.db.count(t, where);
    const [groups, members, fields, forums, topics, attachments, posts, reactions, conversations, follows, warnings, statuses, prefixes] = await Promise.all([
      c("core_groups"),
      c("core_members"),
      c("core_pfields_data"),
      c("forums_forums"),
      c("forums_topics"),
      c("core_attachments"),
      c("forums_posts"),
      c("core_reputation_index", { app: "forums" }),
      c("core_message_topics"),
      c("core_follow"),
      c("core_members_warn_logs"),
      c("core_member_status_updates"),
      this.prefixes().then((p) => p.length),
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
      follows,
      warnings,
      statuses,
    };
  }

  async groups(): Promise<SrcGroup[]> {
    const [rows, adminRows, guestGroup, memberGroup, bannedGroup] = await Promise.all([
      this.db.all("core_groups", undefined, [["g_id", "asc"]]),
      this.db.all("core_admin_permission_rows", { row_id_type: "group" }),
      this.setting("guest_group"),
      this.setting("member_group"),
      this.setting("banned_group"),
    ]);
    const admins = new Set(adminRows.map((r) => id(r.row_id)));
    const names = await this.words(rows.map((r) => `core_group_${id(r.g_id)}`));
    return rows.map((r) => {
      const gid = id(r.g_id);
      let role: GcsSourceRole = "other";
      if (gid === guestGroup) role = "guest";
      else if (gid === memberGroup) role = "member";
      else if (gid === bannedGroup) role = "banned";
      else if (admins.has(gid)) role = "admin";
      else if (num(r.g_is_supmod) === 1) role = "moderator";
      return { id: gid, name: cleanName(names.get(`core_group_${gid}`) || str(r.g_title), 60, `Grup ${gid}`), color: hexColor(r.prefix), role };
    });
  }

  async members(cursor: string | null, limit: number): Promise<GcsBatch<SrcMember>> {
    const { rows, next } = await this.db.idBatch("core_members", "member_id", cursor, limit);
    const ids = rows.map((r) => num(r.member_id));
    const [validating, birthdayType] = await Promise.all([this.db.whereIn("core_validating", "member_id", ids), this.setting("profile_birthday_type")]);
    const unconfirmed = new Set(validating.filter((v) => num(v.new_reg) === 1).map((v) => id(v.member_id)));
    const now = Date.now();
    return {
      next,
      rows: rows.map((r) => {
        const mid = id(r.member_id);
        const tempBan = num(r.temp_ban);
        const bday = num(r.bday_day) > 0 && num(r.bday_month) > 0 && birthdayType === "public";
        const photo = str(r.pp_main_photo);
        const cover = str(r.pp_cover_photo);
        return {
          id: mid,
          name: str(r.name),
          email: str(r.email),
          emailConfirmed: !unconfirmed.has(mid),
          joinedAt: unixDate(r.joined) ?? new Date(0),
          lastVisitAt: unixDate(r.last_activity) ?? unixDate(r.last_visit),
          registrationIp: ipString(r.ip_address),
          primaryGroupId: id(r.member_group_id),
          secondaryGroupIds: idList(r.mgroup_others),
          avatarPaths: photo && !/^https?:/i.test(photo) ? [`uploads/${photo}`] : [],
          coverPaths: cover && !/^https?:/i.test(cover) ? [`uploads/${cover}`] : [],
          signature: str(r.signature),
          birthday: bday ? { day: num(r.bday_day), month: num(r.bday_month), year: num(r.bday_year) > 0 ? num(r.bday_year) : null } : null,
          reputation: num(r.pp_reputation_points),
          title: str(r.member_title) || null,
          ban: tempBan === -1 ? { reason: "", expiresAt: null } : tempBan * 1000 > now ? { reason: "", expiresAt: new Date(tempBan * 1000) } : null,
          password: password(r),
        };
      }),
    };
  }

  async profileFields(): Promise<SrcProfileField[]> {
    const rows = await this.db.all("core_pfields_data", undefined, [["pf_position", "asc"]]);
    const names = await this.words(rows.map((r) => `core_pfield_${id(r.pf_id)}`));
    return rows.map((r) => {
      const fid = id(r.pf_id);
      const options = jsonValue<unknown>(r.pf_content, []);
      const hide = str(r.pf_member_hide).toLowerCase();
      return {
        id: fid,
        name: cleanName(names.get(`core_pfield_${fid}`) || str(r.pf_title), 60, `Câmp ${fid}`),
        type: fieldType(str(r.pf_type)),
        options: (Array.isArray(options) ? options : Object.values(options as Record<string, unknown>)).map((o) => str(o)).filter(Boolean).slice(0, 50),
        required: num(r.pf_not_null) === 1,
        visibility: hide === "all" || hide === "" ? "PUBLIC" : "STAFF",
        position: num(r.pf_position),
        maxLength: num(r.pf_max_input) > 0 ? Math.min(num(r.pf_max_input), 2000) : 200,
      };
    });
  }

  async profileValues(cursor: string | null, limit: number): Promise<GcsBatch<SrcProfileValue>> {
    const { rows, next } = await this.db.idBatch("core_pfields_content", "member_id", cursor, limit);
    const out: SrcProfileValue[] = [];
    for (const r of rows) {
      for (const [key, value] of Object.entries(r)) {
        const m = /^field_(\d+)$/.exec(key);
        const text = str(value).trim();
        if (m && text) out.push({ memberId: id(r.member_id), fieldId: m[1]!, value: text });
      }
    }
    return { rows: out, next };
  }

  async forums(): Promise<SrcForum[]> {
    const rows = (await this.db.all("forums_forums", undefined, [["position", "asc"], ["id", "asc"]])).filter((r) => num(r.club_id) <= 0);
    const keys = rows.flatMap((r) => [`forums_forum_${id(r.id)}`, `forums_forum_${id(r.id)}_desc`]);
    const words = await this.words(keys);
    const known = new Set(rows.map((r) => id(r.id)));
    return rows.map((r) => {
      const fid = id(r.id);
      const parent = num(r.parent_id, -1) > 0 && known.has(id(r.parent_id)) ? id(r.parent_id) : null;
      const isLink = num(r.redirect_on) === 1 && str(r.redirect_url) !== "";
      // La rădăcină stau categoriile; un forum de la rădăcină în care se poate posta (`sub_can_post`) rămâne forum.
      return {
        id: fid,
        parentId: parent,
        type: isLink ? "LINK" : parent === null && num(r.sub_can_post, 0) !== 1 ? "CATEGORY" : "FORUM",
        name: cleanName(words.get(`forums_forum_${fid}`) || str(r.name), 100, `Forum ${fid}`),
        description: plainText(words.get(`forums_forum_${fid}_desc`) || str(r.description)).slice(0, 500),
        position: num(r.position),
        linkUrl: isLink ? str(r.redirect_url) : null,
      };
    });
  }

  async forumPermissions(): Promise<SrcForumPermission[]> {
    const [rows, groups] = await Promise.all([this.db.all("core_permission_index", { app: "forums", perm_type: "forum" }), this.db.all("core_groups")]);
    const allGroups = groups.map((g) => id(g.g_id));
    const out: SrcForumPermission[] = [];
    for (const r of rows) {
      const forumId = id(r.perm_type_id);
      const byGroup = new Map<string, GcsForumAction[]>();
      for (const [column, action] of PERMISSION_COLUMNS) {
        const raw = str(r[column]).trim();
        const ids = raw === "*" ? allGroups : idList(raw);
        for (const g of ids) byGroup.set(g, [...(byGroup.get(g) ?? []), action]);
      }
      for (const [groupId, actions] of byGroup) out.push({ forumId, groupId, actions });
    }
    return out;
  }

  /** Prefixele sunt tag-uri marcate (`tag_prefix = 1`); id-ul prefixului e textul lui, normalizat. */
  async prefixes(): Promise<SrcPrefix[]> {
    if (!(await this.db.has("core_tags"))) return [];
    const rows = await this.db.reader.select(this.db.t("core_tags"), { columns: ["tag_text"], where: { tag_prefix: 1, tag_meta_app: "forums" } });
    const seen = new Map<string, SrcPrefix>();
    for (const r of rows) {
      const name = cleanName(str(r.tag_text), 40, "");
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), { id: name.toLowerCase(), name, color: null });
    }
    return [...seen.values()];
  }

  async topics(cursor: string | null, limit: number): Promise<GcsBatch<SrcTopic>> {
    const { rows, next } = await this.db.idBatch("forums_topics", "tid", cursor, limit);
    const tids = rows.map((r) => num(r.tid));
    const [tags, polls] = await Promise.all([
      this.db.whereIn("core_tags", "tag_meta_id", tids, { tag_meta_app: "forums", tag_meta_area: "forums" }),
      this.db.whereIn("core_polls", "tid", tids),
    ]);
    const votes = await this.db.whereIn("core_voters", "poll", polls.map((p) => num(p.pid)));
    return {
      next,
      rows: rows.map((r) => {
        const tid = id(r.tid);
        const own = tags.filter((t) => id(t.tag_meta_id) === tid);
        const prefix = own.find((t) => num(t.tag_prefix) === 1);
        const poll = polls.find((p) => id(p.tid) === tid);
        return {
          id: tid,
          forumId: id(r.forum_id),
          title: str(r.title),
          authorId: num(r.starter_id) > 0 ? id(r.starter_id) : null,
          createdAt: unixDate(r.start_date) ?? new Date(0),
          views: num(r.views),
          pinned: num(r.pinned) === 1,
          locked: str(r.state) === "closed",
          visibility: visibility(r.approved),
          prefixId: prefix ? cleanName(str(prefix.tag_text), 40, "").toLowerCase() || null : null,
          tags: own.filter((t) => num(t.tag_prefix) !== 1).map((t) => str(t.tag_text)),
          poll: poll ? this.poll(poll, votes.filter((v) => id(v.poll) === id(poll.pid))) : null,
          isRedirect: str(r.state) === "link" || str(r.moved_to) !== "",
        };
      }),
    };
  }

  /** Sondajul (prima întrebare; GCS are o întrebare pe sondaj) și voturile. */
  private poll(row: GcsRow, votes: GcsRow[]): SrcPoll | null {
    const choices = jsonValue<Record<string, { question?: string; multi?: number | string; choice?: Record<string, string> }>>(row.choices, {});
    const [qKey, first] = Object.entries(choices)[0] ?? [];
    if (!first?.choice) return null;
    const options = Object.entries(first.choice).map(([oid, text]) => ({ id: oid, text: plainText(str(text)) })).filter((o) => o.text);
    const out: SrcPoll["votes"] = [];
    for (const v of votes) {
      const picked = jsonValue<Record<string, unknown>>(v.member_choices, {})[qKey ?? "1"];
      for (const oid of Array.isArray(picked) ? picked : [picked]) if (oid !== undefined && oid !== null) out.push({ optionId: String(oid), memberId: id(v.member_id) });
    }
    return {
      question: plainText(str(first.question) || str(row.poll_question)),
      multiple: num(first.multi) === 1,
      closesAt: unixDate(row.poll_close_date),
      options,
      votes: out,
    };
  }

  async attachments(cursor: string | null, limit: number): Promise<GcsBatch<SrcAttachment>> {
    const { rows, next } = await this.db.idBatch("core_attachments", "attach_id", cursor, limit);
    return {
      next,
      rows: rows.map((r) => ({
        id: id(r.attach_id),
        ownerId: num(r.attach_member_id) > 0 ? id(r.attach_member_id) : null,
        filename: str(r.attach_file) || `fisier-${id(r.attach_id)}`,
        path: `uploads/${str(r.attach_location)}`,
        size: num(r.attach_filesize),
      })),
    };
  }

  /** Atașamentele legate de conținut (`core_attachments_map`), pe id-ul conținutului (`id2`). */
  private async attachmentsFor(locationKey: string, contentIds: number[]): Promise<Map<string, string[]>> {
    const rows = await this.db.whereIn("core_attachments_map", "id2", contentIds, { location_key: locationKey });
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(id(r.id2), [...(map.get(id(r.id2)) ?? []), id(r.attachment_id)]);
    return map;
  }

  async posts(cursor: string | null, limit: number): Promise<GcsBatch<SrcPost>> {
    const { rows, next } = await this.db.idBatch("forums_posts", "pid", cursor, limit);
    const attached = await this.attachmentsFor(FORUM_ATTACHMENTS, rows.map((r) => num(r.pid)));
    return {
      next,
      rows: rows.map((r) => ({
        id: id(r.pid),
        topicId: id(r.topic_id),
        authorId: num(r.author_id) > 0 ? id(r.author_id) : null,
        authorName: str(r.author_name),
        content: str(r.post),
        createdAt: unixDate(r.post_date) ?? new Date(0),
        ip: ipString(r.ip_address),
        visibility: postVisibility(r.queued),
        editedAt: num(r.append_edit) === 1 || num(r.edit_time) > 0 ? unixDate(r.edit_time) : null,
        editedById: null,
        attachmentIds: attached.get(id(r.pid)) ?? [],
      })),
    };
  }

  async reactionTypes(): Promise<SrcReactionType[]> {
    const rows = await this.db.all("core_reactions", undefined, [["reaction_position", "asc"]]);
    const names = await this.words(rows.map((r) => `reaction_title_${id(r.reaction_id)}`));
    return rows.map((r) => ({ id: id(r.reaction_id), name: names.get(`reaction_title_${id(r.reaction_id)}`) || `reaction-${id(r.reaction_id)}` }));
  }

  async reactions(cursor: string | null, limit: number): Promise<GcsBatch<SrcReaction>> {
    const { rows, next } = await this.db.idBatch("core_reputation_index", "id", cursor, limit, { app: "forums", type: "pid" });
    return {
      next,
      rows: rows.map((r) => ({
        id: id(r.id),
        typeId: id(r.reaction ?? 1),
        postId: id(r.type_id),
        memberId: id(r.member_id),
        createdAt: unixDate(r.rep_date) ?? new Date(0),
      })),
    };
  }

  async conversations(cursor: string | null, limit: number): Promise<GcsBatch<SrcConversation>> {
    const { rows, next } = await this.db.idBatch("core_message_topics", "mt_id", cursor, limit);
    const ids = rows.map((r) => num(r.mt_id));
    const [maps, posts] = await Promise.all([this.db.whereIn("core_message_topic_user_map", "map_topic_id", ids), this.db.whereIn("core_message_posts", "msg_topic_id", ids)]);
    const attached = await this.attachmentsFor(MESSAGE_ATTACHMENTS, posts.map((p) => num(p.msg_id)));
    return {
      next,
      rows: rows.map((r) => {
        const cid = id(r.mt_id);
        const messages: SrcMessage[] = posts
          .filter((p) => id(p.msg_topic_id) === cid)
          .sort((a, b) => num(a.msg_id) - num(b.msg_id))
          .map((p) => ({
            id: id(p.msg_id),
            authorId: num(p.msg_author_id) > 0 ? id(p.msg_author_id) : null,
            content: str(p.msg_post),
            createdAt: unixDate(p.msg_date) ?? new Date(0),
            ip: ipString(p.msg_ip_address),
            attachmentIds: attached.get(id(p.msg_id)) ?? [],
          }));
        return {
          id: cid,
          title: str(r.mt_title),
          starterId: num(r.mt_starter_id) > 0 ? id(r.mt_starter_id) : null,
          createdAt: unixDate(r.mt_date) ?? new Date(0),
          participants: maps
            .filter((m) => id(m.map_topic_id) === cid)
            .map((m) => ({ memberId: id(m.map_user_id), lastReadAt: unixDate(m.map_read_time), left: num(m.map_user_active, 1) !== 1 })),
          messages,
        };
      }),
    };
  }

  async follows(cursor: string | null, limit: number): Promise<GcsBatch<SrcFollow>> {
    const { rows, next } = await this.db.rangeBatch("core_follow", "follow_member_id", cursor, Math.max(1, Math.floor(limit / 10)));
    const out: SrcFollow[] = [];
    for (const r of rows) {
      const app = str(r.follow_app);
      const area = str(r.follow_area);
      const type = app === "forums" && area === "forum" ? "forum" : app === "forums" && area === "topic" ? "topic" : app === "core" && area === "member" ? "user" : null;
      if (type) out.push({ memberId: id(r.follow_member_id), type, targetId: id(r.follow_rel_id) });
    }
    return { rows: out, next };
  }

  async ignores(cursor: string | null, limit: number): Promise<GcsBatch<SrcIgnore>> {
    const { rows, next } = await this.db.idBatch("core_ignored_users", "ignore_id", cursor, limit);
    return { next, rows: rows.map((r) => ({ memberId: id(r.ignore_owner_id), ignoredId: id(r.ignore_ignore_id) })) };
  }

  async warnings(cursor: string | null, limit: number): Promise<GcsBatch<SrcWarning>> {
    const { rows, next } = await this.db.idBatch("core_members_warn_logs", "wl_id", cursor, limit);
    const reasons = await this.words(rows.map((r) => `core_warn_reason_${id(r.wl_reason)}`));
    return {
      next,
      rows: rows.map((r) => ({
        id: id(r.wl_id),
        memberId: id(r.wl_member),
        issuerId: num(r.wl_moderator) > 0 ? id(r.wl_moderator) : null,
        points: num(r.wl_points),
        reason: plainText(reasons.get(`core_warn_reason_${id(r.wl_reason)}`) || str(r.wl_note_member) || str(r.wl_note_mods)),
        createdAt: unixDate(r.wl_date) ?? new Date(0),
        expiresAt: num(r.wl_expire_date) > 0 ? unixDate(r.wl_expire_date) : null,
      })),
    };
  }

  /** Status-urile, apoi răspunsurile lor (id-urile răspunsurilor au prefixul `r`). */
  async statuses(cursor: string | null, limit: number): Promise<GcsBatch<SrcStatus>> {
    const phases = ["s", "r"] as const;
    const { phase, value } = phaseCursor(cursor, phases);
    if (phase === "s") {
      const { rows, next } = await this.db.idBatch("core_member_status_updates", "status_id", value, limit);
      return {
        next: nextPhaseCursor(phase, next, phases),
        rows: rows.map((r) => ({
          id: id(r.status_id),
          profileId: id(r.status_member_id),
          authorId: num(r.status_author_id) > 0 ? id(r.status_author_id) : id(r.status_member_id),
          parentId: null,
          content: str(r.status_content),
          createdAt: unixDate(r.status_date) ?? new Date(0),
          ip: ipString(r.status_author_ip),
          visibility: visibility(r.status_approved),
        })),
      };
    }
    const { rows, next } = await this.db.idBatch("core_member_status_replies", "reply_id", value, limit);
    return {
      next: nextPhaseCursor(phase, next, phases),
      rows: rows.map((r) => ({
        id: `r${id(r.reply_id)}`,
        profileId: "",
        authorId: num(r.reply_member_id) > 0 ? id(r.reply_member_id) : null,
        parentId: id(r.reply_status_id),
        content: str(r.reply_content),
        createdAt: unixDate(r.reply_date) ?? new Date(0),
        ip: ipString(r.reply_ip_address),
        visibility: visibility(r.reply_approved),
      })),
    };
  }
}
