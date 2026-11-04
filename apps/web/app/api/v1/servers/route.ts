import { publicApiRoute } from "@/lib/public-api";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** `GET /api/v1/servers` (dreptul `servers:read`): serverele publice cu statusul lor; 404 fără aplicația Servere. */
export async function GET(req: Request): Promise<Response> {
  return publicApiRoute(req, "servers:read", (guest) => services().publicApi.servers(guest));
}
