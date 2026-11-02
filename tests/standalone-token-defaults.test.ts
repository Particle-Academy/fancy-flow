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
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
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
    if (selector.startsWith("@media") || selector.startsWith("@container") || selector.startsWith("@supports")) {
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

/**
 * `ConfigFieldRenderer` has no root of its own: it returns a bare control, so each
 * top-level class it can emit is listed. Declaring the PRIVATE names on those
 * elements shadows nothing a host can set, which is why no markup had to change.
 */
const ROOTS = [
  ".ff-run-controls",
  ".ff-rich-preview",
  ".ff-expression",
  ".ff-panel__input",
  ".ff-panel__switch",
  ".ff-panel__label",
  ".ff-panel__hint",
  ".ff-panel__issue",
  ".ff-repeater",
  ".ff-keyvalue",
  ".ff-viewer",
];

/**
 * Reads that deliberately do not fall back to their own private default.
 *
 * The label tokens have a computed fallback, and private names need none. The viewer's
 * `inherit` and `transparent` are not dark-only: they adapt to whatever page the
 * viewer sits on, and giving a read-only row an opaque surface would repaint every
 * host that has one on a card. Its accent and radius literals hold in both modes.
 */
const OWN_FALLBACK: Record<string, string[]> = {
  ".ff-viewer": ["--ff-fg", "--ff-surface", "--ff-accent", "--ff-radius"],
};

/** Public, read, and deliberately in no list: their default is computed, or a chain. */
const PUBLIC_OPTIONAL = new Set(["--ff-run-fg", "--ff-cancel-fg", "--ff-kind-fg", "--ff-accent-fg"]);

describe.each(ROOTS)("%s stands alone without shadowing a host", (root) => {
  // The root plus its BEM children, which is where nearly all the reads are.
  const own = rules.filter((rule) => rule.selector.includes(root) && !isDefaultsRule(rule));

  test("no rule that selects the root declares a public --ff-* token", () => {
    const offenders = rules.filter((rule) => {
      if (!namesRoot(rule.selector, root)) return false;
      return [...declarations(rule.body).keys()].some(
        (name) => name.startsWith("--ff-") && !name.startsWith("--ff-default-") && !name.startsWith("--ff-private-"),
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
        if (token!.startsWith("--ff-default-") || token!.startsWith("--ff-private-") || PUBLIC_OPTIONAL.has(token!)) continue;
        if (OWN_FALLBACK[root]?.includes(token!)) continue;
        // A host's --ff-danger still paints its text; only the default is the darker one.
        // The chain is var(--ff-danger-text, var(--ff-danger, var(--ff-default-danger-text))),
        // so the first read has no direct default, and the second is held to the darker one.
        if (token === "--ff-danger-text") continue;
        if (token === "--ff-danger" && fallback === "--ff-default-danger-text") continue;
        // Keeps exactly what a dark host sees today: see the FlowViewer block below.
        if (root === ".ff-viewer" && token === "--ff-fg-muted" && fallback === "--ff-default-fg-subtle") continue;
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

/** WCAG relative luminance of a `#rrggbb`, and the ratio between two of them. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const v = parseInt(hex.slice(at, at + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratioOf = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Every label on a colour reads one rule. Each surface says what it is painted on
 * (`--ff-private-label-on`), and the rule works out dark or white from that.
 */
describe("labels on a colour", () => {
  const AUTO = "--ff-private-label-auto";
  const autoRules = rules.filter((rule) => declarations(rule.body).has(AUTO));
  const auto = declarations(autoRules[0]?.body ?? "");

  const number = (source: string | undefined, pattern: RegExp): number => {
    const found = pattern.exec(source ?? "");
    expect(found, `${pattern} in ${source}`).not.toBeNull();
    return Number(found![1]);
  };

  /** Surface, its base rule's selector, its override token. */
  const SURFACES: [string, string][] = [
    [".ff-run-controls__btn--run", "--ff-run-fg"],
    [".ff-run-controls__btn--cancel", "--ff-cancel-fg"],
    [".ff-node__header", "--ff-kind-fg"],
    [".ff-lane__header", "--ff-kind-fg"],
    [".ff-palette__row-dot", "--ff-kind-fg"],
    [".ff-panel__head-icon", "--ff-kind-fg"],
    [".ff-viewer__index", "--ff-kind-fg"],
    [".ff-prompt__btn--primary", "--ff-accent-fg"],
  ];

  test("the rule is defined once, behind @supports", () => {
    expect(autoRules).toHaveLength(1);
    expect(autoRules[0]!.media).toMatch(/^@supports \(color: color\(from #000 xyz-d65 calc\(clamp\(.*\by\b.*\)/);
    expect(auto.get(AUTO)).toMatch(/^color\(from var\(--ff-private-label-on\) xyz-d65 /);
  });

  test("it is opaque whatever the host's colour is, since relative colour keeps the origin's alpha", () => {
    expect(auto.get(AUTO)).toMatch(/\/ 1\)$/);
  });

  test.each(SURFACES)("%s is in that rule, and reads it under %s", (selector, token) => {
    expect(selectorForms(autoRules[0]!.selector)).toContain(selector);
    const base = onlyRule((rule) => rule.selector === selector && !rule.media, `${selector} base rule`);
    /* A declaration holding var() always parses, so a browser that cannot do relative
       colour would not fall back to an earlier line. The fallback has to be inside
       the var(): white, because it is what those browsers showed, and because a dark
       fallback would go unreadable on a dark host colour. */
    expect(base.get("color")).toBe(`var(${token}, var(${AUTO}, #fff))`);
  });

  /* Declared anywhere, on a root above all, a token would beat the value a host set on a
     wrapper or on :root, and read exactly as if the host had set nothing. */
  test.each([...PUBLIC_OPTIONAL])("no rule declares %s: it belongs to the host", (token) => {
    expect(rules.filter((rule) => declarations(rule.body).has(token)).map((rule) => rule.selector)).toEqual([]);
  });

  test("no surface is in the rule without a test here", () => {
    expect(selectorForms(autoRules[0]!.selector).sort()).toEqual(SURFACES.map(([selector]) => selector).sort());
  });

  test("each button state reads the background it is actually painted on", () => {
    const origin = (selector: string) => onlyRule((rule) => rule.selector === selector && !rule.media, selector).get("--ff-private-label-on");
    expect(origin(".ff-run-controls__btn--run")).toBe("var(--ff-run, var(--ff-default-run))");
    expect(origin(".ff-run-controls__btn--run:hover:not(:disabled)")).toBe("var(--ff-run-hover, var(--ff-default-run-hover))");
    expect(origin(".ff-run-controls__btn--cancel")).toBe("var(--ff-danger, var(--ff-default-danger))");
    expect(origin(".ff-prompt__btn--primary")).toBe("var(--ff-accent)");
  });

  test("no zone of luminance leaves a label under 4.5:1", () => {
    const white = number(auto.get("--ff-private-label-white"), /clamp\(0, \(([\d.]+) - y\)/);
    const soft = number(auto.get("--ff-private-label-soft"), /clamp\(0, \(y - ([\d.]+)\)/);
    const dark = luminance(lightList.get("--ff-fg")!);

    expect(white).toBeLessThan(soft);
    expect(ratioOf(1, white), "white, at the top of its zone").toBeGreaterThanOrEqual(4.5);
    expect(ratioOf(white, 0), "black, at the bottom of its zone").toBeGreaterThanOrEqual(4.5);
    expect(ratioOf(soft, dark), "--ff-fg, at the bottom of its zone").toBeGreaterThanOrEqual(4.5);
  });

  test("the dark label is the light list's --ff-fg, in XYZ", () => {
    expect(lightList.get("--ff-fg")).toBe("#18181b");
    const y = number(auto.get(AUTO), /calc\(var\(--ff-private-label-white\) \+ var\(--ff-private-label-soft\) \* ([\d.]+)\)/);
    expect(y).toBeCloseTo(luminance("#18181b"), 4);
  });

  test("the default green carries that label at AA, normal and hover", () => {
    const dark = luminance(lightList.get("--ff-fg")!);
    expect(ratioOf(luminance(lightList.get("--ff-run")!), dark)).toBeGreaterThanOrEqual(4.5);
    expect(ratioOf(luminance(lightList.get("--ff-run-hover")!), dark)).toBeGreaterThanOrEqual(4.5);
  });

  test("a node tag is not faded: 0.9 opacity takes an AA label under AA", () => {
    const tag = onlyRule((rule) => rule.selector === ".ff-node__tag", "node tag");
    expect(tag.has("opacity")).toBe(false);
  });
});

/**
 * The durable guard. The rule above only protects the surfaces listed in it; a new
 * surface written the old way would be correct on the day and invisible afterwards.
 */
describe("a fixed white label does not come back", () => {
  /**
   * `file: selector or snippet` to why it is not text on an accent. Empty on purpose:
   * the switch knob is white too, but as a `background`, so this never matches it.
   */
  const ALLOWED = new Map<string, string>();

  const src = resolve(__dirname, "../src");
  const sources = (readdirSync(src, { recursive: true }) as string[])
    .filter((file) => /\.(css|tsx?)$/.test(file))
    .map((file) => ({ file: file.replaceAll("\\", "/"), text: readFileSync(resolve(src, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));

  test("it scanned the files that matter", () => {
    const names = sources.map((source) => source.file);
    for (const file of ["styles.css", "components/nodes/NodeShell.tsx", "components/FlowViewer/FlowViewer.tsx"]) expect(names).toContain(file);
  });

  test("no `color: #fff` or `color: white`, in CSS or an inline style", () => {
    const pattern = /(?<![-\w])color\s*:\s*["'`]?(#fff(?:fff)?|white)\b/gi;
    const found = sources.flatMap(({ file, text }) => [...text.matchAll(pattern)].map((match) => {
      const line = text.slice(text.lastIndexOf("\n", match.index) + 1, text.indexOf("\n", match.index)).trim();
      return `${file}: ${line}`;
    }));
    expect(found.filter((entry) => ![...ALLOWED.keys()].some((key) => entry.includes(key)))).toEqual([]);
  });

  test("every inline accent on a label surface also tells the rule what it is painted on", () => {
    const tsx = sources.filter(({ file }) => file.endsWith(".tsx"));
    const pattern = /className=\{?[^>]*?ff-(node__header|lane__header|palette__row-dot|panel__head-icon|viewer__index)[\s\S]{0,160}?style=\{\{([\s\S]*?)\}\}/g;
    const uses = tsx.flatMap(({ file, text }) => [...text.matchAll(pattern)].map((match) => ({ surface: match[1]!, file, style: match[2]! })));
    // NodeShell, RegistryNode twice, LaneNode, palette, panel, viewer.
    expect(uses).toHaveLength(7);
    expect(uses.filter((use) => !use.style.includes("...labelOn(")).map((use) => `${use.file} ${use.surface}`)).toEqual([]);
  });
});

/**
 * React Flow's own default node, what any node with no registered type renders as.
 * Left alone it has `#fff` and `color: inherit` whenever React Flow's layer is light,
 * so light text from the page sat on a white card: 1.16:1, measured.
 */
describe("React Flow's default node takes the canvas's tokens", () => {
  const canvas = onlyRule((rule) => rule.selector === ".ff-canvas" && !isTokenList(rule) && !rule.media, ".ff-canvas");

  test.each([
    ["--xy-node-background-color", "var(--ff-node-bg)"],
    ["--xy-node-color", "var(--ff-fg)"],
    ["--xy-node-border", "1px solid var(--ff-border-strong)"],
  ])("%s is %s", (name, value) => {
    expect(canvas.get(name)).toBe(value);
  });
});

/** Text colours. The browser measures them on their real backgrounds; this pins the shape. */
describe("light text tokens", () => {
  const LIGHT: [string, string][] = [
    ["--ff-fg-subtle", "#52525b"],
    ["--ff-fg-faint", "#52525b"],
    ["--ff-accent", "#7c3aed"],
    ["--ff-warn", "#92400e"],
    ["--ff-danger-text", "#b91c1c"],
    ["--ff-feed-ok", "#047857"],
  ];
  const RECESSED = "#f4f4f5";

  test.each(LIGHT)("%s is %s in the light list, and passes on the recessed surface", (name, value) => {
    expect(lightList.get(name)).toBe(value);
    expect(ratioOf(luminance(value), luminance(RECESSED))).toBeGreaterThanOrEqual(4.5);
  });

  /** Dark must not move: these are the values 0.83.0 shipped. */
  test.each([
    ["--ff-fg-subtle", "#a1a1aa"],
    ["--ff-fg-faint", "#71717a"],
    ["--ff-accent", "#a78bfa"],
    ["--ff-warn", "#fb923c"],
    ["--ff-danger-text", "#ef4444"],
    ["--ff-feed-ok", "#34d399"],
  ])("%s stays %s in both dark lists", (name, value) => {
    expect(classDarkList.get(name)).toBe(value);
    expect(osDarkList.get(name)).toBe(value);
  });

  test("Cancel keeps its background: --ff-danger itself did not move", () => {
    expect(lightList.get("--ff-danger")).toBe("#ef4444");
    expect(onlyRule((rule) => rule.selector === ".ff-run-controls__btn--cancel" && !rule.media, "Cancel").get("background")).toBe("var(--ff-danger, var(--ff-default-danger))");
  });

  test("text in danger reads the text token, and borders stay on --ff-danger", () => {
    const remove = onlyRule((rule) => rule.selector === ".ff-panel__delete", "delete");
    expect(remove.get("color")).toBe("var(--ff-danger-text)");
    expect(remove.get("border")).toBe("1px solid var(--ff-danger)");
    const reads = rules.filter((rule) => /(?<![-\w])color:\s*var\(--ff-danger[,)]/.test(rule.body));
    expect(reads.map((rule) => rule.selector)).toEqual([]);
  });
});

describe("ConfigFieldRenderer shares ff-panel__* with .ff-panel", () => {
  test(".ff-panel keeps its own declared tokens and takes no private defaults", () => {
    expect(defaultsRules.filter((rule) => namesRoot(rule.selector, ".ff-panel"))).toEqual([]);
  });

  test("a required marker, which is only ever rendered inside a label, falls back too", () => {
    const required = onlyRule((rule) => rule.selector === ".ff-panel__required", "required marker");
    expect(required.get("color")).toBe("var(--ff-danger-text, var(--ff-danger, var(--ff-default-danger-text)))");
  });

  test("an input's text gets a colour standalone, but inherits inside .ff-panel as it always did", () => {
    const base = onlyRule((rule) => rule.selector === ".ff-panel__input", "panel input");
    expect(base.get("color")).toBe("inherit");
    const standalone = onlyRule((rule) => rule.selector === ".ff-panel__input:not(.ff-panel *)", "standalone input");
    expect(standalone.get("color")).toBe("var(--ff-fg, var(--ff-default-fg))");
  });
});

describe("FlowViewer", () => {
  const viewer = rules.filter((rule) => rule.selector.includes(".ff-viewer") && !isDefaultsRule(rule));

  test("no var() falls back to a colour that only works in dark", () => {
    const offenders = viewer.flatMap((rule) => rule.body.match(/var\(--ff-[\w-]+,\s*#(3f3f46|a1a1aa)\)/g) ?? []);
    expect(offenders).toEqual([]);
  });

  /** The status pills were dark-only literals too: #34d399 over its tint on white is 1.7:1. */
  const STATUS = {
    ok: "#34d399",
    running: "#60a5fa",
    failed: "#f87171",
    skipped: "#a1a1aa",
    pending: "#c084fc",
  };
  const statusRules = rules.filter((rule) => /--ff-private-viewer-status-[\w-]+\s*:/.test(rule.body));

  test("status colours are declared in all three modes", () => {
    expect(statusRules).toHaveLength(3);
    expect(statusRules.filter((rule) => rule.media === DARK_MEDIA)).toHaveLength(1);
  });

  test.each(Object.entries(STATUS))("%s keeps its current colour in both dark rules", (name, value) => {
    const dark = statusRules.filter((rule) => rule.media === DARK_MEDIA || rule.selector.includes(".dark"));
    expect(dark).toHaveLength(2);
    for (const rule of dark) {
      expect(declarations(rule.body).get(`--ff-private-viewer-status-${name}`)).toBe(value);
    }
  });

  test.each(Object.keys(STATUS))("%s reaches AA over its tint on white in light", (name) => {
    const light = statusRules.find((rule) => !rule.media && !rule.selector.includes(".dark"))!;
    const value = declarations(light.body).get(`--ff-private-viewer-status-${name}`)!;
    const tint = onlyRule((rule) => rule.selector === `.ff-viewer__status--${name}`, name).get("background")!;
    const channels = [1, 3, 5].map((at) => parseInt(tint.slice(at, at + 2), 16));
    const alpha = parseInt(tint.slice(7, 9), 16) / 255;
    const over = `#${channels.map((c) => Math.round(c * alpha + 255 * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
    expect(ratioOf(luminance(value), luminance(over))).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * The defect behind the ExpressionField menu: its rules read `--ff-bg-1`,
 * `--ff-border-1` and friends, names that no list has ever declared, so the menu
 * was transparent and borderless even inside `FlowEditor`, and nothing could say
 * so. A var() with no value is not an error anywhere. This makes it one.
 */
describe("every --ff-* read in src/ resolves to something", () => {
  const src = resolve(__dirname, "../src");
  const files = (readdirSync(src, { recursive: true }) as string[])
    .filter((file) => /\.(css|tsx?)$/.test(file))
    .map((file) => resolve(src, file));

  const reads = new Map<string, Set<string>>();
  for (const file of files) {
    const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of text.matchAll(/(?:var\(\s*|getPropertyValue\(\s*["'`])(--ff-[\w-]+)/g)) {
      if (!reads.has(match[1]!)) reads.set(match[1]!, new Set());
      reads.get(match[1]!)!.add(relative(src, file));
    }
  }

  const declaredBy = (matches: (rule: Rule) => boolean) =>
    new Set(rules.filter(matches).flatMap((rule) => [...declarations(rule.body).keys()]));
  const lists = declaredBy(isTokenList);
  const defaults = declaredBy(isDefaultsRule);
  const anywhere = declaredBy(() => true);

  test("it found the stylesheet's reads, so a pass means something", () => {
    expect(files.some((file) => file.endsWith("styles.css"))).toBe(true);
    expect(reads.size).toBeGreaterThan(30);
    expect(reads.has("--ff-surface")).toBe(true);
    expect(lists.has("--ff-surface")).toBe(true);
    expect(defaults.has("--ff-default-surface")).toBe(true);
  });

  test("public reads are in the token lists, private ones are declared", () => {
    const undefinedReads = [...reads.entries()]
      .filter(([name]) => {
        if (name.startsWith("--ff-default-")) return !defaults.has(name);
        if (name.startsWith("--ff-private-")) return !anywhere.has(name);
        return !lists.has(name) && !PUBLIC_OPTIONAL.has(name);
      })
      .map(([name, where]) => `${name} (${[...where].join(", ")})`);
    expect(undefinedReads).toEqual([]);
  });

  test("the allowance for a public optional token has not gone stale", () => {
    for (const name of PUBLIC_OPTIONAL) expect(reads.has(name), name).toBe(true);
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
