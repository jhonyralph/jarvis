import type { Page } from "@playwright/test";

const port = Number(process.env.JARVIS_PERSONAL_UI_PORT || 43917);
const fixtureOrigin = `http://127.0.0.1:${port}`;
const fixedNow = Date.UTC(2026, 7, 1, 15, 0, 0);

const state = {
  principalId: "playwright-owner",
  revision: 7,
  settings: {
    enabled: true,
    paused: false,
    pausedSourceIds: [] as string[],
    locationMode: "foreground",
    locationPrecision: "approximate",
    notifications: {
      quietStart: "22:00",
      quietEnd: "07:00",
      maxPerDay: 3,
      cooldownMinutes: 90,
      minScore: 0.7,
    },
    retention: {
      observationsDays: 14,
      decisionsDays: 90,
      inferredPreferencesDays: 30,
      keepRawLocation: false,
    },
  },
  sourceStatuses: [
    {
      descriptor: {
        id: "mapas-culturais-fixture",
        label: "Mapa Cultural BH (fixture)",
        purposes: ["events"],
        costClass: "free",
        transport: "http",
        certification: "first_party",
      },
      state: "ready",
      latencyMs: 12,
      lastSuccessAt: fixedNow,
    },
    {
      descriptor: {
        id: "caldav-fixture",
        label: "Equipe CalDAV (fixture)",
        purposes: ["calendar"],
        costClass: "free",
        transport: "http",
        certification: "audited",
      },
      state: "ready",
      latencyMs: 31,
      lastSuccessAt: fixedNow - 120_000,
    },
  ],
  deviceContext: {
    deviceId: "playwright-device",
    location: {
      observedAt: fixedNow - 60_000,
      expiresAt: Date.UTC(2030, 0, 1),
      precision: "approximate",
      source: "web",
      status: "fresh",
      needsSync: false,
    },
    calendar: {
      observedAt: fixedNow - 3_600_000,
      expiresAt: fixedNow - 1,
      rangeStartAt: fixedNow,
      rangeEndAt: fixedNow + 86_400_000,
      timeZone: "America/Sao_Paulo",
      busyIntervals: 2,
      truncated: false,
      source: "android",
      status: "expired",
      needsSync: true,
    },
  },
  sources: [
    {
      id: "caldav-fixture",
      type: "caldav",
      label: "Equipe CalDAV (fixture)",
      enabled: true,
      endpoint: "https://calendar.invalid/",
      config: { certification: "audited", access: "busy_free", timeZone: "America/Sao_Paulo" },
      allowedResources: ["https://calendar.invalid/team/"],
      allowedActions: [],
      hasSecret: true,
      configuredEnvNames: [],
      createdAt: fixedNow - 86_400_000,
      updatedAt: fixedNow,
    },
  ],
  consents: [
    {
      id: "consent-events-fixture",
      principalId: "playwright-owner",
      sourceId: "mapas-culturais-fixture",
      purposes: ["events"],
      fields: ["*"],
      grantedAt: fixedNow - 60_000,
      expiresAt: Date.UTC(2030, 0, 1),
    },
    {
      id: "consent-device-calendar-fixture",
      principalId: "playwright-owner",
      sourceId: "device-calendar",
      purposes: ["calendar"],
      fields: ["busy"],
      grantedAt: fixedNow - 60_000,
      expiresAt: Date.UTC(2030, 0, 1),
    },
  ],
  favorites: [],
  preferences: [],
  vehicleProfiles: [],
  deviceProfiles: [],
  actions: [] as Array<Record<string, unknown>>,
  dataSummary: {
    observations: 0,
    explicitPreferences: 0,
    inferredPreferences: 0,
    actions: 0,
    categories: [
      {
        category: "observations",
        volume: 3,
        sourceIds: ["mapas-culturais-fixture"],
        retentionDays: 14,
        lastUpdatedAt: fixedNow,
      },
    ],
  },
};

