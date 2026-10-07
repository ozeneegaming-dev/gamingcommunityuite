import type { GcsRow } from "./source/reader";

/**
 * Două comunități vechi mici, înregistrate ca rânduri de tabel: una cu schema `core_*` (conținut HTML), una cu
 * schema `xf_*` (conținut BBCode). Le folosesc testele adaptoarelor și ale motorului și sursa de test din E2E
 * (`host = fixture`, doar cu `GCS_TEST_ROUTES=1`). Parolele vechi: `parola-veche-1` … `parola-veche-4`.
 */
export type GcsImportFixture = { tables: Record<string, GcsRow[]>; files: Record<string, Buffer>; oldUrl: string };

/** Imagini PNG 8×8 (roșu, verde), valide pentru recodare. */
const RED_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWO4pmGJFTEMLQkAiMpNwY92gIsAAAAASUVORK5CYII=", "base64");
const GREEN_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPQn+eCFTEMLQkApg5EQfb0Ze8AAAAASUVORK5CYII=", "base64");
const CONFIG_TXT = Buffer.from("sensitivity 1.8\nvolume 0.4\n", "utf8");

const BCRYPT_1 = "$2y$04$2PTAmvhRAJMbIahBpEIUGeaIGkywDrkZ5yn1OhWiwdKVYAllrmUOy"; // parola-veche-1
const BCRYPT_2 = "$2y$04$bj0m8MlNCBAyb6PSf3AinO/D8rK01YhVTKR/wyvbpa.ZPnzKW5D6a"; // parola-veche-2
const MD5_3 = "59a84e4db1b780a0f10e568bf180a503"; // parola-veche-3, sare `k9#Z1`
const SHA256_4 = "3e5dedfcb825857dc9396887429dd2841d78d64c070a4dab72a7b91ca4d9aa54"; // parola-veche-4, sare `saltsalt`

const T0 = 1_700_000_000; // 14 nov. 2023

const word = (key: string, text: string) => ({ word_id: key.length, lang_id: 1, word_key: key, word_default: text, word_custom: "" });

