import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { editor, images, openFromSidebar, pasteImage, read, startApp, waitSaved } from "./helpers";

const FIXTURES = path.resolve("e2e/fixtures/notes");

test("the app opens on a blank note, ready to type", async ({ page }) => {
  await startApp(page);
  await expect(editor(page)).toBeFocused();
  await expect(page.getByRole("tab")).toHaveText(["Nota nueva"]);
  await expect(page.getByTestId("save-state")).toHaveText("· Sin guardar");
});

test("markdown shortcuts format while typing and the file is clean markdown", async ({ page }) => {
  const dir = await startApp(page);
  await page.keyboard.type("# Hola mundo");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Primer parrafo con **negrita** y *cursiva*.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- uno");
  await page.keyboard.press("Enter");
  await page.keyboard.type("dos");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("[] comprar cafe");

  await expect(editor(page).locator("h1")).toHaveText("Hola mundo");
  await expect(editor(page).locator("strong")).toHaveText("negrita");
  await expect(editor(page).locator("em")).toHaveText("cursiva");
  await expect(editor(page).locator('ul[data-type="taskList"] li > div')).toHaveText("comprar cafe");
  await waitSaved(page);

  expect(read(dir, "Hola mundo.md")).toBe(
    "# Hola mundo\n\nPrimer parrafo con **negrita** y *cursiva*.\n\n- uno\n- dos\n\n- [ ] comprar cafe\n",
  );
  await expect(page.getByRole("tab")).toHaveText(["Hola mundo"]);
});

test("an existing note shows formatted, with its image and no image path", async ({ page }) => {
  const dir = await startApp(page);
  await openFromSidebar(page, "plan de estudio");

  await expect(editor(page).locator("h2")).toHaveText("plan de estudio");
  await expect(editor(page).locator('li[data-checked="true"] > div')).toHaveText("ver la clase de ojivas");
  const figure = editor(page).locator("figure.note-image");
  await expect(figure).toHaveAttribute("data-align", "left");
  await expect(figure).toHaveCSS("width", "300px");
  await expect(figure.locator("img")).toHaveJSProperty("complete", true);
  expect(await figure.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(400);
  await expect(editor(page)).not.toContainText("images/");
  expect(read(dir, "plan de estudio.md")).toBe(fs.readFileSync(path.join(FIXTURES, "plan de estudio.md"), "utf8"));
});

test("opening a note that ends in a list keeps the app on screen and ready to type", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await startApp(page);
  await openFromSidebar(page, "ideas de proyectos");
  await expect(editor(page).locator("h1")).toHaveText("ideas de proyectos");
  await expect(editor(page)).toBeFocused();
  await expect(page.getByRole("complementary", { name: "Notas" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("opening and switching notes never rewrites them", async ({ page }) => {
  const dir = await startApp(page);
  const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".md"));
  const before = Object.fromEntries(files.map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]));
  for (const f of files) await openFromSidebar(page, f.replace(/\.md$/, ""));
  await page.waitForTimeout(1200);
  for (const f of files) {
    expect(read(dir, f), f).toBe(fs.readFileSync(path.join(FIXTURES, f), "utf8"));
    expect(fs.statSync(path.join(dir, f)).mtimeMs, f).toBe(before[f]);
  }
});

test("editing an Omawrite note keeps its file name and its lines", async ({ page }) => {
  const dir = await startApp(page);
  await openFromSidebar(page, "# nota estilo omawrite");
  await editor(page).locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" fin");
  await waitSaved(page);
  // The only change besides the typed text: a blank line after the heading.
  expect(read(dir, "# nota estilo omawrite.md")).toBe("# nota estilo omawrite\n\nlinea uno\nlinea dos fin\n");
});

test("changing the first line renames the file", async ({ page }) => {
  const dir = await startApp(page);
  await openFromSidebar(page, "lista del super");
  await editor(page).locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" de noviembre");
  await waitSaved(page);
  expect(fs.existsSync(path.join(dir, "lista del super.md"))).toBe(false);
  expect(read(dir, "lista del super: de noviembre.md")).toBe("lista del super: de noviembre\n\n- pan\n- cafe\n");
  await expect(page.locator(".note-row", { hasText: "lista del super: de noviembre" })).toBeVisible();
});

