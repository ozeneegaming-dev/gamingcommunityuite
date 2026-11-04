import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Paza mențiunilor peste tot (specul 2026-10-10-nume-mentiuni-grupuri-peste-tot): inventarul compozitorilor (unde se
 * scrie conținut cu @mențiuni) și al locurilor care afișează HTML cu nume. Un compozitor nou sau un loc nou cu HTML
 * brut trebuie trecut aici, cu felul în care primește sugestiile / stilul numelor, altfel testul pică.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Compozitorii: fișierul și semnul că folosesc sugestiile comune. */
const COMPOSERS: { file: string; how: RegExp; note: string }[] = [
  { file: "apps/web/app/(site)/_components/forum/GcsNewTopicForm.tsx", how: /mentionUrl/, note: "topic nou (editorul postărilor)" },
  { file: "apps/web/app/(site)/_components/topic/GcsReplyBox.tsx", how: /mentionUrl/, note: "răspuns rapid" },
  { file: "apps/web/app/(site)/_components/topic/GcsPostContent.tsx", how: /mentionUrl/, note: "editarea postării" },
  { file: "apps/web/app/(site)/_components/messages/GcsMessageForms.tsx", how: /mentionUrl/, note: "mesaje private (conversație nouă, răspuns)" },
  { file: "apps/web/app/(site)/_components/chat/GcsChatComposer.tsx", how: /useMentionInput/, note: "chat, Chat Pro, shoutbox" },
  { file: "apps/web/app/(site)/_components/profile/GcsWall.tsx", how: /useMentionInput/, note: "statusuri și comentarii pe profil" },
  { file: "apps/web/app/(site)/_components/settings/GcsSettingsExtra.tsx", how: /mentionUrl/, note: "semnătura (fără notificări)" },
  { file: "apps/web/app/(site)/_components/editor/GcsRichTextInput.tsx", how: /includes\("mention"\)/, note: "câmpurile formatate cu `mention` permis" },
  { file: "apps/web/app/(site)/_components/servers/GcsTicketForm.tsx", how: /"mention"/, note: "tichete (aplicația Servere)" },
  { file: "apps/web/app/(site)/_components/downloads/GcsDownloadActions.tsx", how: /GCS_RICH_FIELDS.downloadText/, note: "recenziile și comentariile fișierelor (Descărcări)" },
  { file: "apps/web/app/(site)/_components/downloads/GcsDownloadForm.tsx", how: /GCS_RICH_FIELDS.downloadText/, note: "descrierea și schimbările unui fișier (Descărcări)" },
];

/** Profilurile câmpurilor formatate care primesc mențiuni (descrierea clanului, câmpurile de profil, semnătura). */
const RICH_WITH_MENTIONS = ["signature", "profileText", "clanDescription", "downloadText"];

