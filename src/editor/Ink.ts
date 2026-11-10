import { Extension, Node, type Editor } from "@tiptap/core";
import { joinBackward, joinForward } from "@tiptap/pm/commands";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Command, Transaction } from "@tiptap/pm/state";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import { api } from "../lib/backend";
import { notify } from "../lib/notify";

export type InkTool = "pen" | "red" | "blue" | "green" | "marker" | "eraser";
export type Stroke = { color: string; width: number; opacity: number; points: number[] };
type Pen = Omit<Stroke, "points">;

export const INK_PENS: Record<Exclude<InkTool, "eraser">, Pen> = {
  // currentColor follows the theme's text color; other viewers draw it black.
  pen: { color: "currentColor", width: 2.5, opacity: 1 },
  red: { color: "#e5484d", width: 2.5, opacity: 1 },
  blue: { color: "#3e8ef7", width: 2.5, opacity: 1 },
  green: { color: "#30a46c", width: 2.5, opacity: 1 },
  marker: { color: "#ffd60a", width: 18, opacity: 0.4 },
};

const SVG_NS = "http://www.w3.org/2000/svg";
const ERASER_RADIUS = 8;

/**
 * A drawing over the page. The node has no height and sits right before the block it annotates, with its
 * strokes measured from its own top-left corner, so the ink moves with that block when text above changes.
 * In the file it is `![ink](images/ink-….svg)`, which other editors show as a plain image.
 */
export const Ink = Node.create({
  name: "ink",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      src: { default: "", rendered: false },
      strokes: { default: [], rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: "img[data-ink]",
        priority: 60,
        getAttrs: (el) => ({ src: el.getAttribute("data-src") ?? "", strokes: parseStrokes(el.getAttribute("data-strokes")) }),
      },
    ];
  },

  renderHTML({ node }) {
    return ["img", { "data-ink": "", "data-src": node.attrs.src, "data-strokes": JSON.stringify(node.attrs.strokes) }];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => new InkView(node, editor, getPos);
  },
});

/** Without these, Enter and Backspace next to a drawing would leave it behind or delete it. */
export const InkKeys = Extension.create({
  name: "inkKeys",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => newLineAboveInk(editor.view),
      Backspace: ({ editor }) => keepInk(editor.view, joinBackward, -1),
      Delete: ({ editor }) => keepInk(editor.view, joinForward, 1),
    };
  },
});

function parseStrokes(json: string | null): Stroke[] {
  try {
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

const writes = new Map<string, Promise<unknown>>();

class InkView implements NodeView {
  dom: HTMLElement;
  private svg: SVGSVGElement;
  private written = "";

  constructor(
    private node: PMNode,
    editor: Editor,
    getPos: () => number | undefined,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "ink";
    this.dom.contentEditable = "false";
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.classList.add("ink__svg");
    this.dom.append(this.svg);
    this.render();
    if (node.attrs.strokes.length) this.persist();
    else if (node.attrs.src) this.load(editor, getPos);
  }

  update(node: PMNode) {
    if (node.type !== this.node.type || node.attrs.src !== this.node.attrs.src) return false;
    this.node = node;
    this.render();
    this.persist();
    return true;
  }

  ignoreMutation() {
    return true;
  }

  private render() {
    this.svg.replaceChildren(...(this.node.attrs.strokes as Stroke[]).map(strokePath));
  }

  private persist() {
    const strokes = this.node.attrs.strokes as Stroke[];
    const src = this.node.attrs.src as string;
    const svg = inkSvg(strokes);
    if (!strokes.length || svg === this.written) return;
    this.written = svg;
    // One write at a time per file, so a late write never replaces a newer drawing.
    const next = (writes.get(src) ?? Promise.resolve()).then(() => api.writeInk(src, svg)).catch(() => notify("No se pudo guardar el dibujo"));
    writes.set(src, next);
  }

  private async load(editor: Editor, getPos: () => number | undefined) {
    const src = this.node.attrs.src as string;
    const strokes = await api.readImage(src).then(decodeBase64).then(parseInkSvg).catch(() => []);
    const pos = getPos();
    if (!strokes.length || editor.isDestroyed || pos === undefined) return;
    this.written = inkSvg(strokes);
    // "external": loading what the file already has is not an edit.
    editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, "strokes", strokes).setMeta("addToHistory", false).setMeta("external", true));
  }
}

