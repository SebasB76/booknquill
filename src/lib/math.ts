import katex from "katex";
import "katex/dist/katex.min.css";
import { MathfieldElement } from "mathlive";
import type { Keybinding } from "mathlive";

// KaTeX's stylesheet already loads the same fonts MathLive uses, so MathLive must not fetch its own.
MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;

/** Words that turn into symbols while typing in a formula, on top of MathLive's own (sqrt, pi, alpha…). */
export const SHORTCUTS: Record<string, string> = {
  raiz: "\\sqrt{#?}",
  suma: "\\sum_{#?}^{#?}",
  sumatoria: "\\sum_{i=1}^{n}",
  prod: "\\prod_{#?}^{#?}",
  xbar: "\\bar{x}",
  ybar: "\\bar{y}",
  xb: "\\bar{x}",
  phat: "\\hat{p}",
  qhat: "\\hat{q}",
  barra: "\\overline{#?}",
  gorro: "\\hat{#?}",
  mu: "\\mu",
  sigma: "\\sigma",
  lambda: "\\lambda",
  inf: "\\infty",
  infinito: "\\infty",
  comb: "\\binom{#?}{#?}",
  binom: "\\binom{#?}{#?}",
  aprox: "\\approx",
  "+-": "\\pm",
  "!=": "\\neq",
  "<=": "\\leq",
  ">=": "\\geq",
  "*": "\\cdot",
};

/** Alt chords for the symbols that are slow to spell out. Physical keys, so they work on any layout. */
export const KEYBINDINGS: Keybinding[] = [
  { key: "alt+[KeyR]", ifMode: "math", command: ["insert", "\\sqrt{#@}"] },
  { key: "alt+[KeyS]", ifMode: "math", command: ["insert", "\\sum_{i=1}^{n}"] },
  { key: "alt+[KeyB]", ifMode: "math", command: ["insert", "\\bar{#@}"] },
  { key: "alt+[KeyH]", ifMode: "math", command: ["insert", "\\hat{#@}"] },
  { key: "alt+[KeyM]", ifMode: "math", command: ["insert", "\\mu"] },
  { key: "alt+[KeyO]", ifMode: "math", command: ["insert", "\\sigma"] },
  { key: "alt+[KeyC]", ifMode: "math", command: ["insert", "\\binom{#@}{#?}"] },
];

/** MathLive's defaults plus ours, without the defaults ours replace (alt+o was ∅). */
export function withOurKeybindings(current: readonly Keybinding[]): Keybinding[] {
  const ours = new Set(KEYBINDINGS.flatMap((k) => [k.key, k.key.replace(/\[Key(\w)\]/, (_, c: string) => c.toLowerCase())]));
  return [...current.filter((k) => !ours.has(k.key)), ...KEYBINDINGS];
}

/** A first keyboard page with what a statistics class writes most. */
export const STATS_LAYOUT = {
  label: "Est",
  tooltip: "Estadística",
  rows: [
    ["\\bar{x}", "\\hat{p}", "\\mu", "\\sigma", "\\sigma^2", "s", "n", "[7]", "[8]", "[9]", "[/]"],
    [
      { latex: "\\sum_{i=1}^{n}", insert: "\\sum_{i=1}^{n}#0" },
      { latex: "\\sqrt{#0}", insert: "\\sqrt{#@}" },
      { latex: "\\frac{#@}{#?}", insert: "\\frac{#@}{#?}" },
      { latex: "#@^{#?}", insert: "#@^{#?}" },
      { latex: "#@_{#?}", insert: "#@_{#?}" },
      { latex: "\\binom{#0}{#0}", insert: "\\binom{#@}{#?}" },
      "!",
      "[4]",
      "[5]",
      "[6]",
      "[*]",
    ],
    ["\\pm", "\\leq", "\\geq", "\\neq", "\\approx", "(", ")", "[1]", "[2]", "[3]", "[-]"],
    ["\\alpha", "\\beta", "\\lambda", "\\infty", "P(#0)", "[left]", "[right]", "[0]", "[.]", "[=]", "[+]"],
  ],
};

export function renderLatex(latex: string, display: boolean): string {
  return katex.renderToString(latex, { displayMode: display, throwOnError: false, output: "htmlAndMathml" });
}

export type Evaluation = { latex: string } | { error: string };

/**
 * Appends the numeric result: `5+3` becomes `5+3=8`. With an `=` already present, the part after the
 * last one is computed, or the part before it when nothing follows.
 */
export async function evaluateLatex(latex: string): Promise<Evaluation> {
  const { ComputeEngine, isNumber } = await import("@cortex-js/compute-engine");
  const ce = (engine ??= new ComputeEngine());
  const source = latex.trim().replace(/=\s*$/, "");
  const parts = source.split("=");
  const expr = parts[parts.length - 1].trim();
  if (!expr) return { error: "No hay nada que calcular" };
  const value = ce.parse(expr).N();
  if (!isNumber(value)) return { error: "Solo puedo calcular expresiones con números" };
  const num = Number(value.valueOf());
  const shown = Number.isFinite(num) ? formatNumber(num) : value.latex;
  if (parts.length > 1 && expr === shown) return { latex: source };
  return { latex: `${source}=${shown}` };
}

let engine: InstanceType<typeof import("@cortex-js/compute-engine").ComputeEngine> | undefined;

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(6)));
}

/**
 * Drops the parentheses that only group a fraction part, as a calculator does: typing `(a-b)/c`
 * gives `\frac{\left(a-b\right)}{c}` in MathLive, stored as `\frac{a-b}{c}`.
 */
export function tidyLatex(latex: string): string {
  let out = "";
  let i = 0;
  while (i < latex.length) {
    if (!latex.startsWith("\\frac{", i)) {
      out += latex[i++];
      continue;
    }
    out += "\\frac";
    i += 5;
    for (let arg = 0; arg < 2 && latex[i] === "{"; arg++) {
      const end = closingBrace(latex, i);
      if (end < 0) break;
      out += "{" + tidyLatex(stripGroupingParens(latex.slice(i + 1, end))) + "}";
      i = end + 1;
    }
  }
  return out;
}

function closingBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function stripGroupingParens(part: string): string {
  const t = part.trim();
  for (const [open, close] of [["\\left(", "\\right)"], ["(", ")"]]) {
    if (!t.startsWith(open) || !t.endsWith(close)) continue;
    const inner = t.slice(open.length, t.length - close.length);
    // Only when the first `(` pairs with the last `)`: `(a)(b)` keeps its parentheses.
    let depth = 0;
    for (const ch of inner.replace(/\\left\(|\\right\)/g, (m) => (m.includes("left") ? "(" : ")"))) {
      if (ch === "(") depth++;
      else if (ch === ")" && --depth < 0) return part;
    }
    if (depth === 0) return inner;
  }
  return part;
}