/** Comunitatea `core_*`: adresa veche `https://vechi.exemplu.ro/forum`. */
export function coreSchemaFixture(): GcsImportFixture {
  const base = "<___base_url___>";
  const tables: Record<string, GcsRow[]> = {
    core_applications: [{ app_directory: "core", app_version: "4.7.18", app_long_version: 107180 }],
    core_sys_conf_settings: [
      { conf_key: "guest_group", conf_value: "2", conf_default: "2" },
      { conf_key: "member_group", conf_value: "3", conf_default: "3" },
      { conf_key: "forums_posts_per_page", conf_value: "", conf_default: "25" },
      { conf_key: "profile_birthday_type", conf_value: "public", conf_default: "public" },
    ],
    core_sys_lang: [{ lang_id: 1, lang_default: 1 }],
    core_sys_lang_words: [
      word("core_group_2", "Guests"),
      word("core_group_3", "Members"),
      word("core_group_4", "Administrators"),
      word("core_group_6", "Moderators"),
      word("core_group_7", "Veterani"),
      word("forums_forum_1", "Comunitate"),
      word("forums_forum_1_desc", ""),
      word("forums_forum_2", "Discuții generale"),
      word("forums_forum_2_desc", "<p>Despre <strong>orice</strong>.</p>"),
      word("forums_forum_3", "Staff"),
      word("forums_forum_3_desc", ""),
      word("forums_forum_4", "Site oficial"),
      word("forums_forum_4_desc", ""),
      word("core_pfield_1", "Joc preferat"),
      word("reaction_title_1", "Like"),
      word("reaction_title_2", "Thanks"),
      word("reaction_title_3", "Confused"),
      word("core_warn_reason_1", "Limbaj nepotrivit"),
    ],
    core_groups: [
      { g_id: 2, g_is_supmod: 0, prefix: "" },
      { g_id: 3, g_is_supmod: 0, prefix: "" },
      { g_id: 4, g_is_supmod: 1, prefix: "<span style='color:#d62839'>" },
      { g_id: 6, g_is_supmod: 1, prefix: "<span style='color:#5ea2ff'>" },
      { g_id: 7, g_is_supmod: 0, prefix: "<span style='color:#29a3a3'>" },
    ],
    core_admin_permission_rows: [{ row_id: 4, row_id_type: "group" }],
    core_members: [
      {
        member_id: 1,
        name: "Vechiul Admin",
        email: "admin@vechi.exemplu.ro",
        member_group_id: 4,
        mgroup_others: "",
        joined: T0,
        last_activity: T0 + 5000,
        ip_address: "198.51.100.10",
        members_pass_hash: BCRYPT_1,
        members_pass_salt: null,
        pp_main_photo: "monthly_2023_11/avatar-1.png",
        pp_cover_photo: "",
        pp_reputation_points: 42,
        signature: "<p>Admin din <em>2010</em></p>",
        bday_day: 3,
        bday_month: 5,
        bday_year: 1990,
        temp_ban: 0,
        member_title: "Fondator",
      },
      {
        member_id: 2,
        name: "Ana Pop",
        email: "Ana@Exemplu.ro",
        member_group_id: 3,
        mgroup_others: ",7,",
        joined: T0 + 100,
        last_activity: T0 + 9000,
        ip_address: "198.51.100.20",
        members_pass_hash: BCRYPT_2,
        members_pass_salt: "",
        pp_main_photo: "",
        pp_cover_photo: "",
        pp_reputation_points: 7,
        signature: "",
        bday_day: 0,
        bday_month: 0,
        bday_year: 0,
        temp_ban: 0,
        member_title: "",
      },
      {
        member_id: 3,
        name: "Codrin",
        email: "codrin@exemplu.ro",
        member_group_id: 3,
        mgroup_others: "",
        joined: T0 + 200,
        last_activity: T0 + 300,
        ip_address: "198.51.100.30",
        members_pass_hash: MD5_3,
        members_pass_salt: "k9#Z1",
        pp_main_photo: "",
        pp_cover_photo: "",
        pp_reputation_points: -2,
        signature: "",
        bday_day: 0,
        bday_month: 0,
        bday_year: 0,
        temp_ban: -1,
        member_title: "",
      },
      {
        member_id: 4,
        name: "Dublura",
        email: "existent@exemplu.ro",
        member_group_id: 3,
        mgroup_others: "",
        joined: T0 + 300,
        last_activity: 0,
        ip_address: "",
        members_pass_hash: "",
        members_pass_salt: "",
        pp_main_photo: "",
        pp_cover_photo: "",
        pp_reputation_points: 0,
        signature: "",
        bday_day: 0,
        bday_month: 0,
        bday_year: 0,
        temp_ban: 0,
        member_title: "",
      },
    ],
    core_validating: [],
    core_pfields_data: [{ pf_id: 1, pf_type: "Select", pf_content: '["CS2","Valorant","Rust"]', pf_not_null: 0, pf_member_hide: "all", pf_position: 1, pf_max_input: 0 }],
    core_pfields_content: [
      { member_id: 1, field_1: "Rust" },
      { member_id: 2, field_1: "CS2" },
    ],
    forums_forums: [
      { id: 1, parent_id: -1, position: 1, sub_can_post: 0, redirect_on: 0, redirect_url: "", club_id: null },
      { id: 2, parent_id: 1, position: 1, sub_can_post: 1, redirect_on: 0, redirect_url: "", club_id: null },
      { id: 3, parent_id: 2, position: 1, sub_can_post: 1, redirect_on: 0, redirect_url: "", club_id: null },
      { id: 4, parent_id: 1, position: 2, sub_can_post: 0, redirect_on: 1, redirect_url: "https://exemplu.ro/", club_id: null },
    ],
    core_permission_index: [
      { app: "forums", perm_type: "forum", perm_type_id: 1, perm_view: "*", perm_2: "*", perm_3: "", perm_4: "", perm_5: "", perm_6: "" },
      { app: "forums", perm_type: "forum", perm_type_id: 2, perm_view: "*", perm_2: "*", perm_3: ",3,4,6,7,", perm_4: ",3,4,6,7,", perm_5: ",3,4,6,", perm_6: "*" },
      { app: "forums", perm_type: "forum", perm_type_id: 3, perm_view: ",4,6,", perm_2: ",4,6,", perm_3: ",4,6,", perm_4: ",4,6,", perm_5: ",4,6,", perm_6: ",4,6," },
      { app: "forums", perm_type: "forum", perm_type_id: 4, perm_view: "*", perm_2: "*", perm_3: "", perm_4: "", perm_5: "", perm_6: "" },
    ],
    core_tags: [
      { tag_id: 1, tag_meta_app: "forums", tag_meta_area: "forums", tag_meta_id: 10, tag_text: "Ghid", tag_prefix: 1 },
      { tag_id: 2, tag_meta_app: "forums", tag_meta_area: "forums", tag_meta_id: 10, tag_text: "cs2", tag_prefix: 0 },
      { tag_id: 3, tag_meta_app: "forums", tag_meta_area: "forums", tag_meta_id: 10, tag_text: "config", tag_prefix: 0 },
    ],
    forums_topics: [
      { tid: 10, title: "Bun venit pe forum", forum_id: 2, starter_id: 1, start_date: T0 + 1000, views: 120, pinned: 1, state: "open", approved: 1, moved_to: "", poll_state: 1 },
      { tid: 11, title: "Configul meu de CS2", forum_id: 2, starter_id: 2, start_date: T0 + 2000, views: 33, pinned: 0, state: "closed", approved: 1, moved_to: "", poll_state: 0 },
      { tid: 12, title: "Topic mutat", forum_id: 2, starter_id: 2, start_date: T0 + 2500, views: 0, pinned: 0, state: "link", approved: 1, moved_to: "13&3", poll_state: 0 },
      { tid: 13, title: "Discuție staff", forum_id: 3, starter_id: 1, start_date: T0 + 3000, views: 5, pinned: 0, state: "open", approved: -1, moved_to: "", poll_state: 0 },
    ],
    core_polls: [
      {
        pid: 1,
        tid: 10,
        poll_question: "Ce jucați?",
        choices: JSON.stringify({ 1: { question: "Ce jucați?", multi: 0, choice: { 1: "CS2", 2: "Valorant" }, votes: { 1: 1, 2: 0 } } }),
        poll_close_date: 0,
      },
    ],
    core_voters: [{ vid: 1, poll: 1, member_id: 2, member_choices: JSON.stringify({ 1: [1] }) }],
    forums_posts: [
      {
        pid: 100,
        topic_id: 10,
        author_id: 1,
        author_name: "Vechiul Admin",
        post_date: T0 + 1000,
        ip_address: "198.51.100.10",
        queued: 0,
        edit_time: 0,
        append_edit: 0,
        post:
          `<p>Salut! Citiți <strong>regulile</strong> și <a href="${base}/topic/11-configul-meu-de-cs2/" rel="">configul Anei</a>.</p>` +
          `<p style="text-align:center;"><span style="color:#ff0000;font-size:18px;">Important</span></p>` +
          `<p><a class="legacyAttachLink legacyAttachLink_image" data-fileid="50" href="<fileStore.core_Attachment>/monthly_2023_11/poza.png"><img class="legacyImage" data-fileid="50" src="<fileStore.core_Attachment>/monthly_2023_11/poza.png" alt="poza.png"></a></p>`,
      },
      {
        pid: 101,
        topic_id: 10,
        author_id: 2,
        author_name: "Ana Pop",
        post_date: T0 + 1500,
        ip_address: "198.51.100.20",
        queued: 0,
        edit_time: T0 + 1600,
        append_edit: 1,
        post:
          `<blockquote class="legacyQuote" data-legacyquote="" data-legacyquote-contentcommentid="100" data-legacyquote-contentid="10" data-legacyquote-userid="1" data-legacyquote-username="Vechiul Admin"><div class="legacyQuote_citation">Vechiul Admin a spus:</div><div class="legacyQuote_contents"><p>Salut!</p></div></blockquote>` +
          `<p>Mersi, <a contenteditable="false" data-mentionid="1" href="${base}/profile/1-vechiul-admin/" rel="">@Vechiul Admin</a> <img alt=":)" data-emoticon="" src="<fileStore.core_Emoticons>/emoticons/smile.png" title=":)"></p>` +
          `<div class="legacyEmbeddedVideo"><div><iframe allowfullscreen="" frameborder="0" height="270" src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?feature=oembed" width="480"></iframe></div></div>`,
      },
      {
        pid: 102,
        topic_id: 11,
        author_id: 2,
        author_name: "Ana Pop",
        post_date: T0 + 2000,
        ip_address: "198.51.100.20",
        queued: 0,
        edit_time: 0,
        append_edit: 0,
        post:
          `<p>Configul meu:</p><pre class="legacyCode prettyprint lang-javascript">sensitivity "1.8"\n&lt;b&gt;nu e html&lt;/b&gt;</pre>` +
          `<div class="legacySpoiler" data-legacyspoiler=""><div class="legacySpoiler_header"><span>Spoiler</span></div><div class="legacySpoiler_contents"><p>Secretul e în <u>mouse</u>.</p></div></div>` +
          `<p><script>alert(1)</script><a href="javascript:alert(2)">click</a><img src="x" onerror="alert(3)"></p>` +
          `<ul><li>unu</li><li>doi</li></ul>`,
      },
      {
        pid: 103,
        topic_id: 13,
        author_id: 1,
        author_name: "Vechiul Admin",
        post_date: T0 + 3000,
        ip_address: "198.51.100.10",
        queued: 0,
        edit_time: 0,
        append_edit: 0,
        post: "<p>Doar pentru staff.</p>",
      },
    ],
    core_attachments: [
      { attach_id: 50, attach_file: "poza.png", attach_location: "monthly_2023_11/poza.png", attach_is_image: 1, attach_filesize: RED_PNG.length, attach_member_id: 1 },
      { attach_id: 51, attach_file: "config.cfg", attach_location: "monthly_2023_11/config.cfg", attach_is_image: 0, attach_filesize: CONFIG_TXT.length, attach_member_id: 2 },
      { attach_id: 52, attach_file: "harta.png", attach_location: "monthly_2023_11/harta.png", attach_is_image: 1, attach_filesize: GREEN_PNG.length, attach_member_id: 2 },
    ],
    core_attachments_map: [
      { attachment_id: 50, location_key: "forums_Forums", id1: 10, id2: 100 },
      { attachment_id: 51, location_key: "forums_Forums", id1: 11, id2: 102 },
      { attachment_id: 52, location_key: "core_Messaging", id1: 30, id2: 300 },
    ],
    core_reactions: [
      { reaction_id: 1, reaction_position: 1 },
      { reaction_id: 2, reaction_position: 2 },
      { reaction_id: 3, reaction_position: 3 },
    ],
    core_reputation_index: [
      { id: 1, member_id: 2, app: "forums", type: "pid", type_id: 100, rep_date: T0 + 1100, reaction: 2 },
      { id: 2, member_id: 1, app: "forums", type: "pid", type_id: 101, rep_date: T0 + 1700, reaction: 3 },
    ],
    core_message_topics: [{ mt_id: 30, mt_date: T0 + 4000, mt_title: "Salut din privat", mt_starter_id: 2 }],
    core_message_topic_user_map: [
      { map_id: 1, map_user_id: 2, map_topic_id: 30, map_read_time: T0 + 4100, map_user_active: 1 },
      { map_id: 2, map_user_id: 1, map_topic_id: 30, map_read_time: T0 + 4000, map_user_active: 1 },
    ],
    core_message_posts: [
      { msg_id: 300, msg_topic_id: 30, msg_date: T0 + 4000, msg_post: "<p>Uite harta:</p>", msg_author_id: 2, msg_ip_address: "198.51.100.20" },
      { msg_id: 301, msg_topic_id: 30, msg_date: T0 + 4100, msg_post: "<p>Mersi!</p>", msg_author_id: 1, msg_ip_address: "198.51.100.10" },
    ],
    core_follow: [
      { follow_id: "a1", follow_app: "forums", follow_area: "topic", follow_rel_id: 10, follow_member_id: 2, follow_added: T0 },
      { follow_id: "a2", follow_app: "core", follow_area: "member", follow_rel_id: 1, follow_member_id: 2, follow_added: T0 },
      { follow_id: "a3", follow_app: "forums", follow_area: "forum", follow_rel_id: 2, follow_member_id: 1, follow_added: T0 },
    ],
    core_ignored_users: [{ ignore_id: 1, ignore_owner_id: 1, ignore_ignore_id: 3 }],
    core_members_warn_logs: [{ wl_id: 1, wl_member: 3, wl_moderator: 1, wl_date: T0 + 500, wl_reason: 1, wl_points: 2, wl_note_member: "", wl_note_mods: "", wl_expire_date: -1 }],
    core_member_status_updates: [
      { status_id: 5, status_member_id: 2, status_author_id: 2, status_date: T0 + 600, status_content: "<p>Prima mea zi aici!</p>", status_approved: 1, status_author_ip: "198.51.100.20" },
    ],
    core_member_status_replies: [
      { reply_id: 6, reply_status_id: 5, reply_member_id: 1, reply_date: T0 + 700, reply_content: "<p>Bun venit!</p>", reply_approved: 1, reply_ip_address: "198.51.100.10" },
    ],
  };
  const files = {
    "uploads/monthly_2023_11/poza.png": RED_PNG,
    "uploads/monthly_2023_11/config.cfg": CONFIG_TXT,
    "uploads/monthly_2023_11/harta.png": GREEN_PNG,
    "uploads/monthly_2023_11/avatar-1.png": GREEN_PNG,
  };
  return { tables, files, oldUrl: "https://vechi.exemplu.ro/forum" };
}

