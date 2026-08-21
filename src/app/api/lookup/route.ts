import { NextResponse } from "next/server";
import { normaliseUrl, LookupError } from "@/lib/fetch-site";
import { canonicalOrigin, lookupCompany } from "@/lib/lookup";

/* ===============================================================
   LOOKUP
   ===============================================================
   One URL in, one report out. The reading and the summarising live
   in lookup.ts behind a durable cache; what is left here is the two
   limits and the error handling.

   The limits are checked BEFORE the cached call, which means a
   repeat lookup of an already-read company still costs you one of
   your hourly allowance even though it costs no money. That is the
   wrong way round, and it is deliberate: telling a hit from a miss
   would mean reaching inside the cache, and a limit that can be
   reset by asking for the same domain twice is not a limit. The
   allowance is set high enough that it does not bite.
   =============================================================== */

/*
 * Two limits, because they stop different things. Per-visitor stops
 * one person pasting domains all afternoon; the daily one stops fifty
 * people doing it once each, which the first would happily allow and
 * which costs exactly as much.
 *
 * The daily number is arithmetic, not a feeling. A lookup costs about
 * Rs 4, so eight a day is roughly Rs 960 a month — which fits inside
 * the account's ceiling while leaving room for Eloquence, which draws
 * on the same one. At the previous 25 this site could have spent
 * Rs 3,000 a month by itself and stopped meal plans generating as a
 * side effect.
 *
 * The two numbers are deliberately mismatched: a single person can do
 * twenty in an hour, which is what working through a list feels like,
 * but the site as a whole cannot do more than eight in a day. So the
 * generous number is for the person actually using this, and the
 * strict one is what protects the account.
 *
 * Raise DAILY_LIMIT if the ceiling goes up. It is the one number to
 * change, and Rs 4 a lookup is the sum to do it with.
 */
const PER_VISITOR_LIMIT = 20;
const PER_VISITOR_WINDOW_MS = 60 * 60 * 1000;
const DAILY_LIMIT = 8;

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

  let origin: string;
  try {
    origin = canonicalOrigin(normaliseUrl(String(body.url ?? "")));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof LookupError ? e.message : "That address could not be read." },
      { status: 400 },
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "No API key is configured, so the marketing summary cannot be written." },
      { status: 503 },
    );
  }

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
    return NextResponse.json(await lookupCompany(origin));
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
