import { describe, it, expect } from "vitest";
import { strftime, formatSize, isPathSafe } from "../src/strftime";

describe("strftime", () => {
  it("formats date with default patterns", () => {
    const d = new Date(2026, 6, 15, 14, 30, 45); // July 15, 2026 14:30:45
    const result = strftime("%Y-%m-%d %H:%M:%S", d);
    expect(result).toBe("2026-07-15 14:30:45");
  });

  it("formats %Y as 4-digit year", () => {
    expect(strftime("%Y", new Date(2026, 0, 1))).toBe("2026");
  });

  it("formats %y as 2-digit year", () => {
    expect(strftime("%y", new Date(2026, 0, 1))).toBe("26");
  });

  it("formats %m and %d with zero-padding", () => {
    expect(strftime("%m/%d", new Date(2026, 0, 5))).toBe("01/05");
  });

  it("formats %H %M %S with zero-padding", () => {
    const d = new Date(2026, 0, 1, 9, 5, 3);
    expect(strftime("%H:%M:%S", d)).toBe("09:05:03");
  });

  it("formats %I as 12-hour clock", () => {
    const d0 = new Date(2026, 0, 1, 0, 0, 0);
    expect(strftime("%I", d0)).toBe("12");
    const d13 = new Date(2026, 0, 1, 13, 0, 0);
    expect(strftime("%I", d13)).toBe("01");
  });

  it("formats %p as AM/PM", () => {
    expect(strftime("%p", new Date(2026, 0, 1, 9, 0, 0))).toBe("AM");
    expect(strftime("%p", new Date(2026, 0, 1, 15, 0, 0))).toBe("PM");
  });

  it("formats month names (%B %b)", () => {
    const d = new Date(2026, 6, 15); // July
    expect(strftime("%B", d)).toBe("July");
    expect(strftime("%b", d)).toBe("Jul");
  });

  it("formats weekday names (%A %a)", () => {
    // 2026-07-15 is a Wednesday
    const d = new Date(2026, 6, 15);
    expect(strftime("%A", d)).toBe("Wednesday");
    expect(strftime("%a", d)).toBe("Wed");
  });

  it("formats %j as day of year", () => {
    // Jan 1 = 001
    expect(strftime("%j", new Date(2026, 0, 1))).toBe("001");
    // Feb 1 = 032
    expect(strftime("%j", new Date(2026, 1, 1))).toBe("032");
  });

  it("formats %U as week number", () => {
    // 2026-01-01 is Thursday (Jan 1)
    // Days before first Sunday: Sunday is Jan 4, so Jan 1-3 are week 00
    const jan1 = new Date(2026, 0, 1); // Thu
    expect(strftime("%U", jan1)).toBe("00");

    const jan4 = new Date(2026, 0, 4); // Sun — week 01 starts
    expect(strftime("%U", jan4)).toBe("01");
  });

  it("formats %w as day of week (0=Sun)", () => {
    // 2026-07-15 is Wednesday (3)
    const d = new Date(2026, 6, 15);
    expect(strftime("%w", d)).toBe("3");
  });

  it("formats %C as century", () => {
    expect(strftime("%C", new Date(2026, 0, 1))).toBe("20");
  });

  // ── UTC mode ───────────────────────────────────────────

  it("UTC mode uses UTC hours", () => {
    // A date at UTC+8 midnight → UTC is 4pm previous day
    const d = new Date("2026-07-15T00:00:00+08:00");
    const hourUtc = strftime("%H", d, true);
    const hourLocal = strftime("%H", d, false);
    expect(hourUtc).not.toBe(hourLocal);
    expect(hourUtc).toBe("16"); // 00:00+08:00 = 16:00 UTC
  });

  it("UTC mode uses UTC day of week", () => {
    // 23:00 UTC on July 15 = next day in UTC+8 (China)
    // UTC: Wednesday, Local: Thursday
    const d = new Date(Date.UTC(2026, 6, 15, 23, 0, 0));
    const localDay = strftime("%A", d, false);
    const utcDay = strftime("%A", d, true);
    expect(utcDay).not.toBe(localDay);
  });
});

describe("formatSize", () => {
  it("formats bytes in raw mode", () => {
    expect(formatSize(1234, "bytes")).toBe("1234");
  });

  it("formats bytes in abbrev mode", () => {
    expect(formatSize(500, "abbrev")).toBe("500B");
    expect(formatSize(1500, "abbrev")).toBe("1.5KB");
    expect(formatSize(1048576, "abbrev")).toBe("1.0MB");
    expect(formatSize(1073741824, "abbrev")).toBe("1.0GB");
  });
});

describe("isPathSafe", () => {
  const safeDir = "/project/src";

  it("allows path within safe dir", () => {
    expect(isPathSafe("/project/src/pages/index.shtml", safeDir)).toBe(true);
  });

  it("allows the safe dir itself", () => {
    expect(isPathSafe("/project/src", safeDir)).toBe(true);
  });

  it("rejects path traversal via ..", () => {
    expect(isPathSafe("/project/src/../../../etc/passwd", safeDir)).toBe(
      false,
    );
  });

  it("rejects unrelated directory", () => {
    expect(isPathSafe("/other/file", safeDir)).toBe(false);
  });

  it("rejects sibling directory (not a prefix match)", () => {
    expect(isPathSafe("/project/src-other/file", safeDir)).toBe(false);
  });
});
