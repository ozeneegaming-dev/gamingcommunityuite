import type { GcsActor } from "@gcs/core";
import type { ChatChannel } from "@gcs/db";
import type { GcsChatMessageView } from "./chat";

/** Ce vede o extensie înainte de salvarea unui mesaj: textul curățat (după limite, mute, slow mode și flood). */
export type GcsChatSendContext = {
  actor: GcsActor;
  channel: Pick<ChatChannel, "id" | "key" | "type">;
  body: string;
  /** Câte fișiere are mesajul (imagini, voce). */
  files: number;
  replyToId: number | null;
};

/**
 * Ce poate schimba o extensie: textul salvat (ex. rezultatul unei comenzi) și datele ei, păstrate în `meta` (chat-ul
 * standard le ignoră). O eroare aruncată oprește trimiterea (ex. o comandă dezactivată).
 */
export type GcsChatSendPatch = { body?: string; meta?: Record<string, unknown> };

/** Mesajul salvat (după tranzacție): pentru statistici, notificări etc. */
export type GcsChatSavedContext = {
  actor: GcsActor;
  channel: Pick<ChatChannel, "id" | "key" | "type">;
  messageId: number;
  body: string;
  meta: Record<string, unknown> | null;
  replyToId: number | null;
  createdAt: Date;
};

/**
 * O extensie a chat-ului (punctele de extensie folosite de aplicația Chat Pro). Fiecare cârlig e opțional și e chemat
 * doar cât extensia e activă (`active()`), deci fără extensii active chat-ul se comportă exact ca înainte.
 */
export interface GcsChatExtension {
  key: string;
  active(): Promise<boolean>;
  beforeSend?(ctx: GcsChatSendContext): Promise<GcsChatSendPatch | void>;
  afterSend?(ctx: GcsChatSavedContext): Promise<void>;
  /**
   * Completează vederile mesajelor (pe loc). Datele adăugate sunt aceleași pentru toți cititorii: vederea unui mesaj nou
   * pleacă live, o singură dată, spre toată camera.
   */
  decorate?(views: GcsChatMessageView[]): Promise<void>;
}

/** Registrul extensiilor chat-ului, împărțit de `GcsChatService` și `GcsChatQueries`. */
export class GcsChatExtensions {
  private list: GcsChatExtension[] = [];
  private base: ((views: GcsChatMessageView[]) => Promise<void>)[] = [];

  /** Înregistrează (sau înlocuiește, după cheie) o extensie. */
  use(ext: GcsChatExtension): void {
    this.list = [...this.list.filter((e) => e.key !== ext.key), ext];
  }

  /**
   * O decorare a chat-ului standard (mereu activă, înaintea extensiilor): ex. stilul numelor din pastilele mențiunilor.
   * Rulează și fără nicio extensie înregistrată.
   */
  useBase(decorate: (views: GcsChatMessageView[]) => Promise<void>): void {
    this.base.push(decorate);
  }

  private async active(): Promise<GcsChatExtension[]> {
    const out: GcsChatExtension[] = [];
    for (const e of this.list) if (await e.active()) out.push(e);
    return out;
  }

  /** Cârligele `beforeSend`, în ordinea înregistrării: fiecare vede textul lăsat de cele dinainte; `meta` se adună. */
  async beforeSend(ctx: GcsChatSendContext): Promise<GcsChatSendPatch> {
    if (this.list.length === 0) return {};
    let body: string | undefined;
    let meta: Record<string, unknown> | undefined;
    for (const e of await this.active()) {
      const patch = await e.beforeSend?.({ ...ctx, body: body ?? ctx.body });
      if (!patch) continue;
      if (patch.body !== undefined) body = patch.body;
      if (patch.meta) meta = { ...meta, ...patch.meta };
    }
    return { ...(body !== undefined ? { body } : {}), ...(meta ? { meta } : {}) };
  }

  async afterSend(ctx: GcsChatSavedContext): Promise<void> {
    if (this.list.length === 0) return;
    for (const e of await this.active()) await e.afterSend?.(ctx);
  }

  async decorate<T extends GcsChatMessageView[]>(views: T): Promise<T> {
    if (views.length === 0) return views;
    for (const d of this.base) await d(views);
    if (this.list.length === 0) return views;
    for (const e of await this.active()) await e.decorate?.(views);
    return views;
  }
}
