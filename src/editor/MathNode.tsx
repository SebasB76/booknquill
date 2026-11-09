import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import type { MathfieldElement } from "mathlive";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/backend";
import { SHORTCUTS, STATS_LAYOUT, evaluateLatex, renderLatex, tidyLatex, withOurKeybindings } from "../lib/math";
import { notify } from "../lib/notify";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    math: {
      /** Inserts an empty formula and opens it for typing. `fromDollar` lets Esc give back a plain `$`. */
      insertMath: (opts?: { display?: boolean; fromDollar?: boolean }) => ReturnType;
    };
  }
}

/** `typedAhead` holds what was typed between `$` and the box taking focus, so fast typing is not lost. */
type Storage = { openNext: null | { fromDollar: boolean }; typedAhead: string | null };
const EDIT_EVENT = "bnq-math-edit";

export const MathNode = Node.create<object, Storage>({
  name: "math",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addStorage: () => ({ openNext: null, typedAhead: null }),

  addAttributes() {
    return {
      latex: { default: "", parseHTML: (el) => el.getAttribute("data-math") ?? "" },
      display: { default: false, parseHTML: (el) => el.getAttribute("data-display") === "true" },
    };
  },

  parseHTML: () => [{ tag: "span[data-math]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { "data-math": node.attrs.latex, "data-display": String(node.attrs.display) }),
  ],

  addNodeView() {
    return ReactNodeViewRenderer(MathView, {
      // MathLive owns every key and click inside the formula box.
      stopEvent: ({ event }) => !!(event.target as Element | null)?.closest?.("math-field, .math-tools"),
      ignoreMutation: () => true,
    });
  },

  addCommands() {
    return {
      insertMath:
        (opts = {}) =>
        ({ chain }) => {
          this.storage.openNext = { fromDollar: !!opts.fromDollar };
          this.storage.typedAhead = "";
          return chain().insertContent({ type: this.name, attrs: { latex: "", display: !!opts.display } }).run();
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-m": ({ editor }) => insertOrConvert(editor, false),
      "Mod-Shift-m": ({ editor }) => insertOrConvert(editor, true),
      Enter: ({ editor }) => openSelected(editor),
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("mathDollar"),
        props: {
          // Typing `$` opens a formula. Esc on the still-empty box gives the `$` back, for prices.
          handleTextInput: (view, _from, _to, text) => {
            const storage = (editor.storage as unknown as { math: Storage }).math;
            if (storage.typedAhead !== null) {
              storage.typedAhead += text;
              return true;
            }
            if (text !== "$" || editor.isActive("code") || editor.isActive("codeBlock")) return false;
            if (!view.state.schema.nodes.math) return false;
            return editor.commands.insertMath({ fromDollar: true });
          },
          handleKeyDown: (_view, event) => {
            const storage = (editor.storage as unknown as { math: Storage }).math;
            if (storage.typedAhead === null) return false;
            if (event.key === "Enter") storage.typedAhead += "\n";
            else if (event.key === "Backspace") storage.typedAhead = storage.typedAhead.slice(0, -1);
            else return false;
            return true;
          },
          handleDoubleClick: (view, pos) => {
            const node = view.state.doc.nodeAt(pos);
            if (node?.type.name !== "math") return false;
            view.nodeDOM(pos)?.dispatchEvent(new CustomEvent(EDIT_EVENT));
            return true;
          },
        },
      }),
    ];
  },
});

function openSelected(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "math") return false;
  editor.view.nodeDOM(selection.from)?.dispatchEvent(new CustomEvent(EDIT_EVENT));
  return true;
}

/** With text selected, Claude turns the words into a formula; otherwise an empty formula opens. */
function insertOrConvert(editor: Editor, display: boolean): boolean {
  const { from, to, empty } = editor.state.selection;
  if (empty || editor.state.selection instanceof NodeSelection) return editor.commands.insertMath({ display });
  convertSelection(editor, display, from, to);
  return true;
}

