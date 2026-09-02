/**
 * Duplication prevention.
 *
 * Two problems, and they are not the same one:
 *
 *   - The *same* skill added twice (identical or near-identical body). The
 *     second copy is waste and, worse, ambiguity: two skills matching the same
 *     request means the model picks one at random.
 *   - Two *different* skills that claim the same triggers. Neither is a
 *     duplicate, but the overlap still makes selection a coin toss.
 *
 * Both are caught here, before anything is registered. Detection is content-based
 * rather than name-based, because a duplicate that was renamed is still a
 * duplicate — and renaming is exactly how duplicates get in.
 */

/** How similar two bodies must be before they count as the same skill. */
const DUPLICATE_THRESHOLD = 0.82;

/** How similar two bodies must be to be worth mentioning as overlapping. */
const OVERLAP_THRESHOLD = 0.55;

export type DuplicateVerdict =
  | { kind: "unique" }
  | { kind: "duplicate"; of: string; similarity: number }
  | { kind: "overlap"; with: string; similarity: number }
  | { kind: "trigger-collision"; with: string; triggers: string[] };

export interface Fingerprintable {
  id: string;
  body: string;
  triggers?: readonly string[];
}

/**
 * Reduce a skill body to a bag of meaningful words.
 *
 * Markdown scaffolding (fences, table pipes, list bullets, headings) says
 * nothing about what a skill *does*, and every skill has plenty of it — leaving
 * it in makes unrelated skills look similar. Short words go too, for the same
 * reason.
 */
export function fingerprint(body: string): Set<string> {
  const stripped = body
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`[^`]*`/g, " ") // inline code
    .replace(/^\s*[-*|>#]+/gm, " ") // list, table and heading scaffolding
    .toLowerCase();

  const words = stripped.match(/[a-z][a-z0-9_]{3,}/g) || [];
  return new Set(words);
}

/** Jaccard similarity: shared words over total distinct words. 0 to 1. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const word of small) if (large.has(word)) shared++;

  return shared / (a.size + b.size - shared);
}

/** Normalise a trigger phrase so "Rename Layers" and "rename  layers" match. */
function normalizeTrigger(trigger: string): string {
  return trigger.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Check a candidate against everything already registered.
 *
 * Returns the *first* verdict that matters, worst first: a duplicate is more
 * important to report than an overlap, and an overlap more than a trigger clash.
 */
export function checkDuplicate(
  candidate: Fingerprintable,
  existing: readonly Fingerprintable[]
): DuplicateVerdict {
  const candidatePrint = fingerprint(candidate.body);

  let closest: { id: string; score: number } | null = null;

  for (const other of existing) {
    if (other.id === candidate.id) continue;
    const score = similarity(candidatePrint, fingerprint(other.body));
    if (!closest || score > closest.score) closest = { id: other.id, score };
  }

  if (closest && closest.score >= DUPLICATE_THRESHOLD) {
    return { kind: "duplicate", of: closest.id, similarity: round(closest.score) };
  }

  const candidateTriggers = new Set((candidate.triggers || []).map(normalizeTrigger));
  if (candidateTriggers.size > 0) {
    for (const other of existing) {
      if (other.id === candidate.id) continue;
      const shared = (other.triggers || [])
        .map(normalizeTrigger)
        .filter((trigger) => candidateTriggers.has(trigger));
      if (shared.length > 0) {
        return { kind: "trigger-collision", with: other.id, triggers: shared };
      }
    }
  }

  if (closest && closest.score >= OVERLAP_THRESHOLD) {
    return { kind: "overlap", with: closest.id, similarity: round(closest.score) };
  }

  return { kind: "unique" };
}

/** Human-readable explanation of a verdict, for logs and the skill report. */
export function describeVerdict(id: string, verdict: DuplicateVerdict): string {
  switch (verdict.kind) {
    case "duplicate":
      return `"${id}" is ${Math.round(verdict.similarity * 100)}% identical to "${verdict.of}" — not registered. Bump the existing skill's version instead of adding a copy.`;
    case "trigger-collision":
      return `"${id}" claims trigger(s) already claimed by "${verdict.with}": ${verdict.triggers.join(", ")}. Both registered, but the overlapping triggers make selection ambiguous.`;
    case "overlap":
      return `"${id}" is ${Math.round(verdict.similarity * 100)}% similar to "${verdict.with}". Registered, but consider whether they should be one skill.`;
    case "unique":
      return `"${id}" is distinct from every registered skill.`;
  }
}

/** A verdict that stops registration, as opposed to one that is only a warning. */
export function blocksRegistration(verdict: DuplicateVerdict): boolean {
  return verdict.kind === "duplicate";
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
