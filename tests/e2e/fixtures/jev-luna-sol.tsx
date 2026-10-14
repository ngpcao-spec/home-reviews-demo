import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../../src/i18n";
import { JlsWorkspace } from "../../../src/pages/JevLunaSolPage";
import type { JlsView } from "../../../src/lib/jev-luna-sol";
import { executionCosts } from "../../../supabase/functions/_shared/jev-luna-sol-delegation";
import "../../../src/styles/global.css";
import "../../../src/styles/pages.css";
import "../../../src/styles/reference.css";
import "../../../src/styles/warm-theme.css";
const language = new URLSearchParams(location.search).get("language") === "vi" ? "vi" : "fr";
const prepared = await fetch("/tests/e2e/fixtures/jev-luna-sol-prepared.json").then(r => r.json());
// Free preparation fixture only: no authorization, result, provider request or fake report.
const protocol = await fetch("/tests/e2e/fixtures/jev-luna-sol-delegated-protocol.json").then(r => r.json());
for (const view of Object.values(prepared.views) as JlsView[]) view.delegated = {
  ready: true, plan_id: protocol.body.plan_id, protocol: {body: protocol.body, sha256: protocol.sha},
  run: null, tasks: [], dossier: null, result: null, costs: executionCosts([]),
};
createRoot(document.getElementById("root")!).render(<MemoryRouter><I18nProvider language={language}>
  <main className="page-frame"><div className="jev-page gold-page evidence-v3-page jls-page"><JlsWorkspace data={prepared.views[language] as JlsView} /></div></main>
</I18nProvider></MemoryRouter>);
