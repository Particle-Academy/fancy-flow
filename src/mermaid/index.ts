/**
 * `@particle-academy/fancy-flow/mermaid` — Mermaid flowcharts to and from
 * fancy-flow graphs. Pure: no React, no DOM, no third-party Mermaid code.
 *
 * Kept out of `./engine` and `./connectors` on purpose (a test reads the built
 * bundles to hold that): a headless runtime has no reason to carry a diagram
 * parser.
 */
export { fromMermaid, MERMAID_DEFAULT_LIMITS } from "./parse";
export { exportMermaid, toMermaid } from "./write";
export { mermaidNodeSize, mermaidBounds } from "./layout";
export type {
  MermaidDirection,
  MermaidShape,
  MermaidStroke,
  MermaidEnd,
  MermaidNodeMeta,
  MermaidEdgeMeta,
  MermaidGraph,
  MermaidIssue,
  MermaidIssueCode,
  MermaidIssueSeverity,
  MermaidReport,
  MermaidLimits,
  MermaidImportOptions,
  MermaidImportResult,
  MermaidExportOptions,
  MermaidExportReport,
  MermaidExportResult,
} from "./types";
