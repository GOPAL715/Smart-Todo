import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/supabase", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
    },
  },
}));

import {
  buildResetRedirectUrl,
  isValidEmail,
  requestPasswordReset,
  updatePassword,
  NEUTRAL_RESET_MESSAGE,
  RESET_PASSWORD_PATH,
} from "./passwordResetService";
import { supabase } from "@/services/supabase";

const mockResetForEmail = supabase.auth.resetPasswordForEmail as unknown as ReturnType<
  typeof vi.fn
>;
const mockUpdateUser = supabase.auth.updateUser as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockResetForEmail.mockReset();
  mockUpdateUser.mockReset();
  mockResetForEmail.mockResolvedValue({ data: {}, error: null });
  mockUpdateUser.mockResolvedValue({ data: {}, error: null });
});

describe("buildResetRedirectUrl — open redirect protection", () => {
  it("returns the app's own origin plus the fixed reset route", () => {
    expect(buildResetRedirectUrl("https://app.example.com")).toBe(
      `https://app.example.com${RESET_PASSWORD_PATH}`
    );
  });

  it("supports a localhost development origin", () => {
    expect(buildResetRedirectUrl("http://localhost:5173")).toBe(
      `http://localhost:5173${RESET_PASSWORD_PATH}`
    );
  });

  it("keeps a non-default port", () => {
    expect(buildResetRedirectUrl("http://localhost:4173")).toBe(
      `http://localhost:4173${RESET_PASSWORD_PATH}`
    );
  });

  it("discards a path so it cannot be smuggled through the origin", () => {
    const built = buildResetRedirectUrl("https://app.example.com/evil/path?next=x");
    expect(built).toBe(`https://app.example.com${RESET_PASSWORD_PATH}`);
    expect(built).not.toContain("evil");
    expect(built).not.toContain("next=");
  });

  it("discards a fragment", () => {
    expect(buildResetRedirectUrl("https://app.example.com/#/steal")).toBe(
      `https://app.example.com${RESET_PASSWORD_PATH}`
    );
  });

  it("reduces a userinfo-prefixed origin to the real host", () => {
    // `https://app.example.com@evil.example` has evil.example as its host; a
    // naive concatenation would have sent the link to the attacker's site while
    // appearing to target the app.
    const built = buildResetRedirectUrl("https://app.example.com@evil.example");
    expect(built).toBe(`https://evil.example${RESET_PASSWORD_PATH}`);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(buildResetRedirectUrl("javascript:alert(1)")).toBeNull();
    expect(buildResetRedirectUrl("data:text/html,<script>")).toBeNull();
  });

  it("rejects a relative or unparseable origin", () => {
    expect(buildResetRedirectUrl("/reset-password")).toBeNull();
    expect(buildResetRedirectUrl("not a url")).toBeNull();
    expect(buildResetRedirectUrl("")).toBeNull();
  });
});

describe("isValidEmail", () => {
  it("accepts an ordinary address", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
  });

describe("requestPasswordReset", () => {
  it("calls Supabase with the correct redirect URL", async () => {
    await requestPasswordReset("User@Example.com", "https://app.example.com");

    expect(mockResetForEmail).toHaveBeenCalledTimes(1);
    const [email, options] = mockResetForEmail.mock.calls[0];
    expect(email).toBe("user@example.com");
    expect(options.redirectTo).toBe(`https://app.example.com${RESET_PASSWORD_PATH}`);
  });

  it("takes no caller-supplied redirect parameter", async () => {
    // The service accepts only an email and an origin; the route is fixed, so
    // a caller cannot aim the recovery link elsewhere.
    expect(requestPasswordReset.length).toBe(2);
  });

  it("never reaches the admin API", () => {
    // The browser client is the only auth surface used, so there is no admin
    // method available that could escalate this request.
    const auth = supabase.auth as unknown as Record<string, unknown>;
    expect(auth.admin).toBeUndefined();
    expect(Object.keys(auth).sort()).toEqual(["resetPasswordForEmail", "updateUser"]);
  });

  it("reports success for an unregistered address without distinguishing it", async () => {
    // Supabase returns success for unknown addresses, so the UI learns nothing.
    const result = await requestPasswordReset("nobody@example.com", "https://app.example.com");
    expect(result).toEqual({ ok: true });
  });

  it("states the outcome in neutral wording that reveals nothing", () => {
    expect(NEUTRAL_RESET_MESSAGE).toMatch(/if an account exists/i);
    expect(NEUTRAL_RESET_MESSAGE).not.toMatch(
      /not found|no account|doesn't exist|does not exist|already registered/i
    );
  });

  it("maps a failure to the shared generic copy, not a provider message", async () => {
    mockResetForEmail.mockResolvedValue({
      data: {},
      error: { message: "User not found", code: "user_not_found" },
    });

    const result = await requestPasswordReset("nobody@example.com", "https://app.example.com");

    // authErrors maps user_not_found to the same wording as a wrong password.
    expect(result).toEqual({ ok: false, error: "Invalid email or password." });
    expect(JSON.stringify(result)).not.toMatch(/not found/i);
  });

  it("does not leak the raw provider text to the user", async () => {
    mockResetForEmail.mockResolvedValue({
      data: {},
      error: { message: "SMTP refused for nobody@example.com", code: "unexpected" },
    });

    const result = await requestPasswordReset("nobody@example.com", "https://app.example.com");

    expect(JSON.stringify(result)).not.toMatch(/SMTP|refused/i);
  });

  it("fails safely and sends nothing when no redirect can be built", async () => {
    const result = await requestPasswordReset("user@example.com", "not a url");

    expect(result.ok).toBe(false);
    expect(mockResetForEmail).not.toHaveBeenCalled();
  });

  it("never echoes the email address back in the result", async () => {
    const result = await requestPasswordReset("user@example.com", "https://app.example.com");
    expect(JSON.stringify(result)).not.toContain("user@example.com");
  });
});

describe("updatePassword", () => {
  it("sends the new password to Supabase", async () => {
    const result = await updatePassword("Str0ng!Pass");

    expect(mockUpdateUser).toHaveBeenCalledTimes(1);
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: "Str0ng!Pass" });
    expect(result).toEqual({ ok: true });
  });

  it("returns a failure without throwing when Supabase rejects it", async () => {
    mockUpdateUser.mockResolvedValue({
      data: {},
      error: { message: "Auth session missing", code: "no_session" },
    });

    const result = await updatePassword("Str0ng!Pass");

    expect(result.ok).toBe(false);
    expect("error" in result).toBe(true);
  });

  it("reports an expired recovery link using the shared copy", async () => {
    mockUpdateUser.mockResolvedValue({
      data: {},
      error: { message: "Token has expired", code: "otp_expired" },
    });

    const result = await updatePassword("Str0ng!Pass");

    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toMatch(/token has expired/i);
  });

  it("maps a too-weak password to the existing weak-password message", async () => {
    mockUpdateUser.mockResolvedValue({
      data: {},
      error: { message: "Password should be at least 6 characters", code: "weak_password" },
    });

    const result = await updatePassword("short");

    expect(result).toEqual({
      ok: false,
      error: "Password is too weak. Please use a stronger password.",
    });
  });

  it("never includes the password in the result", async () => {
    const result = await updatePassword("Str0ng!Pass");
    expect(JSON.stringify(result)).not.toContain("Str0ng!Pass");
  });
});

  it("ignores surrounding whitespace", () => {
    expect(isValidEmail("  user@example.com  ")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["", "user", "user@", "@example.com", "user@example", "a b@c.com"]) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });
});
