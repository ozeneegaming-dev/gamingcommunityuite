import { GcsRateLimited, GcsValidationError } from "@gcs/core";
import { GcsButton, GcsCard, GcsUserLink } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { moveTargets, pageParam } from "@/lib/forum-page";
import { memberHref, postHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsPagination } from "../_components/forum/GcsPagination";
import { GcsRelTime } from "../_components/forum/GcsRelTime";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("search"))("title"), robots: { index: false } };
}

/** Căutarea în forum (fără diacritice, cu filtre): `/search?q=&type=&forum=&author=&since=`. */
export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const t = await getTranslations("search");
  const actor = await currentActor();
  const q = one(sp.q).trim();
  const type = one(sp.type) === "posts" ? "posts" : "topics";
  const forumId = Number(one(sp.forum)) || undefined;
  const author = one(sp.author).trim();
  const since = one(sp.since);
  const page = pageParam(sp.page);
  const forums = await moveTargets(actor);

  let result: Awaited<ReturnType<ReturnType<typeof services>["search"]["search"]>> | null = null;
  let message: string | null = null;
  if (q) {
    try {
      result = await services().search.search(actor, {
        q,
        type,
        page,
        ...(forumId ? { forumId } : {}),
        ...(author ? { authorName: author } : {}),
        ...(since ? { since } : {}),
      });
    } catch (error) {
      if (error instanceof GcsValidationError) message = t("tooShort");
      else if (error instanceof GcsRateLimited) message = t("rateLimited");
      else throw error;
    }
  }
  const query = (p: number) => {
    const params = new URLSearchParams({ q, type });
    if (forumId) params.set("forum", String(forumId));
    if (author) params.set("author", author);
    if (since) params.set("since", since);
    if (p > 1) params.set("page", String(p));
    return `/search?${params.toString()}`;
  };

  return (
    <>
      <h1 className="gcs-display gcs-pageHeader__title">{t("title")}</h1>
      <form className="gcs-card gcs-formCard gcs-searchForm" method="get" role="search">
        <div className="gcs-field gcs-searchForm__q">
          <label className="gcs-field__label" htmlFor="gcs-search-q">
            {t("query")}
          </label>
          <input id="gcs-search-q" className="gcs-input" name="q" type="search" defaultValue={q} required minLength={2} maxLength={200} />
        </div>
        <div className="gcs-field">
          <label className="gcs-field__label" htmlFor="gcs-search-type">
            {t("type")}
          </label>
          <select id="gcs-search-type" className="gcs-input" name="type" defaultValue={type}>
            <option value="topics">{t("types.topics")}</option>
            <option value="posts">{t("types.posts")}</option>
          </select>
        </div>
        <div className="gcs-field">
          <label className="gcs-field__label" htmlFor="gcs-search-forum">
            {t("forum")}
          </label>
          <select id="gcs-search-forum" className="gcs-input" name="forum" defaultValue={forumId ? String(forumId) : ""}>
            <option value="">{t("allForums")}</option>
            {forums.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="gcs-field">
          <label className="gcs-field__label" htmlFor="gcs-search-author">
            {t("author")}
          </label>
          <input id="gcs-search-author" className="gcs-input" name="author" defaultValue={author} maxLength={40} />
        </div>
        <div className="gcs-field">
          <label className="gcs-field__label" htmlFor="gcs-search-since">
            {t("since")}
          </label>
          <input id="gcs-search-since" className="gcs-input" name="since" type="date" defaultValue={since} />
        </div>
        <div>
          <GcsButton variant="primary" type="submit">
            {t("submit")}
          </GcsButton>
        </div>
      </form>

      {message && (
        <p role="alert" className="gcs-notice gcs-notice--error">
          {message}
        </p>
      )}
      {result && (
        <section aria-live="polite" className="gcs-searchResults">
          <p className="gcs-muted">{result.pagination.total === 0 ? t("none", { q }) : t("results", { count: result.pagination.total, q })}</p>
          {result.results.map((r) => (
            <GcsCard key={`${r.topicId}-${r.postId}`} as="article" className="gcs-searchResult" data-testid="gcs-search-result">
              <h2 className="gcs-searchResult__title">
                <Link href={postHref(r.topicId, r.postId)}>{r.topicTitle}</Link>
              </h2>
              {/* Fragmentul vine sanitizat de server: doar <mark> e permis. */}
              <p className="gcs-searchResult__snippet" dangerouslySetInnerHTML={{ __html: r.snippet }} />
              <p className="gcs-searchResult__meta">
                {r.author && (
                  <>
                    <GcsUserLink userId={r.author.id} name={r.author.name} nameKey={r.author.nameKey} href={memberHref(r.author)} />
                    {" · "}
                  </>
                )}
                {t("in", { forum: r.forumName })} · <GcsRelTime at={r.createdAt} />
              </p>
            </GcsCard>
          ))}
          <GcsPagination pagination={result.pagination} href={query} />
        </section>
      )}
    </>
  );
}
