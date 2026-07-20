/**
 * The node package manifest — what a marketplace node declares about itself.
 *
 * A node is not one artifact. It is a kind definition (palette entry, config
 * schema, ports, canvas renderer) plus an executor for EACH runtime the
 * consumer actually runs. A package shipping only a TS executor is unusable to
 * anyone executing on PHP, and today that is invisible until a run fails.
 *
 * So the manifest states which runtimes it implements, and the CLI checks that
 * against the host before installing rather than after. Requested by the MOIC
 * Suite consumer (fancy-flow#2 §2), who runs the editor in TS and executes in
 * PHP and hit exactly this.
 *
 * The manifest is data, not code: the registry, the CLI, and the MCP all read
 * it without executing anything a package author wrote.
 */

import type { PauseAwaiting } from "../registry/pause";

/** The current manifest schema version. Bump only on a breaking shape change. */
export const NODE_MANIFEST_SCHEMA_VERSION = 1;

/**
 * A runtime a node can implement.
 *
 * Open rather than a closed union — the PHP and Node twins are what exist
 * today, but the point of a manifest is that a runtime we haven't written can
 * declare itself without a release here.
 */
export type NodeRuntimeId = "ts" | "php" | (string & {});

export type NodePackageManifest = {
  /** Must equal `NODE_MANIFEST_SCHEMA_VERSION`. */
  schemaVersion: number;
  /** Package name, as installed (`@acme/fancy-flow-salesforce`). */
  name: string;
  /**
   * The canonical kind id this package provides — namespaced, and the string
   * that gets persisted into every document using it.
   */
  kind: string;
  /** Semver range of fancy-flow this node's contract targets. */
  fancyFlow: string;
  /**
   * Per-runtime entrypoints. TS is a module path within the package; PHP is a
   * Composer requirement, because the two ecosystems install differently and
   * pretending otherwise just moves the problem into the CLI.
   */
  runtimes: Partial<Record<NodeRuntimeId, string>>;
  /**
   * Host capabilities this node needs wired before it can run — `llm`,
   * `workflow_resolver`, `document`, or a host-specific one.
   *
   * Declared so the CLI can tell an author what to wire BEFORE install, rather
   * than the node silently no-opping or crashing mid-run.
   */
  capabilities?: string[];
  /**
   * Path to this node's golden fixtures, relative to the package root.
   *
   * REQUIRED. Every runtime the package claims runs these same cases, which is
   * what makes "behaves identically on both runtimes" verified rather than
   * asserted. See `./fixtures`.
   */
  fixtures: string;
  /** Declares the node halts for a person. Mirrors `NodeKindDefinition`. */
  pausesForHuman?: PauseAwaiting;
  /** One-line summary — what `search_nodes` matches against. */
  description?: string;
  /**
   * Assigned by the registry, never by the author. Present in a manifest being
   * submitted for publication, it is a claim to a trust signal the author does
   * not get to make.
   */
  verified?: boolean;
};

export type ManifestProblem = {
  level: "error" | "warning";
  field: string;
  message: string;
};

export type ManifestValidation = {
  /** True when there are no `error`-level problems. Warnings do not block. */
  ok: boolean;
  manifest?: NodePackageManifest;
  problems: ManifestProblem[];
};

/** Reserved for first-party packages; the registry rejects other claimants. */
const FIRST_PARTY_SCOPE = "@particle-academy/";

/** `@scope/name` — the shape 0.11.0 made canonical for kind ids. */
const NAMESPACED_KIND = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;

function err(field: string, message: string): ManifestProblem {
  return { level: "error", field, message };
}

function warn(field: string, message: string): ManifestProblem {
  return { level: "warning", field, message };
}

/**
 * Validate a manifest read from disk or a registry.
 *
 * Returns every problem rather than throwing on the first, because an author
 * fixing a package wants the whole list — a validator that reveals one error
 * per run turns a five-minute fix into five round trips.
 */
