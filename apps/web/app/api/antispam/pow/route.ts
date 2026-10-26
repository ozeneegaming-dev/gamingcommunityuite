import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** O provocare nouă pentru captcha-ul proof-of-work al înregistrării (fără stare: semnată cu secretul aplicației). */
export async function GET() {
  const challenge = await services().antispam.powChallenge();
  return Response.json(challenge, { headers: { "Cache-Control": "no-store" } });
}
