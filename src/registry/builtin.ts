import { createElement } from "react";
import { registerNodeKind } from "./registry";
import { RichInputPreview } from "./rich-input";
import { llmRouterExecutor } from "./llm-router";
import { subflowExecutor, subflowPorts, DEFAULT_MAX_DEPTH } from "./subflow";
import type { PortDescriptor } from "../types";
import type { ConfigField, NodeKindDefinition } from "./types";

/**
 * Built-in agentic node kit. Every kind ships with schema + UI but
 * NO executor — host apps wire executors per kind so they control where
 * memory, data, network, and AI calls actually go.
 */

/**
 * Ports for `switch_case`, derived from its `cases` map (match value → port).
 *
 * Several match values may route to the same port, so ports are de-duplicated
 * and labelled with every value that reaches them ("a|c"). `default` is always
 * present — unmatched input has to land somewhere.
 */
function casePorts(cases: unknown): PortDescriptor[] {
  const byPort = new Map<string, string[]>();
  if (cases && typeof cases === "object" && !Array.isArray(cases)) {
    for (const [match, port] of Object.entries(cases as Record<string, unknown>)) {
      if (typeof port !== "string" || port === "" || port === "default") continue;
      const matches = byPort.get(port) ?? [];
      matches.push(match);
      byPort.set(port, matches);
    }
  }
  const ports: PortDescriptor[] = [...byPort].map(([id, matches]) => ({
    id,
    label: matches.join("|"),
  }));
  return [...ports, { id: "default", label: "default" }];
}

/**
 * Ports for `llm_branch`, derived from its `routes` list. Blank and duplicate
 * port names are dropped so a half-typed route can't collide with a real one.
 */
function routePorts(routes: unknown, fallback?: unknown): PortDescriptor[] {
  const ports: PortDescriptor[] = [];
  const seen = new Set<string>();
  if (Array.isArray(routes)) {
    for (const route of routes) {
      const id = (route as any)?.port;
      if (typeof id !== "string" || id.trim() === "" || seen.has(id)) continue;
      seen.add(id);
      ports.push({ id, label: id });
    }
  }
  if (fallback !== false && !seen.has("fallback")) {
    ports.push({ id: "fallback", label: "fallback" });
  }
  if (ports.length === 0) ports.push({ id: "out" });
  return ports;
}

const HTTP_METHODS: ConfigField[] = [
  { type: "select", key: "method", label: "Method", options: [
    { value: "GET", label: "GET" },
    { value: "POST", label: "POST" },
    { value: "PUT", label: "PUT" },
    { value: "PATCH", label: "PATCH" },
    { value: "DELETE", label: "DELETE" },
  ], default: "GET", required: true },
];

