import Link from 'next/link';
import { FOOTER_DISCLAIMER } from '../lib/format';

/**
 * Persistent site footer carrying the "informational only" disclaimer and a link
 * to the full Terms. Shown on every page via the root layout.
 */
export function LegalFooter() {
  return (
    <footer className="mt-16 border-t border-ink/10 bg-paper-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <p className="text-xs leading-relaxed text-ink-500">{FOOTER_DISCLAIMER}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-400">
          <span>© {new Date().getFullYear()} Furlong</span>
          <span aria-hidden className="text-ink/20">
            ·
          </span>
          <Link href="/terms" className="underline-offset-2 hover:text-ink-700 hover:underline">
            Terms &amp; Disclaimer
          </Link>
        </div>
      </div>
    </footer>
  );
}
