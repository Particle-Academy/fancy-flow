/**
 * fromMermaid — Mermaid flowchart source to a fancy-flow graph.
 *
 * Hand-written: a line splitter, a statement dispatcher and a cursor. No eval,
 * no Function, no HTML, no dynamic import, and no regular expression that can
 * backtrack over more than one run of the input — every search for a closing
 * token is an `indexOf` scan, so hostile input costs linear time.
 *
 * Three rules shape the output:
 *
 * 1. **Display-only.** Every node is a `note`. The engine walks past notes, so
 *    importing a diagram can never produce something that runs. An agent that
 *    wants a workflow maps nodes to real kinds on purpose.
 * 2. **Labels are text.** `<br>` becomes a line break; every other tag stays as
 *    the characters it was written with, and is reported.
 * 3. **Nothing is dropped silently.** A statement the importer cannot read or
 *    represent is listed in the report with its line. A diagram it cannot draw
 *    honestly (another diagram type, or over a limit) returns no graph at all,
 *    rather than a graph that means something else.
 */
import { decodeLabel, truncateLabel } from "./labels";
import { layoutMermaid } from "./layout";
import type {
  MermaidDirection,
  MermaidEdgeMeta,
  MermaidEnd,
  MermaidGraph,
  MermaidImportOptions,
  MermaidImportResult,
  MermaidIssue,
  MermaidIssueCode,
  MermaidIssueSeverity,
  MermaidLimits,
  MermaidShape,
} from "./types";
import type { FlowEdge, FlowNode } from "../types";

export const MERMAID_DEFAULT_LIMITS: Readonly<MermaidLimits> = Object.freeze({
  maxInputLength: 50_000,
  maxNodes: 500,
  maxEdges: 1_000,
  maxLabelLength: 500,
  maxSubgraphDepth: 16,
});

/** Mermaid's other diagram keywords, so an unsupported diagram is named, not guessed at. */
const DIAGRAM_TYPES = new Map<string, string>([
  ["sequenceDiagram", "sequence"],
  ["classDiagram", "class"],
  ["classDiagram-v2", "class"],
  ["stateDiagram", "state"],
  ["stateDiagram-v2", "state"],
  ["erDiagram", "er"],
  ["gantt", "gantt"],
  ["pie", "pie"],
  ["journey", "journey"],
  ["gitGraph", "git"],
  ["mindmap", "mindmap"],
  ["timeline", "timeline"],
  ["quadrantChart", "quadrant"],
  ["requirementDiagram", "requirement"],
  ["C4Context", "c4"],
  ["C4Container", "c4"],
  ["C4Component", "c4"],
  ["C4Dynamic", "c4"],
  ["C4Deployment", "c4"],
  ["sankey", "sankey"],
  ["sankey-beta", "sankey"],
  ["xychart", "xychart"],
  ["xychart-beta", "xychart"],
  ["block", "block"],
  ["block-beta", "block"],
  ["packet", "packet"],
  ["packet-beta", "packet"],
  ["kanban", "kanban"],
  ["architecture-beta", "architecture"],
  ["radar-beta", "radar"],
  ["treemap-beta", "treemap"],
  ["zenuml", "zenuml"],
]);

const FLOWCHART_KEYWORDS = new Set(["flowchart", "graph", "flowchart-elk"]);

const DIRECTIONS = new Map<string, MermaidDirection>([
  ["TB", "TB"],
  ["TD", "TB"],
  ["BT", "BT"],
  ["LR", "LR"],
  ["RL", "RL"],
]);

/** Shape openers, longest first so `((` is never read as `(`. */
const SHAPES: ReadonlyArray<{ open: string; close: ReadonlyArray<[string, MermaidShape]> }> = [
  { open: "(((", close: [[")))", "double-circle"]] },
  { open: "((", close: [["))", "circle"]] },
  { open: "([", close: [["])", "stadium"]] },
  { open: "(", close: [[")", "round"]] },
  { open: "[[", close: [["]]", "subroutine"]] },
  { open: "[(", close: [[")]", "cylinder"]] },
  { open: "[/", close: [["/]", "parallelogram"], ["\\]", "trapezoid"]] },
  { open: "[\\", close: [["\\]", "parallelogram-alt"], ["/]", "trapezoid-alt"]] },
  { open: "[", close: [["]", "rect"]] },
  { open: "{{", close: [["}}", "hexagon"]] },
  { open: "{", close: [["}", "diamond"]] },
  { open: ">", close: [["]", "asymmetric"]] },
];

