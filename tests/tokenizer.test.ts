import { describe, it, expect } from "vitest";
import { tokenize } from "../src/tokenizer";

describe("tokenize", () => {
  it("returns single text token for plain content", () => {
    const t = tokenize("Hello world");
    expect(t).toEqual([{ type: "text", content: "Hello world" }]);
  });

  it("returns empty array for empty content", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("tokenizes echo directive", () => {
    const t = tokenize('<!--#echo var="DOCUMENT_NAME" -->');
    expect(t).toHaveLength(1);
    expect(t[0]).toEqual({ type: "echo", var: "DOCUMENT_NAME" });
  });

  it("tokenizes include file directive", () => {
    const t = tokenize('<!--#include file="header.inc" -->');
    expect(t[0]).toEqual({
      type: "include",
      kind: "file",
      target: "header.inc",
    });
  });

  it("tokenizes include virtual directive", () => {
    const t = tokenize('<!--#include virtual="/nav.html" -->');
    expect(t[0]).toEqual({
      type: "include",
      kind: "virtual",
      target: "/nav.html",
    });
  });

  it("tokenizes include element directive (alias for virtual)", () => {
    const t = tokenize('<!--#include element="nav.html" -->');
    expect(t[0]).toEqual({
      type: "include",
      kind: "element",
      target: "nav.html",
    });
  });

  it("tokenizes set directive", () => {
    const t = tokenize('<!--#set var="mood" value="happy" -->');
    expect(t[0]).toEqual({
      type: "set",
      var: "mood",
      value: "happy",
    });
  });

  it("tokenizes set directive with single quotes", () => {
    const t = tokenize("<!--#set var='mood' value='happy' -->");
    expect(t[0]).toEqual({
      type: "set",
      var: "mood",
      value: "happy",
    });
  });

  it("tokenizes if/elif/else/endif block", () => {
    const t = tokenize(
      '<!--#if expr="$x = 1" -->a<!--#elif expr="$x = 2" -->b<!--#else -->c<!--#endif -->',
    );
    const types = t
      .filter((tok) => tok.type !== "text")
      .map((tok) => tok.type);
    expect(types).toEqual(["if", "elif", "else", "endif"]);
  });

  it("tokenizes config directives", () => {
    const t = tokenize(
      '<!--#config timefmt="%Y-%m-%d" --><!--#config sizefmt="bytes" -->',
    );
    const configs = t.filter((tok) => tok.type === "config");
    expect(configs).toHaveLength(2);
    expect(configs[0]).toEqual({
      type: "config",
      key: "timefmt",
      value: "%Y-%m-%d",
    });
    expect(configs[1]).toEqual({
      type: "config",
      key: "sizefmt",
      value: "bytes",
    });
  });

  it("tokenizes fsize directive", () => {
    const t = tokenize('<!--#fsize file="image.gif" -->');
    expect(t[0]).toEqual({
      type: "fsize",
      kind: "file",
      target: "image.gif",
    });
  });

  it("tokenizes flastmod directive", () => {
    const t = tokenize('<!--#flastmod virtual="/style.css" -->');
    expect(t[0]).toEqual({
      type: "flastmod",
      kind: "virtual",
      target: "/style.css",
    });
  });

  it("tokenizes exec directive", () => {
    const t = tokenize('<!--#exec cmd="date" -->');
    expect(t[0]).toEqual({ type: "exec", kind: "cmd", target: "date" });
  });

  it("tokenizes printenv directive", () => {
    const t = tokenize("<!--#printenv -->");
    expect(t[0]).toEqual({ type: "printenv" });
  });

  it("keeps unknown directives as text", () => {
    const t = tokenize("<!--#foobar baz -->");
    expect(t[0]).toEqual({
      type: "text",
      content: "<!--#foobar baz -->",
    });
  });

  it("interleaves text and directives", () => {
    const t = tokenize('Hello <!--#echo var="X" --> World');
    expect(t).toHaveLength(3);
    expect(t[0]).toEqual({ type: "text", content: "Hello " });
    expect(t[1]).toEqual({ type: "echo", var: "X" });
    expect(t[2]).toEqual({ type: "text", content: " World" });
  });

  it("handles multiple attributes", () => {
    const t = tokenize(
      '<!--#config timefmt="%H:%M" sizefmt="abbrev" -->',
    );
    const configs = t.filter((tok) => tok.type === "config");
    expect(configs).toHaveLength(2);
  });
});
