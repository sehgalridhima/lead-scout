import Anthropic from "@anthropic-ai/sdk";
import { toText, type Page } from "@/lib/fetch-site";

/* ===============================================================
   RESEARCH — the only file that spends API credit
   ===============================================================
   Everything that can be found is found in code. What reaches Claude
   is only the part that needs someone to read a page and form a
   view: what this company sells, who for, how they talk about it,
   and what you could open a conversation with.

   Cost decisions, all in one place:

   1. The system prompt is CACHED and byte-identical per request.
   2. effort is LOW. This is reading and summarising, not reasoning.
   3. The output is SCHEMA-CONSTRAINED, so the model returns the
      fields the page renders and cannot pad.
   4. THE PAGES ARE TRIMMED HARD. Site text is mostly navigation and
      footer boilerplate repeated on every page; sending all five in
      full would be most of the bill for none of the value.
   5. CONTACTS ARE NOT SENT AND NOT ASKED FOR. They are already
      extracted exactly. Passing them in would invite the model to
      "correct" them, and a plausible wrong email is worse than none.
   =============================================================== */

const MODEL = "claude-opus-5";

/** Per page. Enough for a positioning statement, not a whole blog. */
const CHARS_PER_PAGE = 6_000;

/** Across all pages. The ceiling on what any one lookup can cost. */
const TOTAL_CHARS = 20_000;

const SYSTEM_PROMPT = `You are helping someone decide whether a company is worth reaching out to, and what to say if they do.

You are given the text of a few pages from one company's website — usually the home page, and whichever of about, pricing and team it links to. Read them and answer from them.

RULES

1. ONLY WHAT THE PAGES SAY. You are reading one company's own website, and that is all you know. Do not fill gaps from memory, do not recognise the brand and add what you think you know about it, and do not infer a funding round or a headcount that is not written down. If the pages do not say, the field says so.

2. THE SUMMARY MUST BE SPECIFIC ENOUGH TO BE WRONG. "A leading provider of innovative solutions" is what the website says and it is worthless. Say what the thing actually does, in the plainest words available: who buys it, what it replaces, what it costs if they publish that. If you could paste your summary onto a different company's page and it would still fit, it is not a summary.

3. THE OUTREACH ANGLE IS THE POINT. One or two sentences on what would make a first message land — something specific and current from these pages. A launch, a new market, a job posting, a claim they lead with, a gap they are open about. Not flattery, and not a template with the company name dropped into it.

4. SIZE AND STAGE ONLY IF EVIDENCED. A team page you can count, a "since 2011", a careers page with thirty openings, an enterprise-only pricing tier. Say what the evidence was. If there is none, say that.

5. NO CONTACT DETAILS. Email addresses, phone numbers and social links are extracted separately and exactly. Do not repeat, guess at, or correct any — anything you produce there would be a guess sitting next to something that is not.

6. SAY WHEN THE SITE IS THIN. Some sites are one page of stock photography with nothing on it. That is a useful finding, not a failure — report it plainly rather than padding a paragraph out of nothing.

7. PLAIN TEXT. No markdown, no asterisks, no headings. The fields are rendered as they are written.`;

const SCHEMA = {
  type: "object",
  properties: {
    company: { type: "string", description: "The company or product name as the site writes it" },
    summary: { type: "string", description: "What they actually sell, in two or three plain sentences" },
    audience: { type: "string", description: "Who it is for, as specifically as the pages allow" },
    positioning: { type: "string", description: "How they frame themselves against alternatives" },
    pricing: { type: "string", description: "What the site says about price, or that it says nothing" },
    size: { type: "string", description: "Size or stage, with the evidence, or that there is none" },
    outreachAngle: { type: "string", description: "What would make a first message land, specifically" },
    thinSite: { type: "boolean", description: "True when there was very little real content to read" },
  },
  required: [
    "company",
    "summary",
    "audience",
    "positioning",
    "pricing",
    "size",
    "outreachAngle",
    "thinSite",
  ],
  additionalProperties: false,
} as const;

export type Research = {
  company: string;
  summary: string;
  audience: string;
  positioning: string;
  pricing: string;
  size: string;
  outreachAngle: string;
  thinSite: boolean;
};

export type Usage = { inputTokens: number; outputTokens: number };

/**
 * The pages as one readable block, trimmed.
 *
 * Labelled by which page each part came from, because "we're hiring
 * twelve engineers" means something different on a careers page than
 * in a home-page banner.
 */
function buildContext(pages: Page[]): string {
  const parts: string[] = [];
  let budget = TOTAL_CHARS;

  for (const page of pages) {
    if (budget <= 0) break;
    const text = toText(page.html).slice(0, Math.min(CHARS_PER_PAGE, budget));
    if (text.length < 40) continue;
    budget -= text.length;
    parts.push(`--- ${page.kind.toUpperCase()} (${page.url})\n${text}`);
  }

  return parts.join("\n\n");
}

export async function research(pages: Page[]): Promise<{ research: Research; usage: Usage }> {
  const client = new Anthropic();
  const context = buildContext(pages);

  if (context.length < 200) {
    throw new Error("There was almost no readable text on that site.");
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: {
      // Reading and summarising, not reasoning.
      effort: "low",
      format: { type: "json_schema", schema: SCHEMA },
    },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        // Identical on every request, so it bills at a fraction after
        // the first call.
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Here are the pages.\n\n${context}`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Claude returned nothing to read.");
  }

  return {
    research: JSON.parse(block.text) as Research,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

/** Rough rupee cost of one lookup. Opus 5: $5/M in, $25/M out. */
export function estimateCostInr(usage: Usage, usdToInr = 90): number {
  return ((usage.inputTokens / 1_000_000) * 5 + (usage.outputTokens / 1_000_000) * 25) * usdToInr;
}
