"use server";

import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { services } from "@/lib/services";

/** Formularul `/contact`: membrii trimit cu numele și emailul contului; vizitatorii cu ale lor și cu captcha-ul invizibil. */
export const sendContactAction = gcsAction(
  z.object({
    name: z.string().max(200).default(""),
    email: z.string().max(300).default(""),
    subject: z.string().max(200),
    body: z.string().max(6000),
    pow: z.string().max(2000).nullable().default(null),
  }),
  async (input, { actor, ip }) => {
    const { contact, db } = services();
    const account = actor.userId ? await db.user.findUnique({ where: { id: actor.userId }, select: { name: true, email: true } }) : null;
    const { id } = await contact.submit(actor, { ...input, ip }, account);
    return { id };
  },
);
