import { getFormatter } from "next-intl/server";

/** Data relativă („acum 12 min”), cu data completă în `title` și `dateTime`. */
export async function GcsRelTime({ at }: { at: string }) {
  const format = await getFormatter();
  const date = new Date(at);
  return (
    <time dateTime={at} title={format.dateTime(date, { dateStyle: "long", timeStyle: "short" })}>
      {format.relativeTime(date, new Date())}
    </time>
  );
}