/** Locurile cu HTML brut: fiecare e trecut aici, cu motivul pentru care numele din el au stilul comun (sau n-au nume). */
const RAW_HTML: Record<string, string> = {
  "apps/web/app/(site)/chat/history/page.tsx": "namesHtml peste HTML-ul mesajelor",
  "apps/web/app/(site)/p/[plugin]/[[...path]]/page.tsx": "namesHtml",
  "apps/web/app/(site)/rules/page.tsx": "regulile chat-ului: fără mențiuni (profilul chatRules)",
  "apps/web/app/(site)/_components/GcsLegalDocPage.tsx": "termenii și confidențialitatea scrise în ACP (ca regulile): sanitizeContentHtml, fără mențiuni",
  "apps/web/app/(site)/search/page.tsx": "fragmentele căutării: text simplu cu evidențieri",
  "apps/web/app/(site)/vip/page.tsx": "namesHtml (previzualizările efectelor)",
  "apps/web/app/(site)/_components/chat/GcsChatRoom.tsx": "HTML decorat pe server (chatMentionNames)",
  "apps/web/app/(site)/_components/chat-pro/GcsChatProMessage.tsx": "HTML decorat pe server (chatMentionNames)",
  "apps/web/app/(site)/_components/chat-pro/GcsChatProRoom.tsx": "mesajul fixat (decorat pe server) și regulile (fără mențiuni)",
  "apps/web/app/(site)/_components/GcsHoverCardHost.tsx": "șablonul hover card-ului: namesHtml în /api/users/[id]/card",
  "apps/web/app/(site)/_components/GcsTranslateButton.tsx": "traducerea: textul tradus, fără pastile",
  "apps/web/app/(site)/_components/header/GcsHeaderBuilder.tsx": "HTML-ul propriu al temei în header (sanitizeContentHtml, scris de admini): fără mențiuni",
  "apps/web/app/(site)/_components/topic/GcsPost.tsx": "HTML-ul pluginurilor (sanitizat de gazdă)",
  "apps/web/app/(site)/_components/topic/GcsPostContent.tsx": "postările și reviziile: namesHtml în pagina topicului",
  "apps/web/app/(site)/_components/topic/GcsReplyBox.tsx": "previzualizarea răspunsului: namesHtml în previewPostAction",
  "apps/web/app/(site)/_components/widgets/GcsPluginWidget.tsx": "namesHtml",
  "apps/web/app/(site)/_components/widgets/registry.tsx": "anunțul: fără mențiuni (profilul announcement)",
  "apps/web/app/admin/(panel)/plugins/[plugin]/[[...path]]/page.tsx": "namesHtml",
  "apps/web/app/admin/(panel)/community/forums/[id]/page.tsx": "tab-urile pluginurilor din formularul forumului (sanitizat de gazdă)",
  "apps/web/app/admin/(panel)/members/bulk-mail/page.tsx": "previzualizarea emailului în masă: sanitizeContentHtml, profilul announcement (fără mențiuni)",
  "apps/web/app/layout.tsx": "CSS-ul temei",
  "apps/web/lib/member-names.tsx": "GcsNamedHtml (namesHtml)",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

describe("mențiunile peste tot", () => {
  test("fiecare compozitor folosește sugestiile comune", () => {
    const missing = COMPOSERS.filter((c) => !c.how.test(read(c.file))).map((c) => `${c.file} (${c.note})`);
    expect(missing).toEqual([]);
  });

  test("câmpurile formatate cu mențiuni: profilurile le permit", () => {
    const src = read("packages/core/src/content/richFields.ts");
    for (const key of RICH_WITH_MENTIONS) {
      const block = new RegExp(`${key}: \\{[\\s\\S]*?nodes: \\[([^\\]]*)\\]`).exec(src)?.[1] ?? "";
      expect(block, key).toContain('"mention"');
    }
  });

  test("HTML-ul brut e doar în locurile inventariate (numele din el au stilul comun)", () => {
    const files = walk(path.join(ROOT, "apps/web/app")).concat(walk(path.join(ROOT, "apps/web/lib")));
    const found = files
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
      .filter((rel) => /dangerouslySetInnerHTML/.test(read(rel)))
      .filter((rel) => !(rel in RAW_HTML));
    expect(found).toEqual([]);
  });

  test("conținutul fără editor: chat-ul păstrează mențiunile după id, iar paginile randează HTML-ul prin GcsNamedHtml", () => {
    expect(read("packages/modules/src/chat/chat.ts")).toMatch(/textMentions\.resolve\(/);
    expect(read("packages/modules/src/chat/text.ts")).toMatch(/gcs-groupMention/);
    for (const rel of [
      "apps/web/app/(site)/members/[ref]/page.tsx",
      "apps/web/app/(site)/messages/[id]/page.tsx",
      "apps/web/app/(site)/servers/tickets/[id]/page.tsx",
      "apps/web/app/(site)/clans/[ref]/page.tsx",
      "apps/web/app/(site)/settings/signature/page.tsx",
    ]) {
      expect(read(rel), rel).toMatch(/GcsNamedHtml/);
    }
  });
});
