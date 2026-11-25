import type { FlowGraph } from "../types";

/** Mermaid's flowchart directions. `TD` is read as `TB`. */
export type MermaidDirection = "TB" | "BT" | "LR" | "RL";

/** The node shapes the importer reads and the exporter writes. */
export type MermaidShape =
  | "rect"
  | "round"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "double-circle"
  | "asymmetric"
  | "diamond"
  | "hexagon"
  | "parallelogram"
  | "parallelogram-alt"
  | "trapezoid"
  | "trapezoid-alt";

export type MermaidStroke = "normal" | "thick" | "dotted" | "invisible";
export type MermaidEnd = "none" | "arrow" | "circle" | "cross";

/** What an imported node remembers of its Mermaid source, on `data.mermaid`. */
export type MermaidNodeMeta = {
  /** The id as written in Mermaid. */
  id: string;
  shape: MermaidShape;
  /** The node is a subgraph container; its members carry `parentId`. */
  subgraph?: true;
  /** A subgraph's own `direction` statement. */
  direction?: MermaidDirection;
};

/** What an imported edge remembers of its Mermaid source, on `data.mermaid`. */
export type MermaidEdgeMeta = {
  stroke: MermaidStroke;
  /** The end at the target. */
  head: MermaidEnd;
  /** The end at the source (`<-->`, `o--o`, `x--x`). */
  tail: MermaidEnd;
  /** Mermaid's link length: `-->` is 1, `--->` is 2. */
  length: number;
};

/** A graph imported from Mermaid. Still a plain FlowGraph; `mermaid` is extra. */
export type MermaidGraph = FlowGraph & {
  mermaid?: { direction: MermaidDirection };
};

export type MermaidIssueSeverity = "error" | "warning" | "info";

export type MermaidIssueCode =
  /** Nothing to draw: empty input, or only comments. */
  | "empty"
  /** A Mermaid diagram type other than flowchart / graph. */
  | "unsupported-diagram"
  /** Over one of the `MermaidLimits`. The import is refused. */
  | "limit-exceeded"
  /** A statement that could not be read. It is left out. */
  | "parse-error"
  /** Valid Mermaid this importer does not read (`A@{...}`, edge ids). Left out. */
  | "unsupported-syntax"
  /** Styling and metadata that has no place in the graph (`style`, `classDef`, `:::`, `accTitle`). */
  | "unsupported-statement"
  /** `click` and callbacks. Interactions are never imported. */
  | "interaction-ignored"
  /** A `%%{init: ...}%%` directive. Directives never change the import. */
  | "directive-ignored"
  /** YAML front matter. */
  | "frontmatter-ignored"
  /** A label containing markup. It is kept as literal text. */
  | "html-as-text"
  /** A label in Mermaid's markdown-string form. Shown as plain text. */
  | "markdown-as-text"
  /** A label over `maxLabelLength`, shortened. */
  | "label-truncated"
  /** A `subgraph` with no `end`. Closed at the end of the input. */
  | "unclosed-subgraph"
  /** An `end` with no open subgraph. */
  | "unexpected-end"
  /** A subgraph id already used by a node with its own label or shape. */
  | "id-collision"
  /** A `%%` comment. Comments are not kept. */
  | "comment";

export interface MermaidIssue {
  severity: MermaidIssueSeverity;
  code: MermaidIssueCode;
  /** 1-based source line. */
  line?: number;
  message: string;
  /** The source text concerned, shortened. Text only; never rendered as markup. */
  text?: string;
}

export interface MermaidReport {
  /** `flowchart` when drawn; otherwise the Mermaid type found (`sequence`, `gantt`, ...), `empty` or `unknown`. */
  diagramType: string;
  /** The diagram type is one this importer draws. */
  supported: boolean;
  /**
   * Every statement was read. `false` when any statement was left out
   * (an issue with severity `error`); what could be read is still in the graph.
   */
  complete: boolean;
  direction?: MermaidDirection;
  /** Plain nodes drawn, not counting subgraph containers. */
  nodeCount: number;
  edgeCount: number;
  subgraphCount: number;
  issues: MermaidIssue[];
}

export interface MermaidLimits {
  /** Characters of input read at all. Default 50,000. */
  maxInputLength: number;
  /** Nodes, including subgraph containers. Default 500. */
  maxNodes: number;
  /** Edges, after `A & B --> C` is expanded. Default 1,000. */
  maxEdges: number;
  /** Characters per label; longer labels are shortened and reported. Default 500. */
  maxLabelLength: number;
  /** Nested subgraphs. Default 16. */
  maxSubgraphDepth: number;
}

export interface MermaidImportOptions {
  /** Override any of the default limits. */
  limits?: Partial<MermaidLimits>;
}

export interface MermaidImportResult {
  /** `null` when nothing can be drawn honestly: unsupported type, empty, or over a limit. */
  graph: MermaidGraph | null;
  report: MermaidReport;
}

export interface MermaidExportOptions {
  /** Defaults to the direction the graph was imported with, else `TB`. */
  direction?: MermaidDirection;
}

export interface MermaidExportReport {
  /** Edges left out because an end is not a node in the graph. */
  skippedEdges: string[];
  /** Node ids that are not valid Mermaid ids, and what they were written as. */
  renamedIds: Record<string, string>;
}

export interface MermaidExportResult {
  source: string;
  report: MermaidExportReport;
}