const phrase = (title: string, text: string) => ({ language_id: 0, title, phrase_text: text });
const ser = (pairs: Record<string, string>) =>
  `a:${Object.keys(pairs).length}:{${Object.entries(pairs)
    .map(([k, v]) => `s:${Buffer.byteLength(k)}:"${k}";s:${Buffer.byteLength(v)}:"${v}";`)
    .join("")}}`;

/** Comunitatea `xf_*`: adresa veche `https://comunitate.exemplu.ro`. */
export function prefixedSchemaFixture(): GcsImportFixture {
  const old = "https://comunitate.exemplu.ro";
  const tables: Record<string, GcsRow[]> = {
    xf_addon: [{ addon_id: "XF", version_string: "2.2.13", version_id: 2021370 }],
    xf_option: [{ option_id: "messagesPerPage", option_value: "20" }],
    xf_phrase: [
      phrase("user_field_title.platforma", "Platformă"),
      phrase("thread_prefix.1", "Întrebare"),
      phrase("reaction_title.1", "Like"),
      phrase("reaction_title.2", "Love"),
      phrase("reaction_title.3", "Haha"),
    ],
    xf_user_group: [
      { user_group_id: 1, title: "Unregistered / Unconfirmed", username_css: "" },
      { user_group_id: 2, title: "Registered", username_css: "" },
      { user_group_id: 3, title: "Administrative", username_css: "color: #d62839; font-weight: bold;" },
      { user_group_id: 4, title: "Moderating", username_css: "color: #5ea2ff;" },
      { user_group_id: 5, title: "Donatori", username_css: "color: #f4b740;" },
    ],
    xf_user: [
      { user_id: 1, username: "Admin XF", email: "admin@comunitate.exemplu.ro", user_group_id: 3, secondary_group_ids: Buffer.from("2"), register_date: T0, last_activity: T0 + 8000, message_count: 2, reaction_score: 15, is_banned: 0, user_state: "valid", custom_title: "", avatar_date: 0 },
      { user_id: 2, username: "Mihai Ionescu", email: "mihai@exemplu.ro", user_group_id: 2, secondary_group_ids: Buffer.from("5"), register_date: T0 + 100, last_activity: T0 + 9000, message_count: 2, reaction_score: 3, is_banned: 0, user_state: "valid", custom_title: "Veteran", avatar_date: T0 + 100 },
      { user_id: 3, username: "Spammer", email: "spam@exemplu.ro", user_group_id: 2, secondary_group_ids: Buffer.from(""), register_date: T0 + 200, last_activity: T0 + 200, message_count: 0, reaction_score: 0, is_banned: 1, user_state: "valid", custom_title: "", avatar_date: 0 },
    ],
    xf_user_profile: [
      { user_id: 1, dob_day: 0, dob_month: 0, dob_year: 0, signature: "[B]Admin[/B] din 2015", banner_date: 0 },
      { user_id: 2, dob_day: 12, dob_month: 8, dob_year: 1995, signature: "", banner_date: 0 },
      { user_id: 3, dob_day: 0, dob_month: 0, dob_year: 0, signature: "[URL=javascript:alert(1)]x[/URL]", banner_date: 0 },
    ],
    xf_user_option: [
      { user_id: 1, show_dob_date: 0, show_dob_year: 0 },
      { user_id: 2, show_dob_date: 1, show_dob_year: 0 },
      { user_id: 3, show_dob_date: 0, show_dob_year: 0 },
    ],
    xf_user_authenticate: [
      { user_id: 1, scheme_class: "Src:Core12", data: Buffer.from(ser({ hash: BCRYPT_1 })) },
      { user_id: 2, scheme_class: "Src:Core", data: Buffer.from(ser({ hash: SHA256_4, salt: "saltsalt", hashFunc: "sha256" })) },
      { user_id: 3, scheme_class: "Src:NoPassword", data: Buffer.from("a:0:{}") },
    ],
    xf_user_ban: [{ user_id: 3, ban_user_id: 1, ban_date: T0 + 300, end_date: 0, user_reason: "Spam" }],
    xf_ip: [
      { ip_id: 1, user_id: 1, content_type: "user", content_id: 1, action: "register", ip: Buffer.from([203, 0, 113, 1]) },
      { ip_id: 2, user_id: 2, content_type: "user", content_id: 2, action: "register", ip: Buffer.from([203, 0, 113, 2]) },
      { ip_id: 3, user_id: 2, content_type: "post", content_id: 201, action: "insert", ip: Buffer.from([203, 0, 113, 2]) },
    ],
    xf_user_field: [{ field_id: "platforma", display_group: "personal", display_order: 1, field_type: "select", field_choices: Buffer.from(ser({ pc: "PC", ps5: "PlayStation 5" })), match_type: "none", required: 0, viewable_profile: 1, max_length: 0 }],
    xf_user_field_value: [{ user_id: 2, field_id: "platforma", field_value: "pc" }],
    xf_node: [
      { node_id: 1, title: "Principal", description: "", node_type_id: "Category", parent_node_id: 0, display_order: 1, lft: 1 },
      { node_id: 2, title: "Știri", description: "Noutăți <b>despre</b> server", node_type_id: "Forum", parent_node_id: 1, display_order: 1, lft: 2 },
      { node_id: 3, title: "Pagina mea", description: "", node_type_id: "Page", parent_node_id: 1, display_order: 2, lft: 4 },
    ],
    xf_link_forum: [],
    xf_permission_entry: [
      { user_group_id: 1, user_id: 0, permission_group_id: "general", permission_id: "viewNode", permission_value: "allow" },
      { user_group_id: 1, user_id: 0, permission_group_id: "forum", permission_id: "viewContent", permission_value: "allow" },
      { user_group_id: 2, user_id: 0, permission_group_id: "general", permission_id: "viewNode", permission_value: "allow" },
      { user_group_id: 2, user_id: 0, permission_group_id: "forum", permission_id: "viewContent", permission_value: "allow" },
      { user_group_id: 2, user_id: 0, permission_group_id: "forum", permission_id: "postThread", permission_value: "allow" },
      { user_group_id: 2, user_id: 0, permission_group_id: "forum", permission_id: "postReply", permission_value: "allow" },
      { user_group_id: 3, user_id: 0, permission_group_id: "general", permission_id: "viewNode", permission_value: "allow" },
      { user_group_id: 3, user_id: 0, permission_group_id: "forum", permission_id: "viewContent", permission_value: "allow" },
      { user_group_id: 3, user_id: 0, permission_group_id: "forum", permission_id: "postThread", permission_value: "allow" },
      { user_group_id: 3, user_id: 0, permission_group_id: "forum", permission_id: "postReply", permission_value: "allow" },
    ],
    xf_permission_entry_content: [
      // Pe „Știri”, membrii pot doar citi și răspunde (topicurile noi le scrie staff-ul).
      { content_type: "node", content_id: 2, user_group_id: 2, user_id: 0, permission_group_id: "forum", permission_id: "postThread", permission_value: "reset" },
    ],
    xf_thread_prefix: [{ prefix_id: 1, prefix_group_id: 0, display_order: 1, css_class: "label label--blue" }],
    xf_thread: [
      { thread_id: 20, node_id: 2, title: "Serverul se redeschide", reply_count: 1, view_count: 300, user_id: 1, username: "Admin XF", post_date: T0 + 1000, sticky: 1, discussion_state: "visible", discussion_open: 1, discussion_type: "poll", first_post_id: 200, prefix_id: 1 },
      { thread_id: 21, node_id: 2, title: "Mutat", reply_count: 0, view_count: 0, user_id: 2, username: "Mihai Ionescu", post_date: T0 + 1500, sticky: 0, discussion_state: "visible", discussion_open: 1, discussion_type: "redirect", first_post_id: 0, prefix_id: 0 },
    ],
    xf_tag: [{ tag_id: 1, tag: "server" }],
    xf_tag_content: [{ content_type: "thread", content_id: 20, tag_id: 1 }],
    xf_poll: [{ poll_id: 1, content_type: "thread", content_id: 20, question: "Vii la lansare?", max_votes: 1, close_date: 0 }],
    xf_poll_response: [
      { poll_response_id: 1, poll_id: 1, response: "Da" },
      { poll_response_id: 2, poll_id: 1, response: "Nu" },
    ],
    xf_poll_vote: [{ user_id: 2, poll_response_id: 1, poll_id: 1 }],
    xf_post: [
      {
        post_id: 200,
        thread_id: 20,
        user_id: 1,
        username: "Admin XF",
        post_date: T0 + 1000,
        message:
          "[CENTER][SIZE=5][COLOR=#ff0000]Lansare sâmbătă![/COLOR][/SIZE][/CENTER]\n\nDetalii pe [URL=https://exemplu.ro/stiri]site[/URL] și în [URL='" +
          `${old}/threads/regulament.20/']regulament[/URL].\n\n[ATTACH type="full"]60[/ATTACH]\n[LIST]\n[*]IP: [ICODE]play.exemplu.ro[/ICODE]\n[*]Slot-uri: 64\n[/LIST]`,
        ip_id: 0,
        message_state: "visible",
        last_edit_date: 0,
        last_edit_user_id: 0,
      },
      {
        post_id: 201,
        thread_id: 20,
        user_id: 2,
        username: "Mihai Ionescu",
        post_date: T0 + 2000,
        message:
          '[QUOTE="Admin XF, post: 200, member: 1"]Lansare sâmbătă![/QUOTE]\nSuper, [USER=1]@Admin XF[/USER]!\n[MEDIA=youtube]dQw4w9WgXcQ[/MEDIA]\n[CODE=php]<?php echo "salut"; ?>[/CODE]\n[SPOILER="Final"]Totul merge.[/SPOILER]\n[IMG]http://nesigur.exemplu.ro/a.png[/IMG] [FOO]necunoscut[/FOO] [URL=javascript:alert(1)]rău[/URL]',
        ip_id: 3,
        message_state: "visible",
        last_edit_date: T0 + 2100,
        last_edit_user_id: 2,
      },
    ],
    xf_attachment: [
      { attachment_id: 60, data_id: 1060, content_type: "post", content_id: 200 },
      { attachment_id: 61, data_id: 1061, content_type: "conversation_message", content_id: 400 },
    ],
    xf_attachment_data: [
      { data_id: 1060, user_id: 1, filename: "afis.png", file_size: RED_PNG.length, file_hash: "aaaa", width: 8, height: 8 },
      { data_id: 1061, user_id: 2, filename: "dovada.png", file_size: GREEN_PNG.length, file_hash: "bbbb", width: 8, height: 8 },
    ],
    xf_reaction: [
      { reaction_id: 1, display_order: 1 },
      { reaction_id: 2, display_order: 2 },
      { reaction_id: 3, display_order: 3 },
    ],
    xf_reaction_content: [
      { reaction_content_id: 1, reaction_id: 3, content_type: "post", content_id: 200, reaction_user_id: 2, reaction_date: T0 + 2050 },
      { reaction_content_id: 2, reaction_id: 2, content_type: "post", content_id: 201, reaction_user_id: 1, reaction_date: T0 + 2060 },
    ],
    xf_conversation_master: [{ conversation_id: 40, title: "Întrebare", user_id: 2, start_date: T0 + 3000 }],
    xf_conversation_recipient: [
      { conversation_id: 40, user_id: 1, recipient_state: "active", last_read_date: T0 + 3000 },
      { conversation_id: 40, user_id: 2, recipient_state: "active", last_read_date: T0 + 3100 },
    ],
    xf_conversation_message: [
      { message_id: 400, conversation_id: 40, message_date: T0 + 3000, user_id: 2, message: "Am o [B]întrebare[/B].", ip_id: 0 },
      { message_id: 401, conversation_id: 40, message_date: T0 + 3100, user_id: 1, message: "Spune!", ip_id: 0 },
    ],
    xf_forum_watch: [{ user_id: 2, node_id: 2 }],
    xf_thread_watch: [{ user_id: 2, thread_id: 20 }],
    xf_user_follow: [{ user_id: 2, follow_user_id: 1 }],
    xf_user_ignored: [{ user_id: 1, ignored_user_id: 3 }],
    xf_warning: [{ warning_id: 1, user_id: 3, warning_user_id: 1, warning_date: T0 + 400, title: "Spam", notes: "", points: 5, expiry_date: 0 }],
    xf_profile_post: [{ profile_post_id: 7, profile_user_id: 2, user_id: 1, post_date: T0 + 500, message: "Bine ai venit, [B]Mihai[/B]!", ip_id: 0, message_state: "visible" }],
    xf_profile_post_comment: [{ profile_post_comment_id: 8, profile_post_id: 7, user_id: 2, comment_date: T0 + 600, message: "Mersi!", ip_id: 0, message_state: "visible" }],
  };
  const files = {
    "internal_data/attachments/1/1060-aaaa.data": RED_PNG,
    "internal_data/attachments/1/1061-bbbb.data": GREEN_PNG,
    "data/avatars/o/0/2.jpg": RED_PNG,
  };
  return { tables, files, oldUrl: old };
}