const STYLE_KEYWORDS = new Set(["style", "classDef", "class", "linkStyle"]);
const META_KEYWORDS = new Set(["accTitle", "accDescr"]);

// Sticky, and each one a single run of one character class: no backtracking
// beyond the run it starts on.
const RE_NORMAL_HEAD = /(-{2,})([>ox])/y;
const RE_NORMAL_OPEN = /-{3,}/y;
const RE_THICK_HEAD = /(={2,})([>ox])/y;
const RE_THICK_OPEN = /={3,}/y;
const RE_DOTTED = /-(\.+)-([>ox])?/y;
const RE_INVISIBLE = /~{3,}/y;
const RE_ID = /[\p{L}\p{N}_](?:[\p{L}\p{N}_]|-(?=[\p{L}\p{N}_]))*/uy;

function endOf(ch: string): MermaidEnd {
  if (ch === ">" || ch === "<") return "arrow";
  if (ch === "o") return "circle";
  if (ch === "x") return "cross";
  return "none";
}

function sticky(re: RegExp, s: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(s);
}

function clip(text: string, max = 200): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/** A statement that cannot be read. Caught per statement; the rest goes on. */
class StatementError extends Error {
  constructor(
    readonly code: MermaidIssueCode,
    message: string,
  ) {
    super(message);
  }
}

/** Over a limit. Ends the import: a truncated diagram is a different diagram. */
class Fatal extends Error {
  constructor(readonly issue: MermaidIssue) {
    super(issue.message);
  }
}

class Cursor {
  i = 0;
  constructor(readonly s: string) {}
  get done(): boolean {
    return this.i >= this.s.length;
  }
  peek(ahead = 0): string {
    return this.s[this.i + ahead] ?? "";
  }
  startsWith(token: string): boolean {
    return this.s.startsWith(token, this.i);
  }
  ws(): void {
    while (this.i < this.s.length && (this.s[this.i] === " " || this.s[this.i] === "\t")) this.i++;
  }
  id(): string | null {
    const m = sticky(RE_ID, this.s, this.i);
    if (!m) return null;
    this.i += m[0].length;
    return m[0];
  }
  /** A `"quoted"` run. Mermaid has no escapes inside quotes; `#quot;` is the escape. */
  quoted(): string | null {
    if (this.peek() !== '"') return null;
    const end = this.s.indexOf('"', this.i + 1);
    if (end < 0) return null;
    const text = this.s.slice(this.i + 1, end);
    this.i = end + 1;
    return text;
  }
  /** Label text up to the first of `closers`, quoted or not. */
  text(closers: ReadonlyArray<string>): { text: string; closer: string } | null {
    this.ws();
    if (this.peek() === '"') {
      const text = this.quoted();
      if (text === null) return null;
      this.ws();
      for (const closer of closers) {
        if (this.startsWith(closer)) {
          this.i += closer.length;
          return { text, closer };
        }
      }
      return null;
    }
    let best = -1;
    let which = "";
    for (const closer of closers) {
      const at = this.s.indexOf(closer, this.i);
      if (at >= 0 && (best < 0 || at < best)) {
        best = at;
        which = closer;
      }
    }
    if (best < 0) return null;
    const text = this.s.slice(this.i, best).trim();
    this.i = best + which.length;
    return { text, closer: which };
  }
}

type NodeRec = {
  id: string;
  label: string;
  shape: MermaidShape;
  /** Declared with its own shape or label (not just referenced). */
  explicit: boolean;
  subgraph: boolean;
  direction?: MermaidDirection;
  parent: string | null;
};

type EdgeRec = { source: string; target: string; label?: string; meta: MermaidEdgeMeta };
type Mention = { id: string; shape?: MermaidShape; label?: string };
type Link = { meta: MermaidEdgeMeta; label?: string };

class Reader {
  readonly nodes = new Map<string, NodeRec>();
  readonly order: string[] = [];
  readonly edges: EdgeRec[] = [];
  /** Open subgraphs. `id: null` is one whose header failed; its `end` still matches. */
  readonly stack: Array<{ id: string | null; line: number }> = [];
  line = 0;
  /** Issues from the statement being read, kept only if the statement is. */
  private local: MermaidIssue[] = [];
  private anon = 0;

