import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../../src/i18n";
import { JlsPrioritizedPreparation } from "../../../src/pages/JevLunaSolPage";
import { PrioritizedJlsReport } from "../../../src/components/analysis/PrioritizedJlsReport";
import "../../../src/styles/global.css";
import "../../../src/styles/pages.css";
import "../../../src/styles/warm-theme.css";
const language = new URLSearchParams(location.search).get("language") === "vi" ? "vi" : "fr";
const fixture = await fetch("/tests/e2e/fixtures/jls-prioritized.json").then(r => r.json());
if (!fixture.simulated_test_fixture) throw Error("EXPLICIT_MOCK_REQUIRED");
const view = fixture.views[language];
createRoot(document.getElementById("root")!).render(<I18nProvider language={language}>
  <main className="page-frame"><div className="jev-page gold-page evidence-v3-page jls-page"><p>EXPLICIT SYNTHETIC TEST — NO REAL SOL RESULT</p>
    <JlsPrioritizedPreparation data={{draft:view.draft,artifact_id:null,source_run_id:"explicit_mock_only"}}/>
    <PrioritizedJlsReport result={view.result}/>
  </div></main>
</I18nProvider>);
