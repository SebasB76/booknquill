import MarkdownIt from "markdown-it";
import type { JSONContent } from "@tiptap/react";

// `breaks` keeps single newlines as line breaks, which is how notes are written in Omawrite.
const md = new MarkdownIt({ html: false, linkify: false, breaks: true });

// Images carry Obsidian-style options in the alt text: `![left|320](images/a.png)`.
md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx];
  const { align, width } = parseImageAlt(token.content);
  const src = String(token.attrGet("src") ?? "");
  const esc = md.utils.escapeHtml;
  return `<img data-src="${esc(src)}" data-align="${align}"${width ? ` data-width="${width}"` : ""}>`;
};

export type ImageAlign = "left" | "center" | "right" | "full";

export function parseImageAlt(alt: string): { align: ImageAlign; width: number | null } {
  const [first, size] = alt.split("|");
  const word = first.trim();
  const align: ImageAlign = word === "left" || word === "right" || word === "full" ? word : "center";
  const width = size ? parseInt(size, 10) : NaN;
  return { align, width: Number.isFinite(width) && width > 0 ? width : null };
}

export function markdownToHtml(source: string): string {
  const doc = new DOMParser().parseFromString(md.render(source), "text/html");
  // A paragraph holding only an image becomes the image block itself.
  doc.querySelectorAll("p").forEach((p) => {
    const kids = [...p.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()) && n.nodeName !== "BR");
    if (kids.length && kids.every((n) => n.nodeName === "IMG")) p.replaceWith(...kids);
  });
  // `- [ ] x` items become task items, but only when the whole list is tasks.
  doc.querySelectorAll("ul").forEach((ul) => {
    const items = [...ul.children].filter((c) => c.nodeName === "LI");
    const marks = items.map((li) => /^\[( |x|X)\]\s/.exec(li.textContent ?? ""));
    if (!items.length || marks.some((m) => !m)) return;
    ul.setAttribute("data-type", "taskList");
    items.forEach((li, i) => {
      li.setAttribute("data-type", "taskItem");
      li.setAttribute("data-checked", String(marks[i]![1].toLowerCase() === "x"));
      stripLeadingText(li, marks[i]![0].length);
    });
  });
  return doc.body.innerHTML;
}

function stripLeadingText(el: Element, count: number) {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let left = count;
  while (left > 0 && walker.nextNode()) {
    const t = walker.currentNode as Text;
    const cut = Math.min(left, t.data.length);
    t.data = t.data.slice(cut);
    left -= cut;
  }
}

/** Serializes the editor document back to Markdown. */
export function docToMarkdown(doc: JSONContent): string {
  const out = blocks(doc.content ?? [], "").replace(/\n{3,}/g, "\n\n").trim();
  return out ? out + "\n" : "";
}

function blocks(nodes: JSONContent[], indent: string): string {
  return nodes
    .map((n) => block(n, indent))
    .filter((b) => b !== null)
    .join("\n\n");
}

function block(n: JSONContent, indent: string): string | null {
  switch (n.type) {
    case "paragraph": {
      const text = inline(n.content ?? []);
      return text.trim() ? prefixLines(text, indent) : null;
    }
    case "heading":
      return indent + "#".repeat(n.attrs?.level ?? 1) + " " + inline(n.content ?? []);
    case "bulletList":
      return list(n, indent, () => "- ");
    case "orderedList": {
      const start = n.attrs?.start ?? 1;
      return list(n, indent, (i) => `${start + i}. `);
    }
    case "taskList":
      return list(n, indent, (_, item) => `- [${item.attrs?.checked ? "x" : " "}] `);
    case "blockquote":
      return prefixLines(blocks(n.content ?? [], ""), indent + "> ");
    case "codeBlock": {
      const lang = n.attrs?.language ?? "";
      const code = (n.content ?? []).map((c) => c.text ?? "").join("");
      return prefixLines("```" + lang + "\n" + code + "\n```", indent);
    }
    case "horizontalRule":
      return indent + "---";
    case "noteImage":
      return indent + imageMarkdown(n.attrs ?? {});
    default:
      return n.content ? blocks(n.content, indent) : null;
  }
}

function list(n: JSONContent, indent: string, marker: (i: number, item: JSONContent) => string): string {
  return (n.content ?? [])
    .map((item, i) => {
      const m = marker(i, item);
      const [first, ...rest] = item.content ?? [];
      const head = first ? inline(first.content ?? []) : "";
      const lines = [indent + m + head.replace(/\n/g, "\n" + indent + " ".repeat(m.length))];
      for (const child of rest) {
        const b = block(child, indent + " ".repeat(m.length));
        if (b !== null) lines.push(b);
      }
      return lines.join("\n");
    })
    .join("\n");
}

export function imageMarkdown(attrs: Record<string, unknown>): string {
  const align = (attrs.align as ImageAlign) ?? "center";
  const width = attrs.width as number | null;
  const alt = (align === "center" ? "" : align) + (width && align !== "full" ? `|${Math.round(width)}` : "");
  return `![${alt}](${attrs.src ?? ""})`;
}

const MARKS: Record<string, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  strike: ["~~", "~~"],
  code: ["`", "`"],
};

function inline(nodes: JSONContent[]): string {
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "\n";
      if (n.type !== "text") return "";
      let text = n.text ?? "";
      for (const mark of n.marks ?? []) {
        if (mark.type === "link") text = `[${text}](${mark.attrs?.href ?? ""})`;
        const wrap = MARKS[mark.type];
        if (wrap) text = wrap[0] + text + wrap[1];
      }
      return text;
    })
    .join("");
}

function prefixLines(text: string, prefix: string): string {
  return prefix ? text.split("\n").map((l) => prefix + l).join("\n") : text;
}

/** The note title is its first written line, without Markdown markers. */
export function titleOf(markdown: string): string {
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("![")) continue;
    return line
      .replace(/^#+\s*/, "")
      .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "")
      .replace(/^>\s*/, "")
      .replace(/[*_`~]/g, "")
      .trim();
  }
  return "";
}

export function wordCount(markdown: string): number {
  return markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
