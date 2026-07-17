/** Parse key="value" or key='value' attributes from an SSI directive string. */
const RE_ATTR =
  /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export type SsiToken =
  | { type: "text"; content: string }
  | { type: "echo"; var: string }
  | { type: "include"; kind: "file" | "virtual" | "element"; target: string }
  | { type: "set"; var: string; value: string }
  | { type: "if"; expr: string }
  | { type: "elif"; expr: string }
  | { type: "else" }
  | { type: "endif" }
  | { type: "config"; key: string; value: string }
  | { type: "fsize"; kind: "file" | "virtual"; target: string }
  | { type: "flastmod"; kind: "file" | "virtual"; target: string }
  | { type: "exec"; kind: "cmd" | "cgi"; target: string }
  | { type: "printenv" };

/**
 * Tokenize raw .shtml content into a flat list of SSI tokens.
 *
 * Creates a fresh regex on every call to avoid global-regex
 * concurrency issues if tokenize() is ever called from multiple
 * entry points.
 */
export function tokenize(content: string): SsiToken[] {
  const tokens: SsiToken[] = [];
  let prevEnd = 0;

  const RE_SSI = /<!--\s*#(\w+)\s*(.*?)\s*-->/g;
  let m: RegExpExecArray | null;
  while ((m = RE_SSI.exec(content)) !== null) {
    // Text before this directive
    const textBefore = content.slice(prevEnd, m.index);
    if (textBefore) tokens.push({ type: "text", content: textBefore });

    // Parse the directive
    const dir = m[1].toLowerCase();
    const attrStr = m[2];

    // Extract key="value" or key='value' pairs
    const attrs: Record<string, string> = {};
    let am: RegExpExecArray | null;
    const reAttr = new RegExp(RE_ATTR);
    while ((am = reAttr.exec(attrStr)) !== null) {
      const key = am[1].toLowerCase();
      const val = am[2] !== undefined ? am[2] : am[3];
      attrs[key] = val;
    }

    switch (dir) {
      case "echo":
        tokens.push({ type: "echo", var: attrs["var"] ?? "" });
        break;
      case "include":
        if (attrs["file"]) {
          tokens.push({ type: "include", kind: "file", target: attrs["file"] });
        } else if (attrs["virtual"]) {
          tokens.push({ type: "include", kind: "virtual", target: attrs["virtual"] });
        } else if (attrs["element"]) {
          // Apache's <!--#include element="..." --> is equivalent to virtual
          tokens.push({ type: "include", kind: "element", target: attrs["element"] });
        }
        break;
      case "set":
        tokens.push({
          type: "set",
          var: attrs["var"] ?? "",
          value: attrs["value"] ?? "",
        });
        break;
      case "if":
        tokens.push({ type: "if", expr: attrs["expr"] ?? "" });
        break;
      case "elif":
        tokens.push({ type: "elif", expr: attrs["expr"] ?? "" });
        break;
      case "else":
        tokens.push({ type: "else" });
        break;
      case "endif":
        tokens.push({ type: "endif" });
        break;
      case "config":
        for (const [k, v] of Object.entries(attrs)) {
          tokens.push({ type: "config", key: k, value: v });
        }
        break;
      case "fsize":
        if (attrs["file"]) {
          tokens.push({ type: "fsize", kind: "file", target: attrs["file"] });
        } else if (attrs["virtual"]) {
          tokens.push({ type: "fsize", kind: "virtual", target: attrs["virtual"] });
        }
        break;
      case "flastmod":
        if (attrs["file"]) {
          tokens.push({ type: "flastmod", kind: "file", target: attrs["file"] });
        } else if (attrs["virtual"]) {
          tokens.push({ type: "flastmod", kind: "virtual", target: attrs["virtual"] });
        }
        break;
      case "exec":
        if (attrs["cmd"]) {
          tokens.push({ type: "exec", kind: "cmd", target: attrs["cmd"] });
        } else if (attrs["cgi"]) {
          tokens.push({ type: "exec", kind: "cgi", target: attrs["cgi"] });
        }
        break;
      case "printenv":
        tokens.push({ type: "printenv" });
        break;
      default:
        // Unknown directive — keep as text
        tokens.push({ type: "text", content: m[0] });
        break;
    }

    prevEnd = m.index + m[0].length;
  }

  // Trailing text
  const tail = content.slice(prevEnd);
  if (tail) tokens.push({ type: "text", content: tail });

  return tokens;
}
