"use client";

import type { AuthCapability, ConnectionState, Mode } from "@/lib/types";
import type { DemoScenario } from "@/lib/demo/data";
import { Panel, StatusDot, Button } from "@/components/ui";
import { authReadyCapability, connectActionLabel } from "@/components/connect-state";

const SCENARIOS: Array<{
  id: DemoScenario;
  title: string;
  description: string;
}> = [
  {
    id: "healthy",
    title: "Healthy market",
    description: "Deterministic demo PASS — all checks inside thresholds.",
  },
  {
    id: "volatile",
    title: "Elevated volatility",
    description: "Deterministic demo CAUTION — volatility above the threshold.",
  },
  {
    id: "blocked",
    title: "Insufficient balance",
    description: "Deterministic demo BLOCK — balance below the requested amount.",
  },
];

export function ConnectionDrawer({
  open,
  onClose,
  mode,
  onModeChange,
  scenario,
  onScenarioChange,
  demoState,
  liveState,
  auth,
  connectError,
  onConnect,
  connecting,
  onDisconnect,
  onResetDemo,
}: {
  open: boolean;
  onClose: () => void;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  scenario: DemoScenario;
  onScenarioChange: (scenario: DemoScenario) => void;
  demoState: ConnectionState | null;
  liveState: ConnectionState | null;
  auth?: AuthCapability | null;
  connectError?: string | null;
  onConnect: () => void;
  connecting: boolean;
  onDisconnect: () => void;
  onResetDemo?: () => void;
}) {
  // Honest three-way button state. `authReady` reflects the server-reported
  // OAuth capability of THIS deployment — never assumed from client-side
  // clicks. The button is never permanently disabled; when setup is required
  // it stays clickable so it can surface the server's recoverable error.
  const authReady = authReadyCapability(auth);
  const actionLabel = connectActionLabel({
    authReady,
    connected: liveState?.connected === true,
    connecting,
    error: Boolean(connectError),
  });
  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />
      <aside
        className={`absolute right-0 top-0 h-full w-full max-w-[420px] overflow-y-auto border-l border-line bg-canvas transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text">
            Settings
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-muted transition-colors hover:bg-panel3 hover:text-text"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <section>
            <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              Mode
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ModeCard
                active={mode === "demo"}
                title="Demo"
                description="Deterministic simulation."
                onClick={() => onModeChange("demo")}
              />
              <ModeCard
                active={mode === "live" && liveState?.connected === true}
                title="Live"
                description="Requires a verified Agent OS connection."
                onClick={() => onModeChange("live")}
              />
            </div>
            {mode === "demo" && !liveState?.connected && (
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                Live Mode activates after Agent OS is connected — select Live,
                then connect Agent OS below.
              </p>
            )}
          </section>

          {mode === "demo" && (
            <section>
              <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                Demo scenario
              </div>
              <div className="space-y-2">
                {SCENARIOS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onScenarioChange(s.id)}
                    className={`w-full cursor-pointer rounded-lg border px-3 py-2.5 text-left transition-all duration-150 ease-in-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:scale-[0.98] ${
                      scenario === s.id
                        ? "border-acc/60 bg-acc/10"
                        : "border-line bg-panel hover:border-line2 hover:bg-panel2"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-text">
                        {s.title}
                      </span>
                      {scenario === s.id && (
                        <span className="font-mono text-[10px] font-semibold text-acc">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">
                      {s.description}
                    </div>
                  </button>
                ))}
              </div>
              {onResetDemo && (
                <Button
                  variant="secondary"
                  onClick={onResetDemo}
                  className="mt-3 w-full"
                >
                  Reset Demo Portfolio
                </Button>
              )}
            </section>
          )}

          <section>
            <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              Agent OS connection
            </div>
            <Panel className="px-4 py-3">
              {mode === "demo" ? (
                <StatusBlock
                  state={demoState}
                  fallbackText="Debug demo data is ready."
                />
              ) : (
                <StatusBlock
                  state={liveState}
                  fallbackText="Live status unavailable."
                />
              )}
            </Panel>
          </section>

          <section className="space-y-2.5">
            {liveState?.permissions?.length ? (
              <div className="space-y-1.5">
                {liveState.permissions.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-lg border border-line bg-panel px-3 py-2"
                  >
                    <div>
                      <div className="text-[13px] font-medium text-text">
                        {p.label}
                      </div>
                      <div className="font-mono text-[10px] text-muted">
                        {p.id}
                      </div>
                    </div>
                    <StatusDot
                      tone={
                        p.granted === true
                          ? "ok"
                          : p.granted === false
                            ? "danger"
                            : "muted"
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <Panel className="px-4 py-3 text-[13px] text-muted">
                No Agent OS connection yet. Connect the Agentic sub-account to
                enable live evidence — until then RiskLens stays in Demo Mode
                and nothing executes.
              </Panel>
            )}

            {liveState?.connected ? (
              <Button variant="secondary" onClick={onDisconnect} className="w-full">
                Disconnect Agent OS
              </Button>
            ) : (
              <Button
                variant={authReady ? "primary" : "secondary"}
                onClick={onConnect}
                disabled={connecting}
                className="w-full"
              >
                {actionLabel}
              </Button>
            )}

            {connectError ? (
              <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] leading-relaxed text-danger">
                {connectError}
              </div>
            ) : !authReady ? (
              <div className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] leading-relaxed text-muted">
                {auth?.detail ??
                  "Agent OS setup is required on this deployment before RiskLens can connect to Binance. No API key is needed — the deployment only needs to be reachable over public HTTPS for Binance to accept its OAuth client metadata."}
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-line bg-panel px-4 py-3 text-[12px] leading-relaxed text-muted">
            <span className="font-semibold text-text">Isolation.</span> The
            Agentic sub-account is isolated from your main Binance account.
            RiskLens only sees market data, read-only account info and
            supported trading scopes you grant — withdrawals are never exposed
            and RiskLens never moves funds on its own.
          </section>
        </div>
      </aside>
    </div>
  );
}

function ModeCard({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`cursor-pointer rounded-lg border px-3 py-2.5 text-left transition-all duration-150 ease-in-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc active:scale-[0.98] ${
        active
          ? "border-acc/70 bg-acc/10 shadow-sm"
          : "border-line bg-panel hover:border-line2 hover:bg-panel2"
      }`}
    >
      <div className="text-sm font-semibold text-text">{title}</div>
      <div className="mt-0.5 text-[12px] text-muted">{description}</div>
    </button>
  );
}

function StatusBlock({
  state,
  fallbackText,
}: {
  state: ConnectionState | null;
  fallbackText: string;
}) {
  if (!state) {
    return <div className="text-[13px] text-muted">{fallbackText}</div>;
  }
  return (
    <div>
      <div className="flex items-center gap-2">
        <StatusDot tone={state.connected ? "ok" : "muted"} />
        <span className="text-sm font-semibold text-text">
          {state.statusText}
        </span>
      </div>
      <div className="mt-1 text-[12px] leading-relaxed text-muted">
        {state.detail}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {state.permissions.map((p) => (
          <span
            key={p.id}
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
              p.granted === true
                ? "border-ok/30 bg-ok/10 text-ok"
                : p.granted === false
                  ? "border-danger/30 bg-danger/10 text-danger"
                  : "border-line2 bg-panel3 text-muted"
            }`}
          >
            {p.granted === true ? "✓ " : p.granted === false ? "✕ " : "? "}
            {p.id}
          </span>
        ))}
      </div>
    </div>
  );
}