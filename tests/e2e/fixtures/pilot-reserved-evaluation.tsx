import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../../src/i18n";
import { ReservedEvaluationWorkspace } from "../../../src/pages/PilotReservedEvaluationPage";
import type { ReservedEvaluationView } from "../../../src/lib/pilot-reserved-evaluation";
import report from "../../../docs/pilot-evidence-v3-reserved40-evaluation-20261011.json";
import "../../../src/styles/global.css";
import "../../../src/styles/pages.css";
import "../../../src/styles/reference.css";
import "../../../src/styles/warm-theme.css";
const data = {
    record: { id: "fixture", ...report, created_at: "2026-10-11" },
    ready: true,
    read_only: true,
    new_paid_calls: 0,
    production_enabled: false,
  } as unknown as ReservedEvaluationView,
  language = new URLSearchParams(location.search).get("language") === "vi"
    ? "vi"
    : "fr";
createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <I18nProvider language={language}>
      <main className="page-frame">
        <div className="jev-page gold-page evidence-v3-page">
          <ReservedEvaluationWorkspace data={data} />
        </div>
      </main>
    </I18nProvider>
  </MemoryRouter>,
);