export async function convertSelection(editor: Editor, display = false, from = editor.state.selection.from, to = editor.state.selection.to) {
  const text = editor.state.doc.textBetween(from, to, " ").trim();
  if (!text) return;
  notify("Convirtiendo a fórmula…");
  try {
    const latex = await api.mathFromText(text);
    if (editor.isDestroyed || editor.state.doc.textBetween(from, to, " ").trim() !== text) return;
    editor.chain().insertContentAt({ from, to }, { type: "math", attrs: { latex, display } }).run();
    notify(null);
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e));
  }
}

function MathView({ node, editor, getPos, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const storage = (editor.storage as unknown as { math: Storage }).math;
  const [editing, setEditing] = useState<null | { fromDollar: boolean }>(() => {
    const pending = storage.openNext;
    storage.openNext = null;
    return pending;
  });
  const wrapper = useRef<HTMLSpanElement>(null);
  const latex = node.attrs.latex as string;
  const display = node.attrs.display as boolean;
  const html = useMemo(() => renderLatex(latex, display), [latex, display]);

  useEffect(() => {
    const dom = wrapper.current?.closest(".react-renderer") ?? wrapper.current;
    const open = () => setEditing({ fromDollar: false });
    dom?.addEventListener(EDIT_EVENT, open);
    return () => dom?.removeEventListener(EDIT_EVENT, open);
  }, []);

  /** Leaves the box and puts the caret before or after the formula. */
  const close = (value: string, side: "before" | "after" = "after", fromDollar = false) => {
    setEditing(null);
    window.mathVirtualKeyboard?.hide();
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos == null) return;
    if (!value.trim()) {
      const chain = editor.chain().deleteRange({ from: pos, to: pos + 1 });
      (fromDollar ? chain.insertContentAt(pos, "$") : chain).run();
    } else if (value !== latex) {
      updateAttributes({ latex: value });
    }
    const after = !value.trim() ? pos + (fromDollar ? 1 : 0) : side === "after" ? pos + 1 : pos;
    const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, Math.min(after, editor.state.doc.content.size)));
    editor.view.dispatch(tr);
    editor.view.focus();
  };

  return (
    <NodeViewWrapper
      as="span"
      ref={wrapper}
      className={`math-node ${display ? "is-display" : ""} ${selected ? "is-selected" : ""} ${editing ? "is-editing" : ""}`}
      contentEditable={false}
      data-testid="math"
      data-latex={latex}
    >
      {editing ? (
        <MathBox
          initial={latex}
          display={display}
          takeTypedAhead={() => {
            const typed = storage.typedAhead ?? "";
            storage.typedAhead = null;
            return typed;
          }} onClose={(v, side) => close(v, side, editing.fromDollar)} onRemove={() => (deleteNode(), editor.view.focus())} />
      ) : (
        <span className="math-render" onClick={() => setEditing({ fromDollar: false })} dangerouslySetInnerHTML={{ __html: html || "&nbsp;" }} />
      )}
    </NodeViewWrapper>
  );
}

/**
 * Types held-back keys into the box as if they were typed there: `/` and `^` act on the box, and word
 * shortcuts (`sigma`, `raiz`) expand, which synthetic keystrokes alone do not do.
 */
function replayKeys(mf: MathfieldElement, typed: string) {
  const shortcuts = Object.entries(mf.inlineShortcuts)
    .filter(([word]) => /^[a-z]{2,}$/i.test(word))
    .sort((a, b) => b[0].length - a[0].length);
  for (let i = 0; i < typed.length; ) {
    const hit = shortcuts.find(([word]) => typed.startsWith(word, i));
    if (hit) {
      const def = hit[1];
      mf.insert(typeof def === "string" ? def : def.value, { selectionMode: "placeholder" });
      i += hit[0].length;
    } else {
      mf.executeCommand(["typedText", typed[i], { simulateKeystroke: true }]);
      i++;
    }
  }
}