function decodeBase64(b64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

function strokePath(s: Stroke): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", smoothPath(s.points));
  path.setAttribute("stroke", s.color);
  path.setAttribute("stroke-width", String(s.width));
  if (s.opacity < 1) path.setAttribute("stroke-opacity", String(s.opacity));
  return path;
}

/** Quadratic curves through the midpoints, so a mouse stroke does not look like a polygon. */
export function smoothPath(p: number[]): string {
  const n = p.length / 2;
  if (n === 0) return "";
  // A single point still needs a length for the round cap to draw a dot.
  if (n === 1) return `M${p[0]} ${p[1]}l0.01 0`;
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 1; i < n - 1; i++) {
    const mx = round((p[i * 2] + p[i * 2 + 2]) / 2);
    const my = round((p[i * 2 + 1] + p[i * 2 + 3]) / 2);
    d += `Q${p[i * 2]} ${p[i * 2 + 1]} ${mx} ${my}`;
  }
  return d + `L${p[n * 2 - 2]} ${p[n * 2 - 1]}`;
}

const round = (v: number) => Math.round(v * 10) / 10;

/** The drawing as a standalone SVG. `data-points` keeps the raw points so the app can read it back exactly. */
export function inkSvg(strokes: Stroke[]): string {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    for (let i = 0; i < s.points.length; i += 2) {
      x0 = Math.min(x0, s.points[i] - s.width);
      x1 = Math.max(x1, s.points[i] + s.width);
      y0 = Math.min(y0, s.points[i + 1] - s.width);
      y1 = Math.max(y1, s.points[i + 1] + s.width);
    }
  }
  const w = round(x1 - x0), h = round(y1 - y0);
  const paths = strokes.map(
    (s) =>
      `<path d="${smoothPath(s.points)}" fill="none" stroke="${s.color}" stroke-width="${s.width}"` +
      (s.opacity < 1 ? ` stroke-opacity="${s.opacity}"` : "") +
      ` stroke-linecap="round" stroke-linejoin="round" data-points="${s.points.join(" ")}"/>`,
  );
  return `<svg xmlns="${SVG_NS}" width="${w}" height="${h}" viewBox="${round(x0)} ${round(y0)} ${w} ${h}">\n${paths.join("\n")}\n</svg>\n`;
}

export function parseInkSvg(text: string): Stroke[] {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  return [...doc.querySelectorAll("path[data-points]")].map((p) => ({
    color: p.getAttribute("stroke") ?? "currentColor",
    width: Number(p.getAttribute("stroke-width")) || 2.5,
    opacity: Number(p.getAttribute("stroke-opacity") ?? 1),
    points: (p.getAttribute("data-points") ?? "").split(/\s+/).filter(Boolean).map(Number),
  }));
}

function newInkSrc(): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
  return `images/ink-${stamp}-${Math.random().toString(36).slice(2, 6)}.svg`;
}

/** Where a top-level node sits, measured from the editor's top-left corner. */
function originOf(view: EditorView, pos: number): { x: number; y: number } {
  const prose = view.dom.getBoundingClientRect();
  const r = (view.nodeDOM(pos) as HTMLElement).getBoundingClientRect();
  return { x: r.left - prose.left, y: r.top - prose.top };
}

const shift = (strokes: Stroke[], dx: number, dy: number): Stroke[] =>
  strokes.map((s) => ({ ...s, points: s.points.map((v, i) => round(v + (i % 2 ? dy : dx))) }));

