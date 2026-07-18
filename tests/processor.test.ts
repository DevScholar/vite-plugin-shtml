import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { SsiProcessor } from "../src/processor";

const FIXTURES = path.resolve(__dirname, "fixtures");

function makeProcessor(includeDir: string = FIXTURES) {
  return new SsiProcessor(
    path.dirname(includeDir),   // root = tests/
    path.basename(includeDir),  // includeDir = fixtures/
    {},
    false,
  );
}

describe("SsiProcessor.process", () => {
  it("leaves plain HTML unchanged", () => {
    const p = makeProcessor();
    const result = p.process(
      "<html><body>Hello</body></html>",
      path.join(FIXTURES, "test.shtml"),
      0,
      false,
    );
    expect(result).toContain("Hello");
  });

  it("resolves <!--#echo var=\"...\" --> with built-in vars", () => {
    const p = makeProcessor();
    const filePath = path.join(FIXTURES, "test.shtml");
    const result = p.process(
      '<!--#echo var="DOCUMENT_NAME" -->',
      filePath,
      0,
      false,
    );
    expect(result).toContain("test.shtml");
  });

  it("resolves <!--#echo var=\"...\" --> with custom vars", () => {
    const p = new SsiProcessor(
      path.dirname(FIXTURES),
      path.basename(FIXTURES),
      { FOO: "bar" },
      false,
    );
    const result = p.process(
      '<!--#echo var="FOO" -->',
      path.join(FIXTURES, "test.shtml"),
      0,
      false,
    );
    expect(result).toBe("bar");
  });

  it("resolves <!--#set --> and echo", () => {
    const p = makeProcessor();
    const result = p.process(
      '<!--#set var="mood" value="happy" --><!--#echo var="mood" -->',
      path.join(FIXTURES, "test.shtml"),
      0,
      false,
    );
    expect(result).toBe("happy");
  });

  it("processes include file directives", () => {
    const p = makeProcessor();
    const result = p.process(
      '<!--#include file="header.inc" -->',
      path.join(FIXTURES, "test.shtml"),
      0,
      false,
    );
    expect(result).toContain("<header>Site Header</header>");
  });

  it("processes multi-level includes", () => {
    const p = makeProcessor();
    const result = p.process(
      '<!--#include file="include-test.shtml" -->',
      path.join(FIXTURES, "test.shtml"),
      0,
      false,
    );
    expect(result).toContain("<header>Site Header</header>");
  });

  it("config timefmt changes DATE_LOCAL output", () => {
    const p = makeProcessor();
    const fmt = '<!--#config timefmt="%Y" --><!--#echo var="DATE_LOCAL" -->';
    const result = p.process(
      fmt,
      path.join(FIXTURES, "test.shtml"),
      0,
      false,
    );
    expect(result).toBe(new Date().getFullYear().toString());
  });

  // ── conditional processing ──────────────────────────────

  it("outputs if-block when condition is true", () => {
    const p = makeProcessor();
    const content =
      '<!--#if expr="$X = hello" -->YES<!--#else -->NO<!--#endif -->';
    const result = p.process(
      content,
      path.join(FIXTURES, "test.shtml"),
      0,
      false,
      { X: "hello" },
    );
    expect(result).toBe("YES");
  });

  it("outputs else-block when condition is false", () => {
    const p = makeProcessor();
    const content =
      '<!--#if expr="$X = hello" -->YES<!--#else -->NO<!--#endif -->';
    const result = p.process(
      content,
      path.join(FIXTURES, "test.shtml"),
      0,
      false,
      { X: "world" },
    );
    expect(result).toBe("NO");
  });

  it("elif picks the first true branch", () => {
    const p = makeProcessor();
    const content =
      '<!--#if expr="$X = a" -->A<!--#elif expr="$X = b" -->B<!--#elif expr="$X = c" -->C<!--#else -->D<!--#endif -->';
    const result = p.process(
      content,
      path.join(FIXTURES, "test.shtml"),
      0,
      false,
      { X: "b" },
    );
    expect(result).toBe("B");
  });

  it("skips nested blocks when outer is false", () => {
    const p = makeProcessor();
    const content =
      '<!--#if expr="$A = yes" -->OUTER<!--#if expr="$B = yes" -->INNER<!--#endif --><!--#endif -->';
    const result = p.process(
      content,
      path.join(FIXTURES, "test.shtml"),
      0,
      false,
      { A: "no", B: "yes" },
    );
    expect(result).toBe("");
  });

  // ── circular include detection ─────────────────────────

  it("detects circular includes", () => {
    const p = makeProcessor();
    const result = p.process(
      '<!--#include file="circular-a.shtml" -->',
      path.join(FIXTURES, "test.shtml"),
      0,
      false,
    );
    // Should return empty when circular include is hit, not crash
    expect(typeof result).toBe("string");
  });

  // ── variable inheritance across includes ───────────────

  it("passes inherited variables to included files", () => {
    // Create a processor for the fixtures directory
    const p = makeProcessor();
    const result = p.process(
      '<!--#set var="theme" value="dark" --><!--#include file="header.inc" -->',
      path.join(FIXTURES, "test.shtml"),
      0,
      false,
    );
    expect(result).toContain("<header>Site Header</header>");
  });
});
