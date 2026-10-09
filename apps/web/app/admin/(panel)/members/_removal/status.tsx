import type { MemberRemovalStatus } from "@gcs/db";
import { GcsBadge, type GcsBadgeTone } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";

const TONE: Record<MemberRemovalStatus, GcsBadgeTone> = { SCHEDULED: "info", QUEUED: "neutral", RUNNING: "warn", DONE: "ok", FAILED: "accent", CANCELLED: "neutral" };
const ICON: Record<MemberRemovalStatus, string> = {
  SCHEDULED: "fa-solid fa-hourglass-half",
  QUEUED: "fa-solid fa-clock",
  RUNNING: "fa-solid fa-gears",
  DONE: "fa-solid fa-circle-check",
  FAILED: "fa-solid fa-circle-exclamation",
  CANCELLED: "fa-solid fa-ban",
};

/** Starea unei operații, cu text și iconiță (niciodată doar culoarea). */
export function GcsRemovalStatus({ status, label }: { status: MemberRemovalStatus; label: string }) {
  return (
    <GcsBadge tone={TONE[status]} icon={<GcsIcon name={ICON[status]} />} data-testid="gcs-removal-status" data-status={status}>
      {label}
    </GcsBadge>
  );
}

export const REMOVAL_ACTIVE = new Set<MemberRemovalStatus>(["QUEUED", "RUNNING"]);
