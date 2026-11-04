export type Theme = {
  id: string;
  name: string;
  /** Background, text, accent and a second accent, for the picker preview. */
  swatches: [string, string, string, string];
};

export const THEMES: Theme[] = [
  { id: "default", name: "Negro", swatches: ["#000000", "#f5f5f5", "#3d6bf0", "#111111"] },
  { id: "tokyo-night", name: "Tokyo Night", swatches: ["#1a1b26", "#c0caf5", "#7aa2f7", "#bb9af7"] },
  { id: "parchment", name: "Pergamino", swatches: ["#f3e9d2", "#3b2a1a", "#a8321e", "#6b4f2a"] },
  { id: "phosphor", name: "Fósforo", swatches: ["#0d0a05", "#ffb641", "#ffcf7a", "#7a5418"] },
  { id: "cyanotype", name: "Cianotipo", swatches: ["#0e3a63", "#e6f0fa", "#ffffff", "#8fc1ec"] },
];

const KEY = "booknquill.theme";

export function savedTheme(): string {
  try {
    const id = localStorage.getItem(KEY);
    if (id && THEMES.some((t) => t.id === id)) return id;
  } catch {}
  return THEMES[0].id;
}

export function applyTheme(id: string) {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {}
}
