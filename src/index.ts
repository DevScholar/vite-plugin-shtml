/**
 * vite-plugin-shtml — full Apache mod_include emulation for Vite.
 *
 * Transforms .shtml files into HTML, then lets Vite handle the rest.
 *
 * Supported directives:
 *   <!--#include file="..."        -->
 *   <!--#include virtual="..."     -->
 *   <!--#include element="..."     -->
 *   <!--#echo   var="..."         -->
 *   <!--#set    var="..." value="..." -->
 *   <!--#if     expr="..."        -->
 *   <!--#elif   expr="..."        -->
 *   <!--#else                     -->
 *   <!--#endif                    -->
 *   <!--#config timefmt="..." sizefmt="bytes|abbrev" errmsg="..." -->
 *   <!--#fsize    file="..."      -->
 *   <!--#fsize    virtual="..."   -->
 *   <!--#flastmod file="..."      -->
 *   <!--#flastmod virtual="..."   -->
 *   <!--#exec     cmd="..."       -->
 *   <!--#printenv                 -->
 *
 * Standard variables: DOCUMENT_NAME, DOCUMENT_URI, DATE_LOCAL,
 * DATE_GMT, LAST_MODIFIED, USER_NAME, SERVER_SOFTWARE, and any
 * user-defined variable set via <!--#set --> or plugin options.
 */

import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import * as fs from "node:fs";
import * as path from "node:path";

import type { ShtmlOptions } from "./types";
import { SsiProcessor } from "./processor";
import { globShtml } from "./glob";
import { isPathSafe } from "./strftime";

export type { ShtmlOptions } from "./types";

/**
 * Regex for src/href attributes we want to resolve to hashed filenames.
 * Matches: <script src="...">, <link href="...">, <img src="...">
 */
