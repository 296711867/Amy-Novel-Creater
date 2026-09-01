import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { initializeTheme } from "./theme/theme";
import "./styles.css";
import "./writer.css";
import "./bible.css";
import "./bible-responsive.css";
import "./continuity.css";
import "./onboarding.css";

initializeTheme();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
);
