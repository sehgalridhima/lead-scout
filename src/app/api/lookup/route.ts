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

type Report = { url: string; contacts: Contacts; research: Research };

const cache = new Map<string, { at: number; report: Report }>();

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
