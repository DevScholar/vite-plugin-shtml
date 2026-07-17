import * as path from "node:path";

/**
 * strftime subset compatible with mod_include.
 *
 * Pass `utc = true` to use UTC-based date parts (for DATE_GMT).
 */
export function strftime(fmt: string, d: Date, utc = false): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const Y = utc ? d.getUTCFullYear() : d.getFullYear();
  const month = utc ? d.getUTCMonth() : d.getMonth();
  const date = utc ? d.getUTCDate() : d.getDate();
  const hours = utc ? d.getUTCHours() : d.getHours();
  const mins = utc ? d.getUTCMinutes() : d.getMinutes();
  const secs = utc ? d.getUTCSeconds() : d.getSeconds();
  const day = utc ? d.getUTCDay() : d.getDay();

  const jan1 = new Date(Date.UTC(Y, 0, 1));
  const current = new Date(Date.UTC(Y, month, date));

  const map: Record<string, string> = {
    "%Y": String(Y),
    "%y": String(Y).slice(-2),
    "%m": pad(month + 1),
    "%d": pad(date),
    "%H": pad(hours),
    "%M": pad(mins),
    "%S": pad(secs),
    "%B": utc
      ? new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(d)
      : d.toLocaleString("en-US", { month: "long" }),
    "%b": utc
      ? new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(d)
      : d.toLocaleString("en-US", { month: "short" }),
    "%A": utc
      ? new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(d)
      : d.toLocaleString("en-US", { weekday: "long" }),
    "%a": utc
      ? new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(d)
      : d.toLocaleString("en-US", { weekday: "short" }),
    "%I": pad((hours % 12) || 12),
    "%p": hours < 12 ? "AM" : "PM",
    "%j": String(
      Math.ceil((current.getTime() - jan1.getTime()) / 86400000) + 1,
    ).padStart(3, "0"),
    "%U": (() => {
      const dayOfYear = Math.floor(
        (current.getTime() - jan1.getTime()) / 86400000,
      );
      const jan1Day = new Date(Date.UTC(Y, 0, 1)).getUTCDay(); // 0=Sun
      const daysToFirstSunday = jan1Day === 0 ? 0 : 7 - jan1Day;
      if (dayOfYear < daysToFirstSunday) return "00";
      return String(
        Math.floor((dayOfYear - daysToFirstSunday) / 7) + 1,
      ).padStart(2, "0");
    })(),
    "%w": String(day),
    "%C": String(Math.floor(Y / 100)),
  };
  return fmt.replace(
    /%[YymdHMSBAbaIjpUwC]/g,
    (m) => map[m] ?? m,
  );
}

/**
 * Format file size in bytes or abbreviated form.
 */
export function formatSize(bytes: number, sizefmt: string): string {
  if (sizefmt === "bytes") return `${bytes}`;
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${bytes}B` : `${v.toFixed(1)}${units[i]}`;
}

/**
 * Path traversal guard — checks that `resolvedPath` is within `safeDir`.
 */
export function isPathSafe(resolvedPath: string, safeDir: string): boolean {
  const normalized = path.resolve(resolvedPath);
  const normalizedDir = path.resolve(safeDir);
  return (
    normalized.startsWith(normalizedDir + path.sep) ||
    normalized === normalizedDir
  );
}
