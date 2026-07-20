/**
 * The node package manifest — what a marketplace node declares about itself.
 *
 * A node is not one artifact. It is a kind definition (palette entry, config
 * schema, ports, renderer) plus an executor for EACH runtime the consumer runs.
 * A package shipping only a TS executor is unusable to anyone executing on PHP,
 * and without a manifest that is invisible until a run fails. Requested by the
 * MOIC Suite consumer (fancy-flow#2 §2), who runs the editor in TS and executes
 * in PHP and hit exactly this.
 *
 * The manifest is data, not code: the registry, the CLI, and the MCP all read
 * it without executing anything a package author wrote.
 *
 * ## Why the engine range lives per runtime
 *
 * The first cut of this manifest carried ONE `fancyFlow` range, and it was
 * wrong: the two engines version independently, so a single range cannot say
 * "needs npm >=0.11 AND php >=0.5". A package supporting both runtimes would
 * install cleanly against a host whose OTHER runtime was too old — the 0.9.0
 * failure shape wearing a manifest. The range belongs inside each runtime.
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

/**
 * How one runtime provides this node, and which engine version it needs.
 *
 * `entry` and `package` are both here because the two ecosystems install
 * differently — a module path within the package for TS, a Composer
 * requirement for PHP — and pretending otherwise just moves the problem into
 * the CLI. Exactly one is required.
 */
export type NodeRuntimeSpec = {
  /** Module path within the package (TS-style runtimes). */
  entry?: string;
  /** Dependency requirement resolved by that ecosystem (PHP/Composer-style). */
  package?: string;
  /** Semver range of THIS runtime's engine. Required — see the module note. */
  engine: string;
};

/**
 * Whether a capability must be wired for the node to work at all.
 *
 * `required` is checked at AUTHOR time, not run time. The failure that hurts is
 * a node that installs fine, authors fine, and silently no-ops during a run —
 * the same silence as a routing bug. An editor can grey the node and say which
 * capability the host never registered.
 */
export type CapabilityRequirement = "required" | "optional";

/**
 * Whether a node is safe to run again.
 *
 * Durable runs RETRY. A node that writes needs to say so, or a host has to pick
 * one retry policy for every node and get it wrong somewhere.
 */
export type SideEffects = "none" | "idempotent" | "unsafe-to-replay";

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
  /**
   * Previous ids this kind still answers to.
   *
   * Core renamed `llm_branch` to `llm_router` and kept every old id working.
   * Third-party packages will rename too, and their documents break the same
   * way core's would have — so packages get the same escape hatch, otherwise
   * only first-party nodes can rename safely.
   */
  aliases?: string[];
  /**
   * Version of this node's CONFIG shape, independent of the document schema.
   *
   * A node's config evolves on its own clock. Without a declared version, every
   * executor accretes hand-written read-fallbacks forever (MOIC carries one for
   * `routes[].key` → `routes[].port`), because nothing canonicalises old config
   * the way import canonicalises kind ids.
   */
  configVersion?: number;
  /** Per-runtime entrypoints and engine ranges. */
  runtimes: Partial<Record<NodeRuntimeId, NodeRuntimeSpec>>;
  /**
   * Host capabilities this node needs, and whether each is mandatory.
   *
   * Declared so the CLI and the editor can say what to wire BEFORE a run,
   * rather than the node silently no-opping or crashing mid-run.
   */
  capabilities?: Record<string, CapabilityRequirement>;
  /**
   * Path to this node's golden fixtures, relative to the package root.
   *
   * REQUIRED. Every runtime the package claims runs these same cases, which is
   * what makes "behaves identically on both runtimes" verified rather than
   * asserted. See `./fixtures`.
   */
  fixtures: string;
  /**
   * Declares the node halts for a person. Mirrors `NodeKindDefinition`.
   *
   * A host-planning fact, not a node internal: a parent that embeds workflows
   * needs to reject a child that can pause, because a paused child wedges the
   * parent — and discovering that at run time means watching a run park.
   */
  pausesForHuman?: PauseAwaiting;
  /** Whether this node is safe to replay. See `SideEffects`. */
  sideEffects?: SideEffects;
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

