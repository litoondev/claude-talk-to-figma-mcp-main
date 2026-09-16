/**
 * Parsing for the links people actually paste.
 *
 * A designer hands over a URL, not a file key — and a comment permalink carries
 * the thread id in its fragment. Turning that into {fileKey, nodeId, commentId}
 * here is what removes the "paste the file URL" / "which comment?" round trip
 * from the comment tools.
 *
 * Deliberately free of network and env access so the logic is unit-testable.
 */

/** What a Figma link can tell us. */
export interface ParsedFigmaUrl {
  /** File key from /design|file|proto|board/<KEY>/... */
  fileKey?: string;
  /** node-id query param, normalised to the colon form the plugin API uses. */
  nodeId?: string;
  /** Numeric fragment of a comment permalink, e.g. ...#1892186776 */
  commentId?: string;
}

/** figma.com/design/<KEY>/<name> — also /file/, /proto/ and FigJam /board/. */
const FILE_KEY_PATTERN =
  /figma\.com\/(?:design|file|proto|board)\/([A-Za-z0-9]{10,})/i;

/** A link of some kind: has a scheme or a path separator. */
const LINK_PATTERN = /^[a-z]+:\/\/|\//i;

/** Does this look like a Figma URL rather than a bare key? */
export function looksLikeFigmaUrl(input: string): boolean {
  return /figma\.com\//i.test(input);
}

/**
 * Pull whatever a Figma link carries. Never throws: an unrecognised string
 * yields an empty result, and the caller decides how to complain.
 */
export function parseFigmaUrl(input: string): ParsedFigmaUrl {
  const raw = (input ?? "").trim();
  if (!raw) return {};

  const result: ParsedFigmaUrl = {};

  const keyMatch = raw.match(FILE_KEY_PATTERN);
  if (keyMatch) result.fileKey = keyMatch[1];

  // node-id arrives as 2971-45373 (URL form) or 2971%3A45373 (escaped colon).
  // The plugin API speaks colons, so normalise to that.
  const nodeMatch = raw.match(/[?&]node-id=([^&#\s]+)/i);
  if (nodeMatch) {
    const decoded = decodeURIComponent(nodeMatch[1]);
    result.nodeId = decoded.replace(/-/g, ":");
  }

  // Only a purely numeric fragment is a comment id. Figma also uses the
  // fragment for other things, and guessing wrong would silently filter
  // every thread out of the result.
  const fragment = raw.split("#")[1];
  if (fragment && /^\d+$/.test(fragment.trim())) {
    result.commentId = fragment.trim();
  }

  return result;
}

/**
 * Accept either a bare file key or any Figma URL and return the key.
 * Returns undefined for blank input so callers can fall back to the open file.
 *
 * Only strings that look like links are parsed; anything else is passed through
 * untouched. This helper exists to *extract* a key from a new input form, not to
 * rule on whether an existing one is well-formed — Figma is the authority on
 * whether a key resolves, and guessing the key alphabet here rejected values
 * that worked (see LESSONS L7).
 */
export function toFileKey(input?: string): string | undefined {
  const raw = (input ?? "").trim();
  if (!raw) return undefined;
  if (!LINK_PATTERN.test(raw)) return raw;

  const { fileKey } = parseFigmaUrl(raw);
  if (fileKey) return fileKey;

  throw new Error(
    `Could not read a Figma file key from "${raw}". Pass either the key itself or a ` +
      "full link of the form figma.com/design/<FILE_KEY>/<name>."
  );
}
