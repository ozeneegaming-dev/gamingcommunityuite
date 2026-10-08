import { GcsUdpChannel, type GcsResolvedAddress } from "../../net";
import { GcsQueryFailure } from "../../protocols/reader";
import { GcsDemoError } from "./guard";

/**
 * Rcon-ul HLTV (CS 1.6, varianta B a specului 2026-10-08-servere-hltv §5): protocolul GoldSrc pe UDP. Întâi
 * `ÿÿÿÿchallenge rcon\n` → `ÿÿÿÿchallenge rcon <n>`, apoi `ÿÿÿÿrcon <n> "<adminpassword>" <comandă>\n` → `ÿÿÿÿl<text>`.
 * Doar două comenzi: `record <nume>` și `stoprecording`; parola nu poate închide ghilimelele comenzii.
 */

const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const CONTROL = /[\u0000-\u001F\u007F]/;

export type GcsHltvAction = { action: "record"; name: string } | { action: "stop" };

export function rconChallengePacket(): Buffer {
  return Buffer.concat([HEADER, Buffer.from("challenge rcon\n", "latin1")]);
}

/** Numărul din `ÿÿÿÿchallenge rcon <n>`; altceva → `null`. */
export function parseRconChallenge(buf: Buffer): string | null {
  if (buf.length < 5 || !buf.subarray(0, 4).equals(HEADER)) return null;
  const m = /^challenge rcon (-?\d{1,12})\s*\0?$/.exec(buf.subarray(4).toString("latin1").replace(/\0+$/, "").trimEnd());
  return m ? m[1]! : null;
}

/** Comanda HLTV (doar cele două permise). */
export function hltvCommand(a: GcsHltvAction): string {
  if (a.action === "stop") return "stoprecording";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(a.name)) throw new Error("Nume de înregistrare invalid");
  return `record ${a.name}`;
}

/** `ÿÿÿÿrcon <challenge> "<parola>" <comandă>\n`; parola / comanda care ar ieși din formă → eroare. */
export function rconCommandPacket(challenge: string, password: string, command: string): Buffer {
  if (!/^-?\d{1,12}$/.test(challenge)) throw new Error("Challenge invalid");
  if (password.length === 0 || password.length > 64 || password.includes('"') || CONTROL.test(password)) throw new Error("Parolă rcon invalidă");
  if (command !== "stoprecording" && !/^record [A-Za-z0-9_-]{1,64}$/.test(command)) throw new Error("Comandă rcon nepermisă");
  return Buffer.concat([HEADER, Buffer.from(`rcon ${challenge} "${password}" ${command}\n`, "latin1")]);
}

/** Răspunsul unei comenzi: textul după `l`, fără caracterele de control; parola greșită → `ok: false`. */
export function parseRconReply(buf: Buffer): { ok: boolean; text: string } {
  if (buf.length < 5 || !buf.subarray(0, 4).equals(HEADER) || buf[4] !== 0x6c) return { ok: false, text: "" };
  const text = buf.subarray(5).toString("latin1").replace(/[\u0000-\u001F\u007F]+/g, " ").trim().slice(0, 200);
  return { ok: !/bad rcon_?password|bad challenge|rcon is not enabled/i.test(text), text };
}

/**
 * Schimbul complet cu HLTV-ul (adresa e deja verificată de gardă): challenge, comanda, răspunsul. `timeoutMs` pentru
 * fiecare pas. Erorile au coduri stabile: `timeout`, `refused`, `bad_challenge`, `bad_password`.
 */
export async function hltvRcon(target: GcsResolvedAddress, port: number, password: string, action: GcsHltvAction, timeoutMs = 3000): Promise<{ text: string }> {
  const command = hltvCommand(action);
  let channel: GcsUdpChannel;
  try {
    channel = await GcsUdpChannel.open(target, port);
  } catch (error) {
    throw new GcsDemoError(error instanceof GcsQueryFailure ? error.code : "network");
  }
  try {
    await channel.send(rconChallengePacket());
    let challenge: string | null = null;
    // Câteva pachete străine (ex. un răspuns întârziat) se ignoră până la termen.
    const deadline = Date.now() + timeoutMs;
    while (challenge === null) challenge = parseRconChallenge(await channel.next(deadline));
    await channel.send(rconCommandPacket(challenge, password, command));
    const reply = parseRconReply(await channel.next(Date.now() + timeoutMs));
    if (!reply.ok) throw new GcsDemoError(/challenge/i.test(reply.text) ? "bad_challenge" : "bad_password");
    return { text: reply.text };
  } catch (error) {
    if (error instanceof GcsDemoError) throw error;
    throw new GcsDemoError(error instanceof GcsQueryFailure ? error.code : "network");
  } finally {
    channel.close();
  }
}
