import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../../src/i18n";
import { HybridWorkspace } from "../../../src/pages/JevHybridReportPage";
import { hybridFixture } from "../../fixtures/jev-hybrid";
import { hybridHash } from "../../../supabase/functions/_shared/jev-hybrid-evidence";
import "../../../src/styles/global.css";
import "../../../src/styles/pages.css";
import "../../../src/styles/reference.css";
import "../../../src/styles/warm-theme.css";
const language = new URLSearchParams(location.search).get("language") === "vi"
    ? "vi"
    : "fr",
  f = await hybridFixture(language);
createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <I18nProvider language={language}>
      <main className="page-frame">
        <div className="jev-page gold-page evidence-v3-page">
          <HybridWorkspace
            data={{
              plan: {
                id: "mock-fixture",
                body: f.plan,
                result_sha256: await hybridHash(f.plan),
                created_at: "2026-10-11",
              },
              control: null,
              jobs: [],
              paid_enabled: false,
              can_generate: false,
              production_enabled: false,
              new_paid_calls: 0,
            }}
          />
        </div>
      </main>
    </I18nProvider>
  </MemoryRouter>,
);
