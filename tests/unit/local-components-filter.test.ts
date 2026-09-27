import { loadPlugin, makeNode } from "../fixtures/figma-plugin-harness";

describe("get_local_components filtering", () => {
  const components = [
    makeNode({ id: "c:desk", name: "# Our Doctors", type: "COMPONENT", width: 1440, height: 1857 }),
    makeNode({ id: "c:tab", name: "# Our Doctors", type: "COMPONENT", width: 768, height: 2919 }),
    makeNode({ id: "c:mobi", name: "# Our Doctors", type: "COMPONENT", width: 320, height: 2180 }),
    makeNode({ id: "c:other", name: "# Our Practice", type: "COMPONENT", width: 320, height: 610 }),
  ];

  function setup() {
    const loaded = loadPlugin();
    (loaded.figma.root as any).findAllWithCriteria = () => components;
    return loaded.api;
  }

  it("finds one breakpoint master by exact name and width", async () => {
    const result = await setup().getLocalComponents({
      name: "# our doctors",
      width: 320,
      includeDimensions: true,
    });

    expect(result.count).toBe(4);
    expect(result.matchedCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.components).toEqual([
      expect.objectContaining({ id: "c:mobi", width: 320, height: 2180 }),
    ]);
  });

  it("limits broad results and reports truncation", async () => {
    const result = await setup().getLocalComponents({ nameContains: "doctors", limit: 2 });
    expect(result.matchedCount).toBe(3);
    expect(result.returned).toBe(2);
    expect(result.truncated).toBe(true);
  });
});
