# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0:** breaking changes land in MINOR releases. Until 1.0 the minor
> number is not a compatibility promise — read the entry, not the version. Every
> breaking change below is paired with what a consumer actually has to DO, and
> in most cases the answer is "nothing".

## [Unreleased]

## [0.15.1] — 2026-07-20

### Fixed

- **A fixture case can state its resolved output ports (`ports`), and both
  runtimes honour it.** Without this the golden-fixture format could not express
  a cross-runtime-safe case for any node whose ports follow config —
  `switch_case`, `llm_router` — which defeats the point of requiring fixtures.

  TS derives config-driven ports by running a JavaScript function. PHP cannot,
  and falls back to the kind's static declaration. So the identical fixture file
  built a **different graph on each runtime**: the fixtures silently stopped
  comparing like with like, which is the exact class of failure they exist to
  catch.

  A case now declares its ports the same way an exported document does (see
  0.10.1, "serialize resolved ports"). Verified by running one fixture file
  through both engines and diffing the verdicts — identical, including which
  cases failed and why.

  **What to do:** nothing for a node with static ports. Add `"ports": [...]` to
  cases for a node whose ports follow config.

## [0.15.0] — 2026-07-20

### Added

- **The human-pause contract is now public and typed.** A run waiting for a
  person travels the same channel as a failure — the executor aborts, the runner
  reads `result.error` — and until now the difference was two `str_starts_with`
  checks in the Laravel run job against constants owned by two *builtin*
  executors. A third-party human-input node had no way in, and nothing stopped a
  refactor from removing the mechanism out from under published packages.
  Reported by the MOIC Suite consumer, who needed exactly that seam and had to
  reach for a private constant to get it.

  ```ts
  import { pauseForHuman, decodePause } from "@particle-academy/fancy-flow/engine";

  if (values === undefined) pauseForHuman(ctx, "input", { fields });  // in the node
  const paused = decodePause(result.error);                           // in the runner
  ```

  `pauseForHuman` / `encodePause` / `decodePause` / `isPause` are exported from
  the main entry **and from `/engine`**, because the code that needs them most is
  a server-side durable runner that must never import React. Verified against the
  build that the engine entry stays React-free.

  `awaiting` is `"approval"` or `"input"` for the builtins but the type is open,
  so a marketplace node can define its own (`"signature"`, `"payment"`). The wire
  format stays a plain string — it survives the existing abort path unchanged,
  crosses a queue boundary, and decodes identically in PHP, none of which a
  thrown class would do. The payload is JSON rather than delimited fields because
  a node id may contain a colon.