  constructor(
    readonly limits: MermaidLimits,
    readonly issues: MermaidIssue[],
  ) {}

  issue(severity: MermaidIssueSeverity, code: MermaidIssueCode, message: string, text?: string, into = this.issues) {
    into.push({ severity, code, line: this.line, message, ...(text !== undefined ? { text: clip(text) } : {}) });
  }

  /** The innermost open subgraph that really exists. */
  get frame(): string | null {
    for (let k = this.stack.length - 1; k >= 0; k--) {
      const id = this.stack[k].id;
      if (id !== null) return id;
    }
    return null;
  }

  statement(raw: string): void {
    const t = raw.trim();
    if (!t) return;
    if (t.startsWith("%%")) {
      this.comment(t);
      return;
    }
    const kw = /^[A-Za-z]+(?![\w-])/.exec(t)?.[0] ?? "";

    if (kw === "subgraph") return this.openSubgraph(t.slice("subgraph".length));
    if (t === "end") return this.closeSubgraph();
    if (kw === "direction") return this.direction(t);
    if (STYLE_KEYWORDS.has(kw)) {
      this.issue("warning", "unsupported-statement", `\`${kw}\` is styling and is not imported.`, t);
      return;
    }
    if (kw === "click") {
      this.issue("warning", "interaction-ignored", "`click` interactions are never imported: no links, callbacks or scripts.", t);
      return;
    }
    if (META_KEYWORDS.has(kw)) {
      this.issue("warning", "unsupported-statement", `\`${kw}\` is not imported.`, t);
      return;
    }
    this.chain(t);
  }

  comment(t: string): void {
    if (t.startsWith("%%{")) {
      this.issue("warning", "directive-ignored", "Directives (`%%{...}%%`) never change the import; this one was ignored.", t);
    } else {
      this.issue("info", "comment", "Comment skipped.");
    }
  }

  private add(rec: NodeRec): NodeRec {
    if (this.nodes.size >= this.limits.maxNodes) {
      throw new Fatal({
        severity: "error",
        code: "limit-exceeded",
        line: this.line,
        message: `The diagram has more than maxNodes (${this.limits.maxNodes}) nodes. It is not drawn, because a cut-down diagram would show something else.`,
      });
    }
    this.nodes.set(rec.id, rec);
    this.order.push(rec.id);
    return rec;
  }

  private anonId(): string {
    let id: string;
    do {
      this.anon++;
      id = `subgraph${this.anon}`;
    } while (this.nodes.has(id));
    return id;
  }

  private label(raw: string, into: MermaidIssue[] = this.local): string {
    const decoded = decodeLabel(raw);
    if (decoded.html) {
      this.issue("warning", "html-as-text", "A label contains markup. It is shown as text, never rendered.", raw, into);
    }
    if (decoded.markdown) {
      this.issue("warning", "markdown-as-text", "A markdown-string label is shown as plain text.", raw, into);
    }
    const cut = truncateLabel(decoded.text, this.limits.maxLabelLength);
    if (cut.truncated) {
      this.issue(
        "warning",
        "label-truncated",
        `A label is longer than maxLabelLength (${this.limits.maxLabelLength}) and was shortened.`,
        raw,
        into,
      );
    }
    return cut.text;
  }

  private openSubgraph(rest: string): void {
    if (this.stack.length >= this.limits.maxSubgraphDepth) {
      throw new Fatal({
        severity: "error",
        code: "limit-exceeded",
        line: this.line,
        message: `Subgraphs are nested deeper than maxSubgraphDepth (${this.limits.maxSubgraphDepth}).`,
      });
    }
    const c = new Cursor(rest);
    c.ws();
    let id: string | null = null;
    let title: string | null = null;
    const fail = (message: string) => {
      this.issue("error", "parse-error", message, `subgraph${rest}`);
      // Still open a frame, so its `end` closes it and not the enclosing one.
      this.stack.push({ id: null, line: this.line });
    };

    if (c.peek() === '"') {
      title = c.quoted();
      c.ws();
      if (title === null || !c.done) return fail("A subgraph title could not be read.");
    } else if (!c.done) {
      const tok = c.id();
      c.ws();
      if (tok && c.done) {
        id = tok;
      } else if (tok && c.peek() === "[") {
        c.i++;
        const read = c.text(["]"]);
        c.ws();
        if (!read || !c.done) return fail("A subgraph title in `[...]` could not be read.");
        id = tok;
        title = read.text;
      } else {
        // `subgraph Some words` — the words are the title, and the id is made up.
        title = rest.trim();
      }
    }

    const label = title === null ? null : this.label(title, this.issues);
    if (id === null) id = this.anonId();
    const parent = this.frame;
    const existing = this.nodes.get(id);
    if (existing) {
      if (existing.subgraph || existing.explicit) {
        this.issue(
          "error",
          "id-collision",
          `"${id}" is already a node with its own label; this subgraph's box is not drawn, and its members are drawn without it.`,
          `subgraph${rest}`,
        );
        this.stack.push({ id: null, line: this.line });
        return;
      }
      // Referenced before it was declared (`A --> S` then `subgraph S`).
      existing.subgraph = true;
      existing.label = label ?? id;
      existing.parent = parent;
    } else {
      this.add({ id, label: label ?? id, shape: "rect", explicit: false, subgraph: true, parent });
    }
    this.stack.push({ id, line: this.line });
  }

