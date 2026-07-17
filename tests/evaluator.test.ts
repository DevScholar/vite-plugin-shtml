import { describe, it, expect } from "vitest";
import { ExprEvaluator } from "../src/evaluator";

function evalExpr(
  expr: string,
  vars: Record<string, string> = {},
): boolean {
  return new ExprEvaluator(vars).eval(expr);
}

describe("ExprEvaluator", () => {
  // ── bare variables ─────────────────────────────────────

  it("treats defined non-empty variable as true", () => {
    expect(evalExpr("$X", { X: "hello" })).toBe(true);
  });

  it("treats empty variable as false", () => {
    expect(evalExpr("$X", { X: "" })).toBe(false);
  });

  it("treats undefined variable as false", () => {
    expect(evalExpr("$X", {})).toBe(false);
  });

  it("variable name is case-insensitive", () => {
    // $X with { x: "hello" } — lookup uppercases the name
    expect(evalExpr("$x", { X: "hello" })).toBe(true);
  });

  // ── string equality ────────────────────────────────────

  it("compares string equality", () => {
    expect(evalExpr('$X = "hello"', { X: "hello" })).toBe(true);
    expect(evalExpr('$X = "world"', { X: "hello" })).toBe(false);
  });

  it("compares string inequality", () => {
    expect(evalExpr('$X != "hello"', { X: "world" })).toBe(true);
    expect(evalExpr('$X != "hello"', { X: "hello" })).toBe(false);
  });

  it("compares against empty string", () => {
    expect(evalExpr('$X = ""', { X: "" })).toBe(true);
    expect(evalExpr('$X = ""', { X: "a" })).toBe(false);
  });

  // ── regex matching ─────────────────────────────────────

  it("matches regex (positive)", () => {
    expect(evalExpr("$X = /hello/", { X: "hello world" })).toBe(true);
  });

  it("matches regex (negative)", () => {
    expect(evalExpr("$X = /bye/", { X: "hello world" })).toBe(false);
  });

  it("matches regex with flags", () => {
    expect(evalExpr("$X = /HELLO/i", { X: "hello" })).toBe(true);
  });

  it("regex non-match", () => {
    expect(evalExpr("$X != /bye/", { X: "hello" })).toBe(true);
    expect(evalExpr("$X != /hello/", { X: "hello" })).toBe(false);
  });

  it("regex only for = and != operators (not <)", () => {
    // `/hello` starts with / but should not be treated as regex for <
    expect(evalExpr("$X < /hello/", { X: "5" })).toBe(false);
  });

  // ── logical operators ──────────────────────────────────

  it("AND operator", () => {
    expect(evalExpr('$A = "1" && $B = "2"', { A: "1", B: "2" })).toBe(
      true,
    );
    expect(evalExpr('$A = "1" && $B = "x"', { A: "1", B: "2" })).toBe(
      false,
    );
  });

  it("OR operator", () => {
    expect(evalExpr('$A = "1" || $B = "2"', { A: "x", B: "2" })).toBe(true);
    expect(evalExpr('$A = "1" || $B = "2"', { A: "x", B: "y" })).toBe(false);
  });

  it("NOT operator", () => {
    expect(evalExpr('!$X = ""', { X: "hello" })).toBe(true);
    expect(evalExpr('!$X = ""', { X: "" })).toBe(false);
  });

  it("NOT on bare variable", () => {
    expect(evalExpr("!$X", { X: "hello" })).toBe(false);
    expect(evalExpr("!$X", { X: "" })).toBe(true);
  });

  // ── grouping ───────────────────────────────────────────

  it("groups with parentheses", () => {
    expect(evalExpr("($X = hello) && ($Y = world)", { X: "hello", Y: "world" })).toBe(true);
  });

  it("nested parentheses", () => {
    expect(
      evalExpr('($A = "1" || $B = "2") && $C = "3"', {
        A: "0",
        B: "2",
        C: "3",
      }),
    ).toBe(true);
  });

  // ── numeric comparison ─────────────────────────────────

  it("numeric less than", () => {
    expect(evalExpr("$X < 10", { X: "5" })).toBe(true);
    expect(evalExpr("$X < 5", { X: "5" })).toBe(false);
  });

  it("numeric greater than or equal", () => {
    expect(evalExpr("$X >= 5", { X: "5" })).toBe(true);
    expect(evalExpr("$X >= 6", { X: "5" })).toBe(false);
  });

  // ── edge cases ─────────────────────────────────────────

  it("handles double negation", () => {
    expect(evalExpr("!!$X", { X: "hello" })).toBe(true);
  });

  it("handles complex expression", () => {
    expect(
      evalExpr(
        '($A = "on" || $B = "on") && !$C = ""',
        { A: "off", B: "on", C: "hello" },
      ),
    ).toBe(true);
  });

  it("returns false for invalid expression", () => {
    // Unmatched parenthesis
    expect(evalExpr("$X = (hello", { X: "hello" })).toBe(false);
  });
});
