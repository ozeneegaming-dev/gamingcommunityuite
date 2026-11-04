import { publicApiRoute } from "@/lib/public-api";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** `GET /api/v1/stats` (dreptul `stats:read`): topicurile, postările, membrii și cel mai nou membru. */
export async function GET(req: Request): Promise<Response> {
  return publicApiRoute(req, "stats:read", () => services().publicApi.stats());
}