  private closeSubgraph(): void {
    if (this.stack.length === 0) {
      this.issue("warning", "unexpected-end", "`end` with no open subgraph was ignored.");
      return;
    }
    this.stack.pop();
  }

  private direction(t: string): void {
    const m = /^direction\s+([A-Za-z]{2})\s*$/.exec(t);
    const dir = m ? DIRECTIONS.get(m[1]) : undefined;
    if (!dir) {
      this.issue("error", "parse-error", "A `direction` statement could not be read.", t);
      return;
    }
    const frame = this.stack[this.stack.length - 1];
    if (!frame) {
      this.issue("warning", "unsupported-statement", "`direction` outside a subgraph has no effect; set it on the first line.", t);
      return;
    }
    if (frame.id !== null) this.nodes.get(frame.id)!.direction = dir;
  }

  private chain(t: string): void {
    const c = new Cursor(t);
    const mentions: Mention[] = [];
    const links: Array<{ from: string[]; to: string[]; link: Link }> = [];
    this.local = [];
    try {
      let left = this.group(c, mentions);
      c.ws();
      while (!c.done) {
        const link = this.link(c);
        c.ws();
        const right = this.group(c, mentions);
        links.push({ from: left, to: right, link });
        left = right;
        c.ws();
      }
    } catch (error) {
      if (error instanceof StatementError) {
        this.issue("error", error.code, `${error.message} The statement is left out.`, t);
        return;
      }
      throw error;
    }

    this.issues.push(...this.local);
    for (const m of mentions) this.touch(m);
    for (const { from, to, link } of links) {
      for (const source of from) {
        for (const target of to) this.addEdge({ source, target, meta: link.meta, ...(link.label !== undefined ? { label: link.label } : {}) });
      }
    }
  }

  private group(c: Cursor, mentions: Mention[]): string[] {
    const ids: string[] = [];
    for (;;) {
      c.ws();
      const m = this.node(c);
      mentions.push(m);
      ids.push(m.id);
      c.ws();
      if (c.peek() !== "&") return ids;
      c.i++;
    }
  }

  private node(c: Cursor): Mention {
    const at = c.i;
    const id = c.id();
    if (!id) {
      throw new StatementError(
        "parse-error",
        c.done ? "Expected a node id, found the end of the statement." : `Expected a node id at column ${at + 1}.`,
      );
    }
    if (c.peek() === "@") {
      throw new StatementError(
        "unsupported-syntax",
        c.peek(1) === "{"
          ? `The \`${id}@{ ... }\` shape syntax is not supported yet.`
          : `Edge ids (\`${id}@-->\`) are not supported yet.`,
      );
    }
    const mention: Mention = { id };
    const shape = SHAPES.find((s) => c.startsWith(s.open));
    if (shape) {
      c.i += shape.open.length;
      const read = c.text(shape.close.map(([closer]) => closer));
      if (!read) throw new StatementError("parse-error", `Node "${id}" has an unclosed or malformed label.`);
      mention.shape = shape.close.find(([closer]) => closer === read.closer)![1];
      mention.label = this.label(read.text);
    }
    if (c.startsWith(":::")) {
      c.i += 3;
      const cls = c.id() ?? "";
      this.issue("warning", "unsupported-statement", `Class assignment \`:::${cls}\` is styling and is not imported.`, undefined, this.local);
    }
    return mention;
  }

