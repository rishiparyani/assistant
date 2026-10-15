// The little Markdown a model writes, read into spans and blocks (no drawing here, so the
// server and tests can use it too); packages/cards/src/native/markdown.tsx draws it.
export type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

/** Inline marks: **bold**, *italic* or _italic_, `code`. Unmatched marks stay as typed. */
export function spansOf(line: string): Span[] {
  const out: Span[] = [];
  // Plain text next to plain text is one span (the space before *italics* joins what came before).
  const plain = (text: string) => {
    const last = out[out.length - 1];
    if (last && !last.bold && !last.italic && !last.code) last.text += text;
    else out.push({ text });
  };
  // No lookbehind (not every JavaScript engine has it): the space before *italics* is matched
  // and put back as plain text.
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|(^|[\s(])\*([^*\n]+)\*|(^|[\s(])_([^_\n]+)_)/g;
  let at = 0;
  for (const m of line.matchAll(re)) {
    if (m.index! > at) plain(line.slice(at, m.index));
    if (m[2] !== undefined) out.push({ text: m[2], bold: true });
    else if (m[3] !== undefined) out.push({ text: m[3], code: true });
    else {
      const lead = m[4] ?? m[6] ?? "";
      if (lead) plain(lead);
      out.push({ text: (m[5] ?? m[7])!, italic: true });
    }
    at = m.index! + m[0].length;
  }
  if (at < line.length) plain(line.slice(at));
  return out;
}

export type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; text: string }
  | { kind: "list"; items: string[]; ordered: boolean };

/** Lines into blocks: a blank line ends a paragraph; "- ", "• " and "1. " make lists; "#" a heading. */
export function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", lines: para });
    para = [];
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^#{1,3}\s+(.+)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: "h", text: h[1]! });
      continue;
    }
    const li = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line);
    if (li) {
      flush();
      const ordered = /^\s*\d/.test(line);
      const last = blocks[blocks.length - 1];
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(li[1]!);
      else blocks.push({ kind: "list", items: [li[1]!], ordered });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}
