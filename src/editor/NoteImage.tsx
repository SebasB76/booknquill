import { Node, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { api, fileUrl } from "../lib/backend";
import type { ImageAlign } from "../lib/markdown";
import { Icon } from "../components/Icon";

let notesDir = "";
export function setImageRoot(dir: string) {
  notesDir = dir;
}

/** Links are relative to the notes folder; older Omawrite notes use absolute paths. */
export function absoluteImagePath(src: string): string {
  return src.startsWith("/") ? src : `${notesDir}/${src}`;
}

export const NoteImage = Node.create({
  name: "noteImage",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: "", rendered: false },
      align: { default: "center", rendered: false },
      width: { default: null, rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: "img[data-src]",
        getAttrs: (el) => ({
          src: el.getAttribute("data-src") ?? "",
          align: el.getAttribute("data-align") ?? "center",
          width: el.getAttribute("data-width") ? Number(el.getAttribute("data-width")) : null,
        }),
      },
    ];
  },

  renderHTML({ node }) {
    return ["img", { "data-src": node.attrs.src, "data-align": node.attrs.align, "data-width": node.attrs.width ?? undefined }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

const SIZES = { s: 240, m: 420, l: 640 } as const;

function ImageView({ node, updateAttributes, deleteNode, selected, editor }: NodeViewProps) {
  const { src, align, width } = node.attrs as { src: string; align: ImageAlign; width: number | null };
  const figure = useRef<HTMLElement>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const maxWidth = () => (editor.view.dom as HTMLElement).clientWidth;
  const shownWidth = liveWidth ?? (align === "full" ? null : width ?? 480);

  function startResize(e: ReactPointerEvent, dir: 1 | -1) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = figure.current!.getBoundingClientRect().width;
    // A centered image grows on both sides, so the pointer moves half as far.
    const k = align === "center" || align === "full" ? 2 : 1;
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = Math.round(Math.max(80, Math.min(maxWidth(), startW + (ev.clientX - startX) * dir * k)));
      setLiveWidth(w);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLiveWidth(null);
      updateAttributes({ width: w, align: align === "full" ? "center" : align });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  async function editPixels(draw: (img: HTMLImageElement) => HTMLCanvasElement, newWidth?: number) {
    setBusy(true);
    try {
      const ext = src.split(".").pop()?.toLowerCase() ?? "png";
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
      const base64 = await api.readImage(src);
      const img = new Image();
      img.src = `data:${mime};base64,${base64}`;
      await img.decode();
      const out = draw(img).toDataURL("image/png").split(",")[1];
      // Edits go to a new file; the original image stays untouched.
      const saved = await api.saveImage(out, "png");
      updateAttributes(newWidth ? { src: saved, width: newWidth } : { src: saved });
    } finally {
      setBusy(false);
    }
  }

  function rotate() {
    editPixels((img) => {
      const c = document.createElement("canvas");
      c.width = img.naturalHeight;
      c.height = img.naturalWidth;
      const ctx = c.getContext("2d")!;
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      return c;
    });
  }

  function applyCrop() {
    const box = figure.current!.querySelector("img")!.getBoundingClientRect();
    const r = crop!;
    setCrop(null);
    if (r.w < 8 || r.h < 8) return;
    editPixels((img) => {
      const sx = img.naturalWidth / box.width;
      const sy = img.naturalHeight / box.height;
      const c = document.createElement("canvas");
      c.width = Math.round(r.w * sx);
      c.height = Math.round(r.h * sy);
      c.getContext("2d")!.drawImage(img, r.x * sx, r.y * sy, c.width, c.height, 0, 0, c.width, c.height);
      return c;
    }, Math.round(r.w));
  }

  function startCropDrag(e: ReactPointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x0 = e.clientX - box.left;
    const y0 = e.clientY - box.top;
    const move = (ev: PointerEvent) => {
      const x1 = Math.max(0, Math.min(box.width, ev.clientX - box.left));
      const y1 = Math.max(0, Math.min(box.height, ev.clientY - box.top));
      setCrop({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function setAlign(a: ImageAlign) {
    const max = maxWidth();
    if (a === "full") return updateAttributes({ align: a });
    const w = width && width < max ? width : a === "center" ? 480 : 320;
    updateAttributes({ align: a, width: w });
  }

  const cropping = crop !== null;
  return (
    <NodeViewWrapper
      as="figure"
      ref={figure}
      className={`note-image ${selected ? "is-selected" : ""} ${cropping ? "is-cropping" : ""} ${busy ? "is-busy" : ""}`}
      data-align={align}
      style={shownWidth ? { width: shownWidth } : undefined}
    >
      <img src={fileUrl(absoluteImagePath(src))} alt="" draggable={false} data-drag-handle="" />
      {liveWidth !== null && <span className="note-image__badge">{liveWidth} px</span>}
      {selected && !cropping && (
        <>
          <span className="note-image__handle note-image__handle--l" onPointerDown={(e) => startResize(e, -1)} />
          <span className="note-image__handle note-image__handle--r" data-testid="image-resize" onPointerDown={(e) => startResize(e, 1)} />
        </>
      )}
      {cropping && (
        <div className="note-image__crop" data-testid="image-crop-area" onPointerDown={startCropDrag}>
          {crop.w > 0 && <div className="note-image__crop-rect" style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }} />}
        </div>
      )}
      {selected && (
        <div className="note-image__bar" contentEditable={false}>
          {cropping ? (
            <>
              <button onClick={() => setCrop(null)}>Cancelar</button>
              <button className="is-primary" data-img="crop-apply" onClick={applyCrop}>Recortar</button>
            </>
          ) : (
            <>
              <BarButton action="left" title="Izquierda, con texto al lado" on={align === "left"} onClick={() => setAlign("left")}><Icon name="alignLeft" /></BarButton>
              <BarButton action="center" title="Centro" on={align === "center"} onClick={() => setAlign("center")}><Icon name="alignCenter" /></BarButton>
              <BarButton action="right" title="Derecha, con texto al lado" on={align === "right"} onClick={() => setAlign("right")}><Icon name="alignRight" /></BarButton>
              <BarButton action="full" title="Ancho completo" on={align === "full"} onClick={() => setAlign("full")}><Icon name="alignFull" /></BarButton>
              <span className="note-image__sep" />
              {(Object.keys(SIZES) as (keyof typeof SIZES)[]).map((k) => (
                <BarButton key={k} action={k} title={`${SIZES[k]} px`} onClick={() => updateAttributes({ width: Math.min(SIZES[k], maxWidth()), align: align === "full" ? "center" : align })}>
                  {k.toUpperCase()}
                </BarButton>
              ))}
              <span className="note-image__sep" />
              <BarButton action="rotate" title="Rotar" onClick={rotate}><Icon name="rotate" /></BarButton>
              <BarButton action="crop" title="Recortar" onClick={() => setCrop({ x: 0, y: 0, w: 0, h: 0 })}><Icon name="crop" /></BarButton>
              <BarButton action="delete" title="Borrar" onClick={() => deleteNode()}><Icon name="trash" /></BarButton>
            </>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

function BarButton(props: { action: string; title: string; on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={props.title}
      data-img={props.action}
      className={props.on ? "is-on" : ""}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
