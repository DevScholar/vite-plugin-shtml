import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

import type { SsiConfig } from "./types";
import { tokenize, type SsiToken } from "./tokenizer";
import { ExprEvaluator } from "./evaluator";
import { strftime, formatSize, isPathSafe } from "./strftime";

const MAX_DEPTH = 10;

/** Custom <!-\- TITLE: ... --> marker */
const RE_TITLE = /<!--\s*TITLE:\s*(.+?)\s*-->/;

/**
 * Rewrite intra-site .shtml hrefs → .html (for build output).
 */
const RE_HREF_SHTML =
  /(<a\s[^>]*href\s*=\s*")([^"]+\.)shtml(")/gi;

export class SsiProcessor {
  private includeDirAbs: string;
  private baseVariables: Record<string, string>;
  private allowExec: boolean;

  /** Track .inc → .shtml deps for HMR invalidation. */
  incToShtml: Map<string, Set<string>> = new Map();
  shtmlToInc: Map<string, Set<string>> = new Map();

  constructor(
    root: string,
    includeDir: string,
    variables: Record<string, string>,
    allowExec: boolean,
  ) {
    this.includeDirAbs = path.resolve(root, includeDir);
    this.baseVariables = variables;
    this.allowExec = allowExec;
  }

  /** Wipe HMR tracking for `shtmlFile` before re-processing. */
  private clearTracking(shtmlFile: string) {
    const prev = this.shtmlToInc.get(shtmlFile);
    if (prev) {
      for (const inc of prev) this.incToShtml.get(inc)?.delete(shtmlFile);
    }
    this.shtmlToInc.delete(shtmlFile);
  }

  // ── path resolution ─────────────────────────────────────

  private resolveTarget(
    kind: "file" | "virtual" | "element",
    target: string,
    fromFile: string,
  ): string | null {
    if (kind === "file") {
      const rel = path.resolve(path.dirname(fromFile), target);
      if (isPathSafe(rel, this.includeDirAbs) && fs.existsSync(rel)) return rel;
      const fromDir = path.resolve(this.includeDirAbs, target);
      if (isPathSafe(fromDir, this.includeDirAbs) && fs.existsSync(fromDir))
        return fromDir;
      return null;
    } else {
      const rel = target.replace(/^\/+/, "");
      const resolved = path.resolve(this.includeDirAbs, rel);
      if (isPathSafe(resolved, this.includeDirAbs) && fs.existsSync(resolved))
        return resolved;
      return null;
    }
  }

  /** Build standard SSI variables for a file. */
  private buildEnv(
    filePath: string,
    pageTitle: string,
    customVars: Record<string, string>,
    timefmt: string,
  ): Record<string, string> {
    const rel = path.relative(this.includeDirAbs, filePath).replace(/\\/g, "/");
    const now = new Date();
    const env: Record<string, string> = {
      DOCUMENT_NAME: path.basename(filePath),
      DOCUMENT_URI: "/" + rel.replace(/\.shtml$/, ".html"),
      DATE_LOCAL: strftime(timefmt, now),
      DATE_GMT: strftime(timefmt, now, true),
      LAST_MODIFIED: (() => {
        try {
          return strftime(timefmt, fs.statSync(filePath).mtime);
        } catch {
          return "(unknown)";
        }
      })(),
      TITLE: pageTitle || this.baseVariables["TITLE"] || "Untitled",
      SERVER_SOFTWARE: "vite-plugin-shtml/0.1.0",
      USER_NAME: "(none)",
    };
    return { ...this.baseVariables, ...customVars, ...env };
  }

  /**
   * Process a single file's content through all SSI directives.
   * Called recursively for includes.
   */
  process(
    content: string,
    filePath: string,
    depth: number,
    track: boolean,
    inheritedTitle = "",
    inheritedVars: Record<string, string> = {},
    inheritedConfig?: SsiConfig,
    visited?: Set<string>,
  ): string {
    const resolvedPath = path.resolve(filePath);
    const visitedSet = visited ?? new Set<string>();
    if (visitedSet.has(resolvedPath)) {
      console.warn(
        `[vite-plugin-shtml] Circular include detected: ${filePath}`,
      );
      return "";
    }
    if (depth > MAX_DEPTH) {
      console.warn(
        `[vite-plugin-shtml] Max include depth exceeded in ${filePath}`,
      );
      return "";
    }
    visitedSet.add(resolvedPath);

    if (track) this.clearTracking(filePath);

    // Extract page title
    const titleMatch = content.match(RE_TITLE);
    const ownTitle = titleMatch ? titleMatch[1].trim() : "";
    const pageTitle = ownTitle || inheritedTitle;

    // Config state (inherited or defaults)
    let timefmt = inheritedConfig?.timefmt ?? "%Y-%m-%d %H:%M:%S";
    let sizefmt = inheritedConfig?.sizefmt ?? "abbrev";
    let errmsg =
      inheritedConfig?.errmsg ??
      "[an error occurred while processing this directive]";

    const localVars: Record<string, string> = { ...inheritedVars };

    const tokens = tokenize(content);

    return this.processTokens(
      tokens,
      filePath,
      depth,
      track,
      pageTitle,
      () => timefmt,
      (v) => { timefmt = v; },
      () => sizefmt,
      (v) => { sizefmt = v; },
      () => errmsg,
      (v) => { errmsg = v; },
      localVars,
      visitedSet,
    );
  }

  private processTokens(
    tokens: SsiToken[],
    filePath: string,
    depth: number,
    track: boolean,
    pageTitle: string,
    getTimefmt: () => string,
    setTimefmt: (v: string) => void,
    getSizefmt: () => string,
    setSizefmt: (v: string) => void,
    getErrmsg: () => string,
    setErrmsg: (v: string) => void,
    localVars: Record<string, string>,
    visited: Set<string>,
  ): string {
    let out = "";

    interface Frame {
      taken: boolean;
      outputting: boolean;
    }

    const stack: Frame[] = [];
    let i = 0;

    const shouldOutput = (): boolean => {
      for (const frame of stack) {
        if (!frame.outputting) return false;
      }
      return true;
    };

    const currentFrame = (): Frame | null =>
      stack.length > 0 ? stack[stack.length - 1] : null;

    const evalExpr = (expr: string): boolean => {
      const env = this.buildEnv(filePath, pageTitle, localVars, getTimefmt());
      try {
        return new ExprEvaluator(env).eval(expr);
      } catch {
        return false;
      }
    };

    while (i < tokens.length) {
      const tok = tokens[i];

      switch (tok.type) {
        case "config":
          if (tok.key === "timefmt") setTimefmt(tok.value);
          else if (tok.key === "sizefmt") setSizefmt(tok.value);
          else if (tok.key === "errmsg") setErrmsg(tok.value);
          i++;
          break;

        case "set":
          localVars[tok.var] = tok.value;
          localVars[tok.var.toUpperCase()] = tok.value;
          i++;
          break;

        case "if": {
          const cond = evalExpr(tok.expr);
          stack.push({ taken: cond, outputting: cond });
          i++;
          break;
        }

        case "elif": {
          const frame = currentFrame();
          if (frame) {
            if (frame.taken) {
              frame.outputting = false;
            } else {
              const cond = evalExpr(tok.expr);
              frame.taken = cond;
              frame.outputting = cond;
            }
          }
          i++;
          break;
        }

        case "else": {
          const frame = currentFrame();
          if (frame) {
            if (frame.taken) {
              frame.outputting = false;
            } else {
              frame.taken = true;
              frame.outputting = true;
            }
          }
          i++;
          break;
        }

        case "endif":
          if (stack.length > 0) stack.pop();
          i++;
          break;

        case "text":
          if (shouldOutput()) out += tok.content;
          i++;
          break;

        case "echo":
          if (shouldOutput()) {
            const env = this.buildEnv(
              filePath, pageTitle, localVars, getTimefmt(),
            );
            out += env[tok.var] ?? env[tok.var.toUpperCase()] ?? "";
          }
          i++;
          break;

        case "include": {
          if (!shouldOutput()) { i++; break; }
          const incPath = this.resolveTarget(tok.kind, tok.target, filePath);
          if (!incPath) {
            console.warn(
              `[vite-plugin-shtml] Include not found: "${tok.target}" from ${filePath}`,
            );
            out += getErrmsg();
            i++;
            break;
          }
          if (track) {
            if (!this.incToShtml.has(incPath))
              this.incToShtml.set(incPath, new Set());
            this.incToShtml.get(incPath)!.add(filePath);
            if (!this.shtmlToInc.has(filePath))
              this.shtmlToInc.set(filePath, new Set());
            this.shtmlToInc.get(filePath)!.add(incPath);
          }
          const incContent = fs.readFileSync(incPath, "utf-8");
          out += this.process(
            incContent, incPath, depth + 1, track, pageTitle,
            { ...localVars },
            {
              timefmt: getTimefmt(),
              sizefmt: getSizefmt(),
              errmsg: getErrmsg(),
            },
            visited,
          );
          i++;
          break;
        }

        case "fsize": {
          if (!shouldOutput()) { i++; break; }
          const targetPath = this.resolveTarget(tok.kind, tok.target, filePath);
          if (!targetPath) { out += getErrmsg(); i++; break; }
          try {
            out += formatSize(fs.statSync(targetPath).size, getSizefmt());
          } catch {
            out += getErrmsg();
          }
          i++;
          break;
        }

        case "flastmod": {
          if (!shouldOutput()) { i++; break; }
          const targetPath = this.resolveTarget(tok.kind, tok.target, filePath);
          if (!targetPath) { out += getErrmsg(); i++; break; }
          try {
            out += strftime(getTimefmt(), fs.statSync(targetPath).mtime);
          } catch {
            out += getErrmsg();
          }
          i++;
          break;
        }

        case "exec": {
          if (!shouldOutput()) { i++; break; }
          if (!this.allowExec) {
            console.warn(
              `[vite-plugin-shtml] <!--#exec --> blocked (set allowExec: true to enable).`,
            );
            out += getErrmsg();
            i++;
            break;
          }
          try {
            out += execSync(tok.target, {
              encoding: "utf-8",
              timeout: 5000,
              cwd: path.dirname(filePath),
            });
          } catch (err) {
            console.error(
              `[vite-plugin-shtml] exec "${tok.target}" failed:`,
              err,
            );
            out += getErrmsg();
          }
          i++;
          break;
        }

        case "printenv": {
          if (!shouldOutput()) { i++; break; }
          const env = this.buildEnv(
            filePath, pageTitle, localVars, getTimefmt(),
          );
          const entries = Object.entries(env).sort(([a], [b]) =>
            a.localeCompare(b),
          );
          out += "<pre>";
          for (const [k, v] of entries) {
            out += `${k}=${v}\n`;
          }
          out += "</pre>";
          i++;
          break;
        }

        default:
          i++;
          break;
      }
    }

    return out;
  }

  /** Rewrite intra-site .shtml hrefs → .html (for build output). */
  static rewriteLinks(content: string): string {
    return content.replace(RE_HREF_SHTML, "$1$2html$3");
  }
}
