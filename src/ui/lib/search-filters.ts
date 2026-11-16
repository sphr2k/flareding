/** Browser URL and inline tag: syntax are Flareding UI state, not Linkding protocol. */
export type BookmarkView = "all" | "unread" | "archived";
export interface SearchState {
  query: string;
  tags: string[];
  view: BookmarkView;
  offset: number;
}

const tagEnd = /(?:^|\s)tag:(?:"([^"]*)"?|([^\s"]*))$/i;
const completedTags = /(^|\s)tag:(?:"([^"]+)"(?=\s|$)|([^\s"]+)(?=\s))/gi;

export function pendingTag(value: string): string | null {
  const match = tagEnd.exec(value);
  return match ? (match[1] ?? match[2] ?? "") : null;
}

export function stripPendingTag(value: string): string {
  return value.replace(tagEnd, "").trim();
}

/** Consume completed tag expressions; keep an unfinished tag: fragment editable. */
export function consumeTagSyntax(value: string): { query: string; tags: string[] } {
  const tags: string[] = [];
  const query = value
    .replace(completedTags, (match, space: string, quoted?: string, unquoted?: string) => {
      const name = (quoted ?? unquoted ?? "").trim();
      if (name) tags.push(name);
      return space || " ";
    })
    .replace(/\s{2,}/g, " ");
  return { query, tags };
}

export function readSearchState(query: string): SearchState {
  const params = new URLSearchParams(query);
  const view = params.get("view");
  const offset = Number(params.get("offset") ?? "0");
  return {
    query: (params.get("q") ?? "").slice(0, 1000),
    tags: [...new Set(params.getAll("tag").filter(Boolean))].slice(0, 12),
    view: view === "unread" || view === "archived" ? view : "all",
    offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : 0,
  };
}

export function writeSearchState(existing: string, state: SearchState): string {
  const params = new URLSearchParams(existing);
  for (const key of ["q", "tag", "view", "offset"]) params.delete(key);
  if (state.query.trim()) params.set("q", state.query.trim());
  for (const tag of state.tags) params.append("tag", tag);
  if (state.view !== "all") params.set("view", state.view);
  if (state.offset) params.set("offset", String(state.offset));
  return params.toString();
}
