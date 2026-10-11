import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../../src/i18n";
import { EvidenceV3Workspace } from "../../../src/pages/PilotEvidenceV3Page";
import { syntheticEvidenceV3View } from "../../fixtures/pilot-evidence-v3";
import "../../../src/styles/global.css";
import "../../../src/styles/pages.css";
import "../../../src/styles/reference.css";
import "../../../src/styles/warm-theme.css";
const language = new URLSearchParams(location.search).get("language") === "vi"
    ? "vi"
    : "fr",
  data = await syntheticEvidenceV3View();
createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <I18nProvider language={language}>
      <main className="page-frame">
        <div className="jev-page gold-page evidence-page evidence-v3-page">
          <EvidenceV3Workspace data={data} audit={async () => {}} />
        </div>
      </main>
    </I18nProvider>
  </MemoryRouter>,
);
