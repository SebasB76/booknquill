import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type NoteInfo = { file: string; title: string; modifiedMs: number; preview: string };

// Set only in E2E runs: the UI then talks to the Rust core over HTTP instead of Tauri IPC.
const BRIDGE = import.meta.env.VITE_BRIDGE_URL as string | undefined;

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!BRIDGE) return invoke<T>("core", { cmd, args });
  const res = await fetch(`${BRIDGE}/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd, args }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error);
  return body as T;
}

export const api = {
  config: () => call<{ notesDir: string }>("config"),
  list: () => call<NoteInfo[]>("list"),
  read: (file: string) => call<string>("read", { file }),
  write: (file: string, content: string) => call<NoteInfo>("write", { file, content }),
  create: (title: string, content: string) => call<NoteInfo>("create", { title, content }),
  rename: (file: string, title: string) => call<NoteInfo>("rename", { file, title }),
  trash: (file: string) => call<null>("trash", { file }),
  saveImage: (base64: string, ext: string) => call<string>("saveImage", { base64, ext }),
  readImage: (path: string) => call<string>("readImage", { path }),
};

export function onNotesChanged(cb: (files: string[]) => void): () => void {
  if (BRIDGE) {
    const es = new EventSource(`${BRIDGE}/events`);
    es.onmessage = (e) => cb(JSON.parse(e.data));
    return () => es.close();
  }
  return subscribe<string[]>("notes-changed", cb);
}

export function onNewNote(cb: () => void): () => void {
  return BRIDGE ? () => {} : subscribe("new-note", cb);
}

export function fileUrl(absPath: string): string {
  return BRIDGE ? `${BRIDGE}/file?path=${encodeURIComponent(absPath)}` : convertFileSrc(absPath);
}

function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  let stop: (() => void) | undefined;
  let dead = false;
  listen<T>(event, (e) => cb(e.payload)).then((unlisten) => (dead ? unlisten() : (stop = unlisten)));
  return () => {
    dead = true;
    stop?.();
  };
}
