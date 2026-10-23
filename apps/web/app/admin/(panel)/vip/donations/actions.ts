"use server";

import type { GcsResult } from "@gcs/core";
import { DONATION_GOALS_ACP_SECTION, DONATIONS_ACP_SECTION, type GcsDonationGoalInput, type GcsDonationInput, type GcsDonationStatus } from "@gcs/modules";
import { field, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Câmpurile formularului unei donații (adăugare / editare, ACP › Donații și fișa membrului). */
function donationInput(fd: FormData, fixedMember?: string): GcsDonationInput {
  return {
    member: fixedMember ?? field(fd, "member"),
    donorName: field(fd, "donorName"),
    amount: Number(field(fd, "amount").replace(",", ".")),
    currency: field(fd, "currency"),
    donatedAt: field(fd, "donatedAt"),
    method: field(fd, "method"),
    note: field(fd, "note"),
    reference: field(fd, "reference"),
    anonymous: fd.get("anonymous") === "on",
    status: (field(fd, "status") || "CONFIRMED") as GcsDonationStatus,
    notify: fd.get("notify") === "on",
  };
}

export async function addDonation(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(DONATIONS_ACP_SECTION, "edit", async (actor) => {
    await services().donations.record(actor, donationInput(fd));
    return null;
  });
}

/** Din fișa membrului: donația e a lui (fără câmpul „Membru”). */
export async function addMemberDonation(userId: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(DONATIONS_ACP_SECTION, "edit", async (actor) => {
    await services().donations.record(actor, donationInput(fd, userId));
    return null;
  });
}

export async function updateDonation(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(DONATIONS_ACP_SECTION, "edit", async (actor) => {
    await services().donations.update(actor, id, donationInput(fd));
    return null;
  });
}

export async function confirmDonation(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(DONATIONS_ACP_SECTION, "edit", async (actor) => {
    await services().donations.confirm(actor, id, { notify: fd.get("notify") !== "off" });
    return null;
  });
}

export async function rejectDonation(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(DONATIONS_ACP_SECTION, "edit", async (actor) => {
    await services().donations.reject(actor, id, field(fd, "reason"));
    return null;
  });
}

export async function deleteDonation(id: number): Promise<GcsResult<null>> {
  return runAcpAction(DONATIONS_ACP_SECTION, "delete", async (actor) => {
    await services().donations.remove(actor, id);
    return null;
  });
}

// ─── Obiectivele ───────────────────────────────────────────────────────────────────────────────────

function goalInput(fd: FormData): GcsDonationGoalInput {
  return {
    title: field(fd, "title"),
    target: Number(field(fd, "target").replace(",", ".")),
    currency: field(fd, "currency"),
    period: field(fd, "period") === "CUSTOM" ? "CUSTOM" : "MONTHLY",
    startsOn: field(fd, "startsOn"),
    endsOn: field(fd, "endsOn"),
    autoRenew: fd.get("autoRenew") === "on",
    groupIds: fd.getAll("groupIds").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0),
    enabled: fd.get("enabled") === "on",
  };
}

export async function saveGoal(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(DONATION_GOALS_ACP_SECTION, "edit", async (actor) => {
    await services().donations.saveGoal(actor, id, goalInput(fd));
    return null;
  });
}

export async function deleteGoal(id: number): Promise<GcsResult<null>> {
  return runAcpAction(DONATION_GOALS_ACP_SECTION, "delete", async (actor) => {
    await services().donations.deleteGoal(actor, id);
    return null;
  });
}
