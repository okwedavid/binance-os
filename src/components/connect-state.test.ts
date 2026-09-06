import { describe, expect, it } from "vitest";
import type { AuthCapability } from "@/lib/types";
import {
  authReadyCapability,
  connectActionLabel,
  connectIsActionable,
} from "./connect-state";

const CIMD_AUTH: AuthCapability = {
  supported: true,
  mechanism: "cimd",
  configured: true,
};

const SETUP_REQUIRED: AuthCapability = {
  supported: false,
  mechanism: "none",
  configured: false,
};

describe("authReadyCapability", () => {
  it("is true only when the server reports a supported, configured mechanism", () => {
    expect(authReadyCapability(CIMD_AUTH)).toBe(true);
    expect(authReadyCapability(SETUP_REQUIRED)).toBe(false);
    expect(authReadyCapability(null)).toBe(false);
    expect(authReadyCapability(undefined)).toBe(false);
    expect(authReadyCapability({ ...CIMD_AUTH, configured: false })).toBe(false);
  });
});

describe("connectActionLabel", () => {
  it("shows Connecting while a connection attempt is in flight", () => {
    expect(
      connectActionLabel({ authReady: true, connected: false, connecting: true, error: false })
    ).toBe("Connecting…");
  });

  it("shows Agent OS Connected once the server confirms a session", () => {
    expect(
      connectActionLabel({ authReady: true, connected: true, connecting: false, error: false })
    ).toBe("Agent OS Connected");
  });

  it("shows Try Again after an error (still actionable)", () => {
    expect(
      connectActionLabel({ authReady: true, connected: false, connecting: false, error: true })
    ).toBe("Try Again");
  });

  it("shows Setup Required but never disables the control", () => {
    const state = { authReady: false, connected: false, connecting: false, error: false };
    expect(connectActionLabel(state)).toBe("Agent OS Setup Required");
    expect(connectIsActionable(state)).toBe(true);
  });

  it("shows Connect Agent OS when everything is ready", () => {
    expect(
      connectActionLabel({ authReady: true, connected: false, connecting: false, error: false })
    ).toBe("Connect Agent OS");
  });

  it("shows Try Again even when setup is required and a prior attempt failed", () => {
    expect(
      connectActionLabel({ authReady: false, connected: false, connecting: false, error: true })
    ).toBe("Try Again");
  });
});

describe("connectIsActionable", () => {
  it("is disabled only during an in-flight connection", () => {
    expect(connectIsActionable({ authReady: true, connected: false, connecting: true, error: false })).toBe(false);
    expect(connectIsActionable({ authReady: true, connected: false, connecting: false, error: false })).toBe(true);
    expect(connectIsActionable({ authReady: true, connected: true, connecting: false, error: false })).toBe(true);
    expect(connectIsActionable({ authReady: false, connected: false, connecting: false, error: true })).toBe(true);
  });
});