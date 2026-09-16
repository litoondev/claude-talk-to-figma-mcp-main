# LESSONS

Mistakes QA caught, recorded by class so they are not shipped twice.
Read at the start of every change. Sweep at QA.

---

## L1 — A green typecheck that checked nothing

- **Looked like:** `npx tsc --noEmit -p .` printed only TS6059 errors. Filtering those out gave "0 errors", and the change was treated as type-clean.
- **Root cause:** the root `tsconfig.json` sets `rootDir: "src"` but includes `tests/**`. That raises TS6059 *option* errors, and tsc does not run semantic checking when options are invalid. The filtered count was always 0, whatever the code contained.
- **Guard:** typecheck `src` with a config whose options are valid (`rootDir` = `src`, `include` = `src/**` only, `typeRoots` resolving `jest`/`bun-types`). Compare the error set against HEAD, and never trust a count taken after filtering out option errors.
- **QA test:** the typecheck must be able to fail. Introduce a deliberate type error once and confirm it is reported before relying on a 0.

## L2 — A command sent by the server but missing from `FigmaCommand`

- **Looked like:** the first test to import `tools/responsive-tools.ts` failed to compile (`'"clean_layers"' is not assignable to parameter of type 'FigmaCommand'`). 15 commands across 6 tool modules had the same gap. It went unnoticed because no test imported those modules and L1 hid it from tsc.
- **Root cause:** a new plugin command is added in three places: the plugin `handleCommand` switch, the server tool, and the `FigmaCommand` union. Nothing enforces the third.
- **Guard:** when adding or renaming a command, update `src/talk_to_figma_mcp/types/index.ts` in the same change, and give each new tool module at least one test that imports it.
- **QA test:** both-sides check. Every `sendCommandToFigma("x")` has a `case "x":` in `src/claude_mcp_plugin/code.js` and an `"x"` member in `FigmaCommand`.

## L3 — Verified against invented fixtures, not the designer's file

- **Looked like:** 519 tests passed and the feature was reported done. On the designer's real section (`# Work Process`: `Container > 01 Block > 01 Block > Card` ×4) the scan found nothing to optimize, the most common unwanted-layer shape in real files.
- **Root cause:** the fixtures modelled what the old code already handled (wrappers *without* Auto Layout). Real double nesting is Auto Layout inside Auto Layout, which `frameHasLayoutPurpose` treats as meaningful. The tests confirmed the implementation instead of the requirement. The live check was also marked UNVERIFIED and handed to the user rather than run through the relay on port 3055, which was already reachable.
- **Guard:** before calling a Figma change done, read the real selection through the relay (read-only `get_node_info` + `clean_layers` dryRun) and turn its structure into a test fixture. Also confirm which server build the client actually runs. Claude Desktop runs the installed extension in `~/Library/Application Support/Claude/Claude Extensions/`, not `dist/`.
- **QA test:** at least one fixture per feature is copied from a real file's tree. The live dry run on the user's selection must report the change the user expects.
- **Recurred (same session):** the fixture was copied from a probe that stopped at component instances, so it lacked the card's absolutely positioned `BG`. The subtree-wide absolute-layer check then rejected every real wrapper while all tests passed. **Stronger guard:** the probe that feeds a fixture must descend into instances, and every property the rule reads (positioning, sizing, bindings) must be present in the fixture. Then run the rule itself live against the real node via `execute_code` (read-only) before calling it done.

## L4 — A chain walk that stops at hidden content treats its parent as the content

- **Looked like:** Grid detection proposed a section whose fourth card was hidden. The wrapper walk stopped *at* the hidden card, so the innermost wrapper, 298px wide and holding nothing visible, became the "item" and passed the equal-width check. In Figma that Hug wrapper renders empty, so the conversion would change the layout.
- **Root cause:** a loop condition (`child.visible !== false`) that ends the walk used as if it rejected the result. Stopping early and rejecting are different outcomes. The code returned the last node it reached instead of reporting "no valid item".
- **Guard:** in any descend-through-wrappers walk, a hidden (or otherwise disqualified) child returns *null* for the whole chain. The walk must never fall back to the wrapper it stopped at.
- **QA test:** for every "peel wrappers" helper, one fixture puts the disqualifying layer at the bottom of the chain, not the top.

## L5 — A mock that accepts every write cannot catch an ordering bug

- **Looked like:** all Grid tests passed, but on the real file every conversion rolled back with `in set_gridColumnSpan: Cannot set child to specified column span due to existing children in adjacent columns`. Claude Desktop then imitated the Grid by hand (ungroup, move_node, set_auto_layout NONE) and left a frame with fixed positions and no layout.
- **Root cause:** the items were moved into the section before it became a Grid. Figma auto-placed the first card beside the heading, then refused to span the heading over it. The harness mock stored `gridColumnSpan` as a plain field, so the order of steps was never tested.
- **Guard:** when a feature depends on an API's *constraints* (overlap, count limits, sizing rules), the mock enforces the constraint with the API's own error text. Before calling a Figma structural change done, run the real function once on a temporary duplicate through the relay (`execute_code`, clone, delete in `finally`) with the user's permission.
- **QA test:** a harness-fidelity test asserts the mock refuses what Figma refuses. The live temporary-copy trace must report `ok: true`.

## L6 — An error path that reads `.message` of whatever was thrown

- **Looked like:** a batch text replacement test left its first node unchanged. The node used Lato Bold, `loadFontAsync` for it rejected, and `setTextContent`'s catch read `error.message` of `undefined`. The real cause, a missing font, became a TypeError, and the whole replacement failed with a message that named nothing.
- **Root cause:** Figma rejects some API promises with no Error object at all. Confirmed live: `loadFontAsync` for a style the family does not have rejects with a value whose message prints as "undefined". Catch blocks written for Error objects either crash or report "undefined".
- **Guard:** wrap Figma API calls whose failure the user has to understand (font loads, style links) and rethrow an Error that names what failed. In a catch, never read `err.message` bare; use `err && err.message ? err.message : String(err)`.
- **QA test:** the harness mock rejects the way Figma does (`Promise.reject(undefined)`), and each feature has one test asserting the user-facing message names the font, style or node.

## L7 — A parser that validated input it was only meant to pass through

- **Looked like:** adding Figma-URL support to the comment tools broke 8 existing integration tests. `reply_to_comments` returned "Could not read a Figma file key from \"FILE_A\"" for a file key that had worked before the change.
- **Root cause:** `toFileKey` decided what a *valid* bare key looks like (`[A-Za-z0-9]{10,}`) and rejected everything else. The job was only to extract a key when given a URL. Real Figma keys match that shape, so the pattern looked right, but test fixtures, older key forms and any key with punctuation do not — and the rejection happened locally, before the API ever got a chance to give an authoritative answer.
- **Guard:** a parser added to accept a *new* input form must not become a validator of the old one. Branch on the new form (does it look like a URL?) and pass anything else through untouched. Let the remote service be the authority on whether an identifier exists.
- **QA test:** run the full suite, not just the new file. Any new input-parsing helper gets one test asserting that an unrecognised-but-previously-working value is passed through unchanged.

