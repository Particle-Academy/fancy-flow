# Contributing to @particle-academy/fancy-flow

Notes for anyone, human or agent, working ON this package's code. How to USE the
package is in [AGENTS.md](./AGENTS.md); what it is, is in [README.md](./README.md).
`CLAUDE.md` is a symlink to this file, so Claude Code reads these notes when it
works in this repo.

## Layout

- `src/` — the engine, registry, schema, durable layer, editor and adapters,
  one package entry per subpath in `package.json` `exports` (`./engine`,
  `./runtime`, `./registry`, `./durable`, `./llm/*`, `./terminal/*`, ...).
- `tests/` — vitest suites, including the `conformance-*.test.ts` files that run
  the shared `fancy-conformance` tables.
- `demo/` — demo sources.

## Tests that guard the docs and the entry points

- `tests/readme-lists-every-kind.test.ts` reads `README.md`: the "Node kinds"
  section must open with the builtin count (`<N> builtins, grouped by category`)
  and its table, up to the sentence starting "Don't hand-copy", must name every
  builtin kind. Adding a kind means updating that table.
- `tests/engine-is-react-free.test.ts` keeps `./engine` free of React.

## Commands

```bash
npm run build   # tsup
npm run dev     # tsup --watch
npm run lint    # tsc --noEmit && eslint .
npm test        # vitest run
```

## Changelog

Update `CHANGELOG.md` in the same commit as the change.