const suggestions = [
  {
    id: "suggestion-event-festival",
    kind: "event",
    score: 0.93,
    candidate: {
      id: "event-festival-luzes",
      kind: "event",
      title: "Festival de Luzes - fixture",
      point: { lat: -19.9245, lng: -43.9352 },
      data: {
        category: "festival cultural",
        confidence: 0.91,
        startAt: Date.UTC(2026, 7, 2, 22, 0, 0),
        updatedAt: Date.UTC(2026, 7, 1, 14, 30, 0),
        locationName: "Praca da Liberdade",
        state: "confirmed",
        straightLineDistanceM: 1100,
        routedDistanceM: 1450,
        durationSeconds: 780,
        legs: [{ encodedPolyline: "fwm_e@nu{xrAgiB_|BwkGozD" }],
      },
    },
    reasons: ["fonte oficial confirmada", "rota local disponivel"],
    caveats: [],
    sources: [
      {
        sourceId: "mapas-culturais-fixture",
        recordId: "festival-luzes",
        observedAt: fixedNow,
        freshness: "fresh",
        attribution: "Mapa Cultural BH (fixture)",
        url: "https://events.invalid/festival-luzes",
      },
    ],
    actions: [
      {
        id: "action-calendar-fixture",
        kind: "calendar.create",
        risk: "external_reversible",
        state: "pending",
        requiresConfirmation: true,
        expiresAt: Date.UTC(2030, 0, 1),
        preview: {
          title: "Adicionar festival a agenda",
          label: "Revisar na agenda",
          when: "2026-08-02 19:00",
          source: "Mapa Cultural BH (fixture)",
        },
      },
    ],
  },
];

export interface FixtureAudit {
  externalRequests: string[];
  pageErrors: string[];
}

