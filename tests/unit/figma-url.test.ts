/**
 * Comment reachability: URL parsing, permalink → single thread, and the
 * profile gate that decides whether the model is shown the comment tools.
 */

import {
  looksLikeFigmaUrl,
  parseFigmaUrl,
  toFileKey,
} from "../../src/talk_to_figma_mcp/utils/figma-url";
import {
  filterThreads,
  threadHasComment,
  type CommentThread,
} from "../../src/talk_to_figma_mcp/utils/comment-helpers";

// The exact link from the reported session.
const REPORTED_URL =
  "https://www.figma.com/design/yiqrtUnbqnEdWHY68kx4Qv/Beyond-Braces?node-id=2971-45373#1892186776";

describe("parseFigmaUrl", () => {
  it("extracts file key, node id and comment id from a comment permalink", () => {
    expect(parseFigmaUrl(REPORTED_URL)).toEqual({
      fileKey: "yiqrtUnbqnEdWHY68kx4Qv",
      nodeId: "2971:45373",
      commentId: "1892186776",
    });
  });

  it("handles /file/, /proto/ and /board/ links", () => {
    expect(parseFigmaUrl("https://figma.com/file/abcdefghij12/Name").fileKey).toBe("abcdefghij12");
    expect(parseFigmaUrl("https://figma.com/proto/abcdefghij12/Name").fileKey).toBe("abcdefghij12");
    expect(parseFigmaUrl("https://figma.com/board/abcdefghij12/Name").fileKey).toBe("abcdefghij12");
  });

  it("decodes an escaped colon in node-id", () => {
    expect(parseFigmaUrl("https://figma.com/design/abcdefghij12/N?node-id=12%3A34").nodeId).toBe("12:34");
  });

  it("ignores a non-numeric fragment rather than filtering everything out", () => {
    expect(parseFigmaUrl("https://figma.com/design/abcdefghij12/N#some-anchor").commentId).toBeUndefined();
  });

  it("returns an empty result for junk instead of throwing", () => {
    expect(parseFigmaUrl("")).toEqual({});
    expect(parseFigmaUrl("not a link")).toEqual({});
  });
});

