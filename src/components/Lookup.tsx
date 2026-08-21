"use client";

import { useState } from "react";
import type { Contacts } from "@/lib/contacts";
import type { Research } from "@/lib/research";

/* ===============================================================
   LOOKUP
   ===============================================================
   Contacts above the summary, always.

   The summary is the interesting part to read and the contacts are
   the part you came for — and they are also the part that is
   certainly true, since they were parsed rather than written. Putting
   the certain thing first is the honest order.

   Everything is one click to copy. This exists to feed an email, and
   an address you have to select by hand is an address you retype
   wrong.
   =============================================================== */

type Report = {
  url: string;
  contacts: Contacts;
  research: Research;
  pagesRead?: { kind: string; url: string }[];
  cached?: boolean;
  error?: string;
};

export default function Lookup() {
  const [url, setUrl] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function look(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || loading) return;

    setError("");
    setLoading(true);
    setReport(null);

    try {
      const response = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data: Report = await response.json();

      if (!response.ok) {
        setError(data.error ?? "That lookup did not work.");
        return;
      }
      setReport(data);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={look} className="flex flex-col gap-2 sm:flex-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
          placeholder="acme.com"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-[var(--lift)] transition-colors focus:border-accent focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="shrink-0 rounded-xl bg-accent px-6 py-3 text-sm font-medium text-accent-contrast transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Reading the site…" : "Look it up"}
        </button>
      </form>

      {error && (
        <p className="rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">
          {error}
        </p>
      )}

      {loading && (
        <p className="text-sm text-muted">
          Fetching the home page, then whichever of contact, about, pricing and team it links
          to. Usually ten to twenty seconds.
        </p>
      )}

      {report && <Result report={report} />}
    </div>
  );
}

function Result({ report }: { report: Report }) {
  const { contacts, research } = report;
  const nothingFound =
    contacts.emails.length === 0 && contacts.phones.length === 0 && contacts.social.length === 0;

  return (
    <div className="animate-rise flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight">{research.company}</h2>
        <a
          href={report.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs text-muted underline underline-offset-4 hover:text-foreground"
        >
          {new URL(report.url).hostname}
        </a>
      </div>

      {research.thinSite && (
        <p className="rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">
          There was very little real content on this site, so the read below is thin. That is
          itself worth knowing before you spend time on them.
        </p>
      )}

      {/* Contacts first: the part that was found rather than written. */}
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-[var(--lift)]">
        <h3 className="font-medium">Contact</h3>

        {nothingFound ? (
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Nothing published on the pages read. Plenty of companies put contact behind a form
            only &mdash;{" "}
            {contacts.contactPage ? (
              <a
                href={contacts.contactPage}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent underline underline-offset-4"
              >
                their contact page
              </a>
            ) : (
              "their site had no contact page to follow"
            )}
            .
          </p>
        ) : (
          <dl className="mt-3 flex flex-col gap-3">
            {contacts.emails.length > 0 && (
              <Row label="Email">
                {/* Addresses that were only *mentioned* on the page are
                    marked. Stripe's own site yields jane.diaz@stripe.com
                    from a demo invoice — real-looking, and nobody. */}
                {contacts.emails.map((email) => (
                  <Copyable
                    key={email.address}
                    value={email.address}
                    note={email.from === "mentioned" ? "seen in page text" : undefined}
                  />
                ))}
              </Row>
            )}
            {contacts.phones.length > 0 && (
              <Row label="Phone">
                {contacts.phones.map((phone) => (
                  <Copyable key={phone} value={phone} />
                ))}
              </Row>
            )}
            {contacts.social.length > 0 && (
              <Row label="Social">
                {contacts.social.map((s) => (
                  <a
                    key={s.network}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="rounded-lg bg-surface-2 px-2.5 py-1 text-sm text-accent underline underline-offset-4"
                  >
                    {s.network}
                  </a>
                ))}
              </Row>
            )}
            {contacts.contactPage && (
              <Row label="Page">
                <a
                  href={contacts.contactPage}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm text-accent underline underline-offset-4"
                >
                  {new URL(contacts.contactPage).pathname}
                </a>
              </Row>
            )}
          </dl>
        )}
      </section>

      <section className="rounded-2xl border border-accent/30 bg-accent-soft p-5">
        <h3 className="font-medium text-accent">How to open</h3>
        <p className="mt-2 text-[0.9375rem] leading-relaxed">{research.outreachAngle}</p>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-[var(--lift)]">
        <h3 className="font-medium">What they sell</h3>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">{research.summary}</p>

        <dl className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Fact label="Who it's for" value={research.audience} />
          <Fact label="How they position it" value={research.positioning} />
          <Fact label="Pricing" value={research.pricing} />
          <Fact label="Size and stage" value={research.size} />
        </dl>
      </section>

      <p className="text-xs leading-relaxed text-muted">
        Contact details are read off the pages, never generated &mdash; what is shown is what is
        published. The rest is a read of{" "}
        {report.pagesRead?.length ?? "a few"} page
        {(report.pagesRead?.length ?? 2) === 1 ? "" : "s"} of their own marketing, so treat it as
        their claims rather than as facts.
        {report.cached && " Served from an earlier lookup of this domain."}
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="flex flex-wrap gap-2">{children}</dd>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-[0.9375rem] leading-relaxed">{value}</dd>
    </div>
  );
}

/** One click, because these exist to be pasted into an email. */
function Copyable({ value, note }: { value: string; note?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      title={note ?? "Copy"}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          () => {
            /* Clipboard refused — the text is on screen either way. */
          },
        );
      }}
      className={`rounded-lg px-2.5 py-1 text-sm transition-colors hover:bg-accent-soft hover:text-accent ${
        note ? "border border-dashed border-border bg-transparent text-muted" : "bg-surface-2"
      }`}
    >
      {copied ? "copied" : value}
    </button>
  );
}
