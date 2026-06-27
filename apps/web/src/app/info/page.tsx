export const dynamic = 'force-static';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-ink/10 bg-paper-50 p-6 shadow-card">
      <h2 className="mb-3 font-serif text-xl font-semibold text-racing-900">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-ink-700">{children}</div>
    </section>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full border border-brass-400/40 bg-brass-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brass-700">
      {children}
    </span>
  );
}

export default function InfoPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brass-600">
          About the model
        </p>
        <h1 className="mt-2 font-serif text-5xl font-semibold tracking-tightish text-racing-900 sm:text-6xl">
          How It Works
        </h1>
        <div className="rule-brass my-5 max-w-xs" />
        <p className="max-w-2xl text-base leading-relaxed text-ink-600">
          Furlong combines real sale data with a machine-learning valuation model to help buyers
          find horses worth more than the market expects. Here&apos;s how every number is
          calculated.
        </p>
      </header>

      <div className="space-y-5">
        <Section title="Data sources">
          <p>
            Furlong ingests official catalogs from Fasig-Tipton, Keeneland, and Tattersalls. Each
            HIP in a published catalog is pulled automatically — including the horse&apos;s name,
            sex, color, sire, dam, damsire, and consignor. Post-sale result files are ingested the
            same way, so every hammer price is attached to the original HIP.
          </p>
          <p>
            The database currently holds results from Keeneland September sales going back to 1999,
            and Fasig-Tipton yearling sales from 2009 — roughly 120,000 comparable sales in total.
            New sales are discovered automatically every 15 minutes; future calendars are added the
            moment they appear on each house&apos;s website.
          </p>
        </Section>

        <Section title="The valuation model">
          <p>
            Prices are predicted by a{' '}
            <span className="font-medium text-ink-900">
              quantile gradient-boosted regression model
            </span>{' '}
            (sklearn HistGradientBoostingRegressor), trained on log-prices of every hammer price in
            the database. The model learns two things:
          </p>
          <ul className="ml-4 list-disc space-y-1.5">
            <li>
              <span className="font-medium text-ink-900">Predicted Price</span> — what the market
              is likely to pay at auction, given the full context: sire, dam, damsire, consignor,
              session, hip number, auction house, year, sex, and color.
            </li>
            <li>
              <span className="font-medium text-ink-900">Pedigree Value</span> — what the
              pedigree alone is worth, ignoring sale context. This model uses only sire, dam,
              damsire, sex, color, and market trend — no consignor or position data.
            </li>
          </ul>
          <p>
            High-cardinality entities like sires, dams, and consignors are encoded as{' '}
            <span className="font-medium text-ink-900">price priors</span>: the mean log-price of
            that entity&apos;s past sales in strictly earlier years. This prevents data leakage
            (the current year&apos;s prices never influence their own prediction) and handles
            entities with few sales gracefully — a first-crop sire simply gets a NaN prior, and
            the model falls back to market-level trend.
          </p>
        </Section>

        <Section title="Price bands: what the ranges mean">
          <p>
            Both models are trained at seven quantiles simultaneously:{' '}
            <span className="tnum font-medium">p10, p25, p35, p50, p65, p75, p90</span>. The
            displayed bands use the <span className="font-medium">inner quantiles</span>:
          </p>
          <ul className="ml-4 list-disc space-y-1.5">
            <li>
              <Pill>Pred. Price</Pill> band — the p35 to p65 range of the sale-price model. In a
              typical market, 30% of comparable horses sell within this band.
            </li>
            <li>
              <Pill>Est. Value</Pill> band — the p35 to p65 range of the pedigree-value model.
              A measure of what the bloodlines alone suggest the horse is worth.
            </li>
          </ul>
          <p>
            Narrower bands mean the model is more confident. Wider bands reflect genuine
            uncertainty — horses by first-crop sires, unusual color categories, or very thin
            consignor histories naturally produce wider ranges.
          </p>
        </Section>

        <Section title="Confidence score">
          <p>
            The confidence score (shown on each HIP&apos;s detail page) combines two signals:
          </p>
          <ul className="ml-4 list-disc space-y-1.5">
            <li>
              <span className="font-medium text-ink-900">Comparables depth</span> — how many
              prior-year sales exist for this sire. A sire with 40+ sold yearlings gets full
              support; a debut sire with zero gets none.
            </li>
            <li>
              <span className="font-medium text-ink-900">Model tightness</span> — the width of the
              p25–p75 band in log-price space. A tight IQR means the model&apos;s predictions
              cluster near the median; a wide IQR means high intrinsic price variance.
            </li>
          </ul>
          <p>
            The final score is a number from 0 to 1. Above 0.7 means the model has strong
            supporting data; below 0.3 means treat the estimate as directional only.
          </p>
        </Section>

        <Section title="Hidden Gems">
          <p>
            A{' '}
            <span className="font-medium text-ink-900">
              <span className="text-brass-600">★</span> Hidden Gem
            </span>{' '}
            is a HIP where the pedigree value model predicts a higher price than the
            sale-context model. In other words: the bloodlines suggest this horse is worth more
            than the market is likely to pay based on its position in the catalog (consignor,
            session, hip number).
          </p>
          <p>
            The hidden gem score is{' '}
            <span className="tnum font-medium">(estMid − predMid) / predMid</span>. A positive
            score means pedigree value exceeds predicted hammer price. This does not guarantee
            the horse will sell under value — it flags horses where the pedigree signal and the
            market-context signal diverge, which is worth investigating further.
          </p>
        </Section>

        <Section title="Disclaimer">
          <p className="text-ink-500">
            Furlong&apos;s valuations are statistical estimates based on historical sale data. They
            are not investment advice, and no prediction should be treated as a guarantee of future
            sale price. Horse markets are influenced by factors outside any model&apos;s reach:
            physical inspection, veterinary reports, buyer competition on the day, and
            macroeconomic conditions. Always conduct your own due diligence.
          </p>
        </Section>
      </div>
    </main>
  );
}
