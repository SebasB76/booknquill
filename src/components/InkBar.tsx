import { INK_PENS, type InkTool } from "../editor/Ink";
import { Icon } from "./Icon";

const COLORS: { tool: InkTool; title: string }[] = [
  { tool: "pen", title: "Tinta" },
  { tool: "red", title: "Rojo" },
  { tool: "blue", title: "Azul" },
  { tool: "green", title: "Verde" },
];

/** The draw-mode tools, floating over the top of the page. */
export function InkBar({ tool, onTool, onDone }: { tool: InkTool; onTool: (t: InkTool) => void; onDone: () => void }) {
  return (
    <div className="ink-bar" role="toolbar" aria-label="Dibujar">
      {COLORS.map((c) => (
        <button key={c.tool} title={c.title} data-ink-tool={c.tool} className={tool === c.tool ? "is-on" : ""} onClick={() => onTool(c.tool)}>
          <span className="ink-bar__dot" style={{ background: c.tool === "pen" ? "var(--fg)" : INK_PENS[c.tool as keyof typeof INK_PENS].color }} />
        </button>
      ))}
      <button title="Resaltador" data-ink-tool="marker" className={tool === "marker" ? "is-on" : ""} onClick={() => onTool("marker")}>
        <Icon name="marker" />
      </button>
      <button title="Borrador: borra el trazo que toques" data-ink-tool="eraser" className={tool === "eraser" ? "is-on" : ""} onClick={() => onTool("eraser")}>
        <Icon name="eraser" />
      </button>
      <span className="ink-bar__sep" />
      <button className="ink-bar__done" data-testid="ink-done" title="Volver a escribir (Esc)" onClick={onDone}>
        Listo
      </button>
    </div>
  );
}
