import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { caretTo, editor, images, openFromSidebar, pasteImage, read, startApp, waitSaved } from "./helpers";

async function writeLines(page: Page, lines: string[]) {
  for (const [i, line] of lines.entries()) {
    if (i) await page.keyboard.press("Enter");
    await page.keyboard.type(line);
  }
}

/** Draws a line with the mouse under the given element. */
async function underline(page: Page, target: ReturnType<Page["locator"]>) {
  const box = (await target.boundingBox())!;
  const y = box.y + box.height + 2;
  await page.mouse.move(box.x, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, y + 1, { steps: 8 });
  await page.mouse.up();
}

const offset = async (a: ReturnType<Page["locator"]>, b: ReturnType<Page["locator"]>) => (await a.boundingBox())!.y - (await b.boundingBox())!.y;

test("a stroke drawn under a line stays on that line, is saved as an SVG and comes back", async ({ page }) => {
  const dir = await startApp(page);
  await writeLines(page, ["dibujo", "uno", "dos"]);
  await waitSaved(page);

  await page.getByTestId("toggle-ink").click();
  await page.locator('[data-ink-tool="red"]').click();
  const uno = editor(page).locator("p", { hasText: "uno" });
  await underline(page, uno);
  const stroke = editor(page).locator(".ink path");
  await expect(stroke).toHaveCount(1);
  await expect(stroke).toHaveAttribute("stroke", "#e5484d");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("toolbar", { name: "Dibujar" })).toHaveCount(0);
  await waitSaved(page);

  const md = read(dir, "dibujo.md");
  expect(md).toMatch(/^dibujo\n\n!\[ink\]\(images\/ink-\d{8}-\d{6}-[a-z0-9]+\.svg\)\n\nuno\n\ndos\n$/);
  const svgFile = md.match(/images\/(ink-[^)]+)/)![1];
  await expect.poll(() => images(dir)).toContain(svgFile);
  expect(fs.readFileSync(path.join(dir, "images", svgFile), "utf8")).toMatch(/<path d="M[^"]+" fill="none" stroke="#e5484d"[^>]*data-points="[\d. -]+"\/>/);

  // New lines above, and Enter at the start of the annotated line itself, move the stroke with its text.
  const before = await offset(stroke, uno);
  await caretTo(page, editor(page).locator("p", { hasText: "dibujo" }), "End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("una linea nueva");
  await caretTo(page, uno, "Home");
  await page.keyboard.press("Enter");
  expect(await offset(stroke, uno)).toBeCloseTo(before, 0);
  await waitSaved(page);
  expect(read(dir, "dibujo.md")).toBe(`dibujo\n\nuna linea nueva\n\n![ink](images/${svgFile})\n\nuno\n\ndos\n`);

  await page.reload();
  await openFromSidebar(page, "dibujo");
  await expect(stroke).toHaveCount(1);
  expect(await offset(stroke, uno)).toBeCloseTo(before, 0);
});

test("Backspace that joins an annotated line keeps the drawing, and the eraser removes it", async ({ page }) => {
  const dir = await startApp(page);
  await writeLines(page, ["borrar", "uno", "dos"]);
  await page.getByTestId("toggle-ink").click();
  await underline(page, editor(page).locator("p", { hasText: "dos" }));
  await page.getByTestId("ink-done").click();
  await waitSaved(page);
  expect(read(dir, "borrar.md")).toMatch(/\n\n!\[ink\]\([^)]+\)\n\ndos\n$/);

  await caretTo(page, editor(page).locator("p", { hasText: "dos" }), "Home");
  await page.keyboard.press("Backspace");
  await expect(editor(page).locator("p", { hasText: "unodos" })).toBeVisible();
  const stroke = editor(page).locator(".ink path");
  await expect(stroke).toHaveCount(1);
  await waitSaved(page);
  expect(read(dir, "borrar.md")).toMatch(/^borrar\n\n!\[ink\]\([^)]+\)\n\nunodos\n$/);

  await page.getByTestId("toggle-ink").click();
  await page.locator('[data-ink-tool="eraser"]').click();
  const box = (await stroke.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y - 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 20, { steps: 6 });
  await page.mouse.up();
  await expect(stroke).toHaveCount(0);
  await waitSaved(page);
  expect(read(dir, "borrar.md")).toBe("borrar\n\nunodos\n");
});

test("in draw mode the pointer does not move the caret or select text", async ({ page }) => {
  await startApp(page);
  await writeLines(page, ["seleccion", "texto largo para seleccionar"]);
  await page.keyboard.press("Control+d");
  await expect(page.getByTestId("toggle-ink")).toHaveClass(/is-on/);
  const p = editor(page).locator("p", { hasText: "texto largo" });
  const box = (await p.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  await expect(editor(page).locator(".ink path")).toHaveCount(1);
});

test("a centered image grows past the text column, up to the window", async ({ page }) => {
  const dir = await startApp(page);
  await page.keyboard.type("imagen grande");
  await page.keyboard.press("Enter");
  await pasteImage(page);
  const figure = editor(page).locator("figure.note-image");
  await expect(figure.locator("img")).toHaveJSProperty("complete", true);

  const column = await editor(page).evaluate((el) => el.clientWidth);
  const room = (await page.locator(".scroll").evaluate((el) => el.clientWidth)) - 48;
  expect(room).toBeGreaterThan(column + 100);

  await figure.locator("img").click();
  const handle = (await page.getByTestId("image-resize").boundingBox())!;
  await page.mouse.move(handle.x + 6, handle.y + 6);
  await page.mouse.down();
  await page.mouse.move(handle.x + 6 + 600, handle.y + 6, { steps: 6 });
  await page.mouse.up();
  await expect(figure).toHaveCSS("width", `${room}px`);
  const prose = (await editor(page).boundingBox())!;
  const shown = (await figure.boundingBox())!;
  expect(shown.x + shown.width / 2).toBeCloseTo(prose.x + prose.width / 2, 0);
  await waitSaved(page);
  expect(read(dir, "imagen grande.md")).toMatch(new RegExp(`^imagen grande\\n\\n!\\[\\|${room}\\]\\(images/pasted-[\\d-]+\\.png\\)\\n$`));

  await figure.locator('[data-img="m"]').click();
  await expect(figure).toHaveCSS("width", "420px");
  await figure.locator('[data-img="full"]').click();
  await expect(figure).toHaveCSS("width", `${room}px`);
});
