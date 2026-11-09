import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/** The same stops browsers use, so each step feels familiar. */
export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

const KEY = "booknquill.zoom";

export function savedZoom(): number {
  try {
    const z = Number(localStorage.getItem(KEY));
    if (ZOOM_LEVELS.includes(z)) return z;
  } catch {}
  return 1;
}

export function stepZoom(current: number, step: 1 | -1): number {
  const i = ZOOM_LEVELS.indexOf(current);
  return ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, i + step))];
}

export function applyZoom(z: number) {
  // Native webview zoom keeps pointer coordinates right for image drag and crop; the browser (E2E) uses CSS zoom.
  if (isTauri()) getCurrentWebview().setZoom(z).catch(() => {});
  else document.documentElement.style.zoom = String(z);
  try {
    localStorage.setItem(KEY, String(z));
  } catch {}
}
