/**
 * The Webflow setup checker.
 *
 * Written after watching a real session discover blockers serially: it reported
 * a missing token scope, the user fixed it, then it reported the extension was
 * not connected, then that site creation needs Enterprise. Three round trips for
 * a state that reads in one, and exactly the repetition CLAUDE.md §17.4 forbids.
 *
 * So the behaviour under test is not "does each check work" but "are all of them
 * reported together, even when the first one fails". A checker that stops at the
 * first blocker would pass a naive test and still be useless.
 */

// The relay module pulls in `ws` and `uuid`, which are ESM-only and cannot be
// parsed here. It is also the thing that must be faked to test the two states
// that matter: extension connected, and extension absent.
const mockChannel = jest.fn<string | null, []>();
const mockSendToWebflow = jest.fn();
jest.mock("../../src/talk_to_figma_mcp/utils/websocket", () => ({
  getCurrentChannel: () => mockChannel(),
  sendCommandToWebflow: (...args: any[]) => mockSendToWebflow(...args),
}));

jest.mock("../../src/talk_to_figma_mcp/utils/logger", () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() },
}));

const TOOL = "../../src/talk_to_figma_mcp/tools/webflow-preflight";

/** Collect the tool's handler without a real MCP server. */
function register(): (args: unknown) => Promise<any> {
  let handler: any;
  const fake: any = {
    tool: (_name: string, _desc: string, _schema: unknown, fn: unknown) => {
      handler = fn;
    },
  };
  let mod: any;
  jest.isolateModules(() => {
    mod = require(TOOL);
  });
  mod.registerWebflowPreflightTools(fake);
  return handler;
}

const textOf = (result: any): string => result.content[0].text as string;