const KINDS: NodeKindDefinition[] = [
  // ───────────── Triggers ─────────────
  {
    name: "@particle-academy/manual_trigger",
    aliases: ["manual_trigger", "@fancy/manual_trigger"],
    category: "trigger",
    label: "Manual",
    description: "Entry point fired when the user clicks Run.",
    icon: "⚡",
    inputs: [],
    outputs: [{ id: "out" }],
  },
  {
    name: "@particle-academy/webhook_trigger",
    aliases: ["webhook_trigger", "@fancy/webhook_trigger"],
    category: "trigger",
    label: "Webhook",
    description: "Triggered by an inbound HTTP request to a host-provided URL.",
    icon: "📡",
    inputs: [],
    outputs: [{ id: "out", label: "payload" }],
    configSchema: [
      { type: "text", key: "path", label: "Path", placeholder: "/hooks/my-flow", required: true },
      { type: "select", key: "method", label: "Method", options: [
        { value: "POST", label: "POST" }, { value: "GET", label: "GET" },
      ], default: "POST" },
      { type: "credential", key: "secret", label: "Verifying secret", credentialType: "webhook_secret" },
    ],
  },
  {
    name: "@particle-academy/schedule_trigger",
    aliases: ["schedule_trigger", "@fancy/schedule_trigger"],
    category: "trigger",
    label: "Schedule",
    description: "Fires on a cron schedule (host-implemented).",
    icon: "⏱",
    inputs: [],
    outputs: [{ id: "out" }],
    configSchema: [
      { type: "text", key: "cron", label: "Cron", placeholder: "*/5 * * * *", required: true,
        description: "Standard 5-field cron expression." },
      { type: "text", key: "timezone", label: "Timezone", placeholder: "UTC", default: "UTC" },
    ],
  },
  {
    name: "@particle-academy/user_input",
    aliases: ["user_input", "@fancy/user_input"],
    category: "human",
    label: "User Input",
    description: "Pause the flow until the user submits the configured form.",
    icon: "✎",
    inputs: [{ id: "in" }],
    outputs: [{ id: "out", label: "values" }],
    configSchema: [
      { type: "text", key: "title", label: "Form title", default: "Need your input" },
      {
        type: "repeater",
        key: "fields",
        label: "Fields",
        description: "The form the run pauses on.",
        titleKey: "label",
        addLabel: "Add field",
        minItems: 1,
        fields: [
          { type: "text", key: "key", label: "Key", required: true, placeholder: "answer" },
          { type: "text", key: "label", label: "Label", required: true, placeholder: "Your answer" },
          {
            type: "select", key: "type", label: "Type", default: "text",
            options: [
              { value: "text", label: "Text" },
              { value: "textarea", label: "Long text" },
              { value: "number", label: "Number" },
              { value: "select", label: "Select" },
              { value: "switch", label: "Switch" },
            ],
          },
          { type: "switch", key: "required", label: "Required", default: false },
        ],
        default: [{ key: "answer", label: "Your answer", type: "textarea", required: true }],
      },
    ],
  },

  {
    name: "@particle-academy/rich_user_input",
    aliases: ["rich_user_input", "@fancy/rich_user_input"],
    category: "human",
    label: "Rich User Input",
    description: "Pause the flow on a fully authored page — content, required reading, multi-section forms.",
    icon: "▤",
    inputs: [{ id: "in" }],
    outputs: [{ id: "out", label: "values" }],
    configSchema: [
      { type: "text", key: "title", label: "Step title", default: "Please review" },
      {
        type: "document",
        key: "document",
        label: "Page content",
        documentType: "stages",
        description: "Authored with the host's document editor (fancy-cms Stages).",
      },
      { type: "switch", key: "requireConfirm", label: "Require explicit confirmation", default: true },
      { type: "text", key: "submitLabel", label: "Submit button", default: "Continue" },
    ],
    // Preview the authored page inside a FauxClient frame, so the canvas shows
    // what the person hitting this step will actually see.
    renderBody: (ctx) => createElement(RichInputPreview, { config: (ctx.config ?? {}) as Record<string, unknown> }),
  },

  {
    name: "@particle-academy/subflow",
    aliases: ["subflow", "@fancy/subflow"],
    category: "logic",
    label: "SubFlow",
    description: "Run another workflow and bring its result — or its live progress — back into this one.",
    icon: "⧉",
    inputs: [{ id: "in" }],
    // The stream port only exists when something actually streams.
    outputs: (config: any) => subflowPorts(config ?? {}),
    // Core, not marketplace: it runs a child graph through this same engine and
    // needs nothing from outside except where workflows live.
    executor: subflowExecutor,
    configSchema: [
      { type: "text", key: "workflow", label: "Workflow", required: true,
        placeholder: "onboarding-v2",
        description: "Reference resolved by the host's registerWorkflowResolver()." },
      {
        type: "select", key: "mode", label: "Return", default: "output",
        options: [
          { value: "output", label: "Output when it finishes" },
          { value: "stream", label: "Stream progress as it runs" },
          { value: "both", label: "Both — stream, then output" },
        ],
        description: "Streaming adds a second port so a parent can show progress instead of a spinner.",
      },
      { type: "keyvalue", key: "inputs", label: "Input mapping",
        description: "Values handed to the child's entry points. Omit to pass this node's inputs straight through.",
        keyLabel: "Name", valueLabel: "Value", addLabel: "Add input" },
      { type: "number", key: "maxDepth", label: "Max nesting depth", default: DEFAULT_MAX_DEPTH, min: 1, max: 32,
        description: "Guards against a workflow referencing itself." },
    ],
  },

  // ───────────── Logic ─────────────
  {
    name: "@particle-academy/branch",
    aliases: ["branch", "@fancy/branch"],
    category: "logic",
    label: "Branch",
    description: "Multi-way branch on a condition or value.",
    icon: "◇",
    inputs: [{ id: "in" }],
    outputs: [{ id: "true", label: "true" }, { id: "false", label: "false" }],
    configSchema: [
      {
        type: "select", key: "match", label: "Match", default: "all",
        options: [
          { value: "all", label: "All conditions (AND)" },
          { value: "any", label: "Any condition (OR)" },
        ],
      },
      {
        type: "repeater",
        key: "conditions",
        label: "Conditions",
        description: "Routes to `true` when these match, otherwise `false`.",
        titleKey: "left",
        addLabel: "Add condition",
        minItems: 1,
        fields: [
          { type: "expression", key: "left", label: "Value", example: "{{ $json.status }}", required: true },
          {
            type: "select", key: "operator", label: "Is", default: "eq",
            options: [
              { value: "eq", label: "equal to" },
              { value: "neq", label: "not equal to" },
              { value: "contains", label: "contains" },
              { value: "not_contains", label: "does not contain" },
              { value: "gt", label: "greater than" },
              { value: "gte", label: "greater than or equal to" },
              { value: "lt", label: "less than" },
              { value: "lte", label: "less than or equal to" },
              { value: "truthy", label: "true" },
              { value: "falsy", label: "false" },
              { value: "empty", label: "empty" },
              { value: "not_empty", label: "not empty" },
            ],
          },
          { type: "text", key: "right", label: "Compared to", placeholder: "active" },
        ],
        default: [{ left: "", operator: "eq", right: "" }],
      },
      {
        type: "expression",
        key: "condition",
        label: "Raw expression (advanced)",
        example: "{{ $json.active && $json.score > 10 }}",
        description: "Escape hatch for logic the builder can't express. Overrides the conditions above when set.",
      },
    ],
  },
  {
    name: "@particle-academy/switch_case",
    aliases: ["switch_case", "@fancy/switch_case"],
    category: "logic",
    label: "Switch",
    description: "Route to one of N labelled outputs based on a key.",
    icon: "⤳",
    inputs: [{ id: "in" }],
    // Ports ARE the config: every distinct port a case routes to becomes an
    // output handle, plus the always-present `default`. Editing the cases map
    // moves the ports on the canvas and the ports the runtime activates.
    outputs: (config: any) => casePorts(config?.cases),
    configSchema: [
      { type: "expression", key: "value", label: "Switch on", example: "{{ $json.kind }}", required: true },
      {
        type: "keyvalue",
        key: "cases",
        label: "Cases",
        description: "Match value → output port. Unmatched input takes `default`.",
        keyLabel: "When value is",
        valueLabel: "Route to port",
        keyPlaceholder: "a",
        valuePlaceholder: "case_a",
        addLabel: "Add case",
        default: { a: "case_a", b: "case_b" },
      },
    ],
  },
  {
    name: "@particle-academy/for_each",
    aliases: ["for_each", "@fancy/for_each"],
    category: "logic",
    label: "For Each",
    description: "Iterate over a list, emitting each item on `item`.",
    icon: "↻",
    inputs: [{ id: "in" }],
    outputs: [{ id: "item", label: "item" }, { id: "done", label: "done" }],
    configSchema: [
      { type: "expression", key: "source", label: "List", example: "{{ $json.users }}", required: true },
      { type: "number", key: "concurrency", label: "Concurrency", default: 1, min: 1, max: 50 },
    ],
  },
  {
    name: "@particle-academy/merge",
    aliases: ["merge", "@fancy/merge"],
    category: "logic",
    label: "Merge",
    description: "Combine multiple inputs into one object or array.",
    icon: "⊕",
    inputs: [{ id: "a" }, { id: "b" }],
    outputs: [{ id: "out" }],
    configSchema: [
      { type: "select", key: "mode", label: "Mode", default: "merge",
        options: [{ value: "merge", label: "Object merge" }, { value: "concat", label: "Array concat" }] },
    ],
  },
  {
    name: "@particle-academy/wait",
    aliases: ["wait", "@fancy/wait"],
    category: "logic",
    label: "Wait",
    description: "Sleep or wait for an external event.",
    icon: "⏸",
    configSchema: [
      { type: "select", key: "mode", label: "Mode", default: "duration",
        options: [{ value: "duration", label: "Duration" }, { value: "until", label: "Until timestamp" }, { value: "event", label: "External event" }] },
      { type: "text", key: "duration", label: "Duration", placeholder: "5s, 10m, 1h", description: "Used when mode = duration." },
    ],
  },
  {
    name: "@particle-academy/transform",
    aliases: ["transform", "@fancy/transform"],
    category: "logic",
    label: "Transform",
    description: "Reshape data with an expression.",
    icon: "ƒ",
    configSchema: [
      {
        type: "select", key: "mode", label: "Build the output", default: "fields",
        options: [
          { value: "fields", label: "Field by field" },
          { value: "expression", label: "One expression" },
        ],
      },
      {
        type: "repeater",
        key: "fields",
        label: "Output fields",
        description: "Each row becomes a key on the result.",
        titleKey: "key",
        addLabel: "Add field",
        fields: [
          { type: "text", key: "key", label: "Key", required: true, placeholder: "name" },
          { type: "expression", key: "value", label: "Value", example: "{{ $json.first }}", required: true },
        ],
        default: [{ key: "", value: "" }],
      },
      {
        type: "expression",
        key: "expression",
        label: "Expression (advanced)",
        example: "{{ { id: $json.id, name: $json.first + ' ' + $json.last } }}",
        description: "Used when the mode above is set to one expression.",
      },
    ],
  },

  // ───────────── Data ─────────────
  {
    name: "@particle-academy/memory_store",
    aliases: ["memory_store", "@fancy/memory_store"],
    category: "data",
    label: "Memory Store",
    description: "Read or write per-conversation memory.",
    icon: "🧠",
    configSchema: [
      { type: "select", key: "operation", label: "Operation", required: true, default: "read",
        options: [{ value: "read", label: "Read" }, { value: "write", label: "Write" }, { value: "append", label: "Append" }] },
      { type: "text", key: "key", label: "Key", placeholder: "user.preferences", required: true },
      { type: "expression", key: "value", label: "Value (write/append only)", example: "{{ $json }}" },
      { type: "credential", key: "store", label: "Memory store", credentialType: "memory_store" },
    ],
  },
  {
    name: "@particle-academy/data_store",
    aliases: ["data_store", "@fancy/data_store"],
    category: "data",
    label: "Data Store",
    description: "Key-value or table read/write against a host store.",
    icon: "🗃",
    configSchema: [
      { type: "select", key: "operation", label: "Operation", required: true, default: "get",
        options: [
          { value: "get", label: "Get" }, { value: "set", label: "Set" }, { value: "delete", label: "Delete" },
          { value: "query", label: "Query" }, { value: "list", label: "List" },
        ] },
      { type: "text", key: "table", label: "Table / collection", required: true },
      { type: "text", key: "key", label: "Key" },
      { type: "keyvalue", key: "where", label: "Where",
        description: "Field/value pairs to match. For query and list operations.",
        keyLabel: "Field", valueLabel: "Equals", addLabel: "Add filter" },
      { type: "expression", key: "value", label: "Value (set only)", example: "{{ $json }}" },
      { type: "credential", key: "store", label: "Data store", credentialType: "data_store" },
    ],
  },
  {
    name: "@particle-academy/variable",
    aliases: ["variable", "@fancy/variable"],
    category: "data",
    label: "Variable",
    description: "Workflow-scoped value used by other nodes.",
    icon: "𝓍",
    configSchema: [
      { type: "text", key: "name", label: "Name", required: true },
      { type: "expression", key: "value", label: "Value", required: true },
    ],
  },

  // ───────────── AI ─────────────
  {
    name: "@particle-academy/llm_call",
    aliases: ["llm_call", "@fancy/llm_call"],
    category: "ai",
    label: "LLM Call",
    description: "Send a prompt + context to a model and receive a response.",
    icon: "✦",
    configSchema: [
      { type: "select", key: "provider", label: "Provider", default: "anthropic",
        options: [
          { value: "anthropic", label: "Anthropic" },
          { value: "openai", label: "OpenAI" },
          { value: "custom", label: "Custom" },
        ] },
      { type: "text", key: "model", label: "Model", placeholder: "claude-sonnet-4-5", required: true },
      { type: "textarea", key: "system", label: "System prompt", rows: 4 },
      { type: "expression", key: "prompt", label: "User prompt", example: "{{ $json.question }}", required: true },
      { type: "number", key: "temperature", label: "Temperature", min: 0, max: 2, step: 0.1, default: 0.7 },
      { type: "number", key: "max_tokens", label: "Max tokens", min: 1, max: 8192, default: 1024 },
      {
        type: "repeater", key: "tools", label: "Tools",
        description: "Tools the model may call.",
        titleKey: "name", addLabel: "Add tool",
        fields: [
          { type: "text", key: "name", label: "Name", required: true, placeholder: "search_index" },
          { type: "text", key: "description", label: "When to use it" },
          { type: "json", key: "input_schema", label: "Input schema",
            description: "JSON Schema for the tool's arguments." },
        ],
      },
      { type: "credential", key: "credential", label: "API credential", credentialType: "llm_credential" },
    ],
  },
  {
    name: "@particle-academy/llm_router",
    // Every id this node has ever shipped under keeps resolving — MOIC's saved
    // flows carry the bare `llm_branch`.
    aliases: ["llm_router", "llm_branch", "@fancy/llm_branch", "@fancy/llm_router"],
    category: "ai",
    label: "LLM Router",
    description: "Let a model choose which route the flow takes.",
    icon: "✧",
    inputs: [{ id: "in" }],
    // Each declared route is a port. The executor returns `{ __port: id }`
    // (or `Port.only(id)` on the PHP runtime) to pick one.
    outputs: (config: any) => routePorts(config?.routes, config?.fallback),
    // A shuttle, not an engine: it carries the routes out to whatever LLM
    // client the host registered and carries the choice back. No provider SDK
    // reaches core, so this stays a builtin without adding a dependency.
    executor: llmRouterExecutor,
    configSchema: [
      { type: "textarea", key: "system", label: "System prompt", rows: 3,
        description: "Optional framing for the routing decision." },
      { type: "expression", key: "prompt", label: "What to route on",
        example: "{{ $json.message }}", required: true },
      {
        type: "repeater",
        key: "routes",
        label: "Routes",
        description: "The model picks exactly one. Descriptions are what it chooses between — make them distinct.",
        titleKey: "port",
        addLabel: "Add route",
        minItems: 2,
        fields: [
          { type: "text", key: "port", label: "Port", required: true, placeholder: "billing" },
          { type: "text", key: "description", label: "When to choose it", required: true,
            placeholder: "The user is asking about an invoice, refund, or payment." },
        ],
        default: [
          { port: "a", description: "Describe when the model should pick this route." },
          { port: "b", description: "Describe when the model should pick this route." },
        ],
      },
      { type: "select", key: "provider", label: "Provider", default: "anthropic",
        options: [
          { value: "anthropic", label: "Anthropic" },
          { value: "openai", label: "OpenAI" },
          { value: "custom", label: "Custom" },
        ] },
      { type: "text", key: "model", label: "Model", placeholder: "claude-sonnet-4-5" },
      { type: "switch", key: "fallback", label: "Add a `fallback` port", default: true,
        description: "Where the flow goes if the model returns no usable route." },
      { type: "credential", key: "credential", label: "API credential", credentialType: "llm_credential" },
    ],
  },
  {
    name: "@particle-academy/tool_use",
    aliases: ["tool_use", "@fancy/tool_use"],
    category: "ai",
    label: "Tool Use",
    description: "Hand control to a host-registered tool by name.",
    icon: "🛠",
    configSchema: [
      { type: "text", key: "tool", label: "Tool name", placeholder: "search_index", required: true },
      { type: "expression", key: "args", label: "Arguments", example: "{{ { query: $json.q } }}" },
    ],
  },
  {
    name: "@particle-academy/embed_search",
    aliases: ["embed_search", "@fancy/embed_search"],
    category: "ai",
    label: "Embed & Search",
    description: "Embed a query and search a vector store.",
    icon: "✺",
    configSchema: [
      { type: "expression", key: "query", label: "Query", required: true, example: "{{ $json.question }}" },
      { type: "number", key: "topK", label: "Top K", default: 5, min: 1, max: 50 },
      { type: "credential", key: "vectorStore", label: "Vector store", credentialType: "vector_store" },
    ],
  },

  // ───────────── IO ─────────────
  {
    name: "@particle-academy/api_request",
    aliases: ["api_request", "@fancy/api_request"],
    category: "io",
    label: "API Request",
    description: "HTTP request to any URL.",
    icon: "↔",
    configSchema: [
      ...HTTP_METHODS,
      { type: "text", key: "url", label: "URL", placeholder: "https://api.example.com/...", required: true },
      { type: "keyvalue", key: "headers", label: "Headers",
        keyLabel: "Header", valueLabel: "Value",
        keyPlaceholder: "content-type", valuePlaceholder: "application/json",
        addLabel: "Add header",
        default: { "content-type": "application/json" } },
      { type: "json", key: "body", label: "Body" },
      { type: "credential", key: "auth", label: "Auth", credentialType: "api_credential" },
    ],
  },
  {
    name: "@particle-academy/webhook_out",
    aliases: ["webhook_out", "@fancy/webhook_out"],
    category: "io",
    label: "Send Webhook",
    description: "POST a payload to a configured URL.",
    icon: "↗",
    configSchema: [
      { type: "text", key: "url", label: "URL", required: true },
      { type: "keyvalue", key: "headers", label: "Headers",
        keyLabel: "Header", valueLabel: "Value", addLabel: "Add header" },
      { type: "expression", key: "payload", label: "Payload", required: true, example: "{{ $json }}" },
    ],
  },

  // ───────────── Human ─────────────
  {
    name: "@particle-academy/human_approval",
    aliases: ["human_approval", "@fancy/human_approval"],
    category: "human",
    label: "Human Approval",
    description: "Pause until a human approves or denies.",
    icon: "✓",
    inputs: [{ id: "in" }],
    outputs: [{ id: "approved", label: "approved" }, { id: "denied", label: "denied" }],
    configSchema: [
      { type: "text", key: "title", label: "Approval title", default: "Approve action" },
      { type: "textarea", key: "description", label: "Description for approver", rows: 3 },
      { type: "credential", key: "channel", label: "Notify channel", credentialType: "notify_channel" },
    ],
  },
  {
    name: "@particle-academy/notify",
    aliases: ["notify", "@fancy/notify"],
    category: "human",
    label: "Notify",
    description: "Send a message via Slack / email / SMS / etc.",
    icon: "🔔",
    configSchema: [
      { type: "select", key: "channel", label: "Channel", default: "slack",
        options: [
          { value: "slack", label: "Slack" }, { value: "email", label: "Email" },
          { value: "sms", label: "SMS" }, { value: "discord", label: "Discord" },
        ] },
      { type: "text", key: "to", label: "To", required: true },
      { type: "expression", key: "message", label: "Message", required: true, example: "{{ $json.summary }}" },
    ],
  },

  // ───────────── Output ─────────────
  {
    name: "@particle-academy/output",
    aliases: ["output", "@fancy/output"],
    category: "output",
    label: "Output",
    description: "Terminal node — captures the workflow's result.",
    icon: "●",
    inputs: [{ id: "in" }],
    outputs: [],
  },
  {
    name: "@particle-academy/log",
    aliases: ["log", "@fancy/log"],
    category: "output",
    label: "Log",
    description: "Send to the run feed.",
    icon: "≡",
    inputs: [{ id: "in" }],
    outputs: [],
    configSchema: [
      { type: "select", key: "level", label: "Level", default: "info",
        options: [{ value: "info", label: "info" }, { value: "warn", label: "warn" }, { value: "error", label: "error" }] },
      { type: "expression", key: "message", label: "Message", required: true, example: "{{ $json }}" },
    ],
  },
];

/** Register every built-in kind. Idempotent via the registry. */
export function registerBuiltinKinds(): void {
  for (const k of KINDS) registerNodeKind(k);
}

/** Exported list for hosts that want to selectively re-register. */
export const BUILTIN_KINDS: NodeKindDefinition[] = KINDS;
