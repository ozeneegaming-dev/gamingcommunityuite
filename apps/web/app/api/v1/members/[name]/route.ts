import { publicApiRoute } from "@/lib/public-api";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

function decoded(raw: string): string {
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

/** `GET /api/v1/members/{nume}` (dreptul `members:read`): profilul public al membrului; 404 dacă nu e vizibil. */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const name = decoded((await params).name);
  return publicApiRoute(req, "members:read", async (guest) => (name.length === 0 || name.length > 64 ? null : services().publicApi.member(guest, name)));
}