describe("toFileKey", () => {
  it("passes a bare key through", () => {
    expect(toFileKey("yiqrtUnbqnEdWHY68kx4Qv")).toBe("yiqrtUnbqnEdWHY68kx4Qv");
  });

  it("extracts the key from a full URL", () => {
    expect(toFileKey(REPORTED_URL)).toBe("yiqrtUnbqnEdWHY68kx4Qv");
  });

  it("passes an unrecognised bare identifier through unchanged (LESSONS L7)", () => {
    // Not our job to rule on key shape — Figma is the authority on that.
    expect(toFileKey("FILE_A")).toBe("FILE_A");
    expect(toFileKey("some_legacy-key")).toBe("some_legacy-key");
  });

  it("returns undefined for blank input so callers fall back to the open file", () => {
    expect(toFileKey(undefined)).toBeUndefined();
    expect(toFileKey("   ")).toBeUndefined();
  });

  it("throws a readable error on an unparseable string", () => {
    expect(() => toFileKey("https://example.com/nope")).toThrow(/Could not read a Figma file key/);
  });

  it("recognises URLs", () => {
    expect(looksLikeFigmaUrl(REPORTED_URL)).toBe(true);
    expect(looksLikeFigmaUrl("abcdefghij12")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

const user = (id: string) => ({ id, handle: `user-${id}`, img_url: "", email: null }) as any;

function thread(overrides: Partial<CommentThread>): CommentThread {
  return {
    rootId: "root-1",
    fileKey: "abcdefghij12",
    author: user("1"),
    createdAt: "2026-09-01T00:00:00Z",
    resolved: false,
    resolvedAt: null,
    message: "root message",
    anchor: "canvas",
    replies: [],
    participants: ["user-1"],
    lastMessageAuthorId: "1",
    lastMessageAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("filtering to a single thread by comment id", () => {
  const target = thread({ rootId: "1892186776", message: "the pasted one" });
  const other = thread({ rootId: "999", message: "unrelated" });

  it("keeps only the thread whose root matches", () => {
    const got = filterThreads([target, other], { commentId: "1892186776" });
    expect(got).toHaveLength(1);
    expect(got[0].message).toBe("the pasted one");
  });

  it("matches a permalink that points at a reply", () => {
    const withReply = thread({
      rootId: "111",
      replies: [{ id: "1892186776", user: user("2"), message: "a reply" } as any],
    });
    expect(threadHasComment(withReply, "1892186776")).toBe(true);
    expect(filterThreads([withReply, other], { commentId: "1892186776" })).toHaveLength(1);
  });

  it("returns a resolved thread when asked for by id", () => {
    const resolved = thread({ rootId: "1892186776", resolved: true, resolvedAt: "2026-09-02T00:00:00Z" });
    // Without the id it is filtered out by the default includeResolved=false...
    expect(filterThreads([resolved], {})).toHaveLength(0);
    // ...but asking for that exact comment means you want it.
    expect(filterThreads([resolved], { commentId: "1892186776" })).toHaveLength(1);
  });

  it("returns nothing when the id is absent", () => {
    expect(filterThreads([target, other], { commentId: "does-not-exist" })).toHaveLength(0);
  });
});

describe("scoping threads to a node", () => {
  const onNode = thread({ rootId: "a", nodeId: "2971:45373", message: "on the frame" });
  const onChild = thread({ rootId: "b", nodeId: "2971:99999", message: "on a child" });
  const onCanvas = thread({ rootId: "c", message: "loose on canvas" });

  it("keeps only threads pinned to the requested node", () => {
    const got = filterThreads([onNode, onChild, onCanvas], { nodeId: "2971:45373" });
    expect(got.map((t) => t.message)).toEqual(["on the frame"]);
  });

  it("does not match a pin on a different node, including a child", () => {
    expect(filterThreads([onChild, onCanvas], { nodeId: "2971:45373" })).toHaveLength(0);
  });

  it("is ignored when a specific comment id is requested", () => {
    // The permalink wins: asking for one comment should not also require a node match.
    const got = filterThreads([onChild], { commentId: "b", nodeId: "2971:45373" });
    expect(got).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("profile gating for comment tools", () => {
  const COMMENT_TOOLS = ["get_file_comments", "get_my_comments", "reply_to_comment", "get_figma_account"];
  const ORIGINAL = process.env.FIGMA_ACCESS_TOKEN;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.FIGMA_ACCESS_TOKEN;
    else process.env.FIGMA_ACCESS_TOKEN = ORIGINAL;
    jest.resetModules();
  });

  // Re-imported per test because the token is read at filter-build time.
  const loadFilter = async () => {
    jest.resetModules();
    return (await import("../../src/talk_to_figma_mcp/config/profiles")).makeToolFilter;
  };

  it("advertises comment tools under 'standard' when a token is configured", async () => {
    process.env.FIGMA_ACCESS_TOKEN = "figd_test_token";
    const makeToolFilter = await loadFilter();
    const allow = makeToolFilter("standard");
    COMMENT_TOOLS.forEach((name) => expect(allow(name)).toBe(true));
  });

  it("withholds them under 'standard' when no token is configured", async () => {
    delete process.env.FIGMA_ACCESS_TOKEN;
    delete process.env.FIGMA_PERSONAL_ACCESS_TOKEN;
    const makeToolFilter = await loadFilter();
    const allow = makeToolFilter("standard");
    COMMENT_TOOLS.forEach((name) => expect(allow(name)).toBe(false));
  });

  it("leaves 'full' and 'core' behaviour unchanged", async () => {
    process.env.FIGMA_ACCESS_TOKEN = "figd_test_token";
    const makeToolFilter = await loadFilter();
    COMMENT_TOOLS.forEach((name) => expect(makeToolFilter("full")(name)).toBe(true));
    COMMENT_TOOLS.forEach((name) => expect(makeToolFilter("core")(name)).toBe(false));
    // A core tool is still admitted.
    expect(makeToolFilter("core")("get_node_info")).toBe(true);
  });

  it("does not withhold non-comment tools either way", async () => {
    delete process.env.FIGMA_ACCESS_TOKEN;
    const makeToolFilter = await loadFilter();
    expect(makeToolFilter("standard")("get_node_info")).toBe(true);
  });
});
