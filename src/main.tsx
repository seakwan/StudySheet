import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { seedIfNeeded } from "./db";
import "./index.css";

void seedIfNeeded().then(() => {
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
