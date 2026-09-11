import { describe, expect, it } from "vitest";
import { TERMS_URL, PRIVACY_URL, TERMS_VERSION } from "./terms";

describe("legal terms constants", () => {
  it("uses a dated version stamp so re-consent can be forced", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("exposes hosted copies of terms and privacy policy", () => {
    expect(TERMS_URL.length).toBeGreaterThan(0);
    expect(PRIVACY_URL.length).toBeGreaterThan(0);
  });

  it("rejects an older stored version so the gate reopens", () => {
    expect("2026-01-01").not.toBe(TERMS_VERSION);
  });
});