/** The top-level block a drawing at height `y` (editor coordinates) belongs to. */
function blockAt(view: EditorView, y: number): number {
  let found = -1;
  let first = -1;
  const top = view.dom.getBoundingClientRect().top;
  view.state.doc.forEach((node, pos) => {
    if (node.type.name === "ink") return;
    if (first < 0) first = pos;
    if ((view.nodeDOM(pos) as HTMLElement).getBoundingClientRect().top - top <= y + 0.5) found = pos;
  });
  return found >= 0 ? found : first;
}

/**
 * Adds strokes (editor coordinates) to the drawing anchored at the block at `blockPos`, creating it if needed.
 * `after` joins the change to an earlier transaction, so one undo removes both.
 */
function addStrokes(view: EditorView, blockPos: number, strokes: Stroke[], after?: Transaction) {
  const before = view.state.doc.resolve(blockPos).nodeBefore;
  const join = (tr: Transaction) => (after ? tr.setMeta("appendedTransaction", after) : tr);
  if (before?.type.name === "ink") {
    const inkPos = blockPos - before.nodeSize;
    const o = originOf(view, inkPos);
    view.dispatch(join(view.state.tr.setNodeAttribute(inkPos, "strokes", [...before.attrs.strokes, ...shift(strokes, -o.x, -o.y)])));
    return;
  }
  // Margins collapse through the empty node, so where it lands is only known once it is in the page.
  const guess = originOf(view, blockPos);
  const insert = join(view.state.tr.insert(blockPos, view.state.schema.nodes.ink.create({ src: newInkSrc(), strokes: shift(strokes, -guess.x, -guess.y) })));
  view.dispatch(insert);
  const real = originOf(view, blockPos);
  if (Math.abs(real.x - guess.x) > 0.05 || Math.abs(real.y - guess.y) > 0.05) {
    view.dispatch(view.state.tr.setNodeAttribute(blockPos, "strokes", shift(strokes, -real.x, -real.y)).setMeta("appendedTransaction", insert));
  }
}

/** Removes every stroke that passes within the eraser of (x, y), in editor coordinates. */
function eraseAt(view: EditorView, x: number, y: number) {
  const changes: { pos: number; size: number; keep: Stroke[] }[] = [];
  view.state.doc.forEach((node, pos) => {
    if (node.type.name !== "ink") return;
    const o = originOf(view, pos);
    const strokes = node.attrs.strokes as Stroke[];
    const keep = strokes.filter((s) => !touches(s, x - o.x, y - o.y));
    if (keep.length !== strokes.length) changes.push({ pos, size: node.nodeSize, keep });
  });
  if (!changes.length) return;
  const tr = view.state.tr;
  for (const c of changes.reverse()) {
    if (c.keep.length) tr.setNodeAttribute(c.pos, "strokes", c.keep);
    else tr.delete(c.pos, c.pos + c.size);
  }
  view.dispatch(tr);
}

