/**
 * `./connectors` must be a real, reachable subpath — declared in `exports`,
 * built by tsup, AND carrying types.
 *
 * This is the same class of defect as the `OutputField` bug in 0.47.1: a thing
 * that exists in the repo and cannot be reached by the name a consumer writes.
 * An entry missing from `tsup.config.ts` produces no `dist/connectors.js`, so
 * the export map points at a file that is not there; an entry missing from the
 * `dts` list ships JavaScript with no types, which fails only for TypeScript
 * consumers — and every consumer of this module is one, since it exists to
 * build a typed `NodeKindDefinition`.
 *
 * The module was vendored sandbox source until 0.48.0. A node could copy it; a
 * PACKAGE could not, so every generated `<provider>-ui` package carried its own
 * copy of a file only this repo can correctly change.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const pkg = JSON.parse(read("package.json"));

describe("the ./connectors subpath", () => {
  test("is declared in exports, for both import and require", () => {
    const entry = pkg.exports?.["./connectors"];
    expect(entry?.import?.default).toBe("./dist/connectors.js");
    expect(entry?.require?.default).toBe("./dist/connectors.cjs");
  });

  test("declares types on both conditions", () => {
    const entry = pkg.exports["./connectors"];
    expect(entry.import.types).toBe("./dist/connectors.d.ts");
    expect(entry.require.types).toBe("./dist/connectors.d.cts");
  });

  test("tsup builds it, and builds its types", () => {
    const config = read("tsup.config.ts");
    // Without the entry there is no dist file for the export map to point at.
    expect(config).toMatch(/connectors:\s*"src\/connectors\.ts"/);
    // Without the dts entry it ships JS with no types.
    const dts = config.slice(config.indexOf("dts:"), config.indexOf("sourcemap"));
    expect(dts).toContain('"src/connectors.ts"');
  });

  test("the module does not import itself through the package name", () => {
    // It was vendored source and imported "@particle-academy/fancy-flow/engine".
    // Left in place that is a self-referential import inside the package.
    expect(read("src/connectors.ts")).not.toContain("@particle-academy/fancy-flow");
  });

  test("it exports the authoring surface a connector package needs", () => {
    const source = read("src/connectors.ts");
    for (const name of ["defineConnectorKind", "connectionFields", "summarize", "ingredients"]) {
      expect(source).toMatch(new RegExp(`export function ${name}\\b`));
    }
    for (const name of ["ConnectorDomain", "ConnectorRole", "SandboxKind", "ConnectorMeta"]) {
      expect(source).toMatch(new RegExp(`export type ${name}\\b`));
    }
  });
});
