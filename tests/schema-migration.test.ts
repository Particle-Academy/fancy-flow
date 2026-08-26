/**
 * The schema-migration seam.
 *
 * This runtime always had one; its twins did not. `fancy-flow-php` and the
 * Python runtime compared the version and ERRORED on any mismatch, so the day
 * schema v2 was cut, every stored Op would have hard-failed to import on both
 * SERVER runtimes — which is where durable runs RESUME. A run parked on a human
 * approval would have become unresumable, and the fix could not be applied
 * afterwards: the graphs would already be unreadable by the very code meant to
 * migrate them.
 *
 * All three now carry the identical shape, and these tests pin it here.
 *
 * `steps` is a parameter for a reason worth stating: with only v1 in existence
 * there is no old document to migrate, so a seam tested against the built-in
 * (empty) table is a check that CANNOT FAIL. It would pass identically against
 * the no-op this function used to be.
 */
import { describe, expect, it } from "vitest";
import {
  importWorkflow,
  migrateSchema,
  WORKFLOW_SCHEMA_URL,
  WORKFLOW_SCHEMA_VERSION,
  type MigrationStep,
} from "../src/schema/workflow-schema";

const doc = (version: number, nodes: unknown[] = []) => ({
  $schema: WORKFLOW_SCHEMA_URL,
  version,
  graph: { nodes, edges: [] },
});

describe("migrateSchema", () => {
  it("carries a PAST version forward through the step table", () => {
    const toV1: MigrationStep = (s) => {
      const g = s.graph as { nodes: Array<Record<string, unknown>> };
      g.nodes[0].kind = "manual_trigger";
      return s;
    };

    const migrated = migrateSchema(doc(0, [{ id: "t", kind: "OLD_NAME" }]), { 0: toV1 }) as {
      version: number;
      graph: { nodes: Array<{ kind: string }> };
    };

    expect(migrated.version).toBe(WORKFLOW_SCHEMA_VERSION);
    expect(migrated.graph.nodes[0].kind).toBe("manual_trigger");
  });

  it("refuses to walk a FUTURE version downward", () => {
    // We cannot know what a later schema means, so guessing is worse than
    // reporting. Untouched hands it to the version check.
    const future = doc(99);
    expect(migrateSchema(future, { 0: (s) => s })).toBe(future);

    const result = importWorkflow(future);
    expect(result.ok).toBe(false);
  });

  it("leaves a document alone when the table has no path for it", () => {
    // A gap is not a licence to guess.
    const old = doc(0);
    expect(migrateSchema(old, {})).toBe(old);
  });

  it("leaves a CURRENT document untouched — the seam is invisible to every graph in the field", () => {
    // The compatibility guard. Everything shipped today is v1, and migration
    // must not be in its way.
    const current = doc(WORKFLOW_SCHEMA_VERSION);
    expect(migrateSchema(current)).toBe(current);
  });

  it("passes a non-object straight through rather than throwing", () => {
    // `importWorkflow` calls this BEFORE it validates the shape, so migration
    // must survive whatever a consumer hands it. Throwing here would turn a
    // clean "Schema is not an object" into a stack trace.
    expect(migrateSchema(null)).toBe(null);
    expect(migrateSchema("nonsense")).toBe("nonsense");
  });
});
