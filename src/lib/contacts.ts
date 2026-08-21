import type { Page } from "@/lib/fetch-site";

/* ===============================================================
   CONTACTS — found, never generated
   ===============================================================
   An email address is either on the page or it is not. There is no
   judgement in it, so there is no model in it either: parsing gives
   the same answer every time, costs nothing, and cannot invent
   sales@ for a company that has never used it.

   That last one is the whole argument. A wrong marketing summary is
   an opinion you can disagree with. A wrong email address is an
   outreach that silently goes nowhere, and you would not know why.
   =============================================================== */

/**
 * Where an address came from, because it changes how much to trust it.
 *
 * "linked" means somebody wrote <a href="mailto:...">: a deliberate
 * invitation to write to that address. "mentioned" means the string
 * merely appears in the page text, which also catches the placeholder
 * in a product screenshot — stripe.com's own demo invoice yields
 * jane.diaz@stripe.com, which is nobody.
 *
 * Both are kept, because a real address sometimes only appears as
 * text. But they are not presented as the same thing.
 */
export type Confidence = "linked" | "mentioned";

export type Email = { address: string; from: Confidence };

export type Contacts = {
  emails: Email[];
  phones: string[];
  social: { network: string; url: string }[];
  /** Where the site says to get in touch, if it has such a page */
  contactPage: string | null;
};

/*
 * Addresses that exist on thousands of sites and belong to nobody
 * worth writing to — image assets, tracking pixels, placeholder text
 * in a template, and the example addresses in a privacy policy.
 */
const JUNK_EMAIL = /@(\d+\.\d+|example\.|sentry\.|wixpress\.|localhost|domain\.com|email\.com|yourdomain)/i;
const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|postmaster|abuse|webmaster)@/i;

/*
 * `ignore` rules out share widgets and, on YouTube, individual videos:
 * a link to one of a company's videos is not their channel, and the
 * first version happily reported a /watch URL as "their YouTube".
 */
const SOCIAL_HOSTS: { network: string; host: RegExp; ignore?: RegExp }[] = [
  { network: "LinkedIn", host: /(^|\.)linkedin\.com$/i, ignore: /^\/(feed|shareArticle|sharing|posts|pulse)/i },
  { network: "X", host: /(^|\.)(twitter|x)\.com$/i, ignore: /^\/(intent|share|home|i)\b/i },
  { network: "Instagram", host: /(^|\.)instagram\.com$/i, ignore: /^\/(p|reel|stories)\//i },
  { network: "Facebook", host: /(^|\.)facebook\.com$/i, ignore: /^\/(sharer|dialog|plugins|events)/i },
  { network: "YouTube", host: /(^|\.)youtube\.com$/i, ignore: /^\/(watch|embed|shorts|playlist|results)/i },
  { network: "GitHub", host: /(^|\.)github\.com$/i },
];

/**
 * Undo the escaping that HTML and embedded JSON apply.
 *
 * Real sites ship their page data as JSON inside a <script> tag, where
 * ">" is written "\u003e". Matching over the raw source without
 * decoding first produced "u003esales@stripe.com" — an address that
 * looks plausible, belongs to nobody, and would have sent a real
 * outreach into the void.
 */
function decodeEscapes(html: string): string {
  return html
    .replace(/\\u003[cCeE]/g, " ")
    .replace(/\\u0026/g, "&")
    .replace(/\\u002[fF]/g, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

export function extractContacts(pages: Page[]): Contacts {
  const emails = new Map<string, Confidence>();
  const phones = new Set<string>();
  const social = new Map<string, string>();

  for (const page of pages) {
    const html = decodeEscapes(page.html);

    /*
     * mailto: and tel: links first, and they are the trustworthy ones:
     * somebody deliberately marked that string as a way to reach them.
     * Loose text matching comes second and is where false positives
     * live.
     */
    for (const m of html.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) {
      addEmail(emails, m[1], "linked");
    }
    for (const m of html.matchAll(/href\s*=\s*["']tel:([^"']+)/gi)) {
      addPhone(phones, m[1]);
    }

    for (const m of html.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
      addEmail(emails, m[0], "mentioned");
    }

    for (const m of html.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
      addSocial(social, m[1]);
    }
  }

  return {
    // Linked first, then by usefulness — a deliberate invitation beats
    // a string that merely appeared somewhere on the page.
    emails: [...emails.entries()]
      .map(([address, from]) => ({ address, from }))
      .sort(
        (a, b) =>
          Number(a.from === "mentioned") - Number(b.from === "mentioned") ||
          byUsefulness(a.address, b.address),
      ),
    phones: [...phones],
    social: [...social.entries()].map(([network, url]) => ({ network, url })),
    contactPage: pages.find((p) => p.kind === "contact")?.url ?? null,
  };
}

function addEmail(into: Map<string, Confidence>, raw: string, from: Confidence): void {
  const email = decodeURIComponent(raw.trim()).toLowerCase().replace(/[.,;:)]+$/, "");

  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return;
  // Image and asset filenames match the email shape often enough to matter:
  // "logo@2x.png", "icon@3x.webp".
  if (/\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/i.test(email)) return;
  if (JUNK_EMAIL.test(email) || JUNK_LOCAL.test(email)) return;

  // A mailto: link is the stronger claim, so it wins if we see both.
  if (from === "linked" || !into.has(email)) into.set(email, from);
}

function addPhone(into: Set<string>, raw: string): void {
  const cleaned = raw.trim().replace(/[^\d+]/g, "");
  // Shorter than this is a extension or a fragment; longer is not a
  // phone number. Both show up in tel: links on real sites.
  if (cleaned.replace(/\D/g, "").length < 7) return;
  if (cleaned.replace(/\D/g, "").length > 15) return;
  into.add(raw.trim());
}

function addSocial(into: Map<string, string>, raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return;
  }

  for (const { network, host, ignore } of SOCIAL_HOSTS) {
    if (!host.test(url.hostname)) continue;
    // A share button is not the company's profile.
    if (ignore?.test(url.pathname)) return;
    if (url.pathname === "/" || url.pathname === "") return;
    // First one wins: sites put their real profile in the footer and
    // share links in the body, and the footer usually comes first in
    // the pages we read.
    if (!into.has(network)) into.set(network, url.toString());
    return;
  }
}

/**
 * Most useful first.
 *
 * Somebody doing outreach wants a person or a department before they
 * want the generic inbox, and they want the generic inbox before they
 * want careers@.
 */
function byUsefulness(a: string, b: string): number {
  return rank(a) - rank(b) || a.localeCompare(b);
}

function rank(email: string): number {
  const local = email.split("@")[0];
  if (/^(sales|partnerships?|bd|business)/.test(local)) return 0;
  if (/^(hello|hi|contact|info|enquir|inquir)/.test(local)) return 1;
  if (/^(support|help|care)/.test(local)) return 3;
  if (/^(careers?|jobs|hr|recruit)/.test(local)) return 4;
  if (/^(press|media|legal|privacy|billing|accounts?)/.test(local)) return 5;
  // A name-shaped address — someone in particular.
  return 2;
}
