import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { useEffect, useRef } from "react";
import { api } from "../lib/backend";
import { docToMarkdown, markdownToHtml } from "../lib/markdown";
import { NoteImage } from "./NoteImage";

type Props = {
  /** Markdown to show. A new value replaces the document (external change or reload). */
  markdown: string;
  version: number;
  active: boolean;
  onChange: (markdown: string) => void;
  onReady?: (editor: Editor) => void;
};

export function NoteEditor({ markdown, version, active, onChange, onReady }: Props) {
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false }, underline: false }),
      TaskList,
      TaskItem.configure({
        nested: true,
        a11y: { checkboxLabel: (node, checked) => `${checked ? "Marcar como pendiente" : "Marcar como hecha"}: ${node.textContent}` },
      }),
      Placeholder.configure({ placeholder: "Escribe… prueba # título, - lista, [] tarea, **negrita**, o pega una imagen." }),
      NoteImage,
    ],
    content: markdownToHtml(markdown),
    editorProps: {
      attributes: { class: "prose", spellcheck: "false" },
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (!files.length) return false;
        event.preventDefault();
        files.forEach((f) => insertImage(view.state.selection.from, f, editor));
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = imageFiles((event as DragEvent).dataTransfer?.files);
        if (moved || !files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
        files.forEach((f) => insertImage(pos, f, editor));
        return true;
      },
    },
    onUpdate: ({ editor, transaction }) => {
      if (transaction.getMeta("external")) return;
      changeRef.current(docToMarkdown(editor.getJSON()));
    },
  });

  // Reload only when the parent says the file changed outside the editor.
  const shownVersion = useRef(version);
  useEffect(() => {
    if (!editor || shownVersion.current === version) return;
    shownVersion.current = version;
    editor.chain().setMeta("external", true).setContent(markdownToHtml(markdown), { emitUpdate: false }).run();
  }, [editor, markdown, version]);

  useEffect(() => {
    if (editor && active) {
      onReady?.(editor);
      focusEditor(editor);
    }
  }, [editor, active, onReady]);

  if (!editor) return null;
  return (
    <div className="doc" hidden={!active}>
      <EditorContent editor={editor} />
      <BubbleMenu editor={editor} shouldShow={({ editor, state }) => !state.selection.empty && !editor.isActive("noteImage")} className="bubble">
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => (focusEditor(editor), editor.chain().toggleBold().run())}><b>B</b></button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => (focusEditor(editor), editor.chain().toggleItalic().run())}><i>I</i></button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => (focusEditor(editor), editor.chain().toggleHeading({ level: 1 }).run())}>H1</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => (focusEditor(editor), editor.chain().toggleHeading({ level: 2 }).run())}>H2</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => (focusEditor(editor), editor.chain().toggleBulletList().run())}>• Lista</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => (focusEditor(editor), editor.chain().toggleTaskList().run())}>☐ Tarea</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => (focusEditor(editor), editor.chain().toggleCode().run())}>{"</>"}</button>
      </BubbleMenu>
    </div>
  );
}

/**
 * Tiptap's focus command treats WebKitGTK as Safari and focuses synchronously; the focus
 * transaction can then change the document under the pending one and crash the editor.
 */
export function focusEditor(editor: Editor) {
  if (!editor.isDestroyed && !editor.view.hasFocus()) editor.view.focus();
}

function imageFiles(list?: FileList | null): File[] {
  return [...(list ?? [])].filter((f) => f.type.startsWith("image/"));
}

export async function insertImage(pos: number, file: File, editor: Editor | null) {
  if (!editor) return;
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  const base64 = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
  const src = await api.saveImage(base64, ext);
  const natural = await naturalWidth(file);
  focusEditor(editor);
  editor
    .chain()
    .insertContentAt(pos, { type: "noteImage", attrs: { src, align: "center", width: Math.min(480, natural) } })
    .run();
}

function naturalWidth(file: File): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth || 480);
    img.onerror = () => resolve(480);
    img.src = URL.createObjectURL(file);
  });
}
