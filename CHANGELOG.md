# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0:** breaking changes land in MINOR releases. Until 1.0 the minor
> number is not a compatibility promise — read the entry, not the version. Every
> breaking change below is paired with what a consumer actually has to DO, and
> in most cases the answer is "nothing".

## [Unreleased]

## [0.41.0] — 2026-08-11

### Added

- **`/fields/react-fancy` — a real JSON editor for `type: "json"` config
  fields.** The built-in is a bare textarea; react-fancy ships a typed key/value
  editor and the panel had no way to use it.

  ```tsx
  import { reactFancyFieldRenderers } from "@particle-academy/fancy-flow/fields/react-fancy";

  <FlowEditor value={graph} onChange={setGraph} fieldRenderers={reactFancyFieldRenderers} />
  ```

  An opt-in subpath rather than a change to the panel, for the reason
  `panel-labels.test.tsx` already records: fancy-flow themes through a `--ff-*`
  token layer a host overrides on `.ff-editor`, while react-fancy's primitives
  are hardcoded Tailwind classes that read no custom properties. Building them
  in would trade the theming contract for a nicer widget. react-fancy stays an
  **optional** peer — a standalone install pays nothing.

  It claims **only** `json`, so handing the whole map over does not quietly
  replace controls it has no business replacing. Spread it to add your own:
  `{ ...reactFancyFieldRenderers, "trigger-filters": mine }`.

- **`fieldRenderers` on `FlowEditor`.** The seam existed on `NodeConfigPanel`
  and had no route through the editor, so the only ways to supply one were to
  abandon `FlowEditor` and compose an editor by hand, or replace the whole panel
  via `slots.panel`. It was real, correct, unit-tested and connected to nothing.

- **`keyMap` on a `json` config field** — declared types per path, as a JSON
  string (`{"retries":"integer"}`). Consumed by the editor above to pick a
  control per value and report contradictions; ignored by the built-in textarea,
  which has nowhere to put it. A string, not an object, so a kind definition
  still survives an MCP round-trip.

### Fixed

- **A `json` field silently discarded invalid input.** It parsed on blur and the
  `catch` block was empty but for a comment claiming the visual would revert. It
  could not: the textarea was uncontrolled, so the broken text stayed on screen
  while the config kept its previous value. The panel showed one document, the
  node ran another, and nothing anywhere said so — a missing comma reverted an
  edit invisibly, in exactly the two places a stray character is most likely
  (`api_request` bodies, `llm_call` input schemas).

  The parse error is now reported under the field (`role="alert"`,
  `aria-invalid`), the author's text stays put to be corrected, and unparseable
  text is still never written to config. Refusing to store garbage was right;
  doing it silently was not.

  **Consumers do nothing.** Valid JSON behaves exactly as before.

- **A `json` field carried no `id` or `data-ff-field`.** It was the one built-in
  the labelling pass missed, so the panel's `<label>` pointed at nothing and
  agents had no handle for it.

- **`repeater` and `keyvalue` had dangling labels.** Their containers never
  received the `id` the panel's `<label htmlFor>` was pointing at, so clicking
  the label focused nothing and a screen reader announced them unnamed. They now
  carry that `id`, `role="group"` and a `data-ff-field` handle. A `htmlFor`
  pointing at an id that does not exist is worse than no label — it reads as
  done.


## [0.40.4] — 2026-08-11

### Fixed

- **The canvas ran React Flow in LIGHT mode on a dark page.** `colorMode` was
  passed straight through, so a host that did not supply one got React Flow's
  own default — light — no matter what the surrounding app was doing.

  Our `ff-` styles still looked right, which is exactly what hid it: they hang
  off an ancestor `.dark`, so the nodes we style were fine while React Flow's
  layer underneath stayed light. Any node kind **without a registered type**
  falls back to React Flow's default node — a white box with unreadable text on
  a dark canvas — and edges, handles, the selection rectangle and the controls
  were light too. Observed on the live showcase: `.react-flow` carried the class
  `light` while `<html>` was `dark`.

  An unset `colorMode` now means **follow the app**: `data-theme`, then a
  `.dark` class, then the OS preference. `"system"` resolves the same way.
  Passing `"light"` or `"dark"` explicitly still wins — a canvas deliberately
  pinned against the page is a real use and is unaffected.

  It also **reacts** to a theme toggle. Flipping the theme changes an attribute
  on `<html>`, which triggers no React render by itself, so a one-shot read
  would have been right on load and wrong the instant anyone used the switch.

- **The dark token block never matched the canvas's own `dark` class.** The
  selector was descendant-only (`.dark :is(.ff-canvas)`), while `FlowCanvas`
  puts `dark` on its own root — so the class the component sets on itself, and
  which a comment there claims drives these tokens, did nothing. The selector
  now matches both.

  **What you must do:** nothing. A host on a dark page gets a dark canvas
  without wiring anything; one that already passed `colorMode` is unchanged.

## 0.40.3 — 2026-08-09

### Fixed

- **The Live Contract parity test never ran in CI.** It compares `flowLive`
  against `FancyFlow\Laravel\LiveContract`, reading the PHP source — from a
  hard-coded `../../fancy-flow-php/`, which resolves only inside the `.agi`
  envelope. In CI the repo is not checked out, so every assertion returned early
  and passed having compared nothing.

  Now: CI checks out `fancy-flow-php`, the path comes from `FLOW_PHP_SRC`
  (sibling as fallback), and a missing twin **throws in CI**. Locally a skip is
  still right.

  Verified in three states: correct path passes all 8, a bad path under `CI=1`
  fails 3, and a bad path without `CI` still skips.

## 0.40.2 — 2026-08-09

### Added

- Six cases to the `satisfiesRange` table. Two pin places where this convention
  **deliberately differs from standard semver**: `1.2.3-beta.1` satisfies `^1.2`
  here and not under npm's `semver`, and `^0.0.1` admits `0.0.2` where standard
  semver pins it exactly.

  `satisfiesRange` has three implementations (`fancy-ui-cli`, this package,
  `fancy-flow-php`) and — unusually for the suite — has never drifted, because
  each carries the same case table in its own CI. I ran all three against a
  shared case set to check that rather than assume it, and they agree on every
  case including these.

  The gap they close is a future one: a fourth implementation reaching for a
  stock semver library would disagree on exactly these two, and nothing said so.

## 0.40.1 — 2026-08-09

### Fixed

- **CI could not run `live-contract.test.ts`**, and had been red since that test
  landed four commits earlier.

  `@tanstack/react-query` is a *required* peer of `@particle-academy/fancy-query`,
  which this repo uses in tests — and CI installs with `--legacy-peer-deps`,
  which skips peer installation entirely. So it resolved locally (where the peer
  was already on disk) and could never resolve on a clean runner.

  Now declared as a direct devDependency, which installs regardless of the flag.
  Verified the way it actually fails: deleted the package, ran CI's exact install
  command, and confirmed it comes back.

  The flag itself is left alone — it is there for other reasons, and flipping it
  to fix a missing declaration would trade a known problem for an unknown one.

