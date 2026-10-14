import {createRoot} from "react-dom/client";
import {I18nProvider} from "../../../src/i18n";
import {JlsRestaurantPreparation,type RestaurantView} from "../../../src/components/analysis/JlsRestaurantPreparation";
import "../../../src/styles/global.css";
import "../../../src/styles/pages.css";
import "../../../src/styles/warm-theme.css";
import "../../../src/pages/JevLunaSolPage.css";
const language=new URLSearchParams(location.search).get("language")==="vi"?"vi":"fr";
const data:RestaurantView={protocol:{id:"11111111-1111-4111-8111-111111111111",sha256:"a".repeat(64),created_at:"2026-10-14",
 establishment_name:"Xóm Mới Garden",source_sha256:"b".repeat(64),configuration_sha256:"c".repeat(64),
 coverage:{google_total:17038,stored_reviews:587,reviews_with_text:550,english_ready:78,reused_analyses:7,missing_analyses:71,missing_english:472},
 max_jev_calls:71,max_luna_calls:32,max_sol_calls:1,language:"vi",format_version:"jls-prioritized-recommendations-v1",
 editorial_version:"jls-prioritized-editorial-v1"},run:null,result:null,progress:null};
createRoot(document.getElementById("root")!).render(<I18nProvider language={language}><main style={{padding:16,maxWidth:700,margin:"auto"}}><p>EXPLICIT SYNTHETIC TEST</p><JlsRestaurantPreparation data={data}/></main></I18nProvider>);
