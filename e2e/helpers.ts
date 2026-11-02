import { expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BRIDGE = "http://127.0.0.1:1431";

/** Gives the test its own copy of the fixture notes and loads the app on it. */
export async function startApp(page: Page): Promise<string> {
  const res = await fetch(`${BRIDGE}/__e2e/reset`, { method: "POST" });
  const { dir } = (await res.json()) as { dir: string };
  await page.goto("/");
  await expect(page.locator(".prose").first()).toBeVisible();
  return dir;
}

export const editor = (page: Page) => page.locator(".doc:not([hidden]) .prose");

export async function waitSaved(page: Page) {
  await expect(page.getByTestId("save-state")).toHaveText("· Guardado");
}

export function read(dir: string, file: string): string {
  return fs.readFileSync(path.join(dir, file), "utf8");
}

export function images(dir: string): string[] {
  return fs.readdirSync(path.join(dir, "images")).sort();
}

export async function openFromSidebar(page: Page, title: string, opts: { newTab?: boolean } = {}) {
  await page.locator(".note-row", { hasText: title }).first().click({ modifiers: opts.newTab ? ["Control"] : [] });
}

/** Pastes a real PNG through the clipboard event the editor listens to. */
export async function pasteImage(page: Page, color = "#e11d48") {
  await editor(page).evaluate(async (el, fill) => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 200;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 320, 200);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 160, 100);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "shot.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, color);
}
