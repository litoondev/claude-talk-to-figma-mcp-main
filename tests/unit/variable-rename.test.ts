import { loadPlugin, clearNodes } from "../fixtures/figma-plugin-harness";
import { casewayFile } from "../fixtures/caseway-tokens";

function freshCasewayFile() {
  return JSON.parse(JSON.stringify(casewayFile()));
}

let api: any;
let figma: any;

beforeEach(() => {
  clearNodes();
  const loaded = loadPlugin(freshCasewayFile());
  api = loaded.api;
  figma = loaded.figma;
});

describe("rename_variable — single variable rename", () => {
  it("renames an existing variable by name", async () => {
    const res = await api.renameVariable({
      name: "Layout/Default/row-gap",
      newName: "Layout/Section/row-gap",
    });

    expect(res.success).toBe(true);
    expect(res.oldName).toBe("Layout/Default/row-gap");
    expect(res.newName).toBe("Layout/Section/row-gap");
    expect(res.collectionName).toBe("styles");

    // Verify it can now be found by the new name
    const updated = await figma.variables.getVariableByIdAsync(res.variableId);
    expect(updated.name).toBe("Layout/Section/row-gap");
  });

  it("renames an existing variable by variableId", async () => {
    const existing = await figma.variables.getVariableByIdAsync("v:1");
    const oldName = existing.name;

    const res = await api.renameVariable({
      variableId: "v:1",
      newName: "Primitives/Renamed/v1",
    });

    expect(res.success).toBe(true);
    expect(res.oldName).toBe(oldName);
    expect(res.newName).toBe("Primitives/Renamed/v1");

    const updated = await figma.variables.getVariableByIdAsync("v:1");
    expect(updated.name).toBe("Primitives/Renamed/v1");
  });

  it("finds variable with case-insensitive name matching", async () => {
    const res = await api.renameVariable({
      name: "layout/default/row-gap",
      newName: "Layout/Default/RowGap-Renamed",
      collectionName: "styles",
    });

    expect(res.success).toBe(true);
    expect(res.newName).toBe("Layout/Default/RowGap-Renamed");
  });

  it("rejects when newName is missing or empty", async () => {
    await expect(
      api.renameVariable({ name: "Layout/Default/row-gap", newName: "" })
    ).rejects.toThrow(/Missing or invalid newName/);
  });

  it("rejects when variable is not found", async () => {
    await expect(
      api.renameVariable({ name: "NonExistent/Token", newName: "SomethingElse" })
    ).rejects.toThrow(/not found/);
  });
});

describe("rename_variables — batch renaming", () => {
  it("renames multiple variables using an explicit list", async () => {
    const res = await api.renameVariables({
      renames: [
        { name: "Layout/Default/column-gap", newName: "Layout/Section/column-gap" },
        { name: "Layout/Default/container-padding", newName: "Layout/Section/container-padding" },
      ],
    });

    expect(res.success).toBe(true);
    expect(res.renamedCount).toBe(2);
    expect(res.errorCount).toBe(0);
    expect(res.renamed[0].newName).toBe("Layout/Section/column-gap");
    expect(res.renamed[1].newName).toBe("Layout/Section/container-padding");
  });

  it("renames variables using find and replace prefix/pattern", async () => {
    // Caseway tokens have several tokens starting with 'Layout/Default/'
    const res = await api.renameVariables({
      collectionName: "styles",
      find: "Layout/Default/",
      replace: "Layout/Section/",
    });

    expect(res.success).toBe(true);
    expect(res.renamedCount).toBeGreaterThan(0);
    expect(res.errorCount).toBe(0);

    // Verify all matching tokens were renamed
    for (const item of res.renamed) {
      expect(item.oldName.startsWith("Layout/Default/")).toBe(true);
      expect(item.newName.startsWith("Layout/Section/")).toBe(true);
    }
  });

  it("supports regex in find and replace", async () => {
    const res = await api.renameVariables({
      collectionName: "styles",
      find: "Layout/(Default)/",
      replace: "Layout/Group-$1/",
      useRegex: true,
    });

    expect(res.success).toBe(true);
    expect(res.renamedCount).toBeGreaterThan(0);
    expect(res.renamed[0].newName).toContain("Layout/Group-Default/");
  });
});

