import { decorateMemberNamesHtml } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { memberNameKeys } from "../profile/nameKeys";
import type { GcsChatMessageView } from "./chat";

/**
 * Decorarea de bază a mesajelor de chat (mereu activă): pastilele mențiunilor de membri primesc stilul numelui de acum
 * (`gcs-name--<cheie>`, după grupul afișat sau stilul ales) și literele pentru efectele pe litere din Studio VIP. Vederea
 * pleacă live o singură dată spre toată camera, deci decorarea e aceeași pentru toți cititorii.
 */
export function chatMentionNames(deps: { db: PrismaClient; letterUsers?: () => Promise<readonly string[]> }): (views: GcsChatMessageView[]) => Promise<void> {
  return async (views) => {
    const ids = [...new Set(views.flatMap((v) => (v.mentions ?? []).filter((m) => m.kind === "user").map((m) => m.id)))];
    if (ids.length === 0) return;
    const [keys, letters] = await Promise.all([memberNameKeys(deps.db, ids), deps.letterUsers ? deps.letterUsers().catch(() => [] as string[]) : Promise.resolve([] as string[])]);
    const set = new Set(letters);
    for (const v of views) {
      if (v.mentions?.some((m) => m.kind === "user")) v.html = decorateMemberNamesHtml(v.html, { keys, letters: set });
    }
  };
}