  private link(c: Cursor): Link {
    const s = c.s;
    let i = c.i;
    let m = sticky(RE_INVISIBLE, s, i);
    if (m) {
      c.i = i + m[0].length;
      return this.pipe(c, { stroke: "invisible", head: "none", tail: "none", length: m[0].length - 2 });
    }

    let tail: MermaidEnd = "none";
    const first = s[i];
    if ((first === "<" || first === "o" || first === "x") && /^(?:--|==|-\.)/.test(s.slice(i + 1, i + 3))) {
      tail = endOf(first);
      i++;
    }
    const done = (end: number, meta: Omit<MermaidEdgeMeta, "tail">): Link => {
      c.i = end;
      return this.pipe(c, { ...meta, tail });
    };

    if ((m = sticky(RE_NORMAL_HEAD, s, i))) return done(i + m[0].length, { stroke: "normal", head: endOf(m[2]), length: m[1].length - 1 });
    if ((m = sticky(RE_NORMAL_OPEN, s, i))) return done(i + m[0].length, { stroke: "normal", head: "none", length: m[0].length - 2 });
    if ((m = sticky(RE_THICK_HEAD, s, i))) return done(i + m[0].length, { stroke: "thick", head: endOf(m[2]), length: m[1].length - 1 });
    if ((m = sticky(RE_THICK_OPEN, s, i))) return done(i + m[0].length, { stroke: "thick", head: "none", length: m[0].length - 2 });
    if ((m = sticky(RE_DOTTED, s, i))) {
      return done(i + m[0].length, { stroke: "dotted", head: m[2] ? endOf(m[2]) : "none", length: m[1].length });
    }

    // Label in the middle: `-- text -->`, `== text ==>`, `-. text .->`.
    if (s.startsWith("--", i)) return this.middle(c, i + 2, "-", "normal", tail);
    if (s.startsWith("==", i)) return this.middle(c, i + 2, "=", "thick", tail);
    if (s.startsWith("-.", i)) return this.dottedMiddle(c, i + 2, tail);

    throw new StatementError("parse-error", `Expected a link (-->, ---, -.->, ==>, ~~~) at column ${i + 1}.`);
  }

  /** `-- text -->` / `== text ==>`: find the closing run with indexOf, never a regex. */
  private middle(c: Cursor, from: number, ch: "-" | "=", stroke: "normal" | "thick", tail: MermaidEnd): Link {
    const s = c.s;
    const pair = ch + ch;
    let k = from;
    for (;;) {
      const at = s.indexOf(pair, k);
      if (at < 0) throw new StatementError("parse-error", "An edge label in the middle of a link is never closed.");
      let r = at;
      while (s[r] === ch) r++;
      const run = r - at;
      const next = s[r];
      let head: MermaidEnd | null = null;
      let end = r;
      let length = 0;
      if (next === ">" || next === "o" || next === "x") {
        head = endOf(next);
        end = r + 1;
        length = run - 1;
      } else if (run >= 3) {
        head = "none";
        length = run - 2;
      }
      if (head !== null) {
        const text = unquote(s.slice(from, at).trim());
        if (!text) throw new StatementError("parse-error", "An edge label in the middle of a link is empty.");
        c.i = end;
        return this.pipe(c, { stroke, head, tail, length }, this.label(text));
      }
      k = r;
    }
  }

  private dottedMiddle(c: Cursor, from: number, tail: MermaidEnd): Link {
    const s = c.s;
    const at = s.indexOf(".-", from);
    if (at < 0) throw new StatementError("parse-error", "A dotted edge label is never closed.");
    let start = at;
    while (start > from && s[start - 1] === ".") start--;
    const dots = at + 1 - start;
    const next = s[at + 2];
    const head = next === ">" || next === "o" || next === "x" ? endOf(next) : "none";
    const text = unquote(s.slice(from, start).trim());
    if (!text) throw new StatementError("parse-error", "A dotted edge label is empty.");
    c.i = at + 2 + (head === "none" ? 0 : 1);
    return this.pipe(c, { stroke: "dotted", head, tail, length: dots }, this.label(text));
  }