const SIDE_EFFECTS: readonly string[] = ["none", "idempotent", "unsafe-to-replay"];
const REQUIREMENTS: readonly string[] = ["required", "optional"];

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

  validateKind(m.kind, problems);
  validateAliases(m.aliases, problems);

  if (m.configVersion !== undefined && (typeof m.configVersion !== "number" || !Number.isInteger(m.configVersion))) {
    problems.push(err("configVersion", "Must be an integer."));
  }

  // A leftover single range from the pre-per-runtime shape. Worth naming
  // explicitly rather than ignoring — it silently means "no engine constraint".
  if (m.fancyFlow !== undefined) {
    problems.push(
      err(
        "fancyFlow",
        "A single engine range cannot express the split — it cannot say \"needs ts >=0.15 AND php >=0.7\". Move the range into each entry of `runtimes` as `engine`.",
      ),
    );
  }

  validateRuntimes(m.runtimes, problems);

  // Fixtures: the publish gate. Cross-runtime drift does not fail loudly —
  // it completes, down one path, with no error — so it has to be caught by
  // something that runs, not by review.
  if (typeof m.fixtures !== "string" || m.fixtures.trim() === "") {
    problems.push(
      err("fixtures", "Required — path to the node's golden fixtures. Every claimed runtime runs them, which is what makes cross-runtime parity verified rather than claimed."),
    );
  }

  validateCapabilities(m.capabilities, problems);

  if (m.sideEffects !== undefined && !SIDE_EFFECTS.includes(m.sideEffects as string)) {
    problems.push(err("sideEffects", `Must be one of: ${SIDE_EFFECTS.join(", ")}.`));
  }

  if (m.verified !== undefined) {
    problems.push(
      err("verified", "Assigned by the registry, not the package. Remove it — a package cannot vouch for itself."),
    );
  }

  const ok = !problems.some((p) => p.level === "error");
  return ok ? { ok, manifest: m as unknown as NodePackageManifest, problems } : { ok, problems };
}

function validateKind(kind: unknown, problems: ManifestProblem[]): void {
  if (typeof kind !== "string" || kind.trim() === "") {
    problems.push(err("kind", "Required — the canonical kind id this package provides."));
    return;
  }
  if (!NAMESPACED_KIND.test(kind)) {
    // Un-namespaced ids are the one mistake that cannot be fixed after the
    // fact: the ambiguous string is already written into saved documents.
    problems.push(
      err("kind", `"${kind}" must be namespaced as @scope/name — a bare id makes stored graphs ambiguous, and that is unfixable once documents carry it.`),
    );
    return;
  }
  if (kind.startsWith(FIRST_PARTY_SCOPE)) {
    problems.push(
      warn("kind", `${FIRST_PARTY_SCOPE}* is reserved for first-party nodes; the registry will reject this unless the package is first-party.`),
    );
  }
}

function validateAliases(aliases: unknown, problems: ManifestProblem[]): void {
  if (aliases === undefined) return;

  if (!Array.isArray(aliases) || aliases.some((a) => typeof a !== "string" || a.trim() === "")) {
    problems.push(err("aliases", "Must be an array of non-empty id strings."));
  }
}

function validateRuntimes(runtimes: unknown, problems: ManifestProblem[]): void {
  if (typeof runtimes !== "object" || runtimes === null || Array.isArray(runtimes)) {
    problems.push(err("runtimes", "Required — an object of runtime id to { entry | package, engine }."));
    return;
  }

  const entries = Object.entries(runtimes as Record<string, unknown>);
  if (entries.length === 0) {
    problems.push(err("runtimes", "A node that implements no runtime cannot execute anywhere."));
    return;
  }

  for (const [runtime, spec] of entries) {
    if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
      problems.push(err(`runtimes.${runtime}`, "Must be an object of { entry | package, engine }."));
      continue;
    }

    const s = spec as Record<string, unknown>;
    const hasEntry = typeof s.entry === "string" && s.entry.trim() !== "";
    const hasPackage = typeof s.package === "string" && s.package.trim() !== "";

    if (!hasEntry && !hasPackage) {
      problems.push(err(`runtimes.${runtime}`, "Needs `entry` (a module path) or `package` (a dependency requirement)."));
    }
    if (hasEntry && hasPackage) {
      problems.push(err(`runtimes.${runtime}`, "Declare `entry` or `package`, not both — which one is authoritative is otherwise ambiguous."));
    }
    if (typeof s.engine !== "string" || s.engine.trim() === "") {
      problems.push(
        err(`runtimes.${runtime}.engine`, `Required — the semver range of the ${runtime} engine. Without it, this node installs against a ${runtime} engine too old to run it.`),
      );
    }
  }
}

function validateCapabilities(capabilities: unknown, problems: ManifestProblem[]): void {
  if (capabilities === undefined) return;

  if (typeof capabilities !== "object" || capabilities === null || Array.isArray(capabilities)) {
    problems.push(
      err("capabilities", 'Must be an object of capability id to "required" | "optional" — a bare list cannot say whether the node works without one.'),
    );
    return;
  }

  for (const [id, requirement] of Object.entries(capabilities as Record<string, unknown>)) {
    if (!REQUIREMENTS.includes(requirement as string)) {
      problems.push(err(`capabilities.${id}`, `Must be "required" or "optional".`));
    }
  }
}

