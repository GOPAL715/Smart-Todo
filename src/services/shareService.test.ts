import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/supabase", () => ({
  supabase: { rpc: vi.fn() },
}));

import {
  shareFailureMessage,
  isEnumerationSensitiveReason,
  isSameEmail,
  shareTask,
  GENERIC_SHARE_FAILURE,
  type ShareFailureReason,
} from "./shareService";
import { supabase } from "@/services/supabase";

const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

describe("shareFailureMessage — account enumeration protection (P1-7)", () => {
  it("does not reveal that an email is unregistered", () => {
    // Previously: "We couldn't find an account with that email."
    expect(shareFailureMessage("not_found")).toBe(GENERIC_SHARE_FAILURE);
    expect(shareFailureMessage("not_found")).not.toMatch(/account|email|registered|exist/i);
  });

  it("uses the same message for every enumeration-sensitive reason", () => {
    const sensitive: ShareFailureReason[] = ["not_found", "self", "unknown"];
    const messages = sensitive.map((reason) => shareFailureMessage(reason));
    expect(new Set(messages).size).toBe(1);
  });

  it("treats a missing reason as the generic message", () => {
    expect(shareFailureMessage(undefined)).toBe(GENERIC_SHARE_FAILURE);
  });

  it("keeps messages that are safe to show", () => {
    // These describe the caller's own mistake or access, not another account's
    // existence, so they stay specific and useful.
    expect(shareFailureMessage("invalid_permission")).toBe(
      "Choose either view-only or can edit."
    );
    expect(shareFailureMessage("not_authenticated")).toMatch(/sign in/i);
    expect(shareFailureMessage("not_owner")).toMatch(/created this task/i);
  });

  it("never exposes the word 'not found' or a lookup failure to the user", () => {
    for (const reason of ["not_found", "self", "unknown", "not_permitted", "not_owner"]) {
      expect(shareFailureMessage(reason as ShareFailureReason)).not.toMatch(
        /not found|no account|doesn't exist|does not exist/i
      );
    }
  });
});

describe("isEnumerationSensitiveReason", () => {
  it("flags the reasons that would disclose account existence", () => {
    expect(isEnumerationSensitiveReason("not_found")).toBe(true);
    expect(isEnumerationSensitiveReason("self")).toBe(true);
    expect(isEnumerationSensitiveReason("unknown")).toBe(true);
  });

  it("does not flag reasons that are safe to show", () => {
    expect(isEnumerationSensitiveReason("invalid_email")).toBe(false);
    expect(isEnumerationSensitiveReason("invalid_permission")).toBe(false);
    expect(isEnumerationSensitiveReason("not_owner")).toBe(false);
    expect(isEnumerationSensitiveReason("not_permitted")).toBe(false);
    expect(isEnumerationSensitiveReason(undefined)).toBe(false);
  });
});

describe("isSameEmail", () => {
  it("compares case-insensitively and ignores surrounding whitespace", () => {
    expect(isSameEmail("User@Example.com", "user@example.com")).toBe(true);
    expect(isSameEmail("  user@example.com  ", "USER@EXAMPLE.COM")).toBe(true);
  });

  it("returns false for different addresses", () => {
    expect(isSameEmail("a@example.com", "b@example.com")).toBe(false);
  });
});

describe("shareTask self-share guard", () => {
  it("does not call the database for the caller's own address", async () => {
    mockRpc.mockClear();
    const result = await shareTask("task-1", "Me@Example.com", "VIEW", "me@example.com");

    expect(result).toEqual({ ok: false, reason: "self" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("proceeds normally for a different address", async () => {
    mockRpc.mockClear();
    mockRpc.mockResolvedValueOnce({
      data: { shared: true, recipient: "Someone" },
      error: null,
    });

    const result = await shareTask("task-1", "other@example.com", "VIEW", "me@example.com");

    expect(result.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("never surfaces a raw RPC error", async () => {
    mockRpc.mockClear();
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "postgres://user:pw@internal/db failed", code: "08006" },
    });

    const result = await shareTask("task-1", "other@example.com", "EDIT");

    expect(result).toEqual({ ok: false, reason: "unknown" });
    // The generic message shown for it must not contain the provider detail.
    expect(shareFailureMessage(result.reason)).not.toContain("postgres://");
  });
});
