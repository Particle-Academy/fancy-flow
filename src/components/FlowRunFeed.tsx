import { type CSSProperties, useEffect, useRef } from "react";
import type { FlowRunFeedEntry } from "../runtime/use-flow-run";

export type FlowRunFeedProps = {
  entries: FlowRunFeedEntry[];
  /** Show the header bar (title + running badge + event count). Default true. */
  showHeader?: boolean;
  /** Header title. Default "Run feed". */
  title?: string;
  /** When true, a "running" badge shows in the header. */
  running?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * FlowRunFeed — scrolling run log with a header (title + live event count).
 * Auto-scrolls its body to the bottom on new entries.
 */
export function FlowRunFeed({ entries, showHeader = true, title = "Run feed", running, className, style }: FlowRunFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div className={["ff-run-feed", className ?? ""].filter(Boolean).join(" ")} style={style}>
      {showHeader && (
        <div className="ff-run-feed__header">
          <span className="ff-run-feed__title" aria-hidden>▸</span>
          <span className="ff-run-feed__title-text">{title}</span>
          {running && <span className="ff-run-feed__badge">running</span>}
          <span className="ff-run-feed__count">{entries.length} {entries.length === 1 ? "event" : "events"}</span>
        </div>
      )}
      <div className="ff-run-feed__body" ref={scrollRef}>
        {entries.length === 0 ? (
          <p className="ff-run-feed__empty">No run events yet.</p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className={`ff-run-feed__row ff-run-feed__row--${e.level}`}>
              <span className="ff-run-feed__time">{formatTime(e.at)}</span>
              {e.nodeId && <span className="ff-run-feed__node">{e.nodeId}</span>}
              <span className="ff-run-feed__text">{e.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatTime(at: number): string {
  const d = new Date(at);
  return `${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${Math.floor(d.getMilliseconds() / 100)}`;
}