function MathBox({
  initial,
  takeTypedAhead,
  display,
  onClose,
  onRemove,
}: {
  initial: string;
  takeTypedAhead: () => string;
  display: boolean;
  onClose: (latex: string, side?: "before" | "after") => void;
  onRemove: () => void;
}) {
  const ref = useRef<MathfieldElement>(null);
  const closed = useRef(false);
  const closeOnce = (side?: "before" | "after") => {
    if (closed.current || !ref.current) return;
    closed.current = true;
    onClose(tidyLatex(ref.current.getValue("latex")), side);
  };

  useEffect(() => {
    const mf = ref.current;
    if (!mf) return;
    mf.inlineShortcuts = { ...mf.inlineShortcuts, ...SHORTCUTS };
    mf.keybindings = withOurKeybindings(mf.keybindings);
    mf.menuItems = [];
    mf.smartFence = true;
    mf.mathVirtualKeyboardPolicy = "manual";
    mf.value = initial;
    if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.layouts = [STATS_LAYOUT, "numeric", "symbols", "greek"];

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        calculate();
      } else if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeOnce();
      } else if (e.key === "Backspace" && !mf.getValue().trim()) {
        e.preventDefault();
        closeOnce();
      }
    };
    const onMoveOut = (e: Event) => {
      const dir = (e as CustomEvent<{ direction: string }>).detail.direction;
      if (dir === "backward" || dir === "upward") closeOnce("before");
      else closeOnce("after");
    };
    // Clicks on the on-screen keyboard briefly move focus; only a real exit closes the box.
    const onBlur = () =>
      window.setTimeout(() => {
        if (document.activeElement !== mf && !document.activeElement?.closest(".math-tools")) closeOnce();
      }, 120);
    mf.addEventListener("keydown", onKey, { capture: true });
    mf.addEventListener("move-out", onMoveOut);
    mf.addEventListener("focusout", onBlur);
    // ProseMirror pulls focus back right after inserting the node, so the `$` plugin holds the keys
    // typed until the box really has focus, and they are replayed here.
    const replay = () => {
      const [typed, ...rest] = takeTypedAhead().split("\n");
      replayKeys(mf, typed);
      if (rest.length) closeOnce();
    };
    mf.addEventListener("focusin", replay, { once: true });
    requestAnimationFrame(() => mf.focus());
    return () => {
      mf.removeEventListener("keydown", onKey, { capture: true });
      mf.removeEventListener("move-out", onMoveOut);
      mf.removeEventListener("focusout", onBlur);
      mf.removeEventListener("focusin", replay);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const calculate = async () => {
    const mf = ref.current;
    if (!mf) return;
    const result = await evaluateLatex(mf.getValue("latex"));
    if ("error" in result) return notify(result.error);
    mf.value = tidyLatex(result.latex);
    mf.executeCommand("moveToMathfieldEnd");
    mf.focus();
  };

  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <span className="math-box">
      <math-field ref={ref} class={display ? "is-display" : ""} data-testid="math-field" />
      <span className="math-tools" onMouseDown={keep}>
        <button title="Calcular el resultado (Ctrl + Enter)" data-testid="math-calc" onClick={calculate}>=</button>
        <button
          title="Teclado en pantalla"
          data-testid="math-keyboard"
          onClick={() => {
            const kb = window.mathVirtualKeyboard;
            ref.current?.focus();
            if (kb.visible) kb.hide();
            else kb.show({ animate: true });
          }}
        >
          ⌨
        </button>
        <button
          title="Copiar como LaTeX (para Word, Canvas o Overleaf)"
          data-testid="math-copy"
          onClick={() => {
            navigator.clipboard?.writeText(ref.current?.getValue("latex") ?? "").then(() => notify("Fórmula copiada como LaTeX"), () => notify("No pude copiar"));
          }}
        >
          ⧉
        </button>
        <button title="Quitar la fórmula" onClick={onRemove}>
          ✕
        </button>
      </span>
    </span>
  );
}
