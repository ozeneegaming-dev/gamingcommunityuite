import { publicApiRoute } from "@/lib/public-api";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** `GET /api/v1/topics?limit=10` (dreptul `forums:read`): ultimele topicuri active din forumurile publice (max 50). */
export async function GET(req: Request): Promise<Response> {
  return publicApiRoute(req, "forums:read", (guest, url) => {
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
    return services().publicApi.topics(guest, Number.isFinite(limit) ? limit : 10);
  });
}
