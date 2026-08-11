import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  availableVariables,
  baseVariables,
  describeExpressionGrammar,
  type AvailableVariable,
} from "../../expressions/variables";
import type { FlowGraph } from "../../types";

export type ExpressionFieldProps = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  /** The panel's field id + agent handle. */
  handle: { id?: string; "data-ff-field": string };
  /**
   * The graph and the node being edited. Both are needed to answer "what can I
   * write here" — without them the picker can still offer `{{ $json }}` but
   * nothing node-specific, which is the static list issue #5 asked us not to
   * ship.
   */
  graph?: FlowGraph;
  nodeId?: string;
};

/** Where the caret sits relative to an unclosed `{{`. */
type Trigger = { open: number; query: string } | null;

/**
 * Find the `{{` the caret is currently inside, if any.
 *
 * Scans back from the caret and stops at the first `}}`, so a completed
 * expression earlier in the field does not re-open the picker while the author
 * types ordinary text after it.
 */
export function findTrigger(text: string, caret: number): Trigger {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf("{{");
  if (open === -1) return null;
  if (before.indexOf("}}", open) !== -1) return null;
  return { open, query: before.slice(open + 2).trim() };
}

/** Case-insensitive substring match on the path, which is what an author types. */
export function filterVariables(vars: AvailableVariable[], query: string): AvailableVariable[] {
  const q = query.trim().toLowerCase();
  if (q === "") return vars;
  return vars.filter((v) => v.path.toLowerCase().includes(q));
}

/**
 * Replace the open `{{ …` run with a chosen variable.
 *
 * Returns the caret position too: leaving it before the closing braces is the
 * difference between "insert-on-select" and "insert, then hunt for where to
 * carry on typing".
 */
export function applyCompletion(
  text: string,
  caret: number,
  trigger: NonNullable<Trigger>,
  variable: AvailableVariable,
): { value: string; caret: number } {
  const head = text.slice(0, trigger.open);
  const tail = text.slice(caret);
  return { value: `${head}${variable.expression}${tail}`, caret: head.length + variable.expression.length };
}

/**
 * ExpressionField — a `{{ }}` field that tells the author what it accepts.
 *
 * Issue #5: the panel rendered a bare textarea with a placeholder and nothing
 * else, so writing an expression required already knowing both the grammar and
 * the exact shape of the upstream node's output. Two affordances close that:
 * typing `{{ ` opens a picker of the variables actually reachable at THIS node,
 * and a reference toggle explains the grammar.
 *
 * The picker deliberately lists only what the resolver can reach — see
 * `availableVariables`. A suggestion that resolves to `null` at runtime is
 * worse than no suggestion, because the author has no reason to doubt it.
 */
export function ExpressionField({
  value,
  onChange,
  placeholder,
  rows = 2,
  handle,
  graph,
  nodeId,
}: ExpressionFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [trigger, setTrigger] = useState<Trigger>(null);
  const [active, setActive] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  // With no graph the picker still opens — `$json` is valid at every node, and
  // an empty menu would read as "this field takes no variables".
  const variables = useMemo(
    () => (graph && nodeId ? availableVariables(graph, nodeId) : baseVariables()),
    [graph, nodeId],
  );
  const matches = useMemo(
    () => (trigger ? filterVariables(variables, trigger.query) : []),
    [trigger, variables],
  );
  const help = useMemo(() => describeExpressionGrammar(), []);
  const open = trigger !== null && matches.length > 0;

  const sync = (el: HTMLTextAreaElement) => {
    const next = findTrigger(el.value, el.selectionStart ?? el.value.length);
    setTrigger(next);
    setActive(0);
  };

  const choose = (variable: AvailableVariable) => {
    const el = ref.current;
    if (!el || !trigger) return;
    const { value: next, caret } = applyCompletion(
      el.value,
      el.selectionStart ?? el.value.length,
      trigger,
      variable,
    );
    onChange(next);
    setTrigger(null);
    // The value round-trips through the parent, so move the caret after React
    // has written it back — otherwise it lands wherever the re-render put it.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      // Enter in a picker means "take this one", not "newline".
      e.preventDefault();
      choose(matches[active] ?? matches[0]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setTrigger(null);
    }
  };

  return (
    <div className="ff-expression" data-ff-expression={handle["data-ff-field"]}>
      <textarea
        {...handle}
        ref={ref}
        className="ff-panel__input ff-panel__input--expression"
        rows={rows}
        value={value ?? ""}
        placeholder={placeholder ?? "{{ $json.field }}"}
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? `${handle.id ?? handle["data-ff-field"]}-vars` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          sync(e.target);
        }}
        onKeyDown={onKeyDown}
        onClick={(e) => sync(e.currentTarget)}
        onBlur={() => {
          // A click on an option fires blur first; let it land.
          window.setTimeout(() => setTrigger(null), 120);
        }}
      />

      <div className="ff-expression__bar">
        <button
          type="button"
          className="ff-expression__helpbtn"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((s) => !s)}
        >
          {"{{ }}"} reference
        </button>
        {variables.length > 1 && (
          <span className="ff-expression__hint">
            type <code>{"{{"}</code> for {variables.length} variables
          </span>
        )}
      </div>

      {open && (
        <ul
          className="ff-expression__menu"
          id={`${handle.id ?? handle["data-ff-field"]}-vars`}
          role="listbox"
          data-ff-expression-menu={handle["data-ff-field"]}
        >
          {matches.map((v, i) => (
            <li key={v.expression} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`ff-expression__option${i === active ? " is-active" : ""}`}
                data-ff-expression-option={v.path}
                // `onMouseDown` rather than `onClick`: the textarea's blur would
                // otherwise close the menu before the click resolved.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(v);
                }}
              >
                <code className="ff-expression__path">{v.path}</code>
                {v.source && <span className="ff-expression__source">{v.source}</span>}
                {v.description && <span className="ff-expression__desc">{v.description}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {showHelp && (
        <div className="ff-expression__help" role="note" data-ff-expression-help>
          <dl>
            {help.forms.map((f) => (
              <div key={f.syntax}>
                <dt><code>{f.syntax}</code></dt>
                <dd>{f.meaning}</dd>
              </div>
            ))}
          </dl>
          <p className="ff-expression__note">{help.note}</p>
        </div>
      )}
    </div>
  );
}
