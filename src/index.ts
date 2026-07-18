/**
 * vite-plugin-shtml — full Apache mod_include emulation for Vite.
 *
 * Transforms .shtml files into HTML, then lets Vite handle the rest.
 *
 * ## Architecture
 *
 * **Dev mode** — clean, Vite-native:
 *   1. Middleware intercepts .shtml requests
 *   2. Raw content → server.transformIndexHtml()
 *   3. Our transformIndexHtml (pre) processes SSI → pure HTML
 *   4. Vite's built-in transformIndexHtml handles <script>, <link>, HMR
 *   → ./main.ts resolves via Vite's normal pipeline, HMR works natively
 *
 * **Build mode** — two-phase:
 *   1. transform (pre): processes SSI → HTML, extracts <script>/<link>
 *      as ES import statements so Rollup bundles them with hashing
 *   2. generateBundle: writes final .html files with hashed references
 *
 * ## Supported directives
 *
 *   <!--#include file="..."        -->
 *   <!--#include virtual="..."     -->
 *   <!--#echo   var="..."         -->
 *   <!--#set    var="..." value="..." -->
 *   <!--#if     expr="..."        -->
 *   <!--#elif   expr="..."        -->
 *   <!--#else                     -->
 *   <!--#endif                    -->
 *   <!--#config timefmt="..." sizefmt="bytes|abbrev" errmsg="..." -->
 *   <!--#fsize    file="..."      -->
 *   <!--#flastmod file="..."      -->
 *   <!--#exec     cmd="..."       -->
 *   <!--#printenv                 -->
 */

import type { Plugin, ResolvedConfig, ViteDevServer, IndexHtmlTransformContext } from "vite";
import * as fs from "node:fs";
import * as path from "node:path";

import type { ShtmlOptions } from "./types.js";
import { SsiProcessor } from "./processor.js";
import { globShtml } from "./glob.js";
import { isPathSafe } from "./strftime.js";

export type { ShtmlOptions } from "./types.js";

// ── Build helpers (extract imports from HTML, rewrite hashed paths) ──