  /** An optional `|label|` after the link. */
  private pipe(c: Cursor, meta: MermaidEdgeMeta, label?: string): Link {
    const save = c.i;
    c.ws();
    if (c.peek() !== "|") {
      c.i = save;
      return label === undefined ? { meta } : { meta, label };
    }
    c.i++;
    let text: string;
    if (c.peek() === '"') {
      const q = c.quoted();
      c.ws();
      if (q === null || c.peek() !== "|") throw new StatementError("parse-error", "A quoted `|label|` is never closed.");
      c.i++;
      text = q;
    } else {
      const end = c.s.indexOf("|", c.i);
      if (end < 0) throw new StatementError("parse-error", "A `|label|` is never closed.");
      text = c.s.slice(c.i, end).trim();
      c.i = end + 1;
    }
    return { meta, label: this.label(text) };
  }

  private touch(m: Mention): void {
    let n = this.nodes.get(m.id);
    const frame = this.frame;
    if (!n) {
      n = this.add({ id: m.id, label: m.id, shape: "rect", explicit: false, subgraph: false, parent: frame });
    } else if (!n.subgraph && n.parent === null && frame !== null) {
      // First mentioned outside any subgraph, then inside one: it belongs there.
      n.parent = frame;
    }
    if (m.shape) {
      if (n.subgraph) {
        this.issue("warning", "id-collision", `"${m.id}" is a subgraph; the node shape and label given to it are not drawn.`);
        return;
      }
      n.shape = m.shape;
      n.label = m.label ?? "";
      n.explicit = true;
    }
  }

  private addEdge(edge: EdgeRec): void {
    if (this.edges.length >= this.limits.maxEdges) {
      throw new Fatal({
        severity: "error",
        code: "limit-exceeded",
        line: this.line,
        message: `The diagram has more than maxEdges (${this.limits.maxEdges}) edges. It is not drawn, because a cut-down diagram would show something else.`,
      });
    }
    this.edges.push(edge);
  }
}

function unquote(text: string): string {
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
}

/** Split a line on `;` outside double quotes. */
function statements(line: string): string[] {
  const out: string[] = [];
  let quoted = false;
  let start = 0;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (ch === '"') quoted = !quoted;
    else if (ch === ";" && !quoted) {
      out.push(line.slice(start, k));
      start = k + 1;
    }
  }
  out.push(line.slice(start));
  return out;
}

function emptyReport(diagramType: string, issues: MermaidIssue[]): MermaidImportResult {
  return {
    graph: null,
    report: { diagramType, supported: false, complete: false, nodeCount: 0, edgeCount: 0, subgraphCount: 0, issues },
  };
}

/**
 * Parse Mermaid flowchart source (`flowchart` / `graph`) into a fancy-flow
 * graph of display-only nodes, laid out with `./layout`.
 *
 * Never throws. `graph` is `null` when nothing can be drawn honestly; the
 * report says why. See AGENTS.md "Mermaid" for the supported subset.
 */
