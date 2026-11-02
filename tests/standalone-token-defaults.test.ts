/**
 * A component that can stand alone has to look right with no `--ff-*` token set
 * anywhere, WITHOUT taking a host's tokens away.
 *
 * ## The bug (reported by Maipa)
 *
 * `<FlowRunControls running={false} onRun={...} />` outside `FlowEditor` rendered
 * a white "Run" label on a transparent background, because `.ff-run-controls` was
 * missing from the token lists and `var(--ff-run)` had nothing to resolve to.
 *
 * ## The trap in the obvious fix
 *
 * Adding the root to those lists re-declares every default ON the root. A custom
 * property declared on the element itself beats anything inherited, whatever the
 * specificity, so a host that themed `--ff-run` on a wrapper or on `.ff-editor`
 * would silently lose its colour, and the lists would look exactly as they do for
 * every other root. So these roots keep their defaults under private
 * `--ff-default-*` names, and read `var(--ff-x, var(--ff-default-x))` at the point
 * of use.
 *
 * ## What this file can and cannot check
 *
 * It reads the stylesheet. It does not resolve a cascade: the proof that the
 * colours come out right is a real browser, and jsdom does not resolve custom
 * properties reliably enough to stand in for one. This is the regression guard
 * for the SHAPE that the browser check verified, so CI catches a root joining the
 * lists or a default drifting from the list it copies.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

type Rule = { selector: string; media: string | null; body: string };

const css = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/@import[^;]*;/g, "");

/** A brace walker, because rule bodies here never nest except inside @media. */
function parseRules(source: string, media: string | null = null): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf("{", i);
    if (open === -1) break;
    const selector = source.slice(i, open).replace(/\s+/g, " ").trim();
    let depth = 1;
    let j = open + 1;
    while (j < source.length && depth > 0) {
      if (source[j] === "{") depth += 1;
      else if (source[j] === "}") depth -= 1;
      j += 1;
    }
    const body = source.slice(open + 1, j - 1);
    if (selector.startsWith("@media") || selector.startsWith("@container")) {
      rules.push(...parseRules(body, selector));
    } else if (!selector.startsWith("@")) {
      rules.push({ selector, media, body });
    }
    i = j;
  }
  return rules;
}

function declarations(body: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    found.set(part.slice(0, colon).trim(), part.slice(colon + 1).replace(/\s+/g, " ").trim());
  }
  return found;
}

/** Split on top-level commas, then expand a single `:is(a, b)` into its forms. */
function selectorForms(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of selector) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());

  return parts.flatMap((part) => {
    const match = /:is\(([^)]*)\)/.exec(part);
    if (!match) return [part];
    return match[1]!.split(",").map((alt) => part.replace(match[0], alt.trim()));
  });
}

function namesRoot(selector: string, root: string): boolean {
  return selectorForms(selector).some((form) => new RegExp(`${root.replace(".", "\\.")}(?![\\w-])`).test(form));
}

const rules = parseRules(css);

function onlyRule(matches: (rule: Rule) => boolean, description: string): Map<string, string> {
  const found = rules.filter(matches);
  expect(found, `expected exactly one rule: ${description}`).toHaveLength(1);
  return declarations(found[0]!.body);
}

const DARK_MEDIA = "@media (prefers-color-scheme: dark)";
const isTokenList = (rule: Rule) => /\.ff-editor(?![\w-])/.test(rule.selector) && /--ff-surface\s*:/.test(rule.body);

const lightList = onlyRule((r) => isTokenList(r) && !r.media && !r.selector.includes(".dark"), "light token list");
const classDarkList = onlyRule((r) => isTokenList(r) && !r.media && r.selector.includes(".dark"), "class dark token list");
const osDarkList = onlyRule((r) => isTokenList(r) && r.media === DARK_MEDIA, "OS dark token list");

const isDefaultsRule = (rule: Rule) => /--ff-default-[\w-]+\s*:/.test(rule.body);
const lightDefaults = onlyRule((r) => isDefaultsRule(r) && !r.media && !r.selector.includes(".dark"), "light defaults");
const classDarkDefaults = onlyRule((r) => isDefaultsRule(r) && !r.media && r.selector.includes(".dark"), "class dark defaults");
const osDarkDefaults = onlyRule((r) => isDefaultsRule(r) && r.media === DARK_MEDIA, "OS dark defaults");

const defaultsRules = rules.filter(isDefaultsRule);

/** The public token behind a private default. */
const publicName = (name: string) => name.replace("--ff-default-", "--ff-");

