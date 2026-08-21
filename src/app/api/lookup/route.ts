import { NextResponse } from "next/server";
import { collectPages, normaliseUrl, LookupError } from "@/lib/fetch-site";
import { extractContacts, type Contacts } from "@/lib/contacts";
import { estimateCostInr, research, type Research } from "@/lib/research";

/* ===============================================================
   LOOKUP
   ===============================================================
   One URL in, one report out.

   Cached by hostname. Looking the same company up twice in an
   afternoon is the normal way this gets used — you check it, you
   come back to it, you send it to yourself — and none of those
   should cost anything after the first.
   =============================================================== */

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/* ---------------------------------------------------------------
   Two limits, because they stop different things.

   The per-visitor one stops somebody sitting there pasting domains.
   The daily one stops a hundred visitors doing it once each — which
   the first limit would happily allow, and which costs exactly as
   much.

   This matters more here than it looks: the Anthropic account behind
   this is the same one Eloquence uses, under one monthly ceiling. An
   afternoon of this draining that ceiling does not just stop this
   site, it stops meal plans being generated on the other one.

   Both counters live in memory, so a serverless instance that gets
   recycled forgets. That makes them a brake, not a wall — the wall
   is the spend limit on the account itself.
   --------------------------------------------------------------- */
const PER_VISITOR_LIMIT = 5;
const PER_VISITOR_WINDOW_MS = 60 * 60 * 1000;
const DAILY_LIMIT = 60;

type Report = { url: string; contacts: Contacts; research: Research };

const cache = new Map<string, { at: number; report: Report }>();
const visits = new Map<string, number[]>();
const spentToday: { day: string; count: number } = { day: "", count: 0 };

function visitorKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function overVisitorLimit(key: string): boolean {
  const now = Date.now();
  const recent = (visits.get(key) ?? []).filter((t) => now - t < PER_VISITOR_WINDOW_MS);
  visits.set(key, recent);
  if (recent.length >= PER_VISITOR_LIMIT) return true;
  recent.push(now);
  return false;
}

function overDailyLimit(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (spentToday.day !== today) {
    spentToday.day = today;
    spentToday.count = 0;
  }
  if (spentToday.count >= DAILY_LIMIT) return true;
  spentToday.count += 1;
  return false;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Could not read that request." }, { status: 400 });
  }

  let url: string;
  try {
    url = normaliseUrl(String(body.url ?? ""));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof LookupError ? e.message : "That address could not be read." },
      { status: 400 },
    );
  }

  const key = new URL(url).hostname.replace(/^www\./, "");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...hit.report, cached: true });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "No API key is configured, so the marketing summary cannot be written." },
      { status: 503 },
    );
  }

  /*
   * Checked after the cache, on purpose. A repeat lookup of a domain
   * already read costs nothing, so it should not count against anyone.
   */
  if (overVisitorLimit(visitorKey(request))) {
    return NextResponse.json(
      {
        error: `That is ${PER_VISITOR_LIMIT} lookups this hour, which is the limit. Each one reads a live site and costs real money, so it is capped. Try again a little later.`,
      },
      { status: 429 },
    );
  }

  if (overDailyLimit()) {
    return NextResponse.json(
      {
        error:
          "This site has hit its lookups for today. It runs on one person's API credit, so there is a daily ceiling. Try tomorrow.",
      },
      { status: 429 },
    );
  }

  try {
    const pages = await collectPages(url);

    /*
     * Contacts first, and independently. They come from parsing, so
     * they are already correct — and if Claude fails, a report with
     * real contact details and no summary is still worth having.
     */
    const contacts = extractContacts(pages);

    const { research: found, usage } = await research(pages);

    console.log(
      `[lookup] ${key} · ${pages.length} pages · ${usage.inputTokens} in / ${usage.outputTokens} out · ~Rs ${estimateCostInr(usage).toFixed(2)}`,
    );

    const report: Report = { url, contacts, research: found };
    cache.set(key, { at: Date.now(), report });

    return NextResponse.json({
      ...report,
      pagesRead: pages.map((p) => ({ kind: p.kind, url: p.url })),
      cached: false,
    });
  } catch (e) {
    if (e instanceof LookupError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    console.error("[lookup] failed:", e);
    return NextResponse.json(
      { error: "Something went wrong reading that site. Try again, or try the plain domain." },
      { status: 502 },
    );
  }
}
