import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import {I18nProvider} from "../../../src/i18n";
import {DecisionsWorkspace} from "../../../src/pages/DecisionsExperimentPage";
import type {DecisionsView} from "../../../supabase/functions/_shared/decisions-api";
import "../../../src/styles/global.css";import "../../../src/styles/pages.css";import "../../../src/styles/reference.css";import "../../../src/styles/warm-theme.css";
const language=new URLSearchParams(location.search).get("language")==="vi"?"vi":"fr";
const data=await fetch("/tests/e2e/fixtures/decisions-prepared.json").then(r=>r.json()) as DecisionsView;
createRoot(document.getElementById("root")!).render(<MemoryRouter><I18nProvider language={language}><main className="page-frame"><div className="jev-page gold-page decisions-page"><DecisionsWorkspace data={data}/></div></main></I18nProvider></MemoryRouter>);