const RE_SRC = /(<(?:script|link|img)\s[^>]*?\b(?:src|href)\s*=\s*")([^"]+)(")/gi;

/**
 * Build a map from absolute source path → hashed output filename
 * by inspecting the Rollup bundle.
 */
function buildHashedMap(
  bundle: Record<string, { type: string; facadeModuleId?: string | null; fileName: string }>,
): Map<string, string> {
  const map = new Map<string, string>();

  for (const [outputFile, info] of Object.entries(bundle)) {
    // Chunks (JS): use facadeModuleId for exact match
    if (info.type === "chunk" && info.facadeModuleId) {
      map.set(info.facadeModuleId, outputFile);
    }
  }

  return map;
}

/**
 * Given a raw src/href value from the HTML and the .shtml file location,
 * resolve it to the corresponding hashed filename from the bundle.
 */
function resolveHashedRef(
  rawRef: string,
  shtmlDir: string,
  hashedMap: Map<string, string>,
  destDir: string,
  outputHtmlFile: string,
  allBundleFiles: Set<string>,
): string | null {
  // Only resolve relative/local references (skip http://, data:, etc.)
  if (/^(https?:|data:|#|\/\/)/.test(rawRef)) return null;

  // Resolve the reference to an absolute path
  const resolved = path.resolve(shtmlDir, rawRef);
  const abs = path.resolve(resolved);

  // 1) Exact chunk match via facadeModuleId
  const hashed = hashedMap.get(abs);
  if (hashed) {
    const htmlDir = path.dirname(path.resolve(destDir, outputHtmlFile));
    const relPath = path.relative(htmlDir, path.resolve(destDir, hashed));
    return relPath.replace(/\\/g, "/");
  }

  // 2) Match by basename against all bundle entries
  const basename = path.basename(rawRef);
  for (const bf of allBundleFiles) {
    if (path.basename(bf) === basename) {
      const htmlDir = path.dirname(path.resolve(destDir, outputHtmlFile));
      const relPath = path.relative(htmlDir, path.resolve(destDir, bf));
      return relPath.replace(/\\/g, "/");
    }
  }

  return null;
}

/**
 * Walk the generated HTML and rewrite src/href attributes with their
 * hashed equivalents from the Rollup bundle.
 */
function rewriteHashedPaths(
  html: string,
  shtmlPath: string,
  hashedMap: Map<string, string>,
  destDir: string,
  outputHtmlFile: string,
  allBundleFiles: Set<string>,
): string {
  const shtmlDir = path.dirname(shtmlPath);

  return html.replace(RE_SRC, (match, prefix: string, ref: string, suffix: string) => {
    const hashed = resolveHashedRef(
      ref, shtmlDir, hashedMap, destDir, outputHtmlFile, allBundleFiles,
    );
    if (hashed) {
      return `${prefix}${hashed}${suffix}`;
    }
    return match;
  });
}

export default function vitePluginShtml(
  options: ShtmlOptions = {},
): Plugin {
  const {
    includeDir = "src",
    variables = {},
    allowExec = false,
  } = options;

  let root = process.cwd();
  let outDir = "dist";
  let command: "build" | "serve" = "serve";
  let processor: SsiProcessor | null = null;

  return {
    name: "vite-plugin-shtml",
    enforce: "pre" as const,

    configResolved(cfg: ResolvedConfig) {
      root = cfg.root;
      outDir = cfg.build.outDir;
      command = cfg.command as "build" | "serve";
      processor = new SsiProcessor(root, includeDir, variables, allowExec);
    },

    // ── DEV: middleware → SSI → server.transformIndexHtml ──

    configureServer(server: ViteDevServer) {
      const p = processor!;

      // Watch non-standard include file types so changes trigger
      // HMR for dependent pages. Vite already watches .html / .shtml.
      for (const ext of [".inc", ".tmpl", ".part"]) {
        server.watcher.add(
          path.resolve(p["includeDirAbs"], `**/*${ext}`),
        );
      }

      server.watcher.on("change", (file) => {
        const abs = path.resolve(root, file);
        const dependents = p.incToShtml.get(abs);
        if (dependents) {
          for (const shtml of dependents) {
            const url =
              "/" + path.relative(root, shtml).replace(/\\/g, "/");
            server.ws.send({ type: "full-reload", path: url });
          }
        }
      });

      // Middleware runs BEFORE Vite's static server so .shtml isn't
      // served as raw text.
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "/";

        // Redirect / → /index.shtml
        if (url === "/") {
          res.writeHead(302, { Location: "/index.shtml" });
          res.end();
          return;
        }

        if (!url.endsWith(".shtml")) return next();

        const cleanUrl = url.split("?")[0].split("#")[0];
        const filePath = path.resolve(p["includeDirAbs"], cleanUrl.slice(1));

        if (
          !isPathSafe(filePath, p["includeDirAbs"]) ||
          !fs.existsSync(filePath)
        ) {
          return next();
        }

        try {
          let html = fs.readFileSync(filePath, "utf-8");
          html = p.process(html, filePath, 0, true);

          // Let Vite inject HMR client, process script/link tags, etc.
          html = await server.transformIndexHtml(url, html);

          res.setHeader("Content-Type", "text/html");
          res.end(html);
        } catch (err) {
          console.error(
            `[vite-plugin-shtml] Error processing ${filePath}:`,
            err,
          );
          res.statusCode = 500;
          res.end(`SSI Error: ${err}`);
        }
      });
    },

    // ── BUILD: generateBundle resolves hashed filenames ────

    generateBundle(_options, bundle) {
      if (command !== "build") return;

      const p = processor!;
      const srcDir = path.resolve(root, includeDir);
      const destDir = path.resolve(root, outDir);

      if (!fs.existsSync(srcDir)) {
        console.warn(
          `[vite-plugin-shtml] Source dir not found: ${srcDir}`,
        );
        return;
      }

      // Collect all known output filenames for basename matching
      const allBundleFiles = new Set<string>();
      for (const outputFile of Object.keys(bundle)) {
        allBundleFiles.add(outputFile);
      }

      // Build exact-match map from facade module ID → hashed filename
      const hashedMap = buildHashedMap(bundle as any);

      const shtmlFiles = globShtml(srcDir);
      console.log(
        `[vite-plugin-shtml] Processing ${shtmlFiles.length} .shtml file(s)...`,
      );

      for (const shtmlPath of shtmlFiles) {
        const rel = path.relative(srcDir, shtmlPath);
        const outName = rel.replace(/\.shtml$/, ".html");

        let content = fs.readFileSync(shtmlPath, "utf-8");
        content = p.process(content, shtmlPath, 0, false);
        content = SsiProcessor.rewriteLinks(content);

        // Rewrite <script src> / <link href> with hashed filenames
        content = rewriteHashedPaths(
          content, shtmlPath, hashedMap, destDir, outName,
          allBundleFiles,
        );

        // Add to the bundle so Vite/Rollup writes it to disk
        (bundle as Record<string, unknown>)[outName] = {
          type: "asset",
          fileName: outName,
          source: content,
          name: outName,
        };

        console.log(`  ${rel}  →  ${outName}`);
      }

      console.log("[vite-plugin-shtml] Done.");
    },
  };
}
