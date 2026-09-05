"use client";

import type { ConnectionState, Mode } from "@/lib/types";
import type { DemoScenario } from "@/lib/demo/data";
import { Panel, StatusDot, Button } from "@/components/ui";

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
  onConnect,
  connecting,
  onDisconnect,
}: {
  open: boolean;
  onClose: () => void;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  scenario: DemoScenario;
  onScenarioChange: (scenario: DemoScenario) => void;
  demoState: ConnectionState | null;
  liveState: ConnectionState | null;
  onConnect: () => void;
  connecting: boolean;
  onDisconnect: () => void;
}) {
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
                active={mode === "live"}
                title="Live"
                description="Real Agent OS connection."
                onClick={() => onModeChange("live")}
              />
            </div>
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
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      scenario === s.id
                        ? "border-acc/60 bg-acc/10"
                        : "border-line bg-panel hover:border-line2"
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

          {mode === "live" && (
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
                  No scopes confirmed yet. Authorize your Agentic sub-account to
                  confirm the permission set.
                </Panel>
              )}

              {liveState?.connected ? (
                <Button variant="secondary" onClick={onDisconnect} className="w-full">
                  Disconnect Agent OS
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={onConnect}
                  disabled={connecting}
                  className="w-full"
                >
                  {connecting ? "Opening Binance…" : "Connect Agent OS"}
                </Button>
              )}
            </section>
          )}

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
      className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
        active
          ? "border-acc/60 bg-acc/10"
          : "border-line bg-panel hover:border-line2"
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