describe("webflow_preflight", () => {
  const ORIGINAL_ENV = { ...process.env };
  const ORIGINAL_FETCH = global.fetch;

  const httpResponse = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  });

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.WEBFLOW_TOKEN;
    delete process.env.WEBFLOW_API_TOKEN;
    delete process.env.FIGMA_MCP_WEBFLOW_DESIGNER;
    process.env.WEBFLOW_API_MAX_RETRIES = "0";
    mockChannel.mockReset();
    mockSendToWebflow.mockReset();
    // Default: nothing connected.
    mockChannel.mockReturnValue(null);
    mockSendToWebflow.mockRejectedValue(new Error("no extension"));
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("reports every blocker in one call, not just the first", async () => {
    // No Figma channel, no token, designer off. A checker that short-circuits
    // would mention one of these; the point is that it mentions all three.
    const report = textOf(await register()({}));

    expect(report).toContain("Figma channel");
    expect(report).toContain("Webflow token");
    expect(report).toContain("Webflow Designer extension");
    expect(report).toContain("3 things to fix");
  });

  it("tells the model not to dribble the blockers out one at a time", async () => {
    const report = textOf(await register()({}));
    expect(report).toContain("Do not start building and report them one at a time");
  });

  it("names the missing scope rather than saying the token is bad", async () => {
    process.env.WEBFLOW_TOKEN = "scopeless";
    global.fetch = jest.fn().mockResolvedValue(
      httpResponse(403, { message: "OAuthForbidden: You are missing the following scopes - 'sites:read'" })
    ) as any;

    const report = textOf(await register()({}));
    expect(report).toContain("missing the sites:read scope");
    // The fix has to say a new token is needed, because scopes cannot be widened.
    expect(report).toContain("Generate a NEW token");
  });

  it("distinguishes an invalid token from a scope problem", async () => {
    process.env.WEBFLOW_TOKEN = "revoked";
    global.fetch = jest.fn().mockResolvedValue(httpResponse(401, { message: "Unauthorized" })) as any;

    const report = textOf(await register()({}));
    expect(report).toContain("rejected (401)");
    expect(report).not.toContain("scope");
  });

  it("separates 'switched off' from 'broken' for the canvas tools", async () => {
    // Off is a checkbox away; broken is a setup problem. Conflating them sends
    // the user to the wrong place.
    const offReport = textOf(await register()({}));
    expect(offReport).toContain("canvas tools are switched off");
    expect(offReport).toContain("Webflow Designer tools");
  });

  it("lists the sites when the token works, so the ids are to hand", async () => {
    process.env.WEBFLOW_TOKEN = "good";
    global.fetch = jest.fn().mockResolvedValue(
      httpResponse(200, { sites: [{ id: "s1", displayName: "Demo" }] })
    ) as any;

    const report = textOf(await register()({}));
    expect(report).toContain("Demo (s1)");
  });

  it("flags a valid token that reaches nothing, which looks like success otherwise", async () => {
    process.env.WEBFLOW_TOKEN = "good-but-empty";
    global.fetch = jest.fn().mockResolvedValue(httpResponse(200, { sites: [] })) as any;

    const report = textOf(await register()({}));
    expect(report).toContain("reaches no sites");
  });

  it("reports the Figma channel when one is joined", async () => {
    mockChannel.mockReturnValue("6zas1rep");
    const report = textOf(await register()({}));
    expect(report).toContain("joined — 6zas1rep");
  });

  it("names the channel the extension must join, and the harness as a way in", async () => {
    // The user cannot act on "extension not connected" without knowing which
    // channel, and the harness is the only route that needs no Webflow account.
    process.env.FIGMA_MCP_WEBFLOW_DESIGNER = "true";
    mockChannel.mockReturnValue("6zas1rep");

    const report = textOf(await register()({}));
    expect(report).toContain("not on channel 6zas1rep");
    expect(report).toContain("join channel 6zas1rep");
    expect(report).toContain("npm run webflow:harness -- 6zas1rep");
  });

  it("confirms the extension and the page it has open", async () => {
    process.env.FIGMA_MCP_WEBFLOW_DESIGNER = "true";
    process.env.WEBFLOW_TOKEN = "good";
    mockChannel.mockReturnValue("6zas1rep");
    mockSendToWebflow.mockResolvedValue({ page: { name: "Demo" } });
    global.fetch = jest.fn().mockResolvedValue(
      httpResponse(200, { sites: [{ id: "s1", displayName: "Demo" }] })
    ) as any;

    const report = textOf(await register()({}));
    expect(report).toContain('connected on channel 6zas1rep — page "Demo"');
    expect(report).toContain("Everything is connected");
  });

  it("probes the extension with a short timeout, not the relay's two minutes", async () => {
    // The whole value of this tool is a fast answer; inheriting the command
    // timeout would make it worse than the serial discovery it replaces.
    process.env.FIGMA_MCP_WEBFLOW_DESIGNER = "true";
    mockChannel.mockReturnValue("ch");
    await register()({});

    const timeout = mockSendToWebflow.mock.calls[0]?.[2];
    expect(typeof timeout).toBe("number");
    expect(timeout).toBeLessThanOrEqual(20000);
  });

  it("says what is possible right now, not only what is broken", async () => {
    process.env.WEBFLOW_TOKEN = "good";
    global.fetch = jest.fn().mockResolvedValue(
      httpResponse(200, { sites: [{ id: "s1", displayName: "Demo" }] })
    ) as any;

    const report = textOf(await register()({}));
    expect(report).toContain("What is possible right now");
    expect(report).toContain("pages, SEO, CMS and publishing");
  });
});

describe("webflow_preflight availability", () => {
  const ORIGINAL_ENV = { ...process.env };

  const load = () => {
    let mod: any;
    jest.isolateModules(() => {
      mod = require("../../src/talk_to_figma_mcp/config/profiles");
    });
    return mod;
  };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.WEBFLOW_TOKEN;
    delete process.env.WEBFLOW_API_TOKEN;
    delete process.env.FIGMA_MCP_WEBFLOW_DESIGNER;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("is hidden when neither Webflow feature is configured", () => {
    expect(load().makeToolFilter("standard")("webflow_preflight")).toBe(false);
  });

  it("appears with only a token — the designer half is what it would diagnose", () => {
    process.env.WEBFLOW_TOKEN = "set";
    expect(load().makeToolFilter("standard")("webflow_preflight")).toBe(true);
  });

  it("appears with only the designer tools — the token is what it would diagnose", () => {
    // This is the case that matters: hiding the checker until everything is
    // configured makes it useless exactly when it is needed.
    process.env.FIGMA_MCP_WEBFLOW_DESIGNER = "true";
    expect(load().makeToolFilter("standard")("webflow_preflight")).toBe(true);
  });
});
