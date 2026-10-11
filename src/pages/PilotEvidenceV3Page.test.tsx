import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import {
  EvidenceV3Workspace,
  PilotEvidenceV3Page,
} from "./PilotEvidenceV3Page";
import { syntheticEvidenceV3View } from "../../tests/fixtures/pilot-evidence-v3";
import { restorableRoute } from "../lib/navigation-state";
const api = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ data: true, isPending: false }));
vi.mock("../lib/pilot-evidence-v3", () => ({ evidenceV3Api: api }));
vi.mock("../lib/use-jev-access", () => ({ useJevAccess: () => gate }));
vi.mock(
  "../app/AppContext",
  () => ({
    useApp: () => ({
      currentUser: { id: "owner" },
      demoMode: false,
      notifications: [],
    }),
  }),
);
const mount = (ui: React.ReactNode, language: "fr" | "vi" = "fr") =>
  render(
    <QueryClientProvider
      client={new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      })}
    >
      <MemoryRouter>
        <I18nProvider language={language}>{ui}</I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  gate.data = true;
});
it.each(["fr", "vi"] as const)(
  "%s 25 themes, four specific recommendations, diagnostic caveat and disabled semantic port",
  async (language) => {
    mount(
      <EvidenceV3Workspace
        data={await syntheticEvidenceV3View()}
        audit={async () => {}}
      />,
      language,
    );
    expect(
      screen.getByRole("button", {
        name: language === "fr"
          ? "Vérification sémantique IA — désactivée"
          : "Kiểm tra ngữ nghĩa AI — chưa bật",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("heading", {
        name: language === "fr"
          ? "Nouveau contrôle figé — 40 avis"
          : "Bộ kiểm tra mới đã cố định — 40 đánh giá",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: language === "fr"
          ? "Quatre recommandations expérimentales"
          : "Bốn khuyến nghị thử nghiệm",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(language === "fr" ? "À réexaminer" : "Cần xem lại")
        .length,
    ).toBeGreaterThan(0);
  },
);
it("reload and refresh only read persisted audit", async () => {
  api.mockResolvedValue(await syntheticEvidenceV3View());
  const m = mount(<PilotEvidenceV3Page />);
  await screen.findByRole("heading", { name: "Statistiques JEV — inchangées" });
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser sans appel IA" }),
  );
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  m.unmount();
  mount(<PilotEvidenceV3Page />);
  await screen.findByRole("heading", { name: "Statistiques JEV — inchangées" });
  expect(api.mock.calls.every((c) => c.length === 0)).toBe(true);
  expect(restorableRoute("/plus/jev-pilot-evidence-v3")).toBe(true);
});
it("manual free action double tap blocked", async () => {
  const d = await syntheticEvidenceV3View();
  api.mockResolvedValueOnce({
    ...d,
    record: null,
    control: null,
    blind_export: null,
  });
  let resolve: (value: unknown) => void = () => {};
  api.mockImplementationOnce(() =>
    new Promise((r) => {
      resolve = r;
    })
  );
  mount(<PilotEvidenceV3Page />);
  const b = await screen.findByRole("button", {
    name: "Préparer gratuitement l’audit V3",
  });
  fireEvent.click(b);
  fireEvent.click(b);
  expect(api.mock.calls).toEqual([[], [true]]);
  resolve(d);
  await screen.findByRole("heading", { name: "Statistiques JEV — inchangées" });
});
it("unauthorized role cannot read V3 data", () => {
  gate.data = false;
  mount(<PilotEvidenceV3Page />);
  expect(api).not.toHaveBeenCalled();
  expect(screen.getByText(/Réservé aux propriétaires/)).toBeInTheDocument();
});