function touches(s: Stroke, x: number, y: number): boolean {
  const reach = ERASER_RADIUS + s.width / 2;
  const p = s.points;
  if (p.length === 2) return Math.hypot(p[0] - x, p[1] - y) <= reach;
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (segmentDistance(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return true;
  }
  return false;
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Enter at the start of an annotated line adds the new line above the drawing, so the drawing stays on its text. */
function newLineAboveInk(view: EditorView): boolean {
  const { $from, empty } = view.state.selection;
  if (!empty || $from.depth !== 1 || $from.parentOffset !== 0 || !$from.parent.content.size) return false;
  const blockPos = $from.before(1);
  const ink = view.state.doc.resolve(blockPos).nodeBefore;
  if (ink?.type.name !== "ink") return false;
  view.dispatch(view.state.tr.insert(blockPos - ink.nodeSize, view.state.schema.nodes.paragraph.create()).scrollIntoView());
  return true;
}

/**
 * Joining two lines across a drawing would delete the drawing. This lifts it out first, joins,
 * and puts it back where it was on the page, anchored to the joined block.
 */
function keepInk(view: EditorView, join: Command, dir: -1 | 1): boolean {
  const { $from, empty } = view.state.selection;
  if (!empty || $from.depth !== 1 || !$from.parent.isTextblock) return false;
  const atEdge = dir < 0 ? $from.parentOffset === 0 : $from.parentOffset === $from.parent.content.size;
  if (!atEdge) return false;
  const edge = dir < 0 ? $from.before(1) : $from.after(1);
  const $edge = view.state.doc.resolve(edge);
  const ink = dir < 0 ? $edge.nodeBefore : $edge.nodeAfter;
  if (ink?.type.name !== "ink") return false;
  const inkPos = dir < 0 ? edge - ink.nodeSize : edge;
  const o = originOf(view, inkPos);
  const strokes = shift(ink.attrs.strokes as Stroke[], o.x, o.y);
  const lift = view.state.tr.delete(inkPos, inkPos + ink.nodeSize);
  view.dispatch(lift);
  join(view.state, (tr) => view.dispatch(tr.setMeta("appendedTransaction", lift)), view);
  const { $from: $now } = view.state.selection;
  addStrokes(view, $now.depth ? $now.before(1) : $now.pos, strokes, lift);
  return true;
}

/**
 * Draw mode: the pointer draws on the page instead of moving the caret. `surface` takes the pointer
 * events (the scroll area, so the margins work too) and `layer` holds the stroke being drawn.
 */
export function startDrawing(editor: Editor, surface: HTMLElement, layer: HTMLElement, tool: InkTool): () => void {
  const view = editor.view;
  const local = (e: PointerEvent) => {
    const r = view.dom.getBoundingClientRect();
    return [round(e.clientX - r.left), round(e.clientY - r.top)] as const;
  };

  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    surface.setPointerCapture(e.pointerId);

    if (tool === "eraser") {
      const erase = (ev: PointerEvent) => eraseAt(view, ...local(ev));
      erase(e);
      const up = () => (surface.removeEventListener("pointermove", erase), surface.removeEventListener("pointerup", up), surface.removeEventListener("pointercancel", up));
      surface.addEventListener("pointermove", erase);
      surface.addEventListener("pointerup", up);
      surface.addEventListener("pointercancel", up);
      return;
    }

    const pen = INK_PENS[tool];
    const points: number[] = [...local(e)];
    // The live stroke is drawn in editor coordinates on a layer placed over the editor.
    const prose = view.dom.getBoundingClientRect();
    const box = layer.getBoundingClientRect();
    const preview = document.createElementNS(SVG_NS, "svg");
    preview.classList.add("ink-preview");
    preview.style.left = `${prose.left - box.left}px`;
    preview.style.top = `${prose.top - box.top}px`;
    const path = strokePath({ ...pen, points });
    preview.append(path);
    layer.append(preview);

    const move = (ev: PointerEvent) => {
      for (const c of ev.getCoalescedEvents?.() ?? [ev]) {
        const [x, y] = local(c);
        const n = points.length;
        if (Math.hypot(x - points[n - 2], y - points[n - 1]) >= 1) points.push(x, y);
      }
      path.setAttribute("d", smoothPath(points));
    };
    const up = () => {
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", up);
      surface.removeEventListener("pointercancel", up);
      preview.remove();
      let y0 = Infinity, y1 = -Infinity;
      for (let i = 1; i < points.length; i += 2) (y0 = Math.min(y0, points[i])), (y1 = Math.max(y1, points[i]));
      // The middle of the stroke picks the line: a circle around a word, or a line under it.
      addStrokes(view, blockAt(view, (y0 + y1) / 2), [{ ...pen, points }]);
    };
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerup", up);
    surface.addEventListener("pointercancel", up);
  };

  surface.addEventListener("pointerdown", down);
  return () => surface.removeEventListener("pointerdown", down);
}
