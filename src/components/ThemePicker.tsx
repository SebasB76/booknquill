import { useEffect, useRef, useState } from "react";
import { THEMES, applyTheme, savedTheme } from "../lib/themes";
import { Icon } from "./Icon";

export function ThemePicker() {
  const [current, setCurrent] = useState(savedTheme);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => root.current?.contains(e.target as Node) || setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (id: string) => {
    applyTheme(id);
    setCurrent(id);
    setOpen(false);
  };

  return (
    <div className="theme-picker" ref={root}>
      <button className={`ibtn ${open ? "is-on" : ""}`} title="Tema" data-testid="theme-button" onClick={() => setOpen((o) => !o)}>
        <Icon name="palette" />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Tema">
          {THEMES.map((t) => (
            <button key={t.id} role="menuitemradio" aria-checked={t.id === current} className="row" onClick={() => pick(t.id)}>
              <span className="swatches">
                {t.swatches.map((c, i) => (
                  <span key={i} style={{ background: c }} />
                ))}
              </span>
              <span className="grow">{t.name}</span>
              {t.id === current && <span className="check"><Icon name="check" /></span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
