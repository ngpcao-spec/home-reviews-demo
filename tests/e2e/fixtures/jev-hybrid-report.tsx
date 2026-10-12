import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../../src/i18n";
import { HybridWorkspace } from "../../../src/pages/JevHybridReportPage";
import type { HybridView } from "../../../supabase/functions/_shared/jev-hybrid-api";
import "../../../src/styles/global.css";
import "../../../src/styles/pages.css";
import "../../../src/styles/reference.css";
import "../../../src/styles/warm-theme.css";
const language = new URLSearchParams(location.search).get("language") === "vi"
    ? "vi"
    : "fr";
// Static explicit mock, just like a server-prepared GET. No selector/tokenizer work on the phone.
const prepared = await fetch("/tests/e2e/fixtures/jev-hybrid-prepared.json").then(r=>r.json());
createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <I18nProvider language={language}>
      <main className="page-frame">
        <div className="jev-page gold-page evidence-v3-page">
          <HybridWorkspace
            data={prepared.views[language] as unknown as HybridView}
          />
        </div>
      </main>
    </I18nProvider>
  </MemoryRouter>,
);