export function fromMermaid(source: string, options: MermaidImportOptions = {}): MermaidImportResult {
  const limits: MermaidLimits = { ...MERMAID_DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const issues: MermaidIssue[] = [];

  if (typeof source !== "string") {
    issues.push({ severity: "error", code: "parse-error", message: "Mermaid source must be a string." });
    return emptyReport("unknown", issues);
  }
  if (source.length > limits.maxInputLength) {
    issues.push({
      severity: "error",
      code: "limit-exceeded",
      message: `The source is ${source.length} characters, over maxInputLength (${limits.maxInputLength}). It was not read.`,
    });
    return emptyReport("unknown", issues);
  }

  const lines = source.split(/\r\n|\r|\n/);
  const reader = new Reader(limits, issues);
  let i = 0;

  // YAML front matter.
  if (lines[0]?.trim() === "---") {
    let close = -1;
    for (let k = 1; k < lines.length; k++) {
      if (lines[k].trim() === "---") {
        close = k;
        break;
      }
    }
    if (close > 0) {
      if (lines.slice(1, close).some((l) => l.trim() !== "")) {
        issues.push({
          severity: "warning",
          code: "frontmatter-ignored",
          line: 1,
          message: "Front matter (title, config) is not imported.",
          text: clip(lines.slice(1, close).join("\n")),
        });
      }
      i = close + 1;
    }
  }

  // The first line that is not a comment or directive names the diagram type.
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.startsWith("%%")) {
      reader.line = i + 1;
      reader.comment(t);
      continue;
    }
    break;
  }
  if (i >= lines.length) {
    issues.push({ severity: "error", code: "empty", message: "There is no diagram to draw." });
    return emptyReport("empty", issues);
  }

  const header = lines[i].trim();
  const keyword = /^[A-Za-z][\w-]*/.exec(header)?.[0] ?? "";
  if (!FLOWCHART_KEYWORDS.has(keyword)) {
    const type = DIAGRAM_TYPES.get(keyword) ?? "unknown";
    issues.push({
      severity: "error",
      code: "unsupported-diagram",
      line: i + 1,
      message:
        type === "unknown"
          ? `"${clip(keyword || header, 40)}" is not a Mermaid diagram type this importer knows. Only flowcharts are drawn.`
          : `Mermaid ${type} diagrams are not supported yet. Only flowcharts (\`flowchart\` / \`graph\`) are drawn.`,
    });
    return emptyReport(type, issues);
  }

  reader.line = i + 1;
  const semi = header.indexOf(";");
  const dirText = (semi < 0 ? header.slice(keyword.length) : header.slice(keyword.length, semi)).trim();
  let direction: MermaidDirection = "TB";
  if (dirText) {
    const dir = DIRECTIONS.get(dirText);
    if (dir) direction = dir;
    else reader.issue("error", "parse-error", `Unknown direction "${clip(dirText, 20)}"; drawn top to bottom.`, header);
  }
  if (keyword === "flowchart-elk") {
    reader.issue("warning", "unsupported-statement", "The ELK renderer is not used; the diagram is laid out with dagre.");
  }

  try {
    if (semi >= 0) for (const st of statements(header.slice(semi + 1))) reader.statement(st);
    for (i = i + 1; i < lines.length; i++) {
      reader.line = i + 1;
      const t = lines[i].trim();
      if (t.startsWith("%%")) {
        reader.comment(t);
        continue;
      }
      // `accDescr { ... }` spans lines.
      if (/^accDescr\s*\{/.test(t) && !t.includes("}")) {
        reader.issue("warning", "unsupported-statement", "`accDescr` is not imported.", t);
        while (i + 1 < lines.length && !lines[i].includes("}")) i++;
        continue;
      }
      for (const st of statements(lines[i])) reader.statement(st);
    }
  } catch (error) {
    if (error instanceof Fatal) {
      issues.push(error.issue);
      // A flowchart, and a supported one, that is too big to draw honestly.
      const { report } = emptyReport("flowchart", issues);
      return { graph: null, report: { ...report, supported: true, direction } };
    }
    throw error;
  }

  for (const open of reader.stack) {
    issues.push({
      severity: "warning",
      code: "unclosed-subgraph",
      line: open.line,
      message: "A subgraph is never closed with `end`; it was closed at the end of the diagram.",
    });
  }

  const graph = build(reader, direction);
  const subgraphCount = [...reader.nodes.values()].filter((n) => n.subgraph).length;
  return {
    graph,
    report: {
      diagramType: "flowchart",
      supported: true,
      complete: !issues.some((x) => x.severity === "error"),
      direction,
      nodeCount: reader.nodes.size - subgraphCount,
      edgeCount: reader.edges.length,
      subgraphCount,
      issues,
    },
  };
}

function build(reader: Reader, direction: MermaidDirection): MermaidGraph {
  // Parents before children, otherwise in order of first mention.
  const placed = new Set<string>();
  const ordered: NodeRec[] = [];
  const place = (id: string) => {
    if (placed.has(id)) return;
    const rec = reader.nodes.get(id)!;
    if (rec.parent !== null) place(rec.parent);
    placed.add(id);
    ordered.push(rec);
  };
  for (const id of reader.order) place(id);

  const nodes: FlowNode[] = ordered.map((n) => {
    const mermaid = {
      id: n.id,
      shape: n.shape,
      ...(n.subgraph ? { subgraph: true as const } : {}),
      ...(n.direction ? { direction: n.direction } : {}),
    };
    return {
      id: n.id,
      // `note`: the engine walks past it. See the module comment.
      type: "note",
      position: { x: 0, y: 0 },
      ...(n.parent !== null ? { parentId: n.parent } : {}),
      data: { kind: "note", label: n.label, config: { text: n.label }, mermaid },
    } as unknown as FlowNode;
  });

  const edges: FlowEdge[] = reader.edges.map((e, k) => ({
    id: `e${k}`,
    source: e.source,
    target: e.target,
    ...(e.label !== undefined ? { label: e.label } : {}),
    data: { mermaid: e.meta },
  }));

  return { nodes: layoutMermaid(nodes, edges, direction), edges, mermaid: { direction } };
}
