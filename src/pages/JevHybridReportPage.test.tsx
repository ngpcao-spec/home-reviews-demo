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
import { HybridWorkspace, JevHybridReportPage } from "./JevHybridReportPage";
import { hybridFixture } from "../../tests/fixtures/jev-hybrid";
import { hybridHash } from "../../supabase/functions/_shared/jev-hybrid-evidence";
import type { HybridView } from "../lib/jev-hybrid-report";
import { restorableRoute } from "../lib/navigation-state";
const api = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ data: true, isPending: false }));
vi.mock("../lib/jev-hybrid-report", () => ({ hybridReportApi: api }));
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
async function hybridFixtureView(
  language: "fr" | "vi" = "fr",
): Promise<HybridView> {
  const { plan } = await hybridFixture(language);
  return {
    plan: {
      id: "fixture",
      body: plan,
      result_sha256: await hybridHash(plan),
      created_at: "2026-10-11",
    },
    control: {
      id: "future-fixture",
      result_sha256: "future-fixture-sha",
      body: { missing_jev: 40, reference_labels: 0 },
    },
    jobs: [],
    paid_enabled: false,
    can_generate: false,
    production_enabled: false,
    new_paid_calls: 0,
  };
}
it.each(["fr", "vi"] as const)(
  "%s generation disabled, free dossier, clear experimental/no independent verification",
  async (language) => {
    mount(
      <HybridWorkspace data={await hybridFixtureView(language)} />,
      language,
    );
    const button = screen.getByRole("button", {
      name: language === "fr"
        ? "Générer le rapport hybride"
        : "Tạo báo cáo kết hợp",
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        language === "fr"
          ? "Pipeline expérimental. Génération payante non autorisée."
          : "Pipeline thử nghiệm. Chưa cho phép tạo báo cáo tính phí.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: language === "fr"
          ? "Prévisualisation gratuite — aucune réponse Sol"
          : "Xem trước miễn phí — chưa có phản hồi Sol",
      }),
    ).toBeInTheDocument();
  },
);
it("readonly GET resume and refresh, no implicit spend", async () => {
  api.mockResolvedValue(await hybridFixtureView());
  const m = mount(<JevHybridReportPage />);
  await screen.findByRole("heading", {
    name: "Statistiques exactes — JEV, pas Sol",
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Actualiser la prévisualisation gratuite",
    }),
  );
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  m.unmount();
  mount(<JevHybridReportPage />);
  await screen.findByRole("heading", {
    name: "Statistiques exactes — JEV, pas Sol",
  });
  expect(api.mock.calls.every((c) => c.length === 1 && c[0] === "fr")).toBe(
    true,
  );
  expect(restorableRoute("/plus/jev-hybrid-report")).toBe(true);
});
it("denied role cannot read dossier", () => {
  gate.data = false;
  mount(<JevHybridReportPage />);
  expect(api).not.toHaveBeenCalled();
});
