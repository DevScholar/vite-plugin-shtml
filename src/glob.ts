import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Recursively find all .shtml files under a directory.
 */
export function globShtml(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      results.push(...globShtml(full));
    } else if (ent.name.endsWith(".shtml")) {
      results.push(full);
    }
  }
  return results;
}
