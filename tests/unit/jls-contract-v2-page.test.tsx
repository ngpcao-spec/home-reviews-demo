import {afterEach,expect,it,vi} from "vitest";
import {cleanup,render,screen,waitFor,fireEvent} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {I18nProvider} from "../../src/i18n";
import {JevLunaSolPage} from "../../src/pages/JevLunaSolPage";
import {supabase} from "../../src/lib/supabase";
import {contractViewFixture} from "../fixtures/jls-contract-v2-view";
vi.mock("../../src/app/AppContext",()=>({useApp:()=>({currentUser:{id:"synthetic-user"},demoMode:false,notifications:[],
 establishments:[{id:"252a8dca-14c7-4f09-bd1f-7b2c40ae97aa",name:"Artisan"},{id:"d40d3438-79d8-4c28-8b09-eba640598201",name:"SYNTHETIC V2 REPORT"}]})}));
vi.mock("../../src/lib/supabase",()=>({supabase:{functions:{invoke:vi.fn()}}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
function mount(){
 const q=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 return render(<MemoryRouter initialEntries={["/plus/jev-luna-sol?establishment_id=d40d3438-79d8-4c28-8b09-eba640598201"]}>
  <QueryClientProvider client={q}><I18nProvider language="fr"><JevLunaSolPage/></I18nProvider></QueryClientProvider></MemoryRouter>);
}
it("a direct Garden link survives remount and loads the new report through GET only",async()=>{
 vi.mocked(supabase!.functions.invoke).mockResolvedValue({data:{protocol:null,run:null,result:null,progress:null,contract_v2:contractViewFixture(),history_available:true},error:null});
 const first=mount();await screen.findByTestId("jls-contract-v2-report");
 expect(screen.getByRole("combobox")).toHaveValue("d40d3438-79d8-4c28-8b09-eba640598201");
 first.unmount();mount();await screen.findByTestId("jls-contract-v2-report");
 for(const [path,options]of vi.mocked(supabase!.functions.invoke).mock.calls){expect(path).toContain("establishment_id=d40d3438");expect(path).not.toContain("historical");expect(options?.method).toBe("GET");}
});
it("historical reports are fetched only when their separate section is opened",async()=>{
 vi.mocked(supabase!.functions.invoke).mockImplementation(async path=>({data:String(path).includes("historical")?
  {protocol:null,run:null,result:null,progress:null}:{protocol:null,run:null,result:null,progress:null,contract_v2:contractViewFixture(),history_available:true},error:null}));
 mount();await screen.findByTestId("jls-contract-v2-report");
 const details=screen.getByText("Consulter les rapports historiques conservés").closest("details")!;
 details.open=true;fireEvent(details,new Event("toggle"));
 await waitFor(()=>expect(vi.mocked(supabase!.functions.invoke).mock.calls.some(([p])=>p.includes("view=historical"))).toBe(true));
 expect(screen.getByTestId("jls-contract-v2-report")).toBeVisible();
});