test("a pasted image is saved, resized and aligned, and the link stores it", async ({ page }) => {
  const dir = await startApp(page);
  await page.keyboard.type("con imagen");
  await page.keyboard.press("Enter");
  await pasteImage(page);

  const figure = editor(page).locator("figure.note-image");
  await expect(figure.locator("img")).toHaveJSProperty("complete", true);
  expect(images(dir).filter((f) => f.startsWith("pasted-"))).toHaveLength(1);

  await figure.locator("img").click();
  const handle = page.getByTestId("image-resize");
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 6 - 30, box.y + 6, { steps: 4 });
  await page.mouse.up();
  await expect(figure).toHaveCSS("width", "260px");
  await figure.locator('[data-img="left"]').click();
  await expect(figure).toHaveAttribute("data-align", "left");
  await waitSaved(page);

  expect(read(dir, "con imagen.md")).toMatch(/^con imagen\n\n!\[left\|260\]\(images\/pasted-\d{8}-\d{6}\.png\)\n$/);
  await expect(editor(page)).not.toContainText("pasted-");
});

test("rotating and cropping save new image files and keep the original", async ({ page }) => {
  const dir = await startApp(page);
  await openFromSidebar(page, "plan de estudio");
  const figure = editor(page).locator("figure.note-image");
  await figure.locator("img").click();

  await figure.locator('[data-img="rotate"]').click();
  await expect.poll(() => images(dir).length).toBe(2);
  await expect.poll(async () => figure.locator("img").evaluate((i: HTMLImageElement) => i.naturalHeight)).toBe(400);

  const beforeCrop = images(dir);
  await figure.locator('[data-img="crop"]').click();
  const area = (await page.getByTestId("image-crop-area").boundingBox())!;
  await page.mouse.move(area.x + 10, area.y + 10);
  await page.mouse.down();
  await page.mouse.move(area.x + 110, area.y + 90, { steps: 4 });
  await page.mouse.up();
  await figure.locator('[data-img="crop-apply"]').click();
  await expect.poll(() => images(dir).length).toBe(3);
  await waitSaved(page);

  expect(images(dir)).toContain("chart.png");
  const cropped = images(dir).find((f) => !beforeCrop.includes(f));
  expect(read(dir, "plan de estudio.md")).toContain(`![left|100](images/${cropped})`);
});

test("tabs: Ctrl+click opens another tab, Ctrl+Tab switches, Ctrl+W closes", async ({ page }) => {
  await startApp(page);
  await openFromSidebar(page, "ideas de proyectos");
  await openFromSidebar(page, "lista del super", { newTab: true });
  await expect(page.getByRole("tab")).toHaveText(["ideas de proyectos", "lista del super:"]);
  await expect(page.getByRole("tab", { selected: true })).toHaveText("lista del super:");

  await page.keyboard.press("Control+Tab");
  await expect(page.getByRole("tab", { selected: true })).toHaveText("ideas de proyectos");
  await expect(editor(page).locator("h1")).toHaveText("ideas de proyectos");

  await page.keyboard.press("Control+w");
  await expect(page.getByRole("tab")).toHaveText(["lista del super:"]);
  await page.keyboard.press("Control+t");
  await expect(page.getByRole("tab")).toHaveText(["lista del super:", "Nota nueva"]);
});

test("the sidebar hides and comes back with the button or Ctrl+\\", async ({ page }) => {
  await startApp(page);
  const sidebar = page.getByRole("complementary", { name: "Notas" });
  await page.getByTestId("toggle-sidebar").click();
  await expect(sidebar).toBeHidden();
  await page.keyboard.press("Control+\\");
  await expect(sidebar).toBeVisible();
});

test("trash moves the note to .trash and closes it", async ({ page }) => {
  const dir = await startApp(page);
  await openFromSidebar(page, "lista del super");
  await page.getByTestId("trash-note").click();
  await expect(page.locator(".toast")).toContainText("lista del super");
  await expect(page.locator(".note-row", { hasText: "lista del super" })).toHaveCount(0);
  expect(fs.existsSync(path.join(dir, "lista del super.md"))).toBe(false);
  expect(read(dir, ".trash/lista del super.md")).toBe("lista del super:\n\n- pan\n- cafe\n");
});

test("a note edited in another app reloads while it is open", async ({ page }) => {
  const dir = await startApp(page);
  await openFromSidebar(page, "ideas de proyectos");
  await expect(editor(page).locator("li")).toHaveCount(2);
  fs.writeFileSync(path.join(dir, "ideas de proyectos.md"), "# ideas de proyectos\n\n- una app que no me deje apagar la alarma\n- agregarle voz al bot\n- escrita en omawrite\n");
  await expect(editor(page).locator("li")).toHaveCount(3);
  await expect(editor(page)).toContainText("escrita en omawrite");
});