- **Node package manifest + validator** — the first half of the node marketplace
  ([#2](https://github.com/Particle-Academy/fancy-flow/issues/2) §2). A node is
  not one artifact: it is a kind definition plus an executor for **each runtime
  the consumer runs**. A package shipping only a TS executor is unusable to
  anyone executing on PHP, and until now that was invisible until a run failed.

  ```jsonc
  {
    "schemaVersion": 1,
    "name": "@acme/fancy-flow-salesforce",
    "kind": "@acme/salesforce_upsert",
    "fancyFlow": ">=0.14.0",
    "runtimes": { "ts": "dist/executor.js", "php": "acme/fancy-flow-salesforce:^0.1" },
    "capabilities": ["llm"],
    "fixtures": "fixtures/salesforce_upsert.json"
  }
  ```

  `validateNodeManifest` reports **every** problem at once rather than throwing
  on the first — a validator that reveals one error per run turns a five-minute
  fix into five round trips. `checkRuntimeSupport` is the TS-only-package check,
  an **error** because the node genuinely cannot execute; `checkCapabilities` is
  a **warning**, because install is the right time to learn what to wire.

  A bare, un-namespaced `kind` is rejected outright — it is the one mistake that
  cannot be fixed afterwards, since the ambiguous string is already written into
  saved documents. An author-set `verified` flag is rejected too: a package
  cannot vouch for itself.

- **Golden fixtures, and they are required to publish.** Every runtime a package
  claims runs the same language-neutral JSON cases, which is what makes
  cross-runtime parity *verified* rather than asserted.

  Required rather than encouraged because **cross-runtime drift does not fail
  loudly**. A fixture asserts that **the downstream node executed** — not the
  port the node recorded. There is a test demonstrating why: a subject emitting
  on a port with no edge leaves `__port` reading `"c"`, `result.ok` reading
  `true`, and nothing downstream ran. A `__port` assertion is green. A status
  assertion is green. Only reachability catches it — which is precisely how the
  0.9.0 routing divergence reached production.

  `runFixtures` wires a real probe to every declared port and reports which
  probes actually ran; `validateFixtureFile` rejects empty case lists and cases
  that assert nothing, since either satisfies the letter of the requirement and
  none of its purpose.

- **`NodeKindDefinition.pausesForHuman`** — a kind declares that it waits for a
  person, and what for. Readable *without* running the graph, so a host can be
  told it needs a resume path before the first run parks itself forever.
  Declared on `user_input`, `rich_user_input`, and `human_approval`.

  **Nothing breaks:** the pre-contract `awaiting-approval:` / `awaiting-input:`
  prefixes are still decoded, so runs that parked under an older version resume.
  A resume path that only works for new runs would strand every in-flight one.

## [0.14.0] — 2026-07-19

### Changed

- **`llm_branch` is now `llm_router`.** The palette said "LLM Router", the
  persisted id said `llm_branch`, the config key is `routes[]`, and the
  contributed PHP executor labelled it "AI Router" — three vocabularies for one
  node. "Router" wins because the node picks one of N named routes; it is not a
  two-way branch.

  **BREAKING in name only — you almost certainly do nothing.** The canonical id
  is `@particle-academy/llm_router`, and every id the node has ever shipped
  under stays an alias: `llm_branch`, `llm_router`, `@fancy/llm_branch`,
  `@fancy/llm_router`. Saved documents open unchanged, and `llmBranchExecutor`
  is still exported as a deprecated alias of `llmRouterExecutor`. Act only if
  you compared a kind id with `===` against the bare string.

- **No builtin is configured by a raw blob any more.** Reported from the editor:
  the Branch node's entire config was one hand-written expression, and several
  others were raw JSON that the structured field types added in 0.9.0 already
  covered.

  - `branch` — a condition builder (match all/any + a repeater of
    value/operator/comparison rows). The raw expression survives as an explicit
    escape hatch rather than the only way in.
  - `transform` — build the output field by field, or switch to one expression.
  - `http` — header maps become `keyvalue`.
  - `data_store` — the where filter becomes `keyvalue`.
  - `llm_call` — tools become a repeater; only each tool's input schema stays
    `json`, because a JSON Schema *is* json.
  - `subflow` — input mapping becomes `keyvalue`.

  Two `json` fields remain and both are json by nature: a tool's `input_schema`
  and an HTTP request `body`. Stored config is read unchanged — this changes how
  a node is *authored*, not what it persists.

  The rule is enforced rather than tidied once: a test fails if any builtin's
  config consists solely of `json`/`expression` fields, and a second test pins
  the exact list of `json` fields so adding one requires an argument. That test
  caught `transform`, which the report had not mentioned.

## [0.13.0] — 2026-07-19

### Added

- **A Vercel AI SDK adapter, so `llm_router` works out of the box.** 0.12.0 made
  the node a shuttle that holds no provider SDK — correct, but it left every
  consumer hand-writing a client before a core node would run at all.

  ```ts
  import { anthropic } from "@ai-sdk/anthropic";
  import { useVercelAiForLlmBranch } from "@particle-academy/fancy-flow/llm/vercel-ai";

  useVercelAiForLlmBranch({ model: anthropic("claude-sonnet-4-5") });
  ```

  The AI SDK is chosen because it fronts every provider rather than binding core
  to one. Choosing it does not force it — `registerLlmClient()` still takes any
  implementation, so a different SDK or a hand-rolled fetch stays first-class.

  `ai` is an **optional peer**, required only by the `/llm/vercel-ai` subpath.
  Verified against the build that neither the main entry nor the headless engine
  imports it, so a flow that never calls a model pays nothing.

  The adapter constrains the model to the declared ports via the SDK's choice
  output rather than parsing prose, which makes the node's hallucinated-port
  guard a backstop instead of the primary defence. Route *descriptions* are
  folded into the prompt — port ids are terse, and the descriptions are what the
  author wrote to tell them apart.

- `resolveModel` — lets a host turn a node's configured provider/model strings
  into a model instance. Core deliberately never maps a name to a provider.

## [0.12.0] — 2026-07-19

Three related changes, all aimed at keeping opinionated nodes in core without
core inheriting their opinions.

### Added

- **Host capabilities.** `registerLlmClient()` and `registerWorkflowResolver()`
  join the existing document adapter: core declares the CONTRACT, the host
  supplies the implementation. `capabilityStatus()` reports what is wired, so a
  host can answer "what does this graph need that I haven't supplied?" *before* a
  run fails halfway through.

- **`@particle-academy/subflow` — run another workflow and bring its result
  home.** Core rather than marketplace: it runs a child graph through this same
  engine and needs nothing external beyond knowing where workflows live.

  Three modes, because both halves are genuinely useful — `output` delivers the
  child's outputs when it finishes, `stream` forwards progress live so a parent
  can show something other than a spinner, and `both` does each. The `stream`
  port exists only when something streams; ports follow config. Child progress
  arrives on the parent feed as tagged log lines rather than re-emitted child
  events, and recursion is guarded by depth with the offending reference *named*
  instead of a stack overflow.

### Changed

- **`llm_branch` is a shuttle, not an engine.** It carries the declared routes
  and the prompt out to whatever client the host registered, and carries the
  chosen port back. No provider SDK, no prompt engineering, no response parsing,
  no retry policy — those belong to the host's client. That is what lets a
  commonly-needed node live in core without every consumer inheriting an LLM
  dependency, and **a test asserts core declares no provider package**, so it
  cannot quietly drift back into being an engine.

  The one thing it does own is graph integrity, because that is a workflow
  concern rather than an AI one: **a port the model invents must never route.**
  An unrecognised choice goes to `fallback` (or the first declared route when
  that switch is off) and always logs a warning. Emitting on a port with no edge
  silently ends the branch, and the run then reports success having done nothing
  — the worst failure mode an engine can have. The chosen route's *reason*
  travels with the value (`{route, reason, input}`), so a completed run explains
  itself without replaying the call.

  Both design points are credited to the gap report in
  [#2](https://github.com/Particle-Academy/fancy-flow/issues/2).

- **Canonical kind ids moved from `@fancy/*` to `@particle-academy/*.`** 0.11.0
  shipped the short scope; an id that looks like an npm scope should be one we
  actually own.

  **You do nothing.** Every `@fancy/*` id shipped in 0.11.0 is retained as an
  alias, alongside the original bare names. Documents saved against 0.11.0 keep
  opening, and import canonicalises so they converge on re-save.

## [0.11.0] — 2026-07-19

### Added

- **Namespaced kind ids with alias resolution.** Groundwork for the node
  marketplace ([#2](https://github.com/Particle-Academy/fancy-flow/issues/2)),
  and worth doing regardless of whether one ever ships.

  `kind` is a bare string and it is persisted inside every saved document. The
  moment two packages both ship a node called `llm_branch`, stored graphs become
  ambiguous — and it is unfixable after the fact, because the ambiguous string is
  already written into the document. Cheap now, impossible later.

  Resolution accepts either form:
  - `resolveKindId(id)` maps any id to its canonical one
  - `getNodeKind()` takes a canonical id or an alias
  - `kindIds(kind)` lists every id a kind answers to
  - import canonicalises, so a document converges on the canonical id the next
    time it is saved rather than carrying the ambiguous name forever

  **BREAKING, but every builtin keeps its bare name as an alias — so unless you
  compared a kind id with `===`, do nothing.** Two places would otherwise have
  broken *silently*, which is the whole hazard of a rename, and both are handled:

  - `buildNodeTypes()` keys the xyflow map on aliases too. xyflow resolves a
    renderer from `node.type` *before* `RegistryNode` can resolve an alias, so a
    graph carrying pre-namespace types would have fallen through to the
    unknown-node placeholder.
  - `pickExecutor()` tries every id the kind answers to. A host that bound
    `executors["switch_case"]` would otherwise stop matching once `node.type`
    became namespaced — the node simply stops running, with no error. A rename
    must not break bindings.

## [0.10.1] — 2026-07-19

### Fixed

- **Resolved ports are serialized, so other runtimes route identically.** A kind
  may derive its ports from config (`switch_case`'s `cases`, `llm_branch`'s
  `routes`), and that derivation is a JavaScript function. The exported document
  carried only `{id, kind, position, label, description, config}` — no ports —
  so a runtime in another language could not reproduce them.

  Before 0.9.0 this was harmless: the TS runtime also read only `data.outputs`
  (absent after import) and fell back to `out`, exactly as the PHP twin did.
  Both were equally wrong and therefore agreed. **0.9.0 fixed routing on Node and
  silently broke the cross-runtime guarantee** — the same JSON routed one way on
  Node and collapsed to a single `out` on PHP, dropping every branch edge, with a
  `completed` status and no error.

  Export now writes the resolved `inputs`/`outputs` onto each schema node, and
  import carries them back, so a round-trip is stable and an unknown kind still
  routes the way the document described.

  **What to do:** both fields are optional and additive, so hand-written schemas
  keep working. **Re-export any flow saved between 0.9.0 and 0.10.1** — those
  recorded no ports and rely on the consuming runtime's registry fallback rather
  than the document (fancy-flow-php 0.4.2 adds that fallback).

  Found while auditing whether a consumer running the TS editor against PHP
  executors was affected. They were.

## [0.10.0] — 2026-07-19

### Changed

- **`rich_user_input` builds on fancy-cms instead of a host-wired adapter.**
  0.9.0 shipped it with a generic adapter the host had to wire with its own
  renderer and editor. That was the wrong call: the page a rich input step shows
  *is* a fancy-cms page, so making every consumer supply glue guaranteed both
  duplicated wiring and a document model that would drift from the CMS.

  fancy-flow now defines **no** document schema. The doc is fancy-cms's
  `PageDoc`, rendered by its `CmsPage`, authored by its `Editor`.

  **What to do:** if you wired the 0.9.0 document adapter, switch to the opt-in
  entry — `import "@particle-academy/fancy-flow/rich-input";` — and drop your
  glue. `fancy-cms-ui` and `react-fancy` are **optional peers**, required only by
  that subpath. Verified against the built output that no other entry imports
  either package and both are external there, so a flow with no rich input pays
  nothing for a CMS.

### Added

- `useFancyCmsForRichInput({ registry, data })` for a custom element registry.
- `isPageDoc()`, so a stray config value can't reach the renderer.

### Fixed

- The rich-input preview frames the page at width 1280 + scale `fit`, so it
  renders at a real desktop width and scales down instead of reflowing into a
  card-sized viewport.

## [0.9.0] — 2026-07-19

Driven by a consumer gap report (MOIC Suite) plus editor asks.

### Added

- **Structured config fields — stop forcing raw JSON for structured config.**
  - `repeater` — a list of objects, each row authored with its own sub-schema
    (add/remove/reorder, per-row validation that names the offending row).
  - `keyvalue` — an editable string map, optionally constrained by
    `valueOptions`.
  - `document` — an opaque rich document edited by a host-supplied editor,
    mirroring how credential fields already work.
  - `text` fields accept `choices` and render as a select when present, so a kind
    can gain fixed options without changing type or migrating stored config. A
    stored value outside the list is preserved, not silently dropped.

  The builtins that had the disease now use them: `user_input.fields` was a
  hand-written JSON blob, `switch_case.cases` likewise.

- `rich_user_input`, and an edge surface for the editor.

### Fixed

- **Ports may now be a function of config (`PortSpec`), fixing a real
  divergence.** The canvas resolved ports via `data.outputs ?? kind.outputs`; the
  runtime read `data.outputs` ONLY and fell back to a lone `out`. A kind
  declaring branch ports therefore DREW correctly and then routed as if it had
  one output, unless the host hand-mirrored ports onto every node's data. Both
  paths now go through `resolveNodePorts`, so drawn ports and activated ports
  cannot drift.

  See 0.10.1 — this fix corrected Node and simultaneously opened a cross-runtime
  gap for hosts executing on another engine.

## [0.8.0] — 2026-07-18

### Fixed

- **Stop declaring bundled `@xyflow/react` as a runtime dependency.** Closes
  [fancy-screens#1](https://github.com/Particle-Academy/fancy-screens/issues/1).

  tsup bundles `@xyflow/react` (and `clsx`) into dist via `noExternal` —
  verified: no dist file imports them, the code is inlined, and the emitted
  `.d.ts` has zero references. But `package.json` still listed them under
  `dependencies`, so every consumer installed `@xyflow/react` anyway, and with it
  `zustand@4`. That transitively collided with `@particle-academy/fancy-screens`,
  which peers `zustand ^5`, making the two **impossible to install together**
  (ERESOLVE). Nobody could use the flow editor and the screen registry in one app.

  **What to do:** nothing — no API changed. Consumers get a smaller tree, no
  phantom xyflow, and no zustand at all from us. Minor bump because the install
  graph changes even though the API doesn't. If you imported `@xyflow/react`
  yourself relying on our transitive copy, declare it directly.

## [0.7.0] — 2026-07-18

### Added

- Right-click a node for Delete / Duplicate.

## [0.6.0] — 2026-07-18

### Added

- A node delete surface, and extension points to make the editor extensible.

## [0.5.4] — 2026-07-18

### Added

- Documentation for the headless `/engine` entry — the editor is not required to
  run a flow.

## [0.5.3] — 2026-06-23

### Fixed

- **Decision merge points** — run a node when ANY incoming edge is active
  ([#1](https://github.com/Particle-Academy/fancy-flow/issues/1)). Execution
  previously halted after the first branch completed.

## [0.5.2] — 2026-06-12

### Changed

- Release plumbing — verified tokenless OIDC publishing.

## [0.5.1] — 2026-06-05

### Added

- `FlowRunnerUx` effects can drive flow control (decision sugar passthrough).

## [0.5.0] — 2026-06-04

### Added

- `FlowRunnerUx` — the flow-driven UX bridge, on the `/ux` subpath.

## [0.4.1] — 2026-06-04

### Fixed

- Bundle xyflow base CSS and enable Shift-to-zoom — fixes a blank canvas.

## [0.4.0] — 2026-06-04

### Added

- A React-free `/engine` subpath for headless flow execution.

## [0.3.1] — 2026-05-28

### Fixed

- Redirect the bundled `use-sync-external-store` CJS shim to an ESM polyfill.

## [0.3.0] — 2026-05-19

### Changed

- Bundle react-flow and hide it behind `defineNode` + `<NodePort>`.

## [0.2.2] — 2026-05-09

### Fixed

- Omit xyflow's number-only `height` prop so `FlowCanvas` can take string
  heights.

[Unreleased]: https://github.com/Particle-Academy/fancy-flow/compare/v0.15.1...HEAD
[0.15.1]: https://github.com/Particle-Academy/fancy-flow/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/Particle-Academy/fancy-flow/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.5.4...v0.6.0
[0.5.4]: https://github.com/Particle-Academy/fancy-flow/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/Particle-Academy/fancy-flow/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/Particle-Academy/fancy-flow/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/Particle-Academy/fancy-flow/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/Particle-Academy/fancy-flow/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/Particle-Academy/fancy-flow/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/Particle-Academy/fancy-flow/releases/tag/v0.2.2
