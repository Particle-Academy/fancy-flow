import { createElement } from "react";
import { ensureBuiltinKinds, registerBuiltinKindInternal } from "./registry";
import { RichInputPreview } from "./rich-input";
import { LaneNode } from "../components/nodes/LaneNode";
import { NoteNode } from "../components/nodes/NoteNode";
import { BUILTIN_KIND_DATA } from "./builtin-kinds";
import type { NodeKindDefinition } from "./types";

/**
 * The built-in kit WITH its React renderers — the editor's door into it.
 *
 * ## Why this file is a decorator rather than the table
 *
 * `/engine` promised to be React-free and was not (#11). The exact edge was
 * `engine.ts → registry/registry.ts → registry/builtin.ts → react`, and it was
 * a REGRESSION of a fix whose comment is still in `engine.ts`: that file
 * imports from the module rather than the barrel precisely to avoid this, and
 * `registry.ts` later gained a `builtin.ts` import so the registry
 * self-populates. Both changes were right. Nothing tested the property, so the
 * second silently undid the first.
 *
 * The surface turned out to be four lines across three kinds in a 1,064-line
 * file, so the table moved to `builtin-kinds.ts` (React-free, what `registry.ts`
 * imports) and only the renderers stayed here.
 *
 * ## Where this gets applied, and why THERE
 *
 * `src/index.ts` calls `registerBuiltinKinds()` at module scope. That is not an
 * arbitrary choice: `package.json`'s `sideEffects` lists `./dist/index.js` and
 * `./dist/index.cjs` and NOT `./dist/registry.js`, so a consumer's bundler is
 * entitled to drop a top-level statement in the registry chunk and obliged to
 * keep one in the root barrel. Putting it anywhere else would work until
 * somebody's tree-shaker disagreed, and the symptom would be lanes quietly
 * rendering as ordinary cards.
 *
 * A consumer who never imports the React root still gets every kind — schema,
 * ports, executors — because `registry.ts` self-populates from the data
 * module. They simply get no renderers, which is correct: a queue worker has
 * no DOM to render into.
 *
 * ## Host and marketplace kinds are untouched
 *
 * Both arrive at runtime through `registerNodeKind` carrying their own
 * `component` / `renderBody`, and never pass through here. This split is
 * first-party-only by construction and adds no rule a third-party kind has to
 * follow.
 */

/** The renderers, by canonical kind name. */
const RENDERERS: Record<string, Partial<NodeKindDefinition>> = {
  "@particle-academy/lane": { component: LaneNode },
  "@particle-academy/terminal_lane": { component: LaneNode },
  "@particle-academy/note": { component: NoteNode },
  "@particle-academy/rich_user_input": {
    // Previews the authored page inside a FauxClient frame, so the canvas shows
    // what the person hitting this step will actually see.
    renderBody: (ctx) =>
      createElement(RichInputPreview, { config: (ctx.config ?? {}) as Record<string, unknown> }),
  },
};

/**
 * Every builtin, with renderers attached to the four that have one.
 *
 * A kind with no renderer is passed through by identity rather than copied, so
 * `BUILTIN_KINDS` and `BUILTIN_KIND_DATA` share objects wherever there is
 * nothing to add.
 */
export const BUILTIN_KINDS: NodeKindDefinition[] = BUILTIN_KIND_DATA.map((kind) => {
  const renderer = RENDERERS[kind.name];
  return renderer ? { ...kind, ...renderer } : kind;
});

/**
 * Register every built-in kind, renderers included.
 *
 * Idempotent, and safe to call after `registry.ts` has already self-populated
 * the plain table: `registerNodeKind` replaces by name, so this UPGRADES the
 * four kinds in place rather than duplicating anything.
 */
export function registerBuiltinKinds(): void {
  // Lay the React-free table down FIRST, through the same lazy path every other
  // entry point uses. Without this the flag is still unset, so the next read
  // anywhere — `getNodeKind`, the palette, a viewer — triggers
  // `ensureBuiltinKinds()` and re-registers the plain table OVER the decorated
  // kinds, silently dropping the four renderers this function exists to attach.
  ensureBuiltinKinds();

  for (const kind of BUILTIN_KINDS) registerBuiltinKindInternal(kind);
}

// Everything else the table exports keeps its old import path, so no consumer
// of `./builtin` has to change.
export { BUILTIN_KIND_DATA, registerBuiltinKindData } from "./builtin-kinds";
