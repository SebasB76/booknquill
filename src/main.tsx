import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTheme, savedTheme } from "./lib/themes";
import { applyZoom, savedZoom } from "./lib/zoom";
import "./styles.css";

// Before the first render, so the window never flashes the default theme.
applyTheme(savedTheme());
applyZoom(savedZoom());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
