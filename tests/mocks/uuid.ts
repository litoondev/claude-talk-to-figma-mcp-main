/**
 * Stand-in for `uuid`, which ships ESM-only and cannot be parsed by ts-jest.
 *
 * Mapped in jest.config.cjs. Only `v4` is used in this codebase, and only to
 * label a request so its response can be matched back — nothing depends on the
 * value being a real UUID, so a counter with the right shape is enough and
 * makes failures readable.
 */
let counter = 0;

export function v4(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

export default { v4 };
