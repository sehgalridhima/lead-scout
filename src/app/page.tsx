import Lookup from "@/components/Lookup";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14 sm:py-20">
      <header className="mb-9">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Who to talk to, and{" "}
          <span className="text-accent">what to say</span>
        </h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-muted">
          Paste a company&rsquo;s website. You get their published contact details, pulled
          straight off the page, and a read of what they sell and how to open a conversation.
        </p>
      </header>

      <Lookup />
    </main>
  );
}