const RE_ALL_SRC = /(<(?:script|link|img)\s[^>]*?\b(?:src|href)\s*=\s*")([^"]+)(")/gi;
const RE_HREF_SHTML = /(<a\s[^>]*href\s*=\s*")([^"]+\.)shtml(")/gi;

/**
 * Extract local script/link (stylesheet) references from processed HTML
 * as ES import statements. Rollup/Vite will resolve and bundle these,
 * producing hashed filenames.
 */
function extractImports(html: string): string[] {
  const imports: string[] = [];
  const seen = new Set<string>();

  // <script src="..."> — direct match
  for (const m of html.matchAll(/<script\s[^>]*?\bsrc\s*=\s*"([^"]+)"/gi)) {
    const src = m[1];
    if (seen.has(src)) continue;
    if (/^(https?:|\/\/|data:|#)/.test(src)) continue;
    seen.add(src);
    imports.push(`import "${src}";`);
  }

  // <link href="..." rel="stylesheet"> — attribute order varies,
  // so match the full tag first, then check for rel=stylesheet
  for (const m of html.matchAll(/<link\s[^>]*?\/?>/gi)) {
    const tag = m[0];
    if (!/\brel\s*=\s*"stylesheet"/i.test(tag)) continue;
    const hm = tag.match(/\bhref\s*=\s*"([^"]+)"/i);
    if (!hm) continue;
    const href = hm[1];
    if (seen.has(href)) continue;
    if (/^(https?:|\/\/|data:|#)/.test(href)) continue;
    seen.add(href);
    imports.push(`import "${href}";`);
  }

  return imports;
}

/**
 * Build a map from absolute source path → hashed output filename.
 * Walks every chunk's `modules` so shared modules (like main.ts) are covered.
 */
function buildModuleOutputMap(
  bundle: Record<string, any>,
): Map<string, string> {
  const map = new Map<string, string>();

  for (const [outputFile, info] of Object.entries(bundle)) {
    if (info.type === "chunk") {
      // Map each module within the chunk to its chunk filename.
      // Normalize to filesystem-native path (Rollup uses / on all platforms).
      for (const moduleId of Object.keys(info.modules ?? {})) {
        const key = path.resolve(moduleId);
        // For CSS files, prefer the emitted CSS asset filename over the JS chunk
        if (moduleId.endsWith(".css") && info.viteMetadata?.importedCss) {
          const cssSet: Set<string> = info.viteMetadata.importedCss;
          if (cssSet.size > 0) {
            map.set(key, [...cssSet][0]);
            continue;
          }
        }
        map.set(key, outputFile);
      }
      if (info.facadeModuleId) {
        map.set(path.resolve(info.facadeModuleId), outputFile);
      }
    }
  }
  return map;
}

/**
 * Rewrite src/href attributes in HTML to use hashed chunk filenames.
 */
function rewriteHashedPaths(
  html: string,
  shtmlPath: string,
  moduleMap: Map<string, string>,
  outName: string,
  outDir: string,
): string {
  const shtmlDir = path.dirname(shtmlPath);
  const htmlOutDir = path.dirname(path.resolve(outDir, outName));

  return html.replace(RE_ALL_SRC, (_match, prefix: string, ref: string, suffix: string) => {
    // Skip external references and data: URIs
    if (/^(https?:|data:|#|\/\/)/.test(ref)) return _match;

    const resolved = path.resolve(shtmlDir, ref);

    // Look up the hashed chunk filename for this module
    const hashedFile = moduleMap.get(resolved);
    if (hashedFile) {
      const relPath = path.relative(htmlOutDir, path.resolve(outDir, hashedFile));
      return `${prefix}${relPath.replace(/\\/g, "/")}${suffix}`;
    }

    return _match;
  });
}

// ── Plugin ──

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

  // Build-only: cache processed HTML from transform → generateBundle
  const buildCache = new Map<string, string>();

  return {
    name: "vite-plugin-shtml",
    enforce: "pre",

    configResolved(cfg: ResolvedConfig) {
      root = cfg.root;
      outDir = cfg.build.outDir;
      command = cfg.command as "build" | "serve";
      processor = new SsiProcessor(root, includeDir, variables, allowExec);
    },

    // ─────────────────────────────────────────────────────────────
    // Dev: transformIndexHtml (pre) — SSI → HTML, then Vite handles
    //      <script>, <link>, HMR injection natively
    // ─────────────────────────────────────────────────────────────
    transformIndexHtml: {
      order: "pre",
      handler(rawHtml: string, ctx: IndexHtmlTransformContext): string {
        const filename = ctx.filename;
        if (!filename.endsWith(".shtml")) return rawHtml;

        const p = processor!;

        // Dev: ctx.filename is the URL we passed (e.g. "/src/index.shtml")
        // Build: not used (handled by transform + generateBundle instead)
        const filePath = path.resolve(root, filename.replace(/^\//, ""));

        if (!fs.existsSync(filePath)) {
          console.warn(`[vite-plugin-shtml] Not found: ${filePath}`);
          return rawHtml;
        }

        return p.process(rawHtml, filePath, 0, !!ctx.server);
      },
    },

    // ─────────────────────────────────────────────────────────────
    // Build: transform (pre) — process SSI, cache HTML, emit JS
    //        imports so Rollup bundles referenced scripts & styles
    // ─────────────────────────────────────────────────────────────
    transform(code, id) {
      if (command !== "build") return;
      if (!id.endsWith(".shtml")) return;

      const p = processor!;
      const html = p.process(code, id, 0, false);
      // Normalize to filesystem path for Cache key (Rollup uses /, globShtml uses \ on Windows)
      buildCache.set(path.resolve(id), html);

      const imports = extractImports(html);
      if (imports.length > 0) {
        return imports.join("\n");
      }
      // No imports — return empty module so Rollup doesn't choke
      return "";
    },

    // ─────────────────────────────────────────────────────────────
    // Build: generateBundle — write processed .html files with
    //        hashed asset references
    // ─────────────────────────────────────────────────────────────
    generateBundle(_options, bundle) {
      if (command !== "build") return;

      const p = processor!;
      const srcDir = path.resolve(root, includeDir);
      const destDir = path.resolve(root, outDir);

      if (!fs.existsSync(srcDir)) {
        console.warn(`[vite-plugin-shtml] Source dir not found: ${srcDir}`);
        return;
      }

      // Build a map from every source module → its output chunk filename
      const moduleMap = buildModuleOutputMap(bundle as any);

      const shtmlFiles = globShtml(srcDir);
      console.log(`[vite-plugin-shtml] Processing ${shtmlFiles.length} .shtml file(s)...`);

      for (const shtmlPath of shtmlFiles) {
        const rel = path.relative(srcDir, shtmlPath);
        const outName = rel.replace(/\.shtml$/, ".html");

        // Use cached HTML from transform phase, or process now (fallback)
        let content = buildCache.get(shtmlPath);
        if (content === undefined) {
          content = fs.readFileSync(shtmlPath, "utf-8");
          content = p.process(content, shtmlPath, 0, false);
        }

        // Rewrite intra-site .shtml links → .html
        content = content.replace(RE_HREF_SHTML, "$1$2html$3");

        // Rewrite script/link references with hashed chunk filenames
        content = rewriteHashedPaths(content, shtmlPath, moduleMap, outName, destDir);

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

    // ─────────────────────────────────────────────────────────────
    // Dev: middleware — routes .shtml → server.transformIndexHtml()
    //      uses URL with includeDir so ./main.ts resolves correctly
    // ─────────────────────────────────────────────────────────────
    configureServer(server: ViteDevServer) {
      const p = processor!;
      const includeDirAbs = path.resolve(root, includeDir);

      // Watch include file types for HMR
      for (const ext of [".inc", ".tmpl", ".part"]) {
        server.watcher.add(path.resolve(includeDirAbs, `**/*${ext}`));
      }

      server.watcher.on("change", (file) => {
        const abs = path.resolve(root, file);
        const dependents = p.incToShtml.get(abs);
        if (dependents) {
          for (const shtml of dependents) {
            const url = "/" + path.relative(root, shtml).replace(/\\/g, "/");
            server.ws.send({ type: "full-reload", path: url });
          }
        }
      });

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
        const filePath = path.resolve(includeDirAbs, cleanUrl.slice(1));

        if (!isPathSafe(filePath, includeDirAbs) || !fs.existsSync(filePath)) {
          return next();
        }

        try {
          const rawHtml = fs.readFileSync(filePath, "utf-8");

          // Pass through transformIndexHtml pipeline.
          //
          // Our pre-order hook processes SSI → HTML.
          // Vite's built-in hook then handles <script>, <link>,
          // HMR client injection — all natively.
          //
          // Use a URL that includes includeDir so relative paths
          // like "./main.ts" resolve to "/src/main.ts" correctly.
          const transformUrl =
            "/" + path.relative(root, filePath).replace(/\\/g, "/");
          const html = await server.transformIndexHtml(transformUrl, rawHtml);

          res.setHeader("Content-Type", "text/html");
          res.end(html);
        } catch (err) {
          console.error(`[vite-plugin-shtml] Error processing ${filePath}:`, err);
          res.statusCode = 500;
          res.end(`SSI Error: ${err}`);
        }
      });
    },
  };
}
