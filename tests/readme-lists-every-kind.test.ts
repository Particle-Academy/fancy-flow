/**
 * The README's node-kind table has to agree with the registry.
 *
 * It is a hand-maintained mirror of `BUILTIN_KINDS`, and this kit's most
 * repeated defect is exactly that: a list somebody keeps by hand, nothing
 * comparing it to the thing it mirrors, and drift that is invisible because
 * both halves look fine on their own. `PackageRegistry::componentsForReactFancy()`
 * lost ten shipped components that way — including the layout primitives the
 * release notes called the highest-leverage gap in the kit — and every one was
 * published, exported and unreachable from any consumer route.
 *
 * The README's count said 27 while the registry held 28, one commit after a
 * kind was added. That is the whole failure mode in miniature, and it is why
 * the number is asserted rather than trusted.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { BUILTIN_KINDS, registerBuiltinKinds } from "../src/registry/builtin";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

/** The bare name every kind is also aliased as — what the table lists. */
function bareName(name: string): string {
  return name.replace(/^@particle-academy\//, "");
}

beforeEach(() => {
  registerBuiltinKinds();
});

describe("README node kinds", () => {
  test("states the number of builtins the registry actually holds", () => {
    const claimed = README.match(/^(\d+) builtins, grouped by category/m)?.[1];

    expect(claimed, "the README no longer opens its Node kinds section with a count").toBeDefined();
    expect(Number(claimed)).toBe(BUILTIN_KINDS.length);
  });

  test("lists every builtin kind by name", () => {
    // The count alone is not enough: swapping one kind for another keeps the
    // number right and the table wrong, which reads as more trustworthy than a
    // number that is merely out of date.
    const section = README.slice(README.indexOf("## Node kinds"));
    const table = section.slice(0, section.indexOf("Don't hand-copy"));

    expect(table).not.toBe("");

    const missing = BUILTIN_KINDS
      .map((k) => bareName(k.name))
      .filter((name) => !new RegExp(`\`${name}\``).test(table));

    expect(missing).toEqual([]);
  });
});
