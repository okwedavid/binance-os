"use client";

import type { TimelineEvent, TimelineKind } from "@/lib/types";
import { Panel, PanelTitle } from "@/components/ui";
import { fmtTs } from "@/lib/format";

const KIND_STYLE: Record<
  TimelineKind,
  { dot: string; label: string }
> = {
  SYSTEM: { dot: "bg-muted", label: "text-muted" },
  ANALYSIS: { dot: "bg-acc", label: "text-acc" },
  PROPOSAL: { dot: "bg-acc", label: "text-acc" },
  APPROVED: { dot: "bg-ok", label: "text-ok" },
  EXECUTED: { dot: "bg-ok", label: "text-ok" },
  SIMULATED: { dot: "bg-ok", label: "text-ok" },
  PAUSED: { dot: "bg-muted", label: "text-muted" },
  BLOCKED: { dot: "bg-danger", label: "text-danger" },
  BALANCE: { dot: "bg-acc", label: "text-acc" },
  CONNECT: { dot: "bg-ok", label: "text-ok" },
  DISCONNECT: { dot: "bg-muted", label: "text-muted" },
  CANCELLED: { dot: "bg-warn", label: "text-warn" },
};

export function ActivityTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <Panel>
      <PanelTitle>Audit trail</PanelTitle>
      {events.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted">
          Your audit trail of evidence checks will appear here.
        </div>
      ) : (
        <ol className="px-4 py-3">
          {events.map((event) => {
            const style = KIND_STYLE[event.kind];
            return (
              <li key={event.id} className="relative flex gap-3 pb-5 last:pb-1">
                <span className="flex flex-col items-center">
                  <span
                    className={`mt-1.5 h-2 w-2 rounded-full ${style.dot}`}
                    aria-hidden
                  />
                  <span className="mt-1 w-px flex-1 bg-line" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${style.label}`}
                    >
                      {event.kind}
                    </span>
                    <time className="shrink-0 font-mono text-[10px] text-muted">
                      {fmtTs(event.atMs)}
                    </time>
                  </div>
                  <div className="mt-0.5 text-[13px] font-medium text-text">
                    {event.label}
                  </div>
                  <div className="text-[12px] leading-relaxed text-muted">
                    {event.detail}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}