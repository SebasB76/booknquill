import { defineConfig } from "@playwright/test";
import path from "node:path";

const BRIDGE_PORT = 1431;
const UI_PORT = 1430;
const cargo = path.join(process.env.HOME ?? "", ".cargo/bin/cargo");

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/.artifacts",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 6_000 },
  use: {
    baseURL: `http://localhost:${UI_PORT}`,
    channel: "chrome",
    viewport: { width: 1280, height: 860 },
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      // The real Rust core, served over HTTP. Each test resets it to a fresh copy of the fixtures.
      command: `${cargo} run --quiet --manifest-path src-tauri/Cargo.toml --features e2e-bridge --bin e2e_bridge`,
      url: `http://127.0.0.1:${BRIDGE_PORT}/health`,
      env: { BNQ_FIXTURES: path.resolve("e2e/fixtures/notes"), BNQ_BRIDGE_PORT: String(BRIDGE_PORT) },
      timeout: 600_000,
      reuseExistingServer: false,
    },
    {
      command: `pnpm vite --port ${UI_PORT} --strictPort`,
      url: `http://localhost:${UI_PORT}`,
      env: { VITE_BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}` },
      reuseExistingServer: false,
    },
  ],
});
