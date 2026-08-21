import { cacheLife, cacheTag } from "next/cache";
import { collectPages } from "@/lib/fetch-site";
import { extractContacts, type Contacts } from "@/lib/contacts";
import { estimateCostInr, research, type Research } from "@/lib/research";

/* ===============================================================
   THE EXPENSIVE PART, CACHED WHERE IT CANNOT BE LOST
   ===============================================================
   This was a Map in the route handler, which looked like caching
   and mostly was not. Each serverless instance kept its own, and
   Vercel routes requests to whichever instance it likes — so a
   company looked up a minute ago would be read, and paid for,
   again. It also meant the cache could not be trusted to spare
   anyone the rate limit, because a "hit" was luck.

   'use cache: remote' is durable and shared across instances, so a
   second lookup of a domain is genuinely free and genuinely instant.

   Keyed by the canonical origin. www.acme.com, acme.com/about and
   acme.com/?utm=x are all one company, and none of them should cost
   three lookups.
   =============================================================== */

export type Report = {
  url: string;
  contacts: Contacts;
  research: Research;
  pagesRead: { kind: string; url: string }[];
};

/**
 * Scheme and host only, lowercased, no www.
 *
 * This is the cache key, so it has to collapse everything that means
 * "the same company" into one string.
 */
export function canonicalOrigin(url: string): string {
  const parsed = new URL(url);
  return `https://${parsed.hostname.toLowerCase().replace(/^www\./, "")}`;
}

export async function lookupCompany(origin: string): Promise<Report> {
  "use cache: remote";

  // A company's contact page and positioning do not change hourly, and
  // a day-old read is fine for deciding whether to write to them.
  cacheLife("days");
  cacheTag(`company:${origin}`);

  const pages = await collectPages(origin);

  /*
   * Contacts first and independently. They come from parsing, so they
   * are already exact — and if the model call fails, a report with
   * real contact details is still worth having.
   */
  const contacts = extractContacts(pages);
  const { research: found, usage } = await research(pages);

  console.log(
    `[lookup] ${origin} · ${pages.length} pages · ${usage.inputTokens} in / ${usage.outputTokens} out · ~Rs ${estimateCostInr(usage).toFixed(2)}`,
  );

  return {
    url: origin,
    contacts,
    research: found,
    pagesRead: pages.map((p) => ({ kind: p.kind, url: p.url })),
  };
}
