import Link from 'next/link';

export const metadata = {
  title: 'Terms & Disclaimer — Furlong',
  description:
    'How Furlong’s estimates work, what they are not, and the terms of using the service.',
};

// NOTE: plain-language disclaimer scaffolding for the prototype. Have counsel
// review before charging or going to production (ROADMAP Phase 5, legal).
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl font-medium text-ink-900">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-ink-700">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-widest text-brass-600">Legal</p>
      <h1 className="mt-2 font-serif text-4xl font-semibold text-racing-800">
        Terms &amp; Disclaimer
      </h1>
      <p className="mt-3 text-sm text-ink-500">
        Please read this before relying on anything Furlong shows you.
      </p>

      <Section title="Informational only">
        <p>
          Furlong is an information tool for thoroughbred buyers. Everything it shows —
          estimated sale-price ranges, pedigree grades, and rankings — is a{' '}
          <strong>data-driven estimate, not a recommendation, appraisal, or guarantee</strong>.
          Nothing here is bloodstock, veterinary, investment, tax, or legal advice.
        </p>
      </Section>

      <Section title="What the estimates are based on — and what they are not">
        <p>
          Estimates are computed from publicly observable signals: pedigree (sire, dam,
          damsire), sale and consignor history, market comparables, and — where available —
          racing records and under-tack (breeze) times. They reflect{' '}
          <strong>statistical patterns in past sales</strong>.
        </p>
        <p>
          They do <strong>not</strong> assess the individual animal in front of you: physical
          conformation, soundness, radiographs, scoping, temperament, or any veterinary
          condition. A horse that scores well here may be a poor purchase, and vice versa.
          Always inspect the horse and consult your own veterinarian and bloodstock agent
          before bidding.
        </p>
      </Section>

      <Section title="No warranty">
        <p>
          The service is provided “as is,” without warranties of any kind. Data is sourced
          from third parties and may be incomplete, delayed, or inaccurate. Models are
          probabilistic and will be wrong in individual cases. We do not warrant that any
          estimate, prediction, or piece of data is accurate, current, or fit for any
          purpose.
        </p>
      </Section>

      <Section title="Limitation of liability">
        <p>
          To the fullest extent permitted by law, Furlong and its operators are not liable
          for any loss or damage — including bids placed, prices paid, or purchases made —
          arising from your use of, or reliance on, the service. You are solely responsible
          for your bidding and purchasing decisions.
        </p>
      </Section>

      <Section title="Data sources">
        <p>
          Furlong aggregates information from auction houses and racing-data providers. That
          data remains the property of its respective owners and is used subject to the
          applicable agreements and licenses. Furlong does not resell raw third-party
          datasets.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>
          You agree not to scrape, resell, or redistribute data obtained through Furlong, nor
          to use the service to violate any auction house’s or data provider’s terms.
        </p>
      </Section>

      <p className="mt-10 border-t border-ink/10 pt-6 text-xs text-ink-400">
        This page is a plain-language summary for an early-stage tool and is not a substitute
        for advice from a qualified attorney. ·{' '}
        <Link href="/" className="underline-offset-2 hover:text-ink-700 hover:underline">
          Back to Furlong
        </Link>
      </p>
    </main>
  );
}
