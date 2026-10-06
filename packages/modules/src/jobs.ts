import { writeWorkerHeartbeat } from "@gcs/core";
import type { GcsServices } from "./services";

/** Jobul care dovedește că worker-ul procesează coada (nu doar că procesul trăiește). */
export const HEARTBEAT_JOB = "system.heartbeat";

/**
 * Joburile aplicației. Se înregistrează în orice proces (în `web` doar ca nume cunoscute),
 * dar rulează doar în `gcs-worker` (`services.jobs.start()`).
 */
export function registerAppJobs(s: GcsServices): void {
  s.jobs.register({ name: HEARTBEAT_JOB, everyMs: 60_000, handler: () => writeWorkerHeartbeat(s.redis) });
  s.achievements.registerJobs(s.jobs);
  s.vip.registerJobs(s.jobs);
  s.notificationProducers.registerJobs(s.jobs);
  s.chat.registerJobs(s.jobs);
  s.jobs.register({ name: "translate.cleanup", everyMs: 24 * 3600_000, handler: async () => void (await s.translation.cleanup()) });
  s.importer.registerJobs(s.jobs);
}
