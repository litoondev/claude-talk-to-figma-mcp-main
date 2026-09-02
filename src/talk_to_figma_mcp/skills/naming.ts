/**
 * The skill naming convention: `Category_Action_Version`.
 *
 * A skill's ID is not decoration — it is how the registry categorises, filters
 * and supersedes skills. `Layer_Rename_v1` and `Layer_Rename_v2` are the same
 * skill at two versions, so the registry can retire the older one; `Layer_Clean_v1`
 * is a different skill in the same category. Getting that from the ID alone means
 * no separate index has to be kept in sync.
 */

/** A skill ID parsed into its three parts. */
export interface ParsedSkillId {
  /** Broad area of work, e.g. "Layer", "Responsive", "Token". */
  category: string;
  /** What the skill does, e.g. "Rename", "Audit". May contain further PascalCase words. */
  action: string;
  /** Major version, 1 or greater. */
  version: number;
  /** The full ID as written. */
  id: string;
}

export interface NamingError {
  id: string;
  reason: string;
  hint: string;
}

/**
 * `Category_Action_vN`, each of Category and Action in PascalCase.
 * Action may be several PascalCase words (`Layer_RenameSemantic_v1`).
 */
const ID_PATTERN = /^([A-Z][A-Za-z0-9]*)_([A-Z][A-Za-z0-9]*)_v([1-9][0-9]*)$/;

/** Parse a skill ID, or return null when it does not follow the convention. */
export function parseSkillId(id: string): ParsedSkillId | null {
  const match = ID_PATTERN.exec(id);
  if (!match) return null;
  return {
    category: match[1],
    action: match[2],
    version: Number(match[3]),
    id,
  };
}

/**
 * Explain why an ID is invalid, in terms the author can act on. Returned
 * instead of a thrown error so a single bad skill cannot stop the server.
 */
export function explainInvalidId(id: string): NamingError {
  const parts = id.split("_");

  if (parts.length !== 3) {
    return {
      id,
      reason: `expected three underscore-separated parts, found ${parts.length}`,
      hint: "Use Category_Action_vN, e.g. Layer_Rename_v1",
    };
  }

  const [category, action, version] = parts;
  if (!/^[A-Z][A-Za-z0-9]*$/.test(category)) {
    return { id, reason: `category "${category}" is not PascalCase`, hint: "e.g. Layer, Responsive, Token" };
  }
  if (!/^[A-Z][A-Za-z0-9]*$/.test(action)) {
    return { id, reason: `action "${action}" is not PascalCase`, hint: "e.g. Rename, Audit, Generate" };
  }
  return {
    id,
    reason: `version "${version}" is not a version marker`,
    hint: "Use v followed by a whole number starting at 1, e.g. v1",
  };
}

/** The stable identity of a skill across versions: everything but the version. */
export function familyOf(parsed: ParsedSkillId): string {
  return `${parsed.category}_${parsed.action}`;
}

/** Build the next version's ID for a skill family. */
export function nextVersionId(parsed: ParsedSkillId): string {
  return `${familyOf(parsed)}_v${parsed.version + 1}`;
}

/**
 * Given every ID in the repository, return the ones that are superseded —
 * an older version of a family that also has a newer one.
 *
 * Superseded skills stay on disk (they are the audit trail for what a repair
 * changed) but are not advertised, so callers only ever reach the current one.
 */
export function findSuperseded(ids: readonly string[]): string[] {
  const newestByFamily = new Map<string, ParsedSkillId>();

  for (const id of ids) {
    const parsed = parseSkillId(id);
    if (!parsed) continue;
    const family = familyOf(parsed);
    const current = newestByFamily.get(family);
    if (!current || parsed.version > current.version) {
      newestByFamily.set(family, parsed);
    }
  }

  const winners = new Set([...newestByFamily.values()].map((p) => p.id));
  return ids.filter((id) => parseSkillId(id) !== null && !winners.has(id));
}
