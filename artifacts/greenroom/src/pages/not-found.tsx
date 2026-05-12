import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="px-12 py-20 max-w-3xl">
      <h1
        className="font-display text-[48px] font-medium text-ink-900 leading-[1.05]"
        style={{ letterSpacing: "-0.02em" }}
      >
        Not found
      </h1>
      <p className="text-[14px] text-ink-500 mt-3">
        That page doesn&apos;t exist.{" "}
        <Link href="/shows" className="text-brand-700 font-medium hover:underline">
          Back to shows
        </Link>
        .
      </p>
    </div>
  );
}