export function validateNodeManifest(input: unknown): ManifestValidation {
  const problems: ManifestProblem[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, problems: [err("", "Manifest must be a JSON object.")] };
  }

  const m = input as Record<string, unknown>;

  // Version first: an unknown version means every other check below is
  // guessing at a shape we do not know, so say so plainly instead of
  // half-reading it and reporting confident nonsense about the rest.
  if (m.schemaVersion !== NODE_MANIFEST_SCHEMA_VERSION) {
    if (typeof m.schemaVersion !== "number") {
      problems.push(err("schemaVersion", `Required, and must be ${NODE_MANIFEST_SCHEMA_VERSION}.`));
    } else {
      return {
        ok: false,
        problems: [
          err(
            "schemaVersion",
            `Unsupported manifest version ${m.schemaVersion}; this fancy-flow understands ${NODE_MANIFEST_SCHEMA_VERSION}. Upgrade fancy-flow to install this node.`,
          ),
        ],
      };
    }
  }

  if (typeof m.name !== "string" || m.name.trim() === "") {
    problems.push(err("name", "Required — the package name as installed."));
  }

  if (typeof m.kind !== "string" || m.kind.trim() === "") {
    problems.push(err("kind", "Required — the canonical kind id this package provides."));
  } else if (!NAMESPACED_KIND.test(m.kind)) {
    // Un-namespaced ids are the one mistake that cannot be fixed after the
    // fact: the ambiguous string is already written into saved documents.
    problems.push(
      err("kind", `"${m.kind}" must be namespaced as @scope/name — a bare id makes stored graphs ambiguous, and that is unfixable once documents carry it.`),
    );
  } else if (m.kind.startsWith(FIRST_PARTY_SCOPE)) {
    problems.push(
      warn("kind", `${FIRST_PARTY_SCOPE}* is reserved for first-party nodes; the registry will reject this unless the package is first-party.`),
    );
  }

  if (typeof m.fancyFlow !== "string" || m.fancyFlow.trim() === "") {
    problems.push(err("fancyFlow", "Required — the semver range of fancy-flow this node targets."));
  }

  // Runtimes: the check the whole manifest exists for.
  if (typeof m.runtimes !== "object" || m.runtimes === null || Array.isArray(m.runtimes)) {
    problems.push(err("runtimes", "Required — an object of runtime id to entrypoint."));
  } else {
    const entries = Object.entries(m.runtimes as Record<string, unknown>);
    if (entries.length === 0) {
      problems.push(err("runtimes", "A node that implements no runtime cannot execute anywhere."));
    }
    for (const [runtime, entry] of entries) {
      if (typeof entry !== "string" || entry.trim() === "") {
        problems.push(err(`runtimes.${runtime}`, "Entrypoint must be a non-empty string."));
      }
    }
  }

  // Fixtures: the publish gate. Cross-runtime drift does not fail loudly —
  // it completes, down one path, with no error — so it has to be caught by
  // something that runs, not by review.
  if (typeof m.fixtures !== "string" || m.fixtures.trim() === "") {
    problems.push(
      err("fixtures", "Required — path to the node's golden fixtures. Every claimed runtime runs them, which is what makes cross-runtime parity verified rather than claimed."),
    );
  }

  if (m.capabilities !== undefined) {
    if (!Array.isArray(m.capabilities) || m.capabilities.some((c) => typeof c !== "string")) {
      problems.push(err("capabilities", "Must be an array of capability id strings."));
    }
  }

  if (m.verified !== undefined) {
    problems.push(
      err("verified", "Assigned by the registry, not the package. Remove it — a package cannot vouch for itself."),
    );
  }

  const ok = !problems.some((p) => p.level === "error");
  return ok ? { ok, manifest: m as unknown as NodePackageManifest, problems } : { ok, problems };
}

/**
 * Check a node against the runtimes a host actually executes on.
 *
 * This is what makes a TS-only package visible to someone running PHP BEFORE
 * they install it rather than at the first run. A missing runtime is an error,
 * not a warning: the node genuinely cannot execute there.
 */
export function checkRuntimeSupport(
  manifest: Pick<NodePackageManifest, "kind" | "runtimes">,
  hostRuntimes: readonly string[],
): ManifestProblem[] {
  const provided = Object.keys(manifest.runtimes ?? {});
  const missing = hostRuntimes.filter((r) => !provided.includes(r));

  if (missing.length === 0) return [];

  return [
    err(
      "runtimes",
      `${manifest.kind} implements ${provided.join(", ") || "no runtime"} but this project executes on ${missing.join(", ")}. The node would install, appear in the palette, and then fail to run.`,
    ),
  ];
}

/**
 * Check that every capability a node needs is actually wired.
 *
 * Pass `capabilityStatus()` from the host. Unwired capabilities are a warning
 * rather than an error — install is the right time to learn what to wire, not
 * a reason to refuse, since wiring usually happens after install.
 */
export function checkCapabilities(
  manifest: Pick<NodePackageManifest, "kind" | "capabilities">,
  available: Readonly<Record<string, boolean>>,
): ManifestProblem[] {
  const needed = manifest.capabilities ?? [];
  const missing = needed.filter((c) => available[c] !== true);

  if (missing.length === 0) return [];

  return [
    warn(
      "capabilities",
      `${manifest.kind} needs ${missing.join(", ")} wired on the host. Until then the node will fail at run time rather than at install.`,
    ),
  ];
}
