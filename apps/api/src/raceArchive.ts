/**
 * Race-form archive reader — the auction-facing view of HorseFormLine.
 *
 * A buyer asks "what is this horse worth?" and "what does its family say?",
 * not "who wins today". So the primary use case is a YEARLING or WEANLING with
 * NO race record of its own: for those lots all the value is in family data —
 * sire/dam progeny performance and sibling results.
 *
 * Honesty rules baked in, not optional:
 *  - The archive covers 2024-01-01 onward ONLY. No form lines does NOT mean
 *    unraced; it means "nothing in our window". Every consumer must say so.
 *  - Every rate ships with its sample size. A 40% strike rate from 5 starters
 *    must never render like one from 500.
 *  - We hold purse + finish position, never official earnings. Anything money-
 *    shaped here is an ESTIMATE and is labelled as one.
 */
import { prisma } from '@furlong/db';

export const ARCHIVE_FROM = '2024-01-01';

export interface RaceRecord {
  starts: number;
  wins: number;
  places: number; // 2nd
  shows: number; // 3rd
  unplaced: number; // ran, finished off the board (also-rans)
  blackTypeWins: number;
  blackTypePlacings: number;
  bestGrade: string | null; // G1 > G2 > G3 > Listed
  lastStart: Date | null;
  firstStart: Date | null;
  surfaces: string[];
  distanceRangeFurlongs: [number, number] | null;
  medianDaysBetweenStarts: number | null; // durability
}

const GRADE_RANK: Record<string, number> = { G1: 4, G2: 3, G3: 2, Listed: 1 };

function bestGrade(grades: (string | null)[]): string | null {
  let best: string | null = null;
  for (const g of grades) {
    if (!g) continue;
    if (!best || (GRADE_RANK[g] ?? 0) > (GRADE_RANK[best] ?? 0)) best = g;
  }
  return best;
}

/** A horse's own record, 2024+. Returns null when we hold no lines at all. */
export async function raceRecordFor(horseKey: string): Promise<RaceRecord | null> {
  const lines = await prisma.horseFormLine.findMany({
    where: { horseKey },
    orderBy: { date: 'asc' },
  });
  if (lines.length === 0) return null;

  const dates = lines.map((l) => l.date.getTime()).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    gaps.push(Math.round((dates[i]! - dates[i - 1]!) / 86_400_000));
  }
  gaps.sort((a, b) => a - b);
  const dists = lines.map((l) => l.distanceFurlongs).filter((d): d is number => d != null);

  return {
    starts: lines.length,
    wins: lines.filter((l) => l.finishPos === 1).length,
    places: lines.filter((l) => l.finishPos === 2).length,
    shows: lines.filter((l) => l.finishPos === 3).length,
    unplaced: lines.filter((l) => l.finishPos == null).length,
    blackTypeWins: lines.filter((l) => l.blackType === 'WIN').length,
    blackTypePlacings: lines.filter((l) => l.blackType === 'PLACED').length,
    bestGrade: bestGrade(lines.map((l) => l.grade)),
    firstStart: lines[0]!.date,
    lastStart: lines[lines.length - 1]!.date,
    surfaces: [...new Set(lines.map((l) => l.surface).filter((s): s is string => !!s))],
    distanceRangeFurlongs: dists.length ? [Math.min(...dists), Math.max(...dists)] : null,
    medianDaysBetweenStarts: gaps.length ? gaps[Math.floor(gaps.length / 2)]! : null,
  };
}

export interface ProgenyStats {
  starters: number; // DISTINCT horses — the denominator bidders care about
  runners: number; // form lines
  winners: number;
  stakesWinners: number;
  stakesPlaced: number;
  winRate: number | null; // winners / starters
  bestGrade: string | null;
  thin: boolean; // < 20 starters — display must not imply precision
}

async function progenyBy(field: 'sireKey' | 'damKey', key: string): Promise<ProgenyStats> {
  const lines = await prisma.horseFormLine.findMany({
    where: { [field]: key } as Record<string, string>,
    select: { horseKey: true, finishPos: true, blackType: true, grade: true },
  });
  const byHorse = new Map<string, { won: boolean; stakesWin: boolean; stakesPlaced: boolean }>();
  for (const l of lines) {
    const cur = byHorse.get(l.horseKey) ?? { won: false, stakesWin: false, stakesPlaced: false };
    if (l.finishPos === 1) cur.won = true;
    if (l.blackType === 'WIN') cur.stakesWin = true;
    if (l.blackType === 'PLACED') cur.stakesPlaced = true;
    byHorse.set(l.horseKey, cur);
  }
  const starters = byHorse.size;
  const winners = [...byHorse.values()].filter((h) => h.won).length;
  return {
    starters,
    runners: lines.length,
    winners,
    stakesWinners: [...byHorse.values()].filter((h) => h.stakesWin).length,
    stakesPlaced: [...byHorse.values()].filter((h) => h.stakesPlaced).length,
    winRate: starters > 0 ? winners / starters : null,
    bestGrade: bestGrade(lines.map((l) => l.grade)),
    thin: starters < 20,
  };
}