export async function installPersonalAssistantFixture(page: Page): Promise<FixtureAudit> {
  const audit: FixtureAudit = { externalRequests: [], pageErrors: [] };
  page.on("pageerror", (error) => audit.pageErrors.push(error.message));
  await page.route("**/*", async (route) => {
    const requestURL = new URL(route.request().url());
    if (requestURL.origin === fixtureOrigin || requestURL.protocol === "blob:" || requestURL.protocol === "data:") {
      await route.continue();
      return;
    }
    audit.externalRequests.push(requestURL.href);
    await route.abort("internetdisconnected");
  });

  await page.addInitScript(
    ({ fixtureState, fixtureSuggestions }) => {
      type Frame = Record<string, unknown> & { t?: string; requestId?: string };
      type FixtureApi = {
        mode: "results" | "empty" | "error";
        receivedState: number;
        sent: Frame[];
        popup?: { href: string; closed: boolean };
        popupBlocked: boolean;
      };

      const fixtureApi: FixtureApi = { mode: "results", receivedState: 0, sent: [], popupBlocked: false };
      Object.defineProperty(window, "__jarvisTest", { value: fixtureApi, configurable: false });
      localStorage.setItem("jarvis_token", "playwright-fixture-token");
      window.open = (() => {
        if (fixtureApi.popupBlocked) return null;
        const popupState = { href: "about:blank", closed: false };
        const popupDocument = document.implementation.createHTMLDocument("");
        const popup = {
          get closed() { return popupState.closed; },
          opener: window,
          document: popupDocument,
          location: {
            get href() { return popupState.href; },
            set href(value: string) { popupState.href = String(value); },
          },
          close() { popupState.closed = true; },
        };
        fixtureApi.popup = popupState;
        return popup as unknown as Window;
      }) as typeof window.open;

      class FakeWebSocket {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSING = 2;
        static readonly CLOSED = 3;

        readonly url: string;
        readyState = FakeWebSocket.CONNECTING;
        onopen: ((event: Event) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent<string>) => void) | null = null;

        constructor(url: string | URL) {
          this.url = String(url);
          setTimeout(() => {
            this.readyState = FakeWebSocket.OPEN;
            this.onopen?.(new Event("open"));
          }, 0);
        }

        send(data: string) {
          const frame = JSON.parse(String(data)) as Frame;
          fixtureApi.sent.push(frame);
          if (frame.t === "auth") {
            this.respond({
              t: "authed",
              token: "playwright-fixture-token",
              user: { id: "playwright-owner", label: "Playwright fixture", role: "owner" },
            });
            return;
          }
          if (frame.t === "personal_context_get") {
            const action = fixtureState.actions[0];
            if (action?.state === "running" && action.awaitingClientAck === true
              && Number(action.clientAckExpiresAt) <= Date.now()) {
              fixtureState.actions = [{
                ...action,
                state: "uncertain",
                awaitingClientAck: false,
                completedAt: Date.now(),
                error: "client handoff acknowledgement timed out; verify whether the destination opened before retrying",
              }];
            }
            fixtureApi.receivedState += 1;
            this.respond({ t: "personal_context_state", requestId: frame.requestId, state: fixtureState });
            return;
          }
          if (frame.t === "personal_context_query") {
            fixtureState.revision += 1;
            const errors = fixtureApi.mode === "error"
              ? [{ sourceId: "mapas-culturais-fixture", error: "Fonte oficial indisponivel (fixture offline)." }]
              : [];
            this.respond({
              t: "personal_context_suggestions",
              requestId: frame.requestId,
              suggestions: fixtureApi.mode === "results" ? fixtureSuggestions : [],
              errors,
              revision: fixtureState.revision,
              diagnostics: fixtureApi.mode === "empty"
                ? [{ status: "discarded", candidateId: "discarded-fixture", reasons: ["outside_requested_window"] }]
                : [],
            });
            return;
          }
          if (frame.t === "personal_context_update") {
            fixtureState.settings = { ...fixtureState.settings, ...(frame.patch as Record<string, unknown>) };
            fixtureState.revision += 1;
            this.respond({ t: "personal_context_state", requestId: frame.requestId, state: fixtureState });
            return;
          }
          if (frame.t === "personal_source_discover" && frame.sourceId === "caldav-fixture") {
            this.respond({
              t: "personal_source_discovery",
              requestId: frame.requestId,
              discovery: {
                sourceId: "caldav-fixture",
                state: "ready",
                health: "healthy",
                latencyMs: 42,
                calendars: [
                  { id: "team", name: "Equipe", href: "https://calendar.invalid/team/", allowed: true },
                  { id: "personal", name: "Pessoal", href: "https://calendar.invalid/personal/", allowed: false },
                ],
                tools: [],
                resources: [],
                truncated: { calendars: false, tools: false, resources: false },
              },
            });
            return;
          }
          if (frame.t === "personal_feedback_put") {
            fixtureState.revision = Number(frame.revision) + 1;
            this.respond({ t: "personal_context_result", requestId: frame.requestId, ok: true, revision: fixtureState.revision });
            return;
          }
          if (frame.t === "personal_action_preview" && frame.kind === "navigation.open") {
            const action = {
              id: "action-navigation-fixture",
              kind: "navigation.open",
              risk: "external_reversible",
              state: "approved",
              requiresConfirmation: false,
              createdAt: Date.now(),
              expiresAt: Date.now() + 60_000,
              preview: { title: "Abrir rota do festival", destination: "Festival de Luzes - fixture" },
            };
            fixtureState.actions = [action];
            this.respond({ t: "personal_action_view", requestId: frame.requestId, action });
            return;
          }
          if (frame.t === "personal_action_execute" && frame.planId === "action-navigation-fixture") {
            const action = {
              ...fixtureState.actions[0],
              state: "running",
              awaitingClientAck: true,
              executionDeviceId: "playwright-device",
              clientAckExpiresAt: Date.now() + 250,
              result: { handoff: "geo:-19.9245,-43.9352?q=Festival", requiresClientAck: true },
            };
            fixtureState.actions = [action];
            this.respond({ t: "personal_action_view", requestId: frame.requestId, action });
            return;
          }
          if (frame.t === "personal_action_handoff_result") {
            // Deliberately omit the ACK response; personal_context_get exposes the timeout state.
            return;
          }
        }

        close() {
          this.readyState = FakeWebSocket.CLOSED;
          this.onclose?.(new CloseEvent("close", { code: 1000, wasClean: true }));
        }

        private respond(frame: Frame) {
          setTimeout(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) })), 0);
        }
      }

      window.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    },
    { fixtureState: state, fixtureSuggestions: suggestions },
  );

  return audit;
}

export async function setFixtureMode(page: Page, mode: "results" | "empty" | "error") {
  await page.evaluate((nextMode) => {
    const fixture = (window as Window & { __jarvisTest?: { mode: string } }).__jarvisTest;
    if (!fixture) throw new Error("Personal assistant fixture is not installed");
    fixture.mode = nextMode;
  }, mode);
}
