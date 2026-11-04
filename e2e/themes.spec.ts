import { expect, test } from "@playwright/test";
import { startApp } from "./helpers";

test("a theme picked from the top bar recolors the app and survives a restart", async ({ page }) => {
  await startApp(page);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");

  await page.getByTestId("theme-button").click();
  await expect(page.getByRole("menuitemradio")).toHaveText(["Negro", "Tokyo Night", "Pergamino", "Fósforo", "Cianotipo"]);
  await page.getByRole("menuitemradio", { name: "Tokyo Night" }).click();

  await expect(page.getByRole("menu")).toBeHidden();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(26, 27, 38)");

  await page.reload();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(26, 27, 38)");
  await page.getByTestId("theme-button").click();
  await expect(page.getByRole("menuitemradio", { name: "Tokyo Night" })).toHaveAttribute("aria-checked", "true");
});
