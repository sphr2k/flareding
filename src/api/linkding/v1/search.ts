import { and, not, or, sql, type SQL } from "drizzle-orm";

type Token = { kind: "text" | "tag" | "keyword"; value: string } | "(" | ")" | "AND" | "OR" | "NOT";
type Atom = (kind: "text" | "tag" | "keyword", value: string) => SQL | undefined;

function tokenize(query: string): Token[] {
  const pattern = /\s+|[()]|([#!]?)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s()"']+))/gy;
  const tokens: Token[] = [];
  while (pattern.lastIndex < query.length) {
    const match = pattern.exec(query);
    if (!match) throw new SyntaxError("Invalid search term");
    const [raw, prefix, doubleQuoted, singleQuoted, bare] = match;
    if (!raw.trim()) continue;
    const operator = raw.toUpperCase();
    if (
      operator === "(" ||
      operator === ")" ||
      operator === "AND" ||
      operator === "OR" ||
      operator === "NOT"
    ) {
      tokens.push(operator);
    } else {
      const value = doubleQuoted ?? singleQuoted ?? bare;
      const kind = prefix === "#" ? "tag" : prefix === "!" ? "keyword" : "text";
      tokens.push({ kind, value: value.replace(/\\(["'\\])/g, "$1") });
    }
    if (tokens.length > 128) throw new SyntaxError("Too many search terms");
  }
  return tokens;
}

/** Compile linkding search expressions into parameterized SQL predicates. */
export function searchPredicate(query: string, atom: Atom): SQL | undefined {
  try {
    const tokens = tokenize(query);
    if (!tokens.length) return undefined;
    let index = 0;
    const unary = (): SQL | undefined => {
      const token = tokens[index++];
      if (token === "NOT") {
        const value = unary();
        return value && not(value);
      }
      if (token === "(") {
        const value = expression();
        if (tokens[index++] !== ")") throw new SyntaxError("Missing closing parenthesis");
        return value;
      }
      if (!token || typeof token === "string") throw new SyntaxError("Expected a search term");
      return atom(token.kind, token.value);
    };
    const conjunction = (): SQL | undefined => {
      const terms = [unary()];
      while (index < tokens.length && tokens[index] !== ")" && tokens[index] !== "OR") {
        if (tokens[index] === "AND") index++;
        terms.push(unary());
      }
      return and(...terms);
    };
    const expression = (): SQL | undefined => {
      const terms = [conjunction()];
      while (tokens[index] === "OR") {
        index++;
        terms.push(conjunction());
      }
      return or(...terms);
    };
    const result = expression();
    if (index !== tokens.length) throw new SyntaxError("Unexpected search token");
    return result;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return sql`0`;
  }
}
