/**
 * Evaluate a mod_include-style expression.
 *
 * Supported:
 *   $VAR              — truthy if defined and non-empty
 *   $VAR = value      — string equality  ($VAR = "")
 *   $VAR != value     — string inequality
 *   $VAR = /re/       — regex match       ($VAR = /hello/i)
 *   $VAR != /re/      — regex non-match
 *   expr && expr      — logical AND
 *   expr || expr      — logical OR
 *   !expr             — logical NOT
 *   (expr)            — grouping
 *   $VAR < N, $VAR > N, $VAR <= N, $VAR >= N  — numeric comparison
 *   "literal" comparisons between quoted strings
 */
export class ExprEvaluator {
  private vars: Record<string, string>;
  private pos: number;
  private expr: string;

  constructor(vars: Record<string, string>) {
    this.vars = vars;
    this.pos = 0;
    this.expr = "";
  }

  eval(expr: string): boolean {
    this.expr = expr.trim();
    this.pos = 0;
    return this.parseOr();
  }

  private parseOr(): boolean {
    let left = this.parseAnd();
    while (this.skip("||")) {
      const right = this.parseAnd();
      left = left || right;
    }
    return left;
  }

  private parseAnd(): boolean {
    let left = this.parseNot();
    while (this.skip("&&")) {
      const right = this.parseNot();
      left = left && right;
    }
    return left;
  }

  private parseNot(): boolean {
    if (this.skip("!")) return !this.parseNot();
    return this.parseAtom();
  }

  private parseAtom(): boolean {
    this.skipWhitespace();

    // grouping
    if (this.skip("(")) {
      const result = this.parseOr();
      this.skip(")");
      return result;
    }

    // read left operand
    const left = this.readOperand();
    this.skipWhitespace();

    // comparison?
    if (this.pos >= this.expr.length) {
      return left !== "";
    }

    const op = this.readOp();
    if (op) {
      this.skipWhitespace();
      const right = this.readOperand();
      return this.compare(left, op, right);
    }

    return left !== "";
  }

  // ── helpers ─────────────────────────────────────────────

  private readOperand(): string {
    this.skipWhitespace();

    // variable reference
    if (this.peek() === "$") {
      this.pos++;
      const name = this.readName();
      return this.vars[name] ?? this.vars[name.toUpperCase()] ?? "";
    }

    // quoted string
    if (this.peek() === '"') {
      this.pos++;
      let result = "";
      while (this.pos < this.expr.length && this.peek() !== '"') {
        if (this.peek() === "\\") {
          this.pos++;
          result += this.peek();
          this.pos++;
        } else {
          result += this.peek();
          this.pos++;
        }
      }
      this.pos++;
      return result;
    }

    if (this.peek() === "'") {
      this.pos++;
      let result = "";
      while (this.pos < this.expr.length && this.peek() !== "'") {
        result += this.peek();
        this.pos++;
      }
      this.pos++;
      return result;
    }

    // unquoted value
    if (this.peek()) {
      let result = "";
      while (
        this.pos < this.expr.length &&
        !/[\s&|!<>=()]/.test(this.peek())
      ) {
        result += this.peek();
        this.pos++;
      }
      return result.trim();
    }

    return "";
  }

  private readOp(): string | null {
    this.skipWhitespace();
    if (this.pos >= this.expr.length) return null;

    const rest = this.expr.slice(this.pos);

    // Must not be part of && or ||
    if (rest.startsWith("&&") || rest.startsWith("||")) return null;

    if (rest.startsWith("!=")) { this.pos += 2; return "!="; }
    if (rest.startsWith("<=")) { this.pos += 2; return "<="; }
    if (rest.startsWith(">=")) { this.pos += 2; return ">="; }
    if (rest.startsWith("="))  { this.pos += 1; return "="; }
    if (rest.startsWith("<"))  { this.pos += 1; return "<"; }
    if (rest.startsWith(">"))  { this.pos += 1; return ">"; }

    return null;
  }

  private compare(left: string, op: string, right: string): boolean {
    // regex: only for = and != operators
    if (
      (op === "=" || op === "!=") &&
      right.startsWith("/") &&
      right.lastIndexOf("/") >= 1
    ) {
      const lastSlash = right.lastIndexOf("/");
      const pattern = right.slice(1, lastSlash);
      const flags = right.slice(lastSlash + 1);
      const re = new RegExp(pattern, flags);
      return op === "=" ? re.test(left) : !re.test(left);
    }

    switch (op) {
      case "=":  return left === right;
      case "!=": return left !== right;
      case "<":  return Number(left) < Number(right);
      case "<=": return Number(left) <= Number(right);
      case ">":  return Number(left) > Number(right);
      case ">=": return Number(left) >= Number(right);
      default:   return false;
    }
  }

  private readName(): string {
    let name = "";
    while (this.pos < this.expr.length && /[A-Za-z0-9_]/.test(this.peek())) {
      name += this.peek();
      this.pos++;
    }
    return name;
  }

  private skipWhitespace() {
    while (this.pos < this.expr.length && /\s/.test(this.peek())) {
      this.pos++;
    }
  }

  private peek(): string {
    return this.pos < this.expr.length ? this.expr[this.pos] : "";
  }

  private skip(s: string): boolean {
    this.skipWhitespace();
    if (this.expr.slice(this.pos, this.pos + s.length) === s) {
      this.pos += s.length;
      return true;
    }
    return false;
  }
}
