/**
 * Marketplace contracts — what a node package declares, and how its claim to
 * cross-runtime parity is verified.
 *
 * Pure data + a headless runner: no React, nothing that executes a package
 * author's code at read time. The CLI, the registry, and the MCP all consume
 * this, so it stays importable from the headless entry.
 */

export {
  NODE_MANIFEST_SCHEMA_VERSION,
  validateNodeManifest,
  checkRuntimeSupport,
  checkCapabilities,
  satisfiesRange,
  type NodePackageManifest,
  type NodeRuntimeId,
  type NodeRuntimeSpec,
  type CapabilityRequirement,
  type SideEffects,
  type ManifestProblem,
  type ManifestValidation,
} from "./manifest";

export {
  runFixtures,
  validateFixtureFile,
  type FixtureFile,
  type FixtureCase,
  type FixtureExpectation,
  type FixtureStubs,
  type FixtureEventExpectation,
  type FixtureFailure,
  type FixtureRunResult,
} from "./fixtures";
