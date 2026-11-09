import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./components/Icon";
import { ThemePicker } from "./components/ThemePicker";
import { NoteEditor, focusEditor, insertImage } from "./editor/NoteEditor";
import { EditorBoundary } from "./editor/EditorBoundary";
import { setImageRoot } from "./editor/NoteImage";
import { api, onNewNote, onNotesChanged, type NoteInfo } from "./lib/backend";
import { titleOf, wordCount } from "./lib/markdown";
import { applyZoom, savedZoom, stepZoom } from "./lib/zoom";

type Tab = {
  id: string;
  /** null until the first character is written. */
  file: string | null;
  /** What the editor shows; changes only on open or external reload. */
  markdown: string;
  version: number;
  /** Last content known to be on disk. */
  saved: string;
  draft: string;
  saving: boolean;
};

const SAVE_DELAY_MS = 500;
let nextId = 1;
const newTab = (): Tab => ({ id: `t${nextId++}`, file: null, markdown: "", version: 0, saved: "", draft: "", saving: false });

export function App() {
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab()]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [notesDir, setNotesDir] = useState("");
  const [now, setNow] = useState(Date.now());
  const [zoom, setZoom] = useState(savedZoom);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const timers = useRef(new Map<string, number>());
  const editors = useRef(new Map<string, Editor>());
  const fileInput = useRef<HTMLInputElement>(null);

  const patch = (id: string, change: Partial<Tab>) => setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...change } : t)));
  const refresh = useCallback(() => api.list().then(setNotes).catch(() => {}), []);

  const save = useCallback(
    async (id: string) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab || tab.draft === tab.saved) return;
      const content = tab.draft;
      patch(id, { saving: true });
      let file = tab.file;
      if (!file) {
        if (!content.trim()) return patch(id, { saving: false });
        file = (await api.create(titleOf(content), content)).file;
      } else {
        // Rename only when the first line itself changed, so opening an old note never renames it.
        const title = titleOf(content);
        if (title && title !== titleOf(tab.saved)) file = (await api.rename(file, title)).file;
        await api.write(file, content);
      }
      tabsRef.current = tabsRef.current.map((t) => (t.id === id ? { ...t, file, saved: content } : t));
      patch(id, { file, saved: content, saving: false });
      refresh();
    },
    [refresh],
  );

  // One save at a time per tab; otherwise two quick saves of a new note would create two files.
  const queues = useRef(new Map<string, Promise<void>>());
  const persist = useCallback(
    (id: string) => {
      timers.current.delete(id);
      const next = (queues.current.get(id) ?? Promise.resolve()).then(() => save(id)).catch(() => patch(id, { saving: false }));
      queues.current.set(id, next);
      return next;
    },
    [save],
  );

  const flush = useCallback(
    async (id: string) => {
      const timer = timers.current.get(id);
      if (timer) window.clearTimeout(timer);
      await persist(id);
    },
    [persist],
  );

  const onChange = (id: string, markdown: string) => {
    tabsRef.current = tabsRef.current.map((t) => (t.id === id ? { ...t, draft: markdown } : t));
    patch(id, { draft: markdown });
    const old = timers.current.get(id);
    if (old) window.clearTimeout(old);
    timers.current.set(id, window.setTimeout(() => persist(id), SAVE_DELAY_MS));
  };

  const newNote = useCallback(() => {
    const active = tabsRef.current.find((t) => t.id === activeRef.current);
    if (active && !active.file && !active.draft.trim()) {
      const editor = editors.current.get(active.id);
      return editor && focusEditor(editor);
    }
    const tab = newTab();
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
  }, []);

  const openNote = async (file: string, inNewTab: boolean) => {
    const open = tabsRef.current.find((t) => t.file === file);
    if (open) return setActiveId(open.id);
    const content = await api.read(file);
    const tab: Tab = { ...newTab(), file, markdown: content, saved: content, draft: content };
    const active = tabsRef.current.find((t) => t.id === activeRef.current);
    // A plain click reuses the current tab; Ctrl+click or middle click opens another one.
    if (!inNewTab && active) {
      await flush(active.id);
      setTabs((ts) => ts.map((t) => (t.id === active.id ? tab : t)));
    } else {
      setTabs((ts) => [...ts, tab]);
    }
    setActiveId(tab.id);
  };

  const closeTab = useCallback(
    async (id: string) => {
      await flush(id);
      editors.current.delete(id);
      const rest = tabsRef.current.filter((t) => t.id !== id);
      if (!rest.length) rest.push(newTab());
      setTabs(rest);
      if (activeRef.current === id) {
        const i = tabsRef.current.findIndex((t) => t.id === id);
        setActiveId(rest[Math.min(i, rest.length - 1)].id);
      }
    },
    [flush],
  );

  const trashActive = async () => {
    const tab = tabsRef.current.find((t) => t.id === activeRef.current);
    if (!tab?.file) return;
    const timer = timers.current.get(tab.id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(tab.id);
    await api.trash(tab.file);
    tabsRef.current = tabsRef.current.map((t) => (t.id === tab.id ? { ...t, draft: t.saved } : t));
    await closeTab(tab.id);
    setToast(`"${tab.file.replace(/\.md$/, "")}" está en la papelera`);
    refresh();
  };

  const zoomRef = useRef(zoom);
  const zoomTo = useCallback((next: (z: number) => number) => {
    const z = next(zoomRef.current);
    if (z !== zoomRef.current) applyZoom(z);
    zoomRef.current = z;
    setZoom(z);
    setToast(`Zoom ${Math.round(z * 100)} %`);
  }, []);

  const cycleTab = (step: number) => {
    const ts = tabsRef.current;
    const i = ts.findIndex((t) => t.id === activeRef.current);
    setActiveId(ts[(i + step + ts.length) % ts.length].id);
  };

  useEffect(() => {
    api.config().then((c) => {
      setImageRoot(c.notesDir);
      setNotesDir(c.notesDir.replace(/^\/home\/[^/]+/, "~"));
    });
    refresh();
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const stopNew = onNewNote(newNote);
    const stopWatch = onNotesChanged(async (files) => {
      refresh();
      for (const tab of tabsRef.current) {
        if (!tab.file || !files.includes(tab.file) || tab.draft !== tab.saved) continue;
        const content = await api.read(tab.file).catch(() => null);
        // Our own writes come back here too; only a different content is an outside edit.
        if (content === null || content === tab.saved) continue;
        patch(tab.id, { markdown: content, saved: content, draft: content, version: tab.version + 1 });
      }
    });
    return () => {
      window.clearInterval(tick);
      stopNew();
      stopWatch();
    };
  }, [refresh, newNote]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      const handled = () => e.preventDefault();
      if (key === "n" || key === "t") (handled(), newNote());
      else if (key === "w") (handled(), closeTab(activeRef.current));
      else if (key === "\\") (handled(), setSidebarOpen((o) => !o));
      else if (key === "tab") (handled(), cycleTab(e.shiftKey ? -1 : 1));
      else if (key === "=" || key === "+") (handled(), zoomTo((z) => stepZoom(z, 1)));
      else if (key === "-") (handled(), zoomTo((z) => stepZoom(z, -1)));
      else if (key === "0") (handled(), zoomTo(() => 1));
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.deltaY) return;
      e.preventDefault();
      zoomTo((z) => stepZoom(z, e.deltaY < 0 ? 1 : -1));
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, [newNote, closeTab, zoomTo]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const tabTitle = (t: Tab) => titleOf(t.draft) || (t.file ? t.file.replace(/\.md$/, "") : "Nota nueva");

  return (
    <div className={`app ${sidebarOpen ? "" : "no-sidebar"}`}>
      <aside className="sidebar" aria-label="Notas">
        <div className="sidebar__head" data-tauri-drag-region>
          <img src="/icon.png" alt="" className="logo" />
          BookNQuill
        </div>
        <div className="sidebar__actions">
          <button className="row" onClick={newNote} data-testid="new-note">
            <Icon name="plus" />
            <span className="grow">Nueva nota</span>
            <span className="kbd">Ctrl N</span>
          </button>
        </div>
        <div className="sidebar__scroll">
          <div className="section">Recientes</div>
          {notes.map((n) => (
            <button
              key={n.file}
              className={`row note-row ${active.file === n.file ? "is-on" : ""}`}
              title={n.preview}
              onClick={(e) => openNote(n.file, e.ctrlKey || e.metaKey)}
              onAuxClick={(e) => e.button === 1 && openNote(n.file, true)}
            >
              <span className="grow">{n.title}</span>
              <span className="meta">{ago(n.modifiedMs, now)}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="main">
        <header className="topbar" data-tauri-drag-region>
          <button className={`ibtn ${sidebarOpen ? "is-on" : ""}`} title="Barra lateral (Ctrl + \)" data-testid="toggle-sidebar" onClick={() => setSidebarOpen((o) => !o)}>
            <Icon name="sidebar" />
          </button>
          <nav className="tabs" role="tablist">
            {tabs.map((t) => (
              <div
                key={t.id}
                role="tab"
                aria-selected={t.id === activeId}
                className={`tab ${t.id === activeId ? "is-on" : ""}`}
                onClick={() => setActiveId(t.id)}
                onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
              >
                <span className="tab__title">{tabTitle(t)}</span>
                <button className="tab__close" title="Cerrar (Ctrl + W)" onClick={(e) => (e.stopPropagation(), closeTab(t.id))}>
                  <Icon name="x" />
                </button>
              </div>
            ))}
            <button className="ibtn" title="Nueva pestaña (Ctrl + T)" onClick={newNote}>
              <Icon name="plus" />
            </button>
          </nav>
          <button className="ibtn" title="Insertar imagen" data-testid="insert-image" onClick={() => fileInput.current?.click()}>
            <Icon name="image" />
          </button>
          <button className="ibtn" title="Mover a la papelera" data-testid="trash-note" disabled={!active.file} onClick={trashActive}>
            <Icon name="trash" />
          </button>
          <ThemePicker />
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              const editor = editors.current.get(activeId) ?? null;
              if (file && editor) insertImage(editor.state.selection.from, file, editor);
              e.target.value = "";
            }}
          />
        </header>

        <div className="scroll">
          {tabs.map((t) => (
            <EditorBoundary key={t.id} active={t.id === activeId}>
              <NoteEditor
                markdown={t.markdown}
                version={t.version}
                active={t.id === activeId}
                onChange={(md) => onChange(t.id, md)}
                onReady={(ed) => editors.current.set(t.id, ed)}
              />
            </EditorBoundary>
          ))}
        </div>

        <footer className="composer-wrap">
          <div className="composer">
            <span className="meta">{active.file ? `${notesDir}/${active.file}` : "Nota nueva"}</span>
            <span className="grow" />
            {zoom !== 1 && (
              <button className="zoom-chip" title="Restablecer zoom (Ctrl + 0)" data-testid="zoom-reset" onClick={() => zoomTo(() => 1)}>
                {Math.round(zoom * 100)} %
              </button>
            )}
            <span className="meta">{wordCount(active.draft)} palabras</span>
            <span className="meta" data-testid="save-state">· {active.saving || active.draft !== active.saved ? "Guardando…" : active.file ? "Guardado" : "Sin guardar"}</span>
          </div>
        </footer>
        {toast && <div className="toast">{toast}</div>}
      </section>
    </div>
  );
}

function ago(ms: number, now: number): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 604800) return `${Math.floor(s / 86400)} d`;
  if (s < 2629800) return `${Math.floor(s / 604800)} sem`;
  return new Date(ms).toLocaleDateString("es", { day: "numeric", month: "short" });
}
