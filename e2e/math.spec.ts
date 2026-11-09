import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { editor, openFromSidebar, read, startApp, waitSaved } from "./helpers";

const mathField = (page: Page) => page.getByTestId("math-field");

async function typeFormula(page: Page, keys: string) {
  await expect(mathField(page)).toBeFocused();
  await page.keyboard.type(keys, { delay: 20 });
}

test("typing $ opens a formula where / makes a fraction and ^ a power", async ({ page }) => {
  const dir = await startApp(page);
  await page.keyboard.type("# Estadistica");
  await page.keyboard.press("Enter");
  await page.keyboard.type("El puntaje z es ");
  await page.keyboard.type("$");
  await typeFormula(page, "(xbar-mu)/sigma");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("+x^2");
  await page.keyboard.press("Enter");
  await page.keyboard.type(" y listo.");

  const math = editor(page).getByTestId("math");
  await expect(math.locator(".katex .mfrac")).toBeVisible();
  await expect(math.locator(".katex .msupsub")).toBeVisible();
  await waitSaved(page);
  expect(read(dir, "Estadistica.md")).toBe("# Estadistica\n\nEl puntaje z es $\\frac{\\bar{x}-\\mu}{\\sigma}+x^2$ y listo.\n");
});

test("fast typing right after $ lands in the formula", async ({ page }) => {
  await startApp(page);
  await page.keyboard.type("Desviacion $sigma/n");
  await page.keyboard.press("Enter");
  await expect(editor(page).getByTestId("math")).toHaveAttribute("data-latex", "\\frac{\\sigma}{n}");
  await expect(editor(page)).toHaveText(/^Desviacion\s*σn/);
});

test("Esc on an empty formula gives back the $ for prices", async ({ page }) => {
  const dir = await startApp(page);
  await page.keyboard.type("Pizza ");
  await page.keyboard.type("$");
  await expect(mathField(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.type("5");
  await expect(editor(page)).toHaveText("Pizza $5");
  await expect(editor(page).getByTestId("math")).toHaveCount(0);
  await waitSaved(page);
  expect(read(dir, "Pizza $5.md")).toBe("Pizza $5\n");
});

test("Spanish words and Alt keys write symbols without LaTeX", async ({ page }) => {
  const dir = await startApp(page);
  await page.keyboard.type("# Atajos");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+m");
  await typeFormula(page, "phat");
  await page.keyboard.type("+");
  await page.keyboard.press("Alt+r");
  await page.keyboard.type("n");
  await page.keyboard.press("Enter");
  await waitSaved(page);
  expect(read(dir, "Atajos.md")).toBe("# Atajos\n\n$\\hat{p}+\\sqrt{n}$\n");
});

test("Ctrl+Enter writes the result of the formula", async ({ page }) => {
  await startApp(page);
  await page.keyboard.type("$");
  await typeFormula(page, "(82-75)/5");
  await page.keyboard.press("Control+Enter");
  await expect(mathField(page)).toHaveJSProperty("value", "\\frac{82-75}{5}=1.4");
  await page.keyboard.press("Enter");
  await expect(editor(page).getByTestId("math")).toHaveAttribute("data-latex", "\\frac{82-75}{5}=1.4");
});

test("the on-screen keyboard types statistics symbols", async ({ page }) => {
  await startApp(page);
  await page.getByTestId("insert-math").click();
  await expect(mathField(page)).toBeFocused();
  await page.getByTestId("math-keyboard").click();
  const keyboard = page.locator(".ML__keyboard");
  await expect(keyboard).toBeVisible();
  await keyboard.getByLabel("\\bar{x}", { exact: true }).click();
  await keyboard.getByLabel("\\sigma", { exact: true }).click();
  await expect(mathField(page)).toHaveJSProperty("value", "\\bar{x}\\sigma");
  await page.keyboard.press("Enter");
  await expect(keyboard).toBeHidden();
  await expect(editor(page).getByTestId("math")).toHaveAttribute("data-latex", "\\bar{x}\\sigma");
});

test("selected words become a formula with AI", async ({ page }) => {
  const dir = await startApp(page);
  await page.keyboard.type("# Error estandar");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Es raiz de n sobre sigma");
  for (let i = 0; i < "raiz de n sobre sigma".length; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.getByTestId("to-formula").click();
  await expect(editor(page).getByTestId("math")).toHaveAttribute("data-latex", "\\frac{\\sqrt{n}}{\\sigma}");
  await waitSaved(page);
  expect(read(dir, "Error estandar.md")).toBe("# Error estandar\n\nEs $\\frac{\\sqrt{n}}{\\sigma}$\n");
});

test("a note with formulas opens rendered, edits in place and keeps prices as text", async ({ page }) => {
  const dir = await startApp(page);
  await openFromSidebar(page, "formulas de estadistica");
  const maths = editor(page).getByTestId("math");
  await expect(maths).toHaveCount(3);
  await expect(maths.nth(2)).toHaveClass(/is-display/);
  await expect(editor(page)).toContainText("costó $5 y $10.");

  await maths.nth(1).click();
  await expect(mathField(page)).toBeFocused();
  await page.keyboard.press("Backspace");
  await page.keyboard.type("sigma");
  await page.keyboard.press("Enter");
  await waitSaved(page);
  expect(read(dir, "formulas de estadistica.md")).toBe(
    fs
      .readFileSync(path.resolve("e2e/fixtures/notes/formulas de estadistica.md"), "utf8")
      .replace("estima $\\mu$", "estima $\\sigma$"),
  );
});

test("printing shows only the note, ready to save as PDF", async ({ page }) => {
  await startApp(page);
  await openFromSidebar(page, "formulas de estadistica");
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("complementary", { name: "Notas" })).toBeHidden();
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(editor(page).getByTestId("math").first()).toBeVisible();
});
