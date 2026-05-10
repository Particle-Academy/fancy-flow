import { registerNodeKind } from "./registry";
import type { ConfigField, NodeKindDefinition } from "./types";

/**
 * Built-in agentic node kit. Every kind ships with schema + UI but
 * NO executor — host apps wire executors per kind so they control where
 * memory, data, network, and AI calls actually go.
 */

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
    name: "manual_trigger",
    category: "trigger",
    label: "Manual",
    description: "Entry point fired when the user clicks Run.",
    icon: "⚡",
    inputs: [],
    outputs: [{ id: "out" }],
  },
  {
    name: "webhook_trigger",
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
    name: "schedule_trigger",
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
    name: "user_input",
    category: "human",
    label: "User Input",
    description: "Pause the flow until the user submits the configured form.",
    icon: "✎",
    inputs: [{ id: "in" }],
    outputs: [{ id: "out", label: "values" }],
    configSchema: [
      { type: "text", key: "title", label: "Form title", default: "Need your input" },
      { type: "json", key: "fields", label: "Fields (JSON)", language: "json", rows: 6,
        default: [{ key: "answer", label: "Your answer", type: "textarea" }] },
    ],
  },

  // ───────────── Logic ─────────────
  {
    name: "branch",
    category: "logic",
    label: "Branch",
    description: "Multi-way branch on a condition or value.",
    icon: "◇",
    inputs: [{ id: "in" }],
    outputs: [{ id: "true", label: "true" }, { id: "false", label: "false" }],
    configSchema: [
      { type: "expression", key: "condition", label: "Condition", example: "{{ $json.active }}", required: true },
    ],
  },
  {
    name: "switch_case",
    category: "logic",
    label: "Switch",
    description: "Route to one of N labelled outputs based on a key.",
    icon: "⤳",
    inputs: [{ id: "in" }],
    outputs: [{ id: "case_a", label: "a" }, { id: "case_b", label: "b" }, { id: "default", label: "default" }],
    configSchema: [
      { type: "expression", key: "value", label: "Switch on", example: "{{ $json.kind }}", required: true },
      { type: "json", key: "cases", label: "Cases (JSON)", default: { a: "case_a", b: "case_b" } },
    ],
  },
  {
    name: "for_each",
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
    name: "merge",
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
    name: "wait",
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
    name: "transform",
    category: "logic",
    label: "Transform",
    description: "Reshape data with an expression.",
    icon: "ƒ",
    configSchema: [
      { type: "expression", key: "expression", label: "Expression",
        example: "{{ { id: $json.id, name: $json.first + ' ' + $json.last } }}", required: true },
    ],
  },

  // ───────────── Data ─────────────
  {
    name: "memory_store",
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
    name: "data_store",
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
      { type: "json", key: "where", label: "Where (JSON)", description: "For query/list operations." },
      { type: "expression", key: "value", label: "Value (set only)", example: "{{ $json }}" },
      { type: "credential", key: "store", label: "Data store", credentialType: "data_store" },
    ],
  },
  {
    name: "variable",
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
    name: "llm_call",
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
      { type: "json", key: "tools", label: "Tools (JSON)", description: "Optional Anthropic-style tool definitions." },
      { type: "credential", key: "credential", label: "API credential", credentialType: "llm_credential" },
    ],
  },
  {
    name: "tool_use",
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
    name: "embed_search",
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
    name: "api_request",
    category: "io",
    label: "API Request",
    description: "HTTP request to any URL.",
    icon: "↔",
    configSchema: [
      ...HTTP_METHODS,
      { type: "text", key: "url", label: "URL", placeholder: "https://api.example.com/...", required: true },
      { type: "json", key: "headers", label: "Headers", default: { "content-type": "application/json" } },
      { type: "json", key: "body", label: "Body" },
      { type: "credential", key: "auth", label: "Auth", credentialType: "api_credential" },
    ],
  },
  {
    name: "webhook_out",
    category: "io",
    label: "Send Webhook",
    description: "POST a payload to a configured URL.",
    icon: "↗",
    configSchema: [
      { type: "text", key: "url", label: "URL", required: true },
      { type: "json", key: "headers", label: "Headers" },
      { type: "expression", key: "payload", label: "Payload", required: true, example: "{{ $json }}" },
    ],
  },

  // ───────────── Human ─────────────
  {
    name: "human_approval",
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
    name: "notify",
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
    name: "output",
    category: "output",
    label: "Output",
    description: "Terminal node — captures the workflow's result.",
    icon: "●",
    inputs: [{ id: "in" }],
    outputs: [],
  },
  {
    name: "log",
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
