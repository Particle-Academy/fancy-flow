import { type CSSProperties, useEffect, useRef } from "react";
import type { FlowRunFeedEntry } from "../runtime/use-flow-run";

export type FlowRunFeedProps = {
  entries: FlowRunFeedEntry[];
  className?: string;
  style?: CSSProperties;
};

/** FlowRunFeed — scrolling log panel. Auto-scrolls to bottom on new entries. */
export function FlowRunFeed({ entries, className, style }: FlowRunFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div className={["ff-run-feed", className ?? ""].filter(Boolean).join(" ")} style={style} ref={scrollRef}>
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
  );
}

function formatTime(at: number): string {
  const d = new Date(at);
  return `${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${Math.floor(d.getMilliseconds() / 100)}`;
}