const ROOTS = [".ff-run-controls", ".ff-rich-preview"];

describe.each(ROOTS)("%s stands alone without shadowing a host", (root) => {
  // The root plus its BEM children, which is where nearly all the reads are.
  const own = rules.filter((rule) => rule.selector.includes(root) && !isDefaultsRule(rule));

  test("no rule that selects the root declares a public --ff-* token", () => {
    const offenders = rules.filter((rule) => {
      if (!namesRoot(rule.selector, root)) return false;
      return [...declarations(rule.body).keys()].some(
        (name) => name.startsWith("--ff-") && !name.startsWith("--ff-default-"),
      );
    });
    expect(offenders.map((rule) => rule.selector)).toEqual([]);
  });

  test("the root is in all three defaults rules, and no others", () => {
    expect(defaultsRules.filter((rule) => namesRoot(rule.selector, root))).toHaveLength(3);
  });

  test("every token its rules read has a fallback to the matching private default", () => {
    const reads = own.flatMap((rule) => rule.body.match(/var\(--ff-[\w-]+[^;]*/g) ?? []);
    // A vacuous pass here is the failure this file exists to prevent.
    expect(reads.length, `${root} has no token reads to check`).toBeGreaterThan(0);

    const bare: string[] = [];
    for (const rule of own) {
      for (const match of rule.body.matchAll(/var\((--ff-[\w-]+)(\s*,\s*var\((--ff-[\w-]+)\))?\)?/g)) {
        const [, token, , fallback] = match;
        if (token!.startsWith("--ff-default-")) continue;
        if (fallback !== publicName(token!).replace("--ff-", "--ff-default-")) {
          bare.push(`${rule.selector}: ${match[0]}`);
        }
      }
    }
    expect(bare).toEqual([]);
  });

  test("every default it reads is actually declared", () => {
    const read = own.flatMap((rule) => [...rule.body.matchAll(/var\((--ff-default-[\w-]+)\)/g)].map((m) => m[1]!));
    expect(read.length).toBeGreaterThan(0);
    expect([...new Set(read)].filter((name) => !lightDefaults.has(name))).toEqual([]);
  });

  test("dark mode resolves the same three ways the other roots do", () => {
    const classForms = defaultsRules
      .filter((rule) => !rule.media && rule.selector.includes(".dark"))
      .flatMap((rule) => selectorForms(rule.selector));
    expect(classForms).toEqual(
      expect.arrayContaining([
        `.dark ${root}`,
        `[data-theme="dark"] ${root}`,
        `.dark${root}`,
        `[data-theme="dark"]${root}`,
      ]),
    );

    // The OS path honours the same `.ff-canvas--light` opt-out as the lists.
    const osForms = defaultsRules
      .filter((rule) => rule.media === DARK_MEDIA)
      .flatMap((rule) => selectorForms(rule.selector));
    expect(osForms).toContain(`${root}:not(.ff-canvas--light):not(.ff-canvas--light *)`);
  });
});

describe("Cancel on hover", () => {
  /**
   * `.ff-run-controls__btn:hover:not(:disabled)` is (0,3,0) and `--cancel` is
   * (0,1,0), so hovering Cancel took the neutral hover surface while the label
   * stayed white: 1.04:1 on the light default, measured, in `FlowEditor` as well as
   * standalone. Run has its own hover rule, which is why only Cancel lost.
   */
  test("keeps the danger background, so its white label stays on it", () => {
    const hover = onlyRule(
      (rule) => rule.selector === ".ff-run-controls__btn--cancel:hover:not(:disabled)",
      "Cancel hover",
    );
    expect(hover.get("background")).toBe("var(--ff-danger, var(--ff-default-danger))");
  });
});

describe("the private defaults copy the token lists", () => {
  test("there is something to compare", () => {
    expect(lightDefaults.size).toBeGreaterThan(0);
  });

  test("each light default equals the light list's value", () => {
    for (const [name, value] of lightDefaults) {
      expect(value, name).toBe(lightList.get(publicName(name)));
    }
  });

  test.each([
    ["class dark", classDarkDefaults, classDarkList],
    ["OS dark", osDarkDefaults, osDarkList],
  ])("%s swaps exactly the tokens its list changes, to the same values", (_label, defaults, list) => {
    for (const name of lightDefaults.keys()) {
      expect(defaults.get(name), name).toBe(list.get(publicName(name)));
    }
    // And nothing the light block does not also declare.
    expect([...defaults.keys()].filter((name) => !lightDefaults.has(name))).toEqual([]);
  });
});
