# Vite Plugin SHTML

A static site generator based on the Apache SHTML standard for simple scenarios. Drop `.shtml` files into your Vite project — SSI directives are processed live in dev mode with HMR, and compiled to `.html` during build.

## Quick Start

```bash
npm install -D @devscholar/vite-plugin-shtml
```

### Project Structure

```
my-site/
  vite.config.ts
  src/
    index.shtml        ← entry page
    about.shtml        ← another page
    header.inc         ← shared include fragment
    footer.inc         ← shared include fragment
    main.ts            ← your JS/TS entry point
```

### Configuration

```ts
// vite.config.ts
import { defineConfig } from "vite";
import shtml from "@devscholar/vite-plugin-shtml";

export default defineConfig({
  plugins: [shtml()],
});
```

That's it. Place your `.shtml` files in `src/` (or set `includeDir`), then:

```bash
vite dev       # http://localhost:5173 → auto-redirects to /index.shtml
vite build     # dist/ contains processed .html files
```

### How It Works

The plugin acts as a format transformer — it processes `.shtml` through SSI directives, producing standard HTML. Vite then handles the rest:

**Dev mode**: The middleware intercepts `.shtml` requests → processes SSI → passes the HTML to `server.transformIndexHtml()`. This means Vite automatically:

- Injects the HMR client
- Resolves `<script src="./main.ts">` — TypeScript/JSX works as expected
- Processes `<link>` tags, `<style>`, asset URLs
- Runs other plugins' `transformIndexHtml` hooks (EJS, minification, etc.)

**Build mode**: During `writeBundle`, every `.shtml` under `includeDir` is processed into a `.html` file in the output directory. Intra-site `<a href="*.shtml">` links are rewritten to `.html`.

**HMR**: When any file included via `<!--#include -->` (`.inc`, `.tmpl`, `.part`) changes, all dependent pages receive a full reload.

---

## Directives

### Include

```html
<!--#include file="header.inc" -->
<!--#include virtual="/nav.html" -->
```

| Kind | Resolves relative to… |
|------|----------------------|
| `file` | The file containing the directive (fallback: `includeDir`) |
| `virtual` | `includeDir` (strips leading `/`) |

All paths are sandboxed to `includeDir` to prevent directory traversal.

### Echo

```html
<!--#echo var="DOCUMENT_NAME" -->
<!--#echo var="DATE_LOCAL" -->
<!--#echo var="FOO" -->
```

Resolves built-in variables, user-defined `<!--#set -->` variables, and `variables` from plugin options.

### Set

```html
<!--#set var="mood" value="awesome" -->
<!--#echo var="mood" -->
```

Sets a variable in the current scope. Variables are inherited by included files. Both double-quoted (`"`) and single-quoted (`'`) attribute values are supported.

### Conditionals

```html
<!--#if expr="$mood = happy" -->
  <p>I'm happy!</p>
<!--#elif expr="$mood = ok" -->
  <p>I'm ok.</p>
<!--#else -->
  <p>Not great.</p>
<!--#endif -->
```

Nested conditionals work correctly. See [Expression Syntax](#expression-syntax) below.

### Config

```html
<!--#config timefmt="%B %d, %Y" -->
<!--#config sizefmt="bytes" -->
<!--#config errmsg="Oops!" -->
```

| Key | Values | Default |
|-----|--------|---------|
| `timefmt` | `strftime` format string | `%Y-%m-%d %H:%M:%S` |
| `sizefmt` | `"bytes"` or `"abbrev"` | `"abbrev"` |
| `errmsg` | Custom error message | `[an error occurred…]` |

Config state is inherited by included files.

### File Size / Last Modified

```html
<!--#fsize file="image.gif" -->
<!--#flastmod virtual="/style.css" -->
```

`<!--#fsize -->` outputs the file size (respects `sizefmt`). `<!--#flastmod -->` outputs the last modification date (respects `timefmt`).

### Exec

```html
<!--#exec cmd="date" -->
```

⚠️ **Disabled by default.** Set `allowExec: true` to enable. Output is captured from the command's stdout. Each command has a 5-second timeout and runs in the file's directory.

### Printenv

```html
<!--#printenv -->
```

Dumps all SSI variables as `<pre>KEY=VALUE</pre>`.

### Page Title

```html
<!-- TITLE: My Page -->
```

Custom directive (not part of Apache SSI) — sets the `TITLE` variable used by `<!--#echo var="TITLE" -->`.

---

## Expression Syntax

`<!--#if -->` and `<!--#elif -->` use a mod_include-compatible expression evaluator:

| Syntax | Example | Description |
|--------|---------|-------------|
| `$VAR` | `$MOOD` | Truthy if defined and non-empty |
| `$VAR = "value"` | `$MOOD = "happy"` | String equality |
| `$VAR != "value"` | `$MOOD != "sad"` | String inequality |
| `$VAR = /re/` | `$NAME = /^A.*z/i` | Regex match (flags supported) |
| `$VAR != /re/` | `$NAME != /test/i` | Regex non-match |
| `$VAR < N` | `$COUNT < 10` | Numeric less than |
| `$VAR > N` | `$COUNT > 0` | Numeric greater than |
| `$VAR <= N` | `$COUNT <= 5` | Numeric less or equal |
| `$VAR >= N` | `$COUNT >= 1` | Numeric greater or equal |
| `&&` | `$A = 1 && $B = 2` | Logical AND |
| `\|\|` | `$A = 1 \|\| $B = 2` | Logical OR |
| `!` | `!$X` | Logical NOT |
| `()` | `($A \|\| $B) && $C` | Grouping |

---

## Built-in Variables

| Variable | Value |
|----------|-------|
| `DOCUMENT_NAME` | Filename of the current .shtml |
| `DOCUMENT_URI` | URL path (`.shtml` → `.html`) |
| `DATE_LOCAL` | Current date/time (local timezone, `timefmt`) |
| `DATE_GMT` | Current date/time (UTC, `timefmt`) |
| `LAST_MODIFIED` | File modification time (`timefmt`) |
| `SERVER_SOFTWARE` | `vite-plugin-shtml/0.1.0` |
| `TITLE` | From `<!-- TITLE: ... -->` or option |
| `USER_NAME` | `(none)` |

---

## Options

```ts
shtml({
  includeDir: "src",          // where .shtml files live (relative to Vite root)
  variables: { FOO: "bar" },  // extra echo variables available to all pages
  allowExec: false,           // enable <!--#exec cmd="..." -->
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `includeDir` | `string` | `"src"` | Directory to resolve includes and serve .shtml from |
| `variables` | `Record<string, string>` | `{}` | Global variables available via `<!--#echo var="..." -->` |
| `allowExec` | `boolean` | `false` | Enable `<!--#exec cmd="..." -->` (security risk) |

---

## Build Output

During `vite build`, the plugin:

1. Finds all `.shtml` files under `includeDir`
2. Processes SSI directives recursively
3. Rewrites `<a href="*.shtml">` → `*.html`
4. Writes the result to `outDir` (preserving directory structure)

Example: `src/about.shtml` → `dist/about.html`

---

## License

MIT
