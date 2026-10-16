import { PLUGIN_JOB, writeWorkerHeartbeat } from "@gcs/core";
import type { GcsServices } from "./services";

/** Jobul care dovedește că worker-ul procesează coada (nu doar că procesul trăiește). */
export const HEARTBEAT_JOB = "system.heartbeat";
/** Jobul care scoate grupurile secundare temporare expirate (Membri v2). */
export const SECONDARY_EXPIRY_JOB = "groups.secondary_expiry";

/**
 * Joburile aplicației. Se înregistrează în orice proces (în `web` doar ca nume cunoscute),
 * dar rulează doar în `gcs-worker` (`services.jobs.start()`).
 */
export function registerAppJobs(s: GcsServices): void {
  s.jobs.register({ name: HEARTBEAT_JOB, everyMs: 60_000, handler: () => writeWorkerHeartbeat(s.redis) });
  s.achievements.registerJobs(s.jobs);
  s.vip.registerJobs(s.jobs);
  // Membri v2: grupurile secundare temporare ajunse la expirare se scot (membrul e anunțat), la minut.
  s.jobs.register({ name: SECONDARY_EXPIRY_JOB, everyMs: 60_000, handler: async () => void (await s.groups.expireSecondary()) });
  s.notificationProducers.registerJobs(s.jobs);
  s.chat.registerJobs(s.jobs);
  // Moderarea chat-ului: expirarea accesului de moderator, a mute-urilor și a sancțiunilor (la minut).
  s.chatModeration.registerJobs(s.jobs);
  // Chat Pro: câștigătorul perioadei încheiate a clasamentului (și badge-ul lui), o dată pe oră.
  s.jobs.register({
    name: "chat_pro.finalize",
    everyMs: 3600_000,
    handler: async () => {
      if (await s.chatPro.active()) await s.chatPro.ranking.finalize();
    },
  });
  s.jobs.register({ name: "translate.cleanup", everyMs: 24 * 3600_000, handler: async () => void (await s.translation.cleanup()) });
  // Timpul online: totalurile zilei copiate din Redis în baza de date (5 min).
  s.onlineTime.registerJobs(s.jobs);
  // Joburile pluginurilor (etapa 6): un singur job generic, rulat de gazda pluginurilor din worker.
  s.jobs.register({ name: PLUGIN_JOB, handler: (data) => s.plugins.runJob(data) });
  s.importer.registerJobs(s.jobs);
  // Aplicația Servere: runda de interogare (10 s) și agregarea orară a istoricului.
  s.serverPoller.registerJobs(s.jobs);
  // Puntea cu serverele de joc: curățenia (5 min), locurile pe server, legăturile Steam și imaginile hărților (10 min).
  s.bridge.registerJobs(s.jobs);
  // Aplicația Clanuri: clasamentul (orar), expirările și arhivarea clanurilor inactive (zilnic).
  s.clans.registerJobs(s.jobs);
  // Ștergerea și unirea conturilor: rularea operațiilor și cererile ajunse la termen (5 min).
  s.memberRemoval.registerJobs(s.jobs);
  // Profil gaming v2: datele Steam / FACEIT ale membrilor cu Steam legat (la cerere și o rundă orară).
  s.externalProfiles.registerJobs(s.jobs);
}
