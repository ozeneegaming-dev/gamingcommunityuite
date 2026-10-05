import { GcsError } from "@gcs/core";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Linkul din emailul de confirmare a adresei noi (Setări → Cont). Tokenul e de unică folosință, valabil 24 de ore. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  try {
    await services().profiles.confirmEmailChange(token);
    return Response.redirect(new URL("/settings/account?email=changed", url), 303);
  } catch (error) {
    if (error instanceof GcsError) return Response.redirect(new URL("/settings/account?email=invalid", url), 303);
    throw error;
  }
}
