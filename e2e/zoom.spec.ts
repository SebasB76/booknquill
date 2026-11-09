import { expect, test } from "@playwright/test";
import { startApp } from "./helpers";

const rootZoom = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.style.zoom || "1");

test("Ctrl + and Ctrl - zoom the window, Ctrl 0 resets it, and the level survives a restart", async ({ page }) => {
  await startApp(page);
  await expect(page.getByTestId("zoom-reset")).toBeHidden();

  await page.keyboard.press("Control+Equal");
  await page.keyboard.press("Control+Shift+Equal");
  await expect(page.getByTestId("zoom-reset")).toHaveText("125 %");
  await expect(page.locator(".toast")).toHaveText("Zoom 125 %");
  expect(await rootZoom(page)).toBe("1.25");

  await page.keyboard.press("Control+Minus");
  await expect(page.getByTestId("zoom-reset")).toHaveText("110 %");

  await page.reload();
  await expect(page.getByTestId("zoom-reset")).toHaveText("110 %");
  expect(await rootZoom(page)).toBe("1.1");

  await page.keyboard.press("Control+0");
  await expect(page.getByTestId("zoom-reset")).toBeHidden();
  expect(await rootZoom(page)).toBe("1");

  await page.mouse.move(640, 400);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 100);
  await page.keyboard.up("Control");
  await expect(page.getByTestId("zoom-reset")).toHaveText("90 %");
  await page.getByTestId("zoom-reset").click();
  await expect(page.getByTestId("zoom-reset")).toBeHidden();
});
