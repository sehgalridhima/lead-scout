/* ===============================================================
   FETCHING — no model involved, on purpose
   ===============================================================
   Everything here is "go and get the pages". That is following
   links and reading HTML, not judgement, so none of it goes near
   Claude: a model asked to guess a company's contact URL will
   confidently invent one, and it costs money to be wrong.

   The bounds below exist because this fetches whatever URL it is
   handed. A page can be enormous, a server can hang, and a site can
   link in a circle. Each limit is the answer to one of those.
   =============================================================== */

/** Pages fetched per lookup, including the one that was pasted. */
const MAX_PAGES = 5;

/** A page slower than this is not worth the wait. */
const TIMEOUT_MS = 10_000;

/** Read this much of a page and stop. Enough for any real contact page. */
const MAX_BYTES = 600_000;

/**
 * Paths worth looking for, best first.
 *
 * Matched against the site's own links rather than guessed at: asking
 * for /contact on a site that calls it /kontakt returns a 404 page
 * that looks like content, and nothing downstream can tell the
 * difference.
 */
const WANTED: { key: PageKind; patterns: RegExp }[] = [
  { key: "contact", patterns: /contact|reach-us|get-in-touch|connect|support|kontakt/i },
  { key: "about", patterns: /about|who-we-are|our-story|company|mission/i },
  { key: "pricing", patterns: /pricing|plans|packages|price/i },
  { key: "team", patterns: /team|people|leadership|founders|management/i },
];

export type PageKind = "home" | "contact" | "about" | "pricing" | "team";

export type Page = {
  kind: PageKind;
  url: string;
  html: string;
};

export class LookupError extends Error {}

/**
 * Normalises whatever was pasted into a URL we can fetch.
 *
 * People paste "acme.com", "www.acme.com/", and full URLs with
 * tracking junk on the end. All three mean the same site.
 */
export function normaliseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new LookupError("Paste a company's website address first.");

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new LookupError(`"${input}" does not look like a web address.`);
  }

  if (!/^https?:$/.test(url.protocol)) {
    throw new LookupError("Only http and https addresses can be looked up.");
  }
  if (!url.hostname.includes(".")) {
    throw new LookupError(`"${input}" does not look like a web address.`);
  }

  url.hash = "";
  url.search = "";
  return url.toString();
}

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        /*
         * Identify honestly. A tool that reads public pages should say
         * what it is; pretending to be a browser is what gets a scraper
         * blocked, and deservedly.
         */
        "User-Agent": "LeadScout/1.0 (+contact-and-marketing lookup; one page set per request)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) return null;

    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;

    // Read with a cap rather than response.text(): a 40MB page would
    // otherwise be pulled into memory in full before being rejected.
    const reader = response.body?.getReader();
    if (!reader) return null;

    /*
     * Decoded as it arrives rather than collected and joined. A
     * streaming decoder also handles a multi-byte character split
     * across two chunks, which joining fixed-size buffers does not.
     */
    const decoder = new TextDecoder("utf-8");
    let text = "";
    let size = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      text += decoder.decode(value, { stream: true });
      if (size >= MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }

    return text + decoder.decode();
  } catch {
    // A dead link, a timeout and a certificate error all mean the same
    // thing here: this page is not available, carry on with the others.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Same-site links on the page, absolute and de-duplicated. */
function linksOn(html: string, base: string): string[] {
  const origin = new URL(base).origin;
  const found = new Set<string>();

  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1], base);
      url.hash = "";
      url.search = "";
      // Same origin only. An "About" link pointing at a parent company
      // or a Medium blog is a different company's page.
      if (url.origin === origin) found.add(url.toString());
    } catch {
      /* mailto:, tel:, javascript: — not pages */
    }
  }

  return [...found];
}

/**
 * The pasted page plus whichever of contact/about/pricing/team the
 * site actually links to.
 */
export async function collectPages(startUrl: string): Promise<Page[]> {
  const home = await fetchPage(startUrl);

  if (home === null) {
    throw new LookupError(
      "Could not read that site — it may be down, blocking us, or not a website at all.",
    );
  }

  const pages: Page[] = [{ kind: "home", url: startUrl, html: home }];
  const links = linksOn(home, startUrl);

  for (const { key, patterns } of WANTED) {
    if (pages.length >= MAX_PAGES) break;

    const match = links.find((link) => {
      const path = new URL(link).pathname;
      return path !== "/" && patterns.test(path);
    });
    if (!match || pages.some((p) => p.url === match)) continue;

    const html = await fetchPage(match);
    if (html) pages.push({ kind: key, url: match, html });
  }

  return pages;
}

/**
 * HTML down to the words on the page.
 *
 * Script and style contents are removed rather than stripped of tags —
 * a minified bundle left in place is tens of thousands of tokens of
 * noise, and it is the single biggest thing that would have been paid
 * for on every lookup.
 */
export function toText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}