export const progenyForSire = (sireKey: string) => progenyBy('sireKey', sireKey);
export const progenyForDam = (damKey: string) => progenyBy('damKey', damKey);

export interface Sibling {
  horseKey: string;
  horseName: string;
  starts: number;
  wins: number;
  blackTypeWins: number;
  bestGrade: string | null;
}

/** Horses sharing a dam — "half-sister to a stakes winner" is literal
 * catalogue language, so this is a first-class query. */
export async function siblingsForDam(damKey: string, excludeHorseKey?: string): Promise<Sibling[]> {
  const lines = await prisma.horseFormLine.findMany({
    where: { damKey },
    select: { horseKey: true, horseName: true, finishPos: true, blackType: true, grade: true },
  });
  const by = new Map<string, Sibling & { grades: (string | null)[] }>();
  for (const l of lines) {
    if (excludeHorseKey && l.horseKey === excludeHorseKey) continue;
    const s = by.get(l.horseKey) ?? {
      horseKey: l.horseKey, horseName: l.horseName, starts: 0, wins: 0,
      blackTypeWins: 0, bestGrade: null, grades: [],
    };
    s.starts += 1;
    if (l.finishPos === 1) s.wins += 1;
    if (l.blackType === 'WIN') s.blackTypeWins += 1;
    s.grades.push(l.grade);
    by.set(l.horseKey, s);
  }
  return [...by.values()]
    .map(({ grades, ...s }) => ({ ...s, bestGrade: bestGrade(grades) }))
    .sort((a, b) => b.blackTypeWins - a.blackTypeWins || b.wins - a.wins);
}

/**
 * Compact prompt block for a hip — what Secretariat and the pedigree read
 * consume. States the archive's window explicitly so "no lines" is never
 * mistaken for "unraced".
 */
export async function formPromptBlock(opts: {
  horseName?: string | null;
  sireName?: string | null;
  damName?: string | null;
  keyOf: (n: string | null | undefined) => string | null;
}): Promise<string> {
  const { horseName, sireName, damName, keyOf } = opts;
  const hk = keyOf(horseName);
  const sk = keyOf(sireName);
  const dk = keyOf(damName);
  const out: string[] = [
    `RACE ARCHIVE (starts from ${ARCHIVE_FROM} only — a horse with no lines below may` +
      ` simply not have run in that window; it does NOT mean unraced).`,
  ];

  const own = hk ? await raceRecordFor(hk) : null;
  if (own) {
    const bt = own.blackTypeWins
      ? `, ${own.blackTypeWins} black-type win(s)`
      : own.blackTypePlacings
        ? `, ${own.blackTypePlacings} black-type placing(s)`
        : '';
    out.push(
      `Own record: ${own.starts} start(s), ${own.wins}-${own.places}-${own.shows}` +
        `${bt}${own.bestGrade ? `, best ${own.bestGrade}` : ''}` +
        `${own.lastStart ? `, last start ${own.lastStart.toISOString().slice(0, 10)}` : ''}.`,
    );
  } else {
    out.push('Own record: no starts in the archive window (expected for a yearling or weanling).');
  }

  if (sk) {
    const p = await progenyForSire(sk);
    out.push(
      p.starters === 0
        ? `Sire ${sireName}: no progeny runners in the window.`
        : `Sire ${sireName}: ${p.winners} winner(s) from ${p.starters} starter(s)` +
          `${p.winRate != null ? ` (${Math.round(p.winRate * 100)}%` + (p.thin ? ', SMALL SAMPLE' : '') + ')' : ''}` +
          `, ${p.stakesWinners} stakes winner(s)${p.bestGrade ? `, best ${p.bestGrade}` : ''}.`,
    );
  }
  if (dk) {
    const p = await progenyForDam(dk);
    const sibs = await siblingsForDam(dk, hk ?? undefined);
    out.push(
      p.starters === 0
        ? `Dam ${damName}: no produce running in the window.`
        : `Dam ${damName}: ${p.winners} winner(s) from ${p.starters} runner(s) produced` +
          `${p.thin ? ' (SMALL SAMPLE)' : ''}, ${p.stakesWinners} stakes winner(s).`,
    );
    const notable = sibs.filter((s) => s.blackTypeWins > 0 || s.wins > 0).slice(0, 4);
    if (notable.length) {
      out.push(
        'Siblings: ' +
          notable
            .map((s) => `${s.horseName} (${s.wins}w${s.blackTypeWins ? `, ${s.blackTypeWins} black-type` : ''})`)
            .join('; ') + '.',
      );
    }
  }
  out.push('No official earnings are held — any money figure would be a purse-based estimate.');
  return out.join('\n');
}
