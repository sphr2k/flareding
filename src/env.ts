import type { BookmarkDO } from "./worker/bookmarks.js";

export interface Env {
  BOOKMARKS: DurableObjectNamespace<BookmarkDO>;
  ASSETS: Fetcher;
  API_TOKEN?: string;
  LINKDING_SHARE_USERNAME?: string;
  LINKDING_PUBLIC_SHARING?: string;
  MCP_ACCESS_AUD?: string;
  MCP_ACCESS_ISSUER?: string;
  IMPORT_SECRET?: string;
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_ALLOWED_EMAIL?: string;
  SESSION_SECRET?: string;
}