describe("set_variable — rename integration", () => {
  it("renames variable when newName is passed without value", async () => {
    const res = await api.setVariable({
      name: "Layout/Default/row-gap",
      newName: "Layout/RenamedViaSet/row-gap",
    });

    expect(res.success).toBe(true);
    expect(res.newName).toBe("Layout/RenamedViaSet/row-gap");

    const check = await figma.variables.getVariableByIdAsync(res.variableId);
    expect(check.name).toBe("Layout/RenamedViaSet/row-gap");
  });

  it("updates both name and value when both newName and value are provided", async () => {
    const res = await api.setVariable({
      collectionName: "styles",
      name: "Layout/Default/row-gap",
      newName: "Layout/UpdatedNameAndValue/row-gap",
      resolvedType: "FLOAT",
      value: 48,
    });

    expect(res.variableName).toBe("Layout/UpdatedNameAndValue/row-gap");
    expect(res.value).toBe(48);

    const check = await figma.variables.getVariableByIdAsync(res.variableId);
    expect(check.name).toBe("Layout/UpdatedNameAndValue/row-gap");
  });
});

describe("execute_code — plugin sandbox execution", () => {
  it("executes JavaScript code and returns safe result", async () => {
    const res = await api.executeCode({
      code: "return 10 + 20;",
    });

    expect(res.success).toBe(true);
    expect(res.result).toBe(30);
  });

  it("provides access to figma and params", async () => {
    const res = await api.executeCode({
      code: `
        const collections = await figma.variables.getLocalVariableCollectionsAsync();
        return { count: collections.length, prefix: params.prefix };
      `,
      params: { prefix: "test-prefix" },
    });

    expect(res.success).toBe(true);
    expect(res.result.count).toBe(2);
    expect(res.result.prefix).toBe("test-prefix");
  });

  it("surfaces execution errors cleanly", async () => {
    await expect(
      api.executeCode({ code: "throw new Error('Custom plugin error');" })
    ).rejects.toThrow(/Custom plugin error/);
  });
});

describe("file key configuration and resolution", () => {
  it("parses full Figma URLs into clean file keys", async () => {
    const res = await api.setFileKey({
      url: "https://www.figma.com/design/AbCdEf12345/My-Design-File?node-id=0-1",
    });

    expect(res.success).toBe(true);
    expect(res.fileKey).toBe("AbCdEf12345");

    const info = await api.getFileKey();
    expect(info.fileKey).toBe("AbCdEf12345");
    expect(info.available).toBe(true);
  });

  it("accepts direct file keys", async () => {
    const res = await api.setFileKey({
      fileKey: "XyZ987654321",
    });

    expect(res.success).toBe(true);
    expect(res.fileKey).toBe("XyZ987654321");
  });
});

describe("command dispatch in handleCommand", () => {
  it("dispatches rename_variable through handleCommand", async () => {
    const res = await api.handleCommand("rename_variable", {
      name: "Layout/Default/row-gap",
      newName: "Layout/Dispatched/row-gap",
    });

    expect(res.success).toBe(true);
    expect(res.newName).toBe("Layout/Dispatched/row-gap");
  });

  it("dispatches rename_variables through handleCommand", async () => {
    const res = await api.handleCommand("rename_variables", {
      collectionName: "styles",
      find: "Layout/Default/",
      replace: "Layout/BatchDispatched/",
    });

    expect(res.success).toBe(true);
    expect(res.renamedCount).toBeGreaterThan(0);
  });

  it("dispatches execute_code through handleCommand", async () => {
    const res = await api.handleCommand("execute_code", {
      code: "return 'executed via handleCommand';",
    });

    expect(res.success).toBe(true);
    expect(res.result).toBe("executed via handleCommand");
  });

  it("dispatches set_file_key through handleCommand", async () => {
    const res = await api.handleCommand("set_file_key", {
      fileKey: "DispatchedKey123",
    });

    expect(res.success).toBe(true);
    expect(res.fileKey).toBe("DispatchedKey123");
  });
});
