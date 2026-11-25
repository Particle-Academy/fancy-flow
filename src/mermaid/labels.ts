/**
 * Mermaid label text <-> plain text.
 *
 * A label is ALWAYS text. Mermaid itself renders labels as HTML when its
 * `htmlLabels` option is on, which is how a diagram in a chat message becomes a
 * script in a reader's page. Here the only markup that means anything is a
 * line break (`<br>`, the one tag Mermaid authors use constantly); every other
 * tag is kept as the literal characters it was written with, and reported.
 */

const NAMED: Record<string, string> = {
  quot: '"',
  amp: "&",
  lt: "<",
  gt: ">",
  apos: "'",
  nbsp: " ",
};

const BR = /<br\s*\/?>/gi;
const ENTITY = /#([a-zA-Z]{1,10}|\d{1,7});/g;
const TAG = /<\/?[a-zA-Z][^<>]*>/;

export type DecodedLabel = { text: string; html: boolean; markdown: boolean };

/** Mermaid label source -> plain text. Never produces or interprets markup. */
export function decodeLabel(raw: string): DecodedLabel {
  let text = raw;
  let markdown = false;
  // Markdown strings: "`**bold**`". Shown as the plain characters inside.
  if (text.length >= 2 && text.startsWith("`") && text.endsWith("`")) {
    text = text.slice(1, -1);
    markdown = true;
  }
  text = text.replace(BR, "\n");
  const html = TAG.test(text);
  text = text.replace(ENTITY, (whole, name: string) => {
    if (/^\d+$/.test(name)) {
      const code = Number(name);
      if (code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)) return String.fromCodePoint(code);
      return whole;
    }
    return Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name] : whole;
  });
  return { text, html, markdown };
}

/** Plain text -> a Mermaid quoted label body that reads back as the same text. */
export function encodeLabel(text: string, opts: { pipe?: boolean } = {}): string {
  let out = text
    // A `#` that would read back as an entity must itself be escaped.
    .replace(/#(?=[a-zA-Z]{1,10};|\d{1,7};)/g, "#35;")
    .replace(/"/g, "#quot;")
    // Written as entities so real Mermaid, with htmlLabels on, shows the
    // characters rather than rendering them as markup.
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/\r\n|\r|\n/g, "<br>");
  if (opts.pipe) out = out.replace(/\|/g, "#124;");
  return out;
}

/** Shorten to `max` characters (code points), marking the cut. */
export function truncateLabel(text: string, max: number): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  if (chars.length <= max) return { text, truncated: false };
  return { text: chars.slice(0, Math.max(0, max - 1)).join("") + "…", truncated: true };
}
