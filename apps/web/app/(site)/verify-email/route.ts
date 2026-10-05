import { GcsError } from "@gcs/core";
import { services } from "@/lib/services";
import { localRedirect } from "@/lib/redirect";

export const dynamic = "force-dynamic";

/** Linkul din emailul de confirmare a adresei noi (Setări → Cont). Tokenul e de unică folosință, valabil 24 de ore. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  try {
    await services().profiles.confirmEmailChange(token);
    return localRedirect("/settings/account?email=changed");
  } catch (error) {
    if (error instanceof GcsError) return localRedirect("/settings/account?email=invalid");
    throw error;
  }
}
