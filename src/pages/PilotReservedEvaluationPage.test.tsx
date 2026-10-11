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
  PilotReservedEvaluationPage,
  ReservedEvaluationWorkspace,
} from "./PilotReservedEvaluationPage";
import artifact from "../../docs/pilot-evidence-v3-reserved40-evaluation-20261011.json";
import type { ReservedEvaluationView } from "../lib/pilot-reserved-evaluation";
import { restorableRoute } from "../lib/navigation-state";
const api = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ data: true, isPending: false }));
vi.mock(
  "../lib/pilot-reserved-evaluation",
  () => ({ reservedEvaluationApi: api }),
);
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
const data = {
  record: { id: "fixture-only", ...artifact, created_at: "2026-10-11" },
  ready: true,
  read_only: true,
  new_paid_calls: 0,
  production_enabled: false,
} as unknown as ReservedEvaluationView;
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
  "%s real report, no paid action or human-Gold claim, 40 cases",
  (language) => {
    mount(<ReservedEvaluationWorkspace data={data} />, language);
    expect(screen.getByText(
      language === "fr"
        ? "GO pour poursuivre les diagnostics expérimentaux. NO GO pour utiliser V3 comme filtre autonome ou l’activer en production."
        : "GO tiếp tục chẩn đoán thử nghiệm. NO GO dùng V3 làm bộ lọc tự động hoặc bật production.",
    )).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: language === "fr"
        ? "Exporter le compte rendu immuable"
        : "Xuất kết quả bất biến",
    })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /JEV|Sol|GPT/ })).not
      .toBeInTheDocument();
    expect(screen.getAllByText(/5\/5/)).toHaveLength(2);
  },
);
it("readonly reload/refresh and exact category filter", async () => {
  api.mockResolvedValue(data);
  const m = mount(<PilotReservedEvaluationPage />);
  await screen.findByRole("heading", { name: "Résultat réel V3" });
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "justified_rejected" },
  });
  expect(screen.getAllByText("50e0a434-b71b-410f-9149-122cec9a23d0"))
    .toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Actualiser le compte rendu" }),
  );
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  m.unmount();
  mount(<PilotReservedEvaluationPage />);
  await screen.findByRole("heading", { name: "Résultat réel V3" });
  expect(api.mock.calls.every((c) => c.length === 0)).toBe(true);
  expect(restorableRoute("/plus/jev-pilot-reserved-evaluation")).toBe(true);
});
it("denied roles cannot read report", () => {
  gate.data = false;
  mount(<PilotReservedEvaluationPage />);
  expect(api).not.toHaveBeenCalled();
});