## 0.40.0 — 2026-08-09

### Added

- **`fieldRenderers` on `NodeConfigPanel` — a generic seam for host-defined
  `ConfigField` types.** (#4)

  ```tsx
  <NodeConfigPanel
    fieldRenderers={{
      "trigger-filters": ({ value, onChange }) => <FilterEditor value={value} onChange={onChange} />,
    }}
  />
  ```

  The panel had hooks for two *specific* types (`renderDocumentField`,
  `renderCredentialField`) and no generic one, so anything richer than the
  built-ins had to be rendered **outside** the panel — that node's config stopped
  living where every other field does. An unknown `type` also fell through to
  `default:` and rendered nothing, so the schema said the field existed and the
  panel showed empty space.

  - Keyed by `field.type`, and consulted **before** the built-in switch, so the
    same seam also replaces a built-in (react-fancy inputs, say) rather than
    needing a second mechanism.
  - Return `null` to fall back to the package's own rendering, so a host can
    claim a type conditionally instead of reimplementing every case.
  - Forwarded into **repeater rows**, so a custom field nested one level down
    renders like any other.

  `ConfigFieldRenderFn` and `ConfigFieldRenderContext` are exported. The type is
  `…Fn` rather than `ConfigFieldRenderer` because that name is already the
  component this module exports.

## 0.39.0 — 2026-08-07

### Added

- **`flowLive` — this package's Live Contract**, plus `flowKeys` for per-run
  query keys. `FancyFlow\Laravel\LiveContract` declares the identical list and
  both sides assert parity.

  `fancy-query` is a **type-only** import, so this adds no dependency.

  **It covers a run's durable state, not per-node chatter.** `NodeStatusChanged`
  and `NodeOutput` fire per node, many times a second on a wide graph — a log
  line is a stream, not a cache entry. In the contract, a 40-node run would
  invalidate the run list forty times while executing, each a re-fetch telling
  the UI nothing the stream had not already delivered. Use `useFancyStream` for
  that half.

  `flow.run.awaiting` gets its own event rather than folding into `updated`: a
  run parking on a human step is the moment a form has to appear in front of
  somebody, and a host should be able to subscribe to just that.

  **Broadcast status, stated plainly:** `fancy-flow-php` dispatches these as
  in-process Laravel events; none implements `ShouldBroadcast` yet. The contract
  is the agreed vocabulary, so a host wanting live runs today re-broadcasts
  under these names. Making them broadcast natively is a separate change,
  because it turns on websocket traffic for every consumer.

  **What you must do:** nothing. Additive.


## 0.38.0 — 2026-08-07

### Changed

- **BREAKING — Node 22 is now declared as the floor.** `engines.node` is `>=22`, where this package previously declared **nothing at all**.

  Declaring nothing was not the same as supporting old Node: a consumer on 18 installed cleanly and found out at runtime.

  **What you must do:** on Node 22 or newer, nothing. Note npm only *warns* on an `engines` mismatch while **pnpm fails the install**, so this surfaces differently depending on your package manager. Node 18 is end-of-life and 20 is maintenance-only.

- **BREAKING — React 18 is no longer supported.** `peerDependencies.react` / `react-dom` are now `^19.0.0`.

  **What you must do:** on React 19, nothing. On React 18, stay on the previous release, or upgrade your app to 19 first.

  React 18 support was a claim nothing tested — every build and test in this package ran against 19, so the 18 half of the old range was never executed. An untested compatibility claim is worse than an absent one, because it reads as support.

### Why

These are the kit 0.5 platform floors, applied across every package at once so a consumer never has to resolve a mix. **No API changed, nothing was removed, nothing was renamed** — only what the package requires.


## 0.37.0 — 2026-08-02

### Added

- **`fancy-flow/screens` — `registerFlowSchema()`**, so an agent-emitted
  `ScreenSchema` can place a workflow in a page:

  ```json
  { "type": "FlowViewer", "props": { "graph": { "nodes": [], "edges": [] } } }
  ```

  Mirrors `fancy-artboard/screens` exactly: a separate entry that is the only
  module importing `@particle-academy/fancy-screens`, declared as an **optional**
  peer and marked external, so the base `.` import graph is untouched and an app
  that never uses fancy-screens never pays for it. The built entry is 604 bytes.

  **Only the VIEWER is registered, deliberately.** A schema is JSON, and
  `FlowEditor` needs executors, run handlers and controlled state that JSON props
  cannot express — registering it would let an agent emit an editor that renders
  and does nothing, which is worse than not offering it at all. `FlowViewer` is
  complete from props alone, which is exactly what makes it schema-safe.

  **What you must DO: nothing** unless you want it. `registerFlowSchema()` is an
  explicit call at host startup, like every other screens adapter.

## 0.36.0 — 2026-08-02

### Added

- **`<FlowViewer>` — a workflow, read-only.** There was no way to *show* a flow.
  `FlowEditor` is the whole editor, and `FlowCanvas` is the canvas — neither had
  a `readOnly` prop. A consumer could assemble a viewer out of `FlowCanvas` plus
  four React Flow flags they had to know to pass, but nothing named that,
  nothing documented it, and nothing stopped the next person handing a graph to
  `FlowEditor` and shipping a fully editable canvas where they wanted a picture.

  Read-only **by construction**: there is no prop that makes it editable, because
  a viewer that can be switched into an editor is one that eventually gets
  switched by accident. Verified behaviourally, not by class name — a drag moves
  nothing and a handle-to-handle drag creates no edge and no connection line.

  ```tsx
  <FlowViewer graph={graph} />                       // canvas
  <FlowViewer graph={graph} variant="list" />        // rows
  <FlowViewer graph={graph} statuses={{ n3: "running" }} />
  ```

  `variant="list"` is the other half of the gap: nothing could render a flow
  **without** a canvas — for a docs page, a narrow column, print, or an audit
  view, where pan-zoom is the wrong shape and often unusable. `statuses` lets
  the same component serve "here is the workflow" and "here is what happened".

- **`overrideNodeKind(name, patch)` — rename a node you did not author.** The
  palette rendered `kind.label` and `kind.description` straight from the
  registry, and the only way to change either was `registerNodeKind`, which
  **replaces the whole definition**. Relabelling `http_request` meant
  re-declaring its config schema, ports, executor and renderer — internals a
  consumer does not own — and silently forfeiting whatever the builtin gained in
  the next release. In practice nobody renamed a node, and the palette could not
  be localised at all.

  ```ts
  const undo = overrideNodeKind("@particle-academy/http_request", {
    label: "Call an API",
    description: "Fetch or post JSON to a URL",
  });
  ```

  Patchable: `label`, `description`, `icon`, `accent`, `category`. Everything
  behavioural is excluded on purpose — an override that could reach `executor`
  or `outputs` is a fork wearing a friendly name, and would desync the graph
  from the runtime that executes it.

  Overrides are stored **separately from the definition**, so they survive the
  base kind being re-registered by HMR, a later `registerBuiltinKinds()`, or a
  package upgrade. They apply at `getNodeKind()` and `listNodeKinds()`, so one
  call reaches the palette, the canvas node cards and `FlowViewer` — and they
  apply *before* category filtering, so re-categorising a node actually moves it
  in the palette instead of leaving it filed under the old heading with a new
  name.

  **What you must DO: nothing.** Both are purely additive.

## [0.35.0] - 2026-07-31

### Added

- **`NodeKindDefinition.sideEffects`** — declare whether a node of this kind is
  safe to run twice (`none` / `idempotent` / `unsafe-to-replay`), the same three
  values a marketplace manifest already carries.

  **No action needed** — optional and additive; every existing kind is unchanged.

  Closing a twin drift, not adding a feature. `fancy-flow-php` 0.10 had to lift
  this onto its own `NodeKind` because its per-node queue driver keys retry
  policy on it: an `unsafe-to-replay` node gets exactly one attempt whatever
  `tries` says, since a retried `git_pr_open` opens a second pull request. The
  field existed only inside manifest validation, which is install-time data a
  durable runner cannot consult mid-run.

  The twins declare the same kind metadata or they are not twins. This is
  declaration only: the in-process TS runner does not retry, so nothing here
  enforces it — a host's runner decides what to do with it.


## [0.34.0] — 2026-07-28

### Changed

- **`useFancyCmsForRichInput` is now `registerFancyCmsForRichInput`.** The `use`
  prefix was wrong: it registers a document engine and returns a dispose
  function — it is not a React hook and calls none. React reserves `use*` for
  hooks, so the name made `react-hooks/rules-of-hooks` report the module-scope
  call on import as a hook outside a component, and told any reader that hook
  rules applied to it.

  **No action needed.** The old name is still exported as a `@deprecated` alias
  and will not be removed in 0.x.

### Changed

- Widened the `@particle-academy/fancy-auto-common` requirement from `^0.1.0` to `>=0.1 <2.0`, so a
  sibling minor release is an upgrade and not a resolver conflict. **No action
  needed** — widening a range only adds candidates; the version you have today
  still resolves.

  A caret on a `0.x` range locks the MINOR, so this pinned a sibling at
  whatever it happened to be on the day it was written, and each sibling
  release then read as a conflict to the resolver rather than an upgrade.
  Nothing here was using an API the newer minors removed — the range was the
  whole problem.

## [0.33.3] — 2026-07-27

### Security

- **A marketplace manifest could hang whatever validated it** (ReDoS, CWE-1333,
  CodeQL `js/polynomial-redos`). The pattern `validateNodeManifest()` uses to
  reject version pins in `fancyDependencies[].package` / `.npm` / `.composer`
  was `(?:@|:)\s*[\^~>=<]*\s*\d`. The operator class can match nothing, so a run
  of *n* spaces could be divided between the two `\s*` in *n+1* ways — and with
  no digit following, the engine tried every one of them. Cost was **O(n²)**:
  a dependency declaring `npm: "@" + " ".repeat(200000)` took **30 seconds**,
  synchronously, on the thread that called it.

  That input is reachable by design. A manifest is third-party data — read off a
  marketplace package or a registry response — and `validateNodeManifest()`
  exists precisely to be pointed at strings nobody in this repo wrote. Anything
  validating submitted nodes (a registry, CI, the CLI, an MCP server) could be
  stalled by one field.

  **You have to do nothing.** The pattern was rewritten to
  `(?:@|:)\s*(?:[\^~>=<]+\s*)?\d`, which matches **exactly** the same strings —
  reaching the second whitespace run only *through* a non-empty operator run
  removes the ambiguity without narrowing the language. Verified exhaustively
  over every string up to length 4 in the relevant alphabet plus 400k longer
  random ones: zero divergence. Every pin that was rejected before is still
  rejected, and the `@scope/` prefix is still not mistaken for a version. The
  same 200k-character input now validates in under a millisecond.

  No length cap was added. Truncating input would have changed which manifests
  validate in order to hide a pattern that was still quadratic.

## [0.33.2] — 2026-07-27

### Fixed

- **Selecting a node blanked the editor** (React error #310, *"rendered more
  hooks than during the previous render"*). `<NodeConfigPanel>` called its two
  `useMemo`s **after** the `if (!node)` early return, so it ran no hooks with
  nothing selected and several with a node — a rules-of-hooks violation.

  **Upgrade from 0.33.1 immediately if you took it.** That release added a third
  hook, which is what tipped the latent violation into a crash on every node
  selection. Every hook now runs before every early return.

  Two regression tests cover the transitions that break it: no-selection → node
  → no-selection, and a node whose kind was never registered → a registered one.


## [0.33.1] — 2026-07-27

### Fixed

- **Every control in `<NodeConfigPanel>` was unlabelled and unaddressable.** The
  editor's source contained **zero `htmlFor`, zero control `id`s and zero
  `aria-label`s** — labels sat beside their inputs without being attached to
  them. Clicking a label focused nothing, and a screen reader announced the
  package's primary authoring surface as a column of unlabelled boxes.

  It also failed the suite's own **Human+ contract**, which asks that every
  interactive element carry a stable identity so an agent targets it instead of
  guessing at the DOM.

  Each control now carries an `id` its `<label htmlFor>` points at, plus a
  `data-ff-field` handle **keyed by the field** — so it survives a reordered
  schema, and an agent that stored a handle keeps writing to the same input.
  Ids are per-panel-instance, so two panels on one page cannot steal each
  other's label clicks.

  **Nothing to do.** No prop changed and no markup moved; controls gained
  attributes.

  `ConfigFieldRenderer` takes an optional `id`, supplied by the caller rather
  than generated internally so the panel's label can point at it. A custom
  `renderPanel` is unaffected.

- **`vitest.config.ts` collected only `.test.ts`, never `.test.tsx`** — so not
  one of the package's 21 React components *could* have a rendering test. A file
  testing a component would have been collected by nothing and counted as
  passing by omission. That is how the above shipped: nothing in the repo could
  see rendered output. `.tsx` is now included, and the 12 new tests fail against
  the previous code.

### Notes

These were **not** converted to react-fancy inputs, and the reason is worth
recording. fancy-flow themes itself through the `--ff-*` token layer a host
overrides on `.ff-editor`; react-fancy's primitives are hardcoded Tailwind
palette classes that read no custom properties, so a `<Button>` inside
`.ff-editor` would ignore `--ff-accent`. Converting would have broken a
documented theming contract, and forced react-fancy plus Tailwind on every
editor consumer, to fix a labelling bug. Hosts that *want* react-fancy controls
already have `renderPanel`.

## [0.33.0] — 2026-07-26

### Added

- **Node manifests can declare `fancyDependencies`** — the Fancy suite packages a
  node's source imports, so `fancy-cli` can tell a consumer what a node needs and
  offer the routes that actually exist.

  Kept separate from a plain npm dependency because the suite is polyglot and
  vendorable: the same capability ships on npm, on Composer, and as source you
  copy in. A bare `dependencies: ["@particle-academy/fancy-screens"]` can only
  ever produce `npm install`, which is the wrong answer in a Laravel app whose
  editor is vendored.

  ```json
  "fancyDependencies": [
    {
      "package": "fancy-screens",
      "npm": "@particle-academy/fancy-screens",
      "reason": "renders the generated schema",
      "requirement": "required"
    }
  ]
  ```

  **Nothing here carries a version, and the validator rejects one** — in the
  name (`…/fancy-screens@^0.4`), in a `composer` entry (`…:^0.9`), or as a
  `version` key. The suite ships additively and often, so a node that pinned at
  authoring time would be holding a project back a year later for a constraint
  nobody revisits. Compatibility stays in `runtimes[].engine`, where it is
  checked against the thing a node actually depends on.

  Additive: the field is optional, and every existing manifest keeps validating
  unchanged. **Nothing to do** unless you are publishing a node that imports a
  suite package.

## [0.32.0] — 2026-07-26

### Changed

- **BREAKING (node manifests): a runtime declares `files`, not `entry` /
  `package`.** Marketplace nodes are **vendored**, not installed —
  `fancy-cli add node` copies a node's source into the project the way it copies
  a component's, so it lands in the app readable, editable and diffable rather
  than hidden in `node_modules` or `vendor`. `entry` and `package` described an
  npm/Composer install that no longer happens, and a manifest carrying them is
  now rejected rather than claiming an install path nothing honours.

  ```jsonc
  "ui": ["ui"],                                    // the React surface, always copied
  "runtimes": {
    "ts":  { "files": ["js"],  "engine": ">=0.30.0" },
    "php": { "files": ["php"], "engine": ">=0.9.0" }
  }
  ```

  `ui` is a new top-level field, deliberately outside `runtimes`: the editor is
  React on **every** host, so a Laravel project needs the React kind and does not
  need the TypeScript executor. Fold the two together and a PHP host either loses
  its palette entry or gains a second implementation of a node it runs once.

  **What you must DO:** nothing unless you authored a node manifest — the
  registry served none before this. If you did, replace each runtime's `entry` /
  `package` with `files`, and move the surface to a top-level `ui`. The PHP twin
  changed in lockstep (`fancy-flow-php` 0.9.1); the two validators must agree or
  a manifest one accepts the other refuses.

## [0.31.0] — 2026-07-26

### Changed

- **BREAKING (feel, not API): the mouse wheel now zooms the canvas by default.**
  It used to scroll the page, with zoom parked on Shift+wheel. That is the wrong
  default for a canvas — every other node editor zooms on wheel, and the old
  behaviour made the canvas feel inert under the one gesture people reach for
  first.

  ```tsx
  <FlowEditor canvasProps={{ zoomOnWheel: false }} />   // back to the old feel
  ```

  With `zoomOnWheel={false}` the bare wheel scrolls the page again and
  **Shift+wheel** zooms — the sensible choice for a canvas embedded mid-page,
  where a reader scrolling past would otherwise get trapped.

  **What you must DO:** nothing, unless your canvas sits inside a scrolling page
  and you want the reader to scroll past it — then pass `zoomOnWheel={false}`.
  No prop was removed, and anything you passed explicitly still wins.

### Fixed

- **A zooming wheel no longer scrolls the page at the same time.** In the old
  Shift+wheel mode `preventScrolling` was `false`, so a zoom gesture zoomed the
  canvas *and* scrolled the page underneath it — the canvas jumped and the page
  moved, which reads as a broken component rather than a wrong setting.

  Both modes now hold the line: with wheel-zoom on, `preventScrolling` does it;
  with it off, a capture-phase handler swallows only the modified gesture, so
  the bare wheel still scrolls the page and Shift+wheel zooms without moving it.
  The three props only make sense as a set, so they are now produced together by
  an exported `wheelZoomProps()` — which is what the tests assert against, since
  mounting a canvas to check them would be testing d3-zoom through jsdom.

## [0.30.0] — 2026-07-26

### Added

- **`/engine` now exports the kind registry, React-free.** A headless consumer
  has to register node kinds and could not: the only door in was
  `@particle-academy/fancy-flow/registry`, whose barrel re-exports the
  `RegistryNode` component — so importing it to call one function dragged React
  into a queue worker, a CLI, or a node package's CI. The first marketplace
  package hit exactly this, failing a clean install with `Cannot find package
  'react'`.

  `registerNodeKind`, `getNodeKind`, `resolveKindId`, `kindIds`,
  `listNodeKinds`, `defaultConfigFor` and `validateConfig` are now available
  from `/engine`, alongside the `NodeKindDefinition` / `ConfigField` types:

  ```ts
  import { registerNodeKind, runFlow } from "@particle-academy/fancy-flow/engine";
  ```

  These are the **same** functions the editor uses — one registry with two doors
  into it, not a headless copy that can drift. A test now asserts against the
  built `dist/engine.js` that no React or `@xyflow/react` import survives
  bundling, because a source-level check would not have caught this either.

  **What you must DO:** nothing. `/registry` is unchanged and every existing
  import keeps working. If you were importing `/registry` from server or CLI
  code purely to register a kind, you can move that import to `/engine` and drop
  React from those dependencies.

## [0.29.1] — 2026-07-26

### Fixed

- **Golden fixtures no longer fail on key order.** `runFixtures` compared
  expected and actual values with `JSON.stringify(a) === JSON.stringify(b)`,
  which treats key **order** as if it were meaning. A node that spreads its
  input before its own fields — `{ ...incoming, applied: true }`, an ordinary
  thing to write — produced a different order than the fixture author wrote, and
  the case failed with a message showing two identical-looking objects. Found
  while writing the first third-party node package against this contract.

  Comparison is now structural: key order is ignored, array order still matters,
  and an `undefined` value still counts as absent (a fixture file can't express
  `undefined`, so that had to stay).

  **What you must DO:** nothing. Fixtures that passed still pass; some that
  failed for no good reason now pass. If you worked around this by hand-ordering
  a fixture's keys to match your executor, you can stop.

## [0.29.0] — 2026-07-25

### Added

- **`runCohort()` — the runs one trigger fires, as a group.** `runFlow` runs one
  graph, so a host that fans a single webhook, schedule, or record change out to
  several flows loops it — and a loop has no answer for the case that actually
  bites: one of those flows deletes or mutates the record they were **all** fired
  for. The rest then run against state that is no longer there and resolve
  `ok: true`, having done nothing. Nothing throws, nothing is logged, and the
  run list says success.

  `runCohort` runs the flows in the order you declared, one at a time, and
  re-checks a `guard` immediately before each — not at dispatch, because the
  whole hazard is what changed in between. A flow whose guard does not pass comes
  back `skipped: true` with a reason instead of running.

  ```ts
  import { runCohort } from "@particle-academy/fancy-flow/engine";

  const results = await runCohort([enrich, archive, notify], executors, undefined, {
    initialInputs: { t: { deal } },
    guard: async () => Boolean(await findDeal(deal.id)),
    reason: () => `deal ${deal.id} no longer exists`,
  });
  ```

  If `archive` deletes the deal, `notify` is skipped with that reason rather than
  notifying about nothing.

  Three policies: `serial-guarded` (default), `serial` (ordered, unguarded), and
  `parallel` (all at once — correct only when the fan-out shares no state). A
  guard that throws **fails closed** and skips: a skip is visible and re-runnable,
  a run over missing state is neither. A flow that *fails* does not cancel the
  cohort — "the flow before me threw" is not an answer to "is my input still
  there", and the guard gets asked either way.

  Exported from the root, `/runtime`, and `/engine`. The Laravel twin is
  `FancyFlow::dispatchCohort()` in `fancy-flow-php` 0.9.0, which is the same
  contract across a queue: same policies, same guard semantics, same fail-closed
  rule, with each run durable and handing on to its successor when it settles.

  **Nothing to do** — `runFlow` is untouched and every existing call keeps its
  exact behaviour. Reach for `runCohort` when a fan-out shares state.

## [0.28.0] — 2026-07-25

### Added

- **`./llm/prism` — a Prism-backed LLM adapter**
  ([#3](https://github.com/Particle-Academy/fancy-flow/issues/3)). Until now the
  only shipped adapter was `./llm/vercel-ai`, which made the Vercel AI SDK the
  de-facto default for anyone wiring up `llm_branch` — awkward in a stack that
  standardises on Prism and already executes LLM nodes through it server-side
  via `fancy-flow-php`.

  Prism is PHP, so there is nothing to import and **no SDK to install**: the
  adapter POSTs the routing question to a route you own, and that route answers
  it with `Prism\Prism`. Provider config, keys, fallbacks and token accounting
  stay in one place.

  ```ts
  import { usePrismForLlmBranch } from "@particle-academy/fancy-flow/llm/prism";

  usePrismForLlmBranch({ endpoint: "/api/flow/llm-route" });
  ```

  The endpoint receives the `LlmRouteRequest` as JSON and answers
  `{ port, reason? }` — the same shape `fancy-flow-php` already models, so **one
  route serves both** the editor's preview runs and server-side execution.
  Sends Laravel's `X-XSRF-TOKEN` and `credentials: "same-origin"` by default,
  since a session-authenticated POST fails on CSRF otherwise.

  It is the lighter of the two adapters: `/llm/vercel-ai` needs `ai` as an
  optional peer, this one needs only `fetch`. Verified in the build — the
  emitted `dist/llm/prism.js` imports nothing but fancy-flow's own chunk.

  A port the endpoint returns that was never declared **throws** rather than
  routing, because emitting on a port with no edge ends the branch silently
  while the run still reports success.

  **Consumers need do nothing** — `/llm/vercel-ai` is unchanged and core still
  imports no provider. Pick whichever adapter matches your stack, or keep using
  `registerLlmClient()` directly.

### Fixed

- **The "no provider SDK in core" guard now guards.** It read only
  `dependencies` and matched only `/openai|anthropic|prism|langchain/`, so it
  could never have caught the Vercel AI SDK (`ai`) and said nothing about
  *where* a provider is imported. It now also requires any provider peer to be
  optional, and asserts every provider import stays inside `src/llm/` — the
  property that actually encodes "core is a shuttle". No shipped code changed;
  core was, and is, clean.

## [0.27.1] — 2026-07-24

### Fixed

- **A merge point downstream of a decision received `undefined` instead of the
  live branch's value.** `#1` stopped the shared continuation node being
  *skipped*; it could still arrive with **nothing**. Inputs were collected by
  assigning every incoming edge in order, and a branch that never fired has no
  port value — so its `undefined` overwrote whatever the branch that *did* fire
  had already put on the same handle. Whether it bit depended purely on edge
  order: inactive-edge-last lost the value, inactive-edge-first kept it.

  This is the quiet kind: the run still reports `ok`, the merge node still
  executes, and it just silently operates on nothing. Any graph where two or
  more mutually-exclusive branches rejoin — decision/switch fan-in, the
  canonical "route, then continue" shape — was exposed.

  **Consumers need do nothing** — no API change, and a genuine parallel AND-join
  (where both inputs really are active) behaves exactly as before; there is a
  test pinning that. If you had worked around this by reordering edges or by
  re-deriving state inside the merge node, that workaround is now unnecessary.

### Security

- **postcss bumped to 8.5.23** (was 8.5.15), clearing
  [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) —
  path traversal in previous-source-map auto-loading (`sourceMappingURL`) that
  can disclose arbitrary `.map` files. postcss is a **build-time transitive** of
  `tsup` and `vite`, both devDependencies; it is not part of the published
  bundle. **Consumers need to do nothing** — this only changes this repo's
  lockfile. Fixed by an in-range update, not an `overrides` pin: every parent
  (`tsup ^8.4.12`, `vite ^8.5.6`, `postcss-load-config >=8.0.9`) already
  admitted the patched version.

## [0.27.0] — 2026-07-24

**Editor redesign + a themeable token layer.** The `<FlowEditor>` chrome is
refreshed to a cleaner, unified look, and every surface now resolves from a
`--ff-*` CSS custom-property layer so a host can retheme the whole editor without
fighting specificity.

### Added

- **`--ff-*` theme tokens.** Colors, surfaces, borders, radii, shadows, and the
  accent all come from custom properties defined on the component roots (with a
  light default set + a single dark override block). Retheme by setting them
  anywhere up the tree, e.g. `.ff-editor { --ff-accent: #ec4899; --ff-radius: 16px; }`.
  Dark mode still honors a `.dark` / `[data-theme="dark"]` ancestor and OS
  `prefers-color-scheme` (with the `.ff-canvas--light` opt-out).
- **Run feed header.** `<FlowRunFeed>` now renders a header (title + live event
  count + a "running" badge) above the scrolling body. New props: `showHeader`
  (default true), `title` (default "Run feed"), `running`. `<FlowEditor>` passes
  `running` automatically.
- **Richer config-panel header.** The `<NodeConfigPanel>` header now shows the
  kind's icon in an accent chip alongside the kind label and the node's name.

### Changed

- **The default editor look changed** — a unified bordered shell (palette ·
  canvas + toolbar + run feed · inspector share one frame), recessed palette /
  panel / feed surfaces, a themed (no longer hard-black) run feed, and refined
  buttons/inputs. **What a consumer must DO:** nothing to keep working; if you
  had overridden the old hard-coded `ff-*` colors, move those overrides to the
  `--ff-*` tokens (cleaner, and they cascade). Class names are unchanged.
- The run feed's scroll container is now `.ff-run-feed__body` (was the
  `.ff-run-feed` root). Only matters if you targeted the root's scroll directly.

## [0.26.0] — 2026-07-24

**User Input actually pauses for input now.** The editor gained a built-in
human-input modal, so a run through a `user_input` / `human_approval` node stops
and asks — no host wiring required.

### Added

- **Built-in human-input modal.** When a run reaches a `user_input` node,
  `<FlowEditor>` opens a form built from that node's `fields` config and BLOCKS
  the run until the person submits (the executor returns a Promise the engine
  awaits — the same pattern the headless runner already supported). A
  `human_approval` node opens an Approve / Deny modal and routes on the choice.
  These ship as **default executors** and are fully overridable — pass your own
  `user_input` / `human_approval` executor and it wins. An unconfigured User
  Input node (empty `fields`) still works: it falls back to a single text field.
  New `HumanPrompt` component + `humanInputFields()` helper are exported for hosts
  building their own run harness.

### Fixed

- **Config-less node cards no longer read "— configure in the panel".** A kind
  with no `configSchema` (Manual trigger, Output, …) has nothing to configure, so
  its card now renders as just its header instead of nagging to configure it. The
  prompt still shows for kinds that HAVE fields but none are filled in yet.

### Notes

- **What a consumer must DO:** nothing. If you already pass a `user_input` or
  `human_approval` executor it keeps winning; if you didn't, those nodes now
  prompt the user in-editor instead of erroring with "No executor registered".

## [0.25.0] — 2026-07-24

**Notes on the canvas.** A first-class `note` kind for documenting a flow —
sticky-note annotations that describe what each part does, for the people and
agents reading the graph. Notes are **visual-only and never reach a runner**.

### Added

- **`note` kind (`@particle-academy/note`, aliases `note` / `@fancy/note`).** A
  resizable sticky note with a `title`, `text`, and `color` (amber / sky /
  violet / emerald / rose / slate). Portless — nothing wires to it. Rendered by
  a new `NoteNode`; drag "Note" from the palette's new **Notes** section, or
  double-click a note on the canvas to edit it in place (edits go through the
  editor's undo pipeline). A note authored outside a `<FlowEditor>` (a read-only
  viewer) renders as static text.
- **New `annotation` node category.** Notes/labels/markup live here, separate
  from `layout` (lanes/pools). Both are visual-only; the palette groups
  annotations under **Notes**. `categoryAccent("annotation")` is a sticky yellow.

### Changed

- **The engine skips annotations, so a note's text never reaches a runner.** A
  note's config (its text) stays in the exported `WorkflowSchema` purely for
  people, editors, and MCP tools — `runFlow` walks straight past any node in the
  `annotation` category (and, as before, any node typed `note`). A note has no
  ports, so it can't feed data into another node either. **What a consumer must
  DO:** nothing — this only adds a skip for a category that didn't exist before.

### Notes

- Agents author notes through the existing bridge with **no change needed**:
  `flow_add_node` / `flow_update_node` handle the `note` kind like any other
  registered kind (title/text/color validate against its `configSchema`), and
  because notes are portless there is nothing to connect.
- A note's `title` / `text` / `color` round-trip through
  `exportWorkflow` / `importWorkflow` (they ride in `config`), as do its resized
  `width` / `height`.

## [0.24.0] — 2026-07-23

Release 5 — **data & polish**. Completes the G1–G15 capability push.

### Added

- **Reactive data flow (G12).** Set `reactive: true` on a kind and, during a
  run, its computed output is written back into `data.output` — the card shows
  the value live ("computing flows"). `useFlowRun` now tracks `outputs`; new
  `applyOutputsToNodes(nodes, outputs)` (chained after `applyStatusesToNodes`).
  Default off — non-reactive kinds are untouched.
- **First-class `colorMode` (G13).** `<FlowCanvas colorMode="light" | "dark" | "system">`
  is forwarded to React Flow's own chrome AND stamped as the shared `.dark` /
  light-opt-out class, so the kit's `ff-` styles theme in lockstep off one signal.
- **Helper lines + snap (G15).** `<FlowCanvas showHelperLines>` — alignment
  guides appear while dragging a node and it snaps to aligned edges. New pure
  `getHelperLines(change, nodes)` + a `HelperLines` overlay (ViewportPortal, so
  it tracks pan/zoom).

### Notes

- This is the final release of the capability push (`.ai/plans/fancy-flow-g3-g15-execution-plan.md`):
  G1 (agent-bridge hardening, PR) + G2–G15 all shipped.

## [0.23.0] — 2026-07-23

Release 4b — **auto-layout**, completing the swimlanes work (R4).

### Added

- **Auto-layout / "Tidy".** One click arranges the graph into a readable DAG via
  **dagre** — **bundled but lazy-loaded**, so consumers who never tidy pay
  nothing for it (verified: dagre is code-split out of the eager bundle), and it
  runs headlessly.
  - New `fancy-flow/layout` subpath: `autoLayout(graph, options)` →
    repositioned nodes (`direction` LR/TB/RL/BT, `nodeSep`, `rankSep`, `scope`).
  - `FlowEditorApi`: `autoLayout(options?)` and **`tidyLane(laneId)`** — a
    lane-scoped arrange that tidies just one swimlane's children. Both go through
    the commit pipeline, so they're a single undo step.
  - Toolbar "⤢ Tidy" builtin (`builtins.autoLayout`).
  - `AutoLayoutOptions` / `AutoLayoutDirection` types re-exported from the root
    (the `autoLayout` value lives on `fancy-flow/layout` to keep dagre lazy).

## [0.22.0] — 2026-07-23

Release 4a — **true swimlanes** (the headline). Auto-layout (G5) follows in 0.23.0.

### Added

- **Swimlanes.** A new `@particle-academy/lane` kind — a resizable, titled
  container (a `layout`-category node with its own `LaneNode` renderer). **Drop a
  node onto a lane to file it there** (`parentId` + `extent:'parent'`, converted
  to a lane-relative position); **drag it out to unfile it**. Lanes resize on the
  canvas; children render on top and move with the lane.
  - `FlowEditorApi`: `addLane(orientation?, title?)`, `assignToLane(nodeId, laneId)`,
    `removeFromLane(nodeId)`. Toolbar "▤ Lane" builtin (`builtins.addLane`).
  - **`NodeKindDefinition.component`** — a kind can now supply its OWN full
    renderer (not just a card body); `buildNodeTypes` uses it. This is the escape
    hatch lanes/containers need.
  - New `layout` `NodeCategory` (+ accent) and pure graph-ops: `sortNodesParentFirst`
    (applied at the FlowCanvas boundary — xyflow requires parents before children),
    `assignToLane`, `removeFromLane`, `stackLanes`.
  - **Runtime:** lanes are visual-only — never executed; edges cross lanes freely,
    so grouping never affects topology.
  - **Persistence:** lane size + each child's `parentId`/`extent` round-trip via
    the 0.21 schema fields.

### Notes

- Auto-layout (dagre) lands next in **0.23.0**; lane auto-arrange builds on it.

## [0.21.0] — 2026-07-23

Release 3 — **node chrome & persistence** — the groundwork swimlanes (0.22) need.

### Added

- **Resizable nodes.** A kind opts in via `NodeKindDefinition.resizable` —
  `true` or `{ minWidth, minHeight, maxWidth, maxHeight, keepAspectRatio }` —
  and gets drag-to-resize handles (xyflow `NodeResizer`). The resulting
  width/height are written onto the node and **persist** (see below). Resize
  handles are themed (light + dark); a resizable card drops the fixed max-width.
- **Per-node toolbar.** A kind opts in via `NodeKindDefinition.toolbar` — a
  render function shown while the node is selected (xyflow `NodeToolbar`) — a
  discoverable, agent-legible alternative to the right-click menu. Call
  `useFlowEditor()` inside it to reach the editor api.
- **The schema now persists visual layout.** `WorkflowSchemaNode` gains optional
  `parentId`, `extent`, `width`, `height`, `style`, and `exportWorkflow` /
  `importWorkflow` round-trip them. They're additive + optional — a runtime that
  only walks edges/ports (the PHP twin) ignores them, and an older reader simply
  drops them. This is the groundwork for swimlanes. New `migrateSchema()` seam
  for a future breaking bump.

### Fixed

- **`fancy-flow/registry` and `fancy-flow/schema` are now importable subpaths.**
  They were built by tsup but absent from `package.json` `exports`, so Node's
  restrictive resolution rejected them. Also **fixed the `fancy-flow/runtime`
  types path**, which pointed at a non-existent flat `runtime.d.ts` (the dts is
  nested) — `runtime` subpath consumers were silently getting no types.

## [0.20.0] — 2026-07-23

Release 2 of the capability push — **selection & editing**.

### Added

- **Multi-select bulk operations.** `FlowEditorApi` exposes the real xyflow
  multi-selection (`selectedIds`, `selectedNodes`) and acts on it:
  `duplicateSelected()` (copying the edges *between* the selected nodes),
  `alignSelected(edge)` (`left`/`hcenter`/`right`/`top`/`vcenter`/`bottom`), and
  `distributeSelected("h" | "v")`. Box-select / shift-click are already available
  through the inherited React Flow props (`selectionMode`, `selectionOnDrag`, …).
- **Copy / cut / paste.** `api.copy()` / `cut()` / `paste(at?)`, plus Ctrl+C /
  Ctrl+X / Ctrl+V and Ctrl+D (duplicate). Paste preserves the wiring *between*
  the copied nodes, offsets the result, and selects it. Backed by the new pure
  helper `cloneSubgraph(nodes, edges, { makeId, offset })`, which remaps every id
  (and any in-set `parentId`) and drops edges that would dangle.
- **Reconnectable edges.** Drag an edge endpoint to rewire it. The new endpoint
  is validated by the same `isValidConnection` rule from 0.18.0, so a
  type-incompatible reconnect is refused, and the edge keeps its id + label.
- New exported, reusable pure graph-ops (for hosts building custom editors and
  for the agent bridge, so both share one implementation): `cloneSubgraph`,
  `reconnectEdge`, `alignNodes`, `distributeNodes` (+ the `AlignEdge` type).

### Changed

- Nothing breaking — all additions.

## [0.19.0] — 2026-07-23

The first of five releases in the capability push (`.ai/plans/fancy-flow-g3-g15-execution-plan.md`) — the **trust layer** everything else builds on.

### Added

- **Undo / redo.** Every *committing* edit — add, delete, connect, config change,
  drag, import — is now reversible. `FlowEditorApi` gains `undo()` / `redo()` /
  `canUndo` / `canRedo`; the toolbar shows Undo/Redo buttons (`builtins.history`,
  default on) and Ctrl+Z / Ctrl+Shift+Z (also Ctrl+Y) work (ignored while a form
  field is focused, so native text-undo still works there). Granularity is
  intentional: a delete of a node **and its edges** undoes as one step, a drag is
  one step, and transient interactions (a drag in progress, selection) are not
  their own steps.
  - New building blocks, exported from the root and `fancy-flow/runtime`:
    `createHistory()` — a pure, React-free snapshot controller — and
    `useFlowHistory(flow)` — the commit/undo pipeline that wraps whichever
    mutation sink is active (uncontrolled hook or controlled adapter), giving the
    two-sink architecture the single interception point it lacked.
- **Staged deletes (`<FlowEditor confirmDelete>`).** When set, every delete path
  — keyboard (`onBeforeDelete`), the panel button, the context menu, and
  `api.deleteNodes` / `deleteEdges` — calls the gate first; a `false` return
  vetoes. Default is unchanged (delete immediately). This realizes the component
  contract's "agents propose, humans confirm" on the canvas itself.

### Changed

- **`UseFlowStateReturn` gains `setGraph(graph)`** — an atomic nodes+edges commit.
  Undo/redo restore and node-delete now go through it, which **fixes a
  controlled-mode bug**: `setNodes` then `setEdges` each closed over a stale
  `value`, so an op touching both (a delete) silently lost the nodes half.
  **What a consumer must DO:** nothing — unless you hand-implemented a
  `UseFlowStateReturn`, in which case add a `setGraph` (write nodes+edges in one
  commit; in React just call both setters).

## [0.18.0] — 2026-07-23

### Added

- **Connection validation from port types.** `PortDescriptor.type` has always
  advertised itself as being "for hosts that want to validate connections", but
  nothing consumed it — a text output could be wired into a number input, by a
  human or an agent. `<FlowCanvas>` now enforces it by default: a new connection
  is refused only when both the source-output and target-input ports declare a
  concrete, differing `type`. Untyped ports (and an `"any"` wildcard,
  `ANY_PORT_TYPE`) match anything, and self-loops are blocked.

  New exports (from the package root and `fancy-flow/registry`):
  `createConnectionValidator(getNodes, options?)` — a pure, React-free
  `isValidConnection` predicate; `defaultPortCompatibility` — the default rule;
  `ANY_PORT_TYPE`; and the `PortCompatibility` / `ConnectionValidatorOptions`
  types. The validator resolves ports through the same `resolveNodePorts` the
  canvas and runtime use, so a connection the canvas refuses is one an agent's
  future `flow_connect` refuses too — one rule, no drift.

  `<FlowCanvas>` gains a `validateConnections?: boolean | ConnectionValidatorOptions`
  prop (default `true`). Pass options to tune the rule (`compatible`,
  `allowSelfConnection`), or `false` to disable. A `FlowEditor` inherits this
  automatically.

  **What a consumer must DO:** nothing, unless your nodes declare typed ports —
  untyped graphs (the default) validate exactly as before. If you *do* set
  `PortDescriptor.type` and were relying on cross-type connections, either give
  the ports the `"any"` type, pass `validateConnections={false}`, or supply your
  own `compatible` rule.

## [0.17.0] — 2026-07-23

### Changed

- **Node delete moved from the `FlowEditor` toolbar into `NodeConfigPanel`.**
  Deleting a node is a property of the node editor panel now, not a bespoke
  toolbar button — so a developer composing their own editor from the exported
  `NodeConfigPanel` gets the delete affordance for free, and `FlowEditor` stays
  a thin composition of the same primitives (no drift between the two).

  `NodeConfigPanel` gains an `onDelete?: (node) => void` prop (and an optional
  `deleteLabel`); when set, it renders a "Delete node" button at the foot of the
  panel while a node is selected. `FlowEditor` wires it to delete the selected
  node, still gated by `builtins.delete`.

  **What a consumer must DO:** if you relied on the toolbar's `✕ Delete` button
  (or a `[data-action="delete"]` selector on it), it's gone — the button is now
  `[data-action="delete-node"]` inside the panel. Keyboard `Del`/`Backspace`,
  the right-click menu, and `api.deleteSelected()` are unchanged, so most
  consumers need do nothing.

### Fixed

- **Node cards no longer dump raw JSON.** A non-primitive config value (a
  `repeater` list, a `keyvalue` object) was rendered with `JSON.stringify`, so a
  User Input node showed `Fields: [{"key":"answer",…}]` on its card. Values are
  now summarised for a glance — an array shows its item names (or a count), an
  object shows a field count — and never as JSON.

## [0.16.0] — 2026-07-20

All of this comes from the MOIC Suite consumer's review of 0.15.0 — the only
consumer actually running the split (TS editor, PHP execution). They found a
design flaw in the manifest within hours of it shipping.

### Changed

- **BREAKING: the engine range moved into each runtime.** One `fancyFlow` range
  could not express the split — it cannot say *"needs ts >=0.15 **and** php
  >=0.7"*. A package supporting both runtimes would install cleanly against a
  host whose **other** runtime was too old: the 0.9.0 failure shape wearing a
  manifest.

  ```jsonc
  "runtimes": {
    "ts":  { "entry": "dist/executor.js", "engine": "^0.16" },
    "php": { "package": "acme/fancy-flow-salesforce:^0.1", "engine": "^0.8" }
  }
  ```

  **What to do:** if you wrote a manifest against 0.15.0, move `fancyFlow` into
  each runtime as `engine`, and change each entry from a bare string to
  `{ entry | package, engine }`. A leftover top-level `fancyFlow` is now an
  explicit error rather than ignored, because silently it means "no engine
  constraint at all". Nobody had published against the old shape — it existed
  for four hours — which is exactly why it was worth fixing now.

- **BREAKING: `capabilities` is a map, not a list.** `["llm"]` becomes
  `{ "llm": "required" }`. A bare list cannot say whether the node works without
  one, and `required` is checked at **author** time so an editor can grey the
  node and name what the host never registered — instead of it installing
  cleanly and silently no-opping mid-run. `checkCapabilities` now returns an
  error for a missing required capability and a warning for a missing optional
  one.

- **BREAKING for implementers: `WorkflowResolver` takes a version.**
  `resolve(ref)` becomes `resolve(ref, version?)`, and may return a
  `WorkflowResolutionFailure` as well as a graph or null.

  A workflow another workflow depends on is an **interface, and interfaces need
  pins**. Without one, a parent goes on calling `invoice-triage`, someone edits
  that child, and the parent runs different logic *having reported success the
  whole time* — correct-looking, no error, wrong behaviour. Before this **no
  host could implement pinning**, because the node had no way to ask and the
  resolver no way to receive.

  `missing` and `version-mismatch` are distinct on purpose: reporting a mismatch
  as "not found" sends an author hunting for a workflow that is sitting right
  there, and a mismatch error should name both versions.

  **What to do:** callers are unaffected. If you *implement* `WorkflowResolver`,
  add the optional parameter. Done now because the population of implementers is
  approximately one; later it would not have been.

### Added

- **`subflow` takes a `version` pin.** Optional; blank keeps today's behaviour of
  running the child's current version.
- **Manifest `aliases`** — third-party packages can rename a kind and keep old
  documents opening, the same escape hatch core used for `llm_branch` →
  `llm_router`. Without it only first-party nodes could rename safely.
- **Manifest `configVersion`** — a node's config shape evolves on its own clock.
  Without a declared version every executor accretes hand-written read-fallbacks
  forever, which is what MOIC carries today for `routes[].key` → `routes[].port`.
- **Manifest `sideEffects`** (`none` / `idempotent` / `unsafe-to-replay`) —
  durable runs **retry**. A node that writes has to say so, or a host picks one
  retry policy for every node and gets it wrong somewhere.
- **Manifest `pausesForHuman`** — a host-planning fact, not a node internal: a
  parent embedding workflows must reject a child that can pause, and discovering
  that at run time means watching a run park.
- **`satisfiesRange`** — a deliberately small semver check (`^`, `~`, `>=`, `=`,
  `*`, `||`) shared by the tooling. An unparseable range is treated as
  **unsatisfied**, so it fails loudly rather than waving a node through. Pinned
  against the PHP implementation clause for clause.

### Added — fixtures

- **Capability stubs declared as data.** `llm_router` cannot reach a provider in
  CI, so a fixture supplies a fake. Both engines build the *same* fake from the
  *same* JSON — otherwise each runtime stubs differently and the fixtures become
  parity theatre.
- **Pause/resume cases** (`expect.afterResume`). Resume is the only path that
  crosses a persistence boundary, so it is where two runtimes are most likely to
  drift — and it had no parity coverage at all while `PausesForHuman` became
  public API.
- **Event assertions** (`expect.events`). Emitted events are behaviour, not
  decoration: an operator relies on the hallucinated-port warning to know a run
  took the fallback, and without this that guarantee can degrade on one runtime
  silently.
- **Legacy-shape cases** (`case.legacyKind`) — runs a case against an alias,
  which is what stops `aliases` being declared and then rotting.
- **At least one failure or pause case is now required to publish.** *"Does it
  fail the same way"* deserves equal weight to *"does it succeed the same way"*:
  the incident behind this whole mechanism was a failure that reported
  `completed` with no error.

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

[Unreleased]: https://github.com/Particle-Academy/fancy-flow/compare/v0.33.3...HEAD
[0.33.3]: https://github.com/Particle-Academy/fancy-flow/compare/v0.33.2...v0.33.3
[0.33.2]: https://github.com/Particle-Academy/fancy-flow/compare/v0.33.1...v0.33.2
[0.33.1]: https://github.com/Particle-Academy/fancy-flow/compare/v0.33.0...v0.33.1
[0.33.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.32.0...v0.33.0
[0.32.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.31.0...v0.32.0
[0.31.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.30.0...v0.31.0
[0.30.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.29.1...v0.30.0
[0.29.1]: https://github.com/Particle-Academy/fancy-flow/compare/v0.29.0...v0.29.1
[0.29.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.28.0...v0.29.0
[0.28.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.27.1...v0.28.0
[0.27.1]: https://github.com/Particle-Academy/fancy-flow/compare/v0.27.0...v0.27.1
[0.27.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.26.0...v0.27.0
[0.26.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.25.0...v0.26.0
[0.25.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.24.0...v0.25.0
[0.24.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/Particle-Academy/fancy-flow/compare/v0.15.1...v0.16.0
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