/**
 * Check a node against the runtimes a host executes on, and their versions.
 *
 * Two failures live here, and both are errors because the node genuinely
 * cannot run: a runtime the package does not implement at all, and a runtime
 * it implements against an engine newer than the host's.
 *
 * `engineVersions` is optional — pass what the host knows. An unchecked range
 * is reported as a warning rather than passed over silently, because "we did
 * not check" and "it is fine" must not look the same.
 */
export function checkRuntimeSupport(
  manifest: Pick<NodePackageManifest, "kind" | "runtimes">,
  hostRuntimes: readonly string[],
  engineVersions?: Readonly<Record<string, string>>,
): ManifestProblem[] {
  const runtimes = manifest.runtimes ?? {};
  const provided = Object.keys(runtimes);
  const problems: ManifestProblem[] = [];

  const missing = hostRuntimes.filter((r) => !provided.includes(r));
  if (missing.length > 0) {
    problems.push(
      err(
        "runtimes",
        `${manifest.kind} implements ${provided.join(", ") || "no runtime"} but this project executes on ${missing.join(", ")}. The node would install, appear in the palette, and then fail to run.`,
      ),
    );
  }

  for (const runtime of hostRuntimes) {
    const spec = (runtimes as Record<string, NodeRuntimeSpec | undefined>)[runtime];
    if (!spec) continue;

    const hostVersion = engineVersions?.[runtime];
    if (hostVersion === undefined) {
      problems.push(
        warn(`runtimes.${runtime}.engine`, `${manifest.kind} needs ${runtime} engine ${spec.engine}; this host did not report its ${runtime} version, so the range was not checked.`),
      );
      continue;
    }

    if (!satisfiesRange(hostVersion, spec.engine)) {
      problems.push(
        err(`runtimes.${runtime}.engine`, `${manifest.kind} needs ${runtime} engine ${spec.engine}, but this host runs ${hostVersion}.`),
      );
    }
  }

  return problems;
}

/**
 * Minimal semver range check — `^x.y.z`, `~x.y.z`, `>=x.y.z`, `x.y.z`, `*`.
 *
 * Deliberately small: this runs in the CLI and in CI, and pulling a semver
 * library into the engine for one comparison is not worth the dependency. It
 * covers the forms a manifest actually uses; anything it cannot parse is
 * treated as unsatisfied rather than silently passed, so an unparseable range
 * fails loudly instead of waving a node through.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed === "") return true;

  const v = parseVersion(version);
  if (!v) return false;

  for (const clause of trimmed.split("||").map((c) => c.trim())) {
    if (satisfiesClause(v, clause)) return true;
  }
  return false;
}

function satisfiesClause(v: [number, number, number], clause: string): boolean {
  const m = /^(\^|~|>=|>|<=|<|=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(clause);
  if (!m) return false;

  const op = m[1] ?? "=";
  const target: [number, number, number] = [Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)];
  const cmp = compare(v, target);

  switch (op) {
    case ">=":
      return cmp >= 0;
    case ">":
      return cmp > 0;
    case "<=":
      return cmp <= 0;
    case "<":
      return cmp < 0;
    case "=":
      return cmp === 0;
    case "~":
      // Same major+minor, patch may rise.
      return cmp >= 0 && v[0] === target[0] && v[1] === target[1];
    case "^":
      // Below 1.0.0 a minor bump is breaking, so ^0.5 means 0.5.x — which is
      // the range every pre-1.0 package in this suite actually needs.
      if (target[0] === 0) return cmp >= 0 && v[0] === 0 && v[1] === target[1];
      return cmp >= 0 && v[0] === target[0];
    default:
      return false;
  }
}

function parseVersion(version: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Check that every capability a node needs is wired.
 *
 * A `required` capability that is missing is an ERROR — that is the whole point
 * of the requirement level. It is meant to be surfaced at author time, so an
 * editor can grey the node and name what the host never registered, rather than
 * the node installing cleanly and silently no-opping during a run.
 *
 * An `optional` one is a warning: the node still works, with less.
 */
export function checkCapabilities(
  manifest: Pick<NodePackageManifest, "kind" | "capabilities">,
  available: Readonly<Record<string, boolean>>,
): ManifestProblem[] {
  const needed = manifest.capabilities ?? {};
  const problems: ManifestProblem[] = [];

  for (const [id, requirement] of Object.entries(needed)) {
    if (available[id] === true) continue;

    problems.push(
      requirement === "required"
        ? err("capabilities", `${manifest.kind} requires the ${id} capability, which this host has not registered. The node cannot run here.`)
        : warn("capabilities", `${manifest.kind} can use the ${id} capability, which this host has not registered. The node runs with reduced behaviour.`),
    );
  }

  return problems;
}
