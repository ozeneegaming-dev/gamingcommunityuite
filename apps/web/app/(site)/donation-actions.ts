"use server";

import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

/**
 * „Am donat” (`/donatii`): membrul anunță o donație făcută prin linkul / instrucțiunile comunității, cu referința plății.
 * Rămâne în așteptare până o confirmă echipa (ACP › VIP & Magazin › Donații); nu se trimit niciodată date de card.
 */
export const submitDonation = gcsAction(
  z.object({
    // Limitele și mesajele pe câmpuri le dă serviciul (aceleași ca în ACP).
    amount: z.number(),
    currency: z.string().max(8),
    method: z.string().max(200),
    reference: z.string().max(500),
    note: z.string().max(1000),
    anonymous: z.boolean(),
    donatedAt: z.string().max(10),
  }),
  async (input, { actor }) => {
    const row = await services().donations.submit(actor, input);
    return { id: row.id };
  },
);
