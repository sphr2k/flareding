import { Button } from "@react-spectrum/s2/Button";
import { CardView } from "@react-spectrum/s2/CardView";
import { InlineAlert, Heading, Content } from "@react-spectrum/s2/InlineAlert";
import { Provider } from "@react-spectrum/s2/Provider";
import { StatusLight } from "@react-spectrum/s2/StatusLight";
import { TextField, type TextFieldRef } from "@react-spectrum/s2/TextField";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppHeader } from "./components/AppHeader.js";
import { CollectionToolbar, type DisplayMode } from "./components/CollectionToolbar.js";
import { BookmarkCard } from "./components/BookmarkCard.js";
import { BookmarkList } from "./components/BookmarkList.js";
import type { BookmarkDTO } from "../api/bookmark-contract.js";

interface BookmarkPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: BookmarkDTO[];
}

type BookmarkView = "all" | "unread" | "archived";

function useDebouncedValue(value: string, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

async function getBookmarks(
  search: string,
  view: BookmarkView,
  tag: string,
  offset: number,
): Promise<BookmarkPage> {
  const url = new URL(
    view === "archived" ? "/api/bookmarks/archived/" : "/api/bookmarks/",
    window.location.origin,
  );
  url.searchParams.set("limit", "60");
  url.searchParams.set("offset", String(offset));
  if (search.trim()) url.searchParams.set("q", search.trim());
  if (view === "unread") url.searchParams.set("unread", "true");
  if (tag.trim()) url.searchParams.set("tag", tag.trim());
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok)
    throw new Error(
      response.status === 401 ? "Sitzung abgelaufen" : "Bookmarks konnten nicht geladen werden",
    );
  return response.json() as Promise<BookmarkPage>;
}

async function sendBookmark(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: payload ? { "Content-Type": "application/json" } : {},
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!response.ok) {
    const message = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(message.detail ?? `HTTP ${response.status}`);
  }
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await fetch("/api/session/", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!result.ok)
        throw new Error(
          result.status === 503
            ? "Für diese Instanz ist noch kein Zugang eingerichtet."
            : "Token ungültig.",
        );
      setToken(""); // The API token is never persisted in browser storage.
      onLogin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Anmeldung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={style({ display: "flex", flexDirection: "column", gap: 20, maxWidth: 440 })}>
      <h1 className={style({ font: "heading-2xl", margin: 0 })}>Deine Bookmarks.</h1>
      <p className={style({ font: "body", color: "gray-700", margin: 0 })}>
        Melde dich mit deinem linkding-kompatiblen API-Token an.
      </p>
      <form
        onSubmit={login}
        className={style({ display: "flex", flexDirection: "column", gap: 16 })}
      >
        <TextField
          label="API-Token"
          type="password"
          value={token}
          onChange={setToken}
          placeholder="Dein API-Token"
          isRequired
        />
        <Button type="submit" variant="accent" isPending={busy} isDisabled={!token.trim()}>
          Anmelden
        </Button>
      </form>
      {error && (
        <InlineAlert variant="negative">
          <Heading>Anmeldung fehlgeschlagen</Heading>
          <Content>{error}</Content>
        </InlineAlert>
      )}
    </main>
  );
}

function BookmarkManager({ onLogout }: { onLogout: () => void }) {
  const cache = useQueryClient();
  const searchRef = useRef<TextFieldRef<HTMLInputElement>>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<BookmarkView>("all");
  const [tagFilter, setTagFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const debouncedTag = useDebouncedValue(tagFilter);
  const [display, setDisplay] = useState<DisplayMode>("cards");
  const [isNarrow, setNarrow] = useState(false);
  useEffect(() => {
    // Spectrum CardView has a native minimum two-column grid. Below 640px,
    // ListView keeps links readable without overriding CardView internals.
    const media = window.matchMedia("(max-width: 640px)");
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const activeDisplay = isNarrow ? "list" : display;
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);

  const { data, isPending, error } = useQuery({
    queryKey: ["bookmarks", debouncedSearch, view, debouncedTag, offset],
    queryFn: () => getBookmarks(debouncedSearch, view, debouncedTag, offset),
    staleTime: 15_000,
  });

  const create = useMutation({
    mutationFn: async (input: { url: string; title: string; tag_names: string[] }) =>
      sendBookmark("POST", "/api/bookmarks/", input),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["bookmarks"] });
    },
  });
  const archive = useMutation({
    mutationFn: async (bookmark: BookmarkDTO) =>
      sendBookmark(
        "POST",
        `/api/bookmarks/${bookmark.id}/${bookmark.is_archived ? "unarchive" : "archive"}/`,
      ),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["bookmarks"] });
    },
  });

  useEffect(() => {
    function shortcut(event: globalThis.KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.matches("input, textarea, select") || target.isContentEditable) return;
        if (target.closest('[role="dialog"], [role="menu"]')) return;
      }
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.getInputElement()?.focus();
      } else if (event.key.toLowerCase() === "n" && !adding) {
        event.preventDefault();
        setAdding(true);
      }
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [adding]);

  return (
    <>
      <AppHeader
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setOffset(0);
        }}
        searchRef={searchRef}
        isAddOpen={adding}
        onAddOpenChange={setAdding}
        onCreate={async (input) => {
          await create.mutateAsync(input);
        }}
        onLogout={onLogout}
      />
      <main
        className={style({
          display: "flex",
          flexDirection: "column",
          gap: 20,
          width: "full",
          flexGrow: 1,
        })}
      >
        <CollectionToolbar
          view={view}
          onViewChange={(next) => {
            setView(next);
            setOffset(0);
          }}
          display={activeDisplay}
          isNarrow={isNarrow}
          onDisplayChange={setDisplay}
          count={data?.count}
          tagFilter={tagFilter}
          onTagFilterChange={(value) => {
            setTagFilter(value);
            setOffset(0);
          }}
        />
        {error && (
          <InlineAlert variant="negative">
            <Heading>Bookmarks konnten nicht geladen werden</Heading>
            <Content>{error.message}</Content>
          </InlineAlert>
        )}
        {isPending && <StatusLight variant="informative">Lade Bookmarks …</StatusLight>}
        {data && (
          <section
            aria-label="Bookmark-Sammlung"
            className={style({
              display: "flex",
              flexDirection: "column",
              gap: 16,
              width: "full",
            })}
          >
            {data.count === 0 ? (
              <InlineAlert variant="informative" fillStyle="subtleFill">
                <Heading>Keine Bookmarks gefunden</Heading>
                <Content>Suchbegriff oder Filter ändern oder einen Bookmark hinzufügen.</Content>
              </InlineAlert>
            ) : activeDisplay === "cards" ? (
              <CardView
                aria-label="Bookmark-Kacheln"
                layout="waterfall"
                size="XL"
                density="compact"
                variant="secondary"
                items={data.results}
                dependencies={[view, archive.isPending]}
                styles={style({ width: "full" })}
              >
                {(bookmark) => (
                  <BookmarkCard
                    bookmark={bookmark}
                    onToggleArchive={(item) => archive.mutate(item)}
                    isPending={archive.isPending}
                  />
                )}
              </CardView>
            ) : (
              <BookmarkList
                bookmarks={data.results}
                onToggleArchive={(item) => archive.mutate(item)}
                isPending={archive.isPending}
              />
            )}
            {(offset > 0 || data.next) && (
              <div
                className={style({
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                })}
              >
                <Button
                  variant="secondary"
                  isDisabled={offset === 0}
                  onPress={() => setOffset(Math.max(0, offset - 60))}
                >
                  Zurück
                </Button>
                <span className={style({ font: "detail", color: "gray-700" })}>
                  {offset + 1}–{Math.min(offset + 60, data.count)} von {data.count}
                </span>
                <Button
                  variant="secondary"
                  isDisabled={!data.next}
                  onPress={() => setOffset(offset + 60)}
                >
                  Weiter
                </Button>
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [loginMode, setLoginMode] = useState<"token" | "access">("token");
  const [accessError, setAccessError] = useState("");

  useEffect(() => {
    let active = true;
    async function discoverSession() {
      try {
        const response = await fetch("/api/session/", { credentials: "same-origin" });
        if (!response.ok) {
          if (active) setAuthenticated(false);
          return;
        }
        const info = (await response.json()) as {
          authenticated: boolean;
          login?: "access" | "token";
        };
        if (!active) return;
        setLoginMode(info.login === "access" ? "access" : "token");
        if (info.authenticated || info.login !== "access") {
          setAuthenticated(info.authenticated);
          return;
        }
        // Access protects /auth/* (never /api/*): the forwarded JWT is
        // verified server-side, and the browser receives only an HttpOnly
        // session cookie. The JWT and API token are never available to JS.
        const exchange = await fetch("/auth/access/session", {
          method: "POST",
          credentials: "same-origin",
        });
        if (!active) return;
        if (!exchange.ok) {
          setAccessError("Cloudflare Access konnte die Anmeldung nicht bestätigen.");
          setAuthenticated(false);
          return;
        }
        setAuthenticated(true);
      } catch {
        if (active) setAuthenticated(false);
      }
    }
    void discoverSession();
    return () => {
      active = false;
    };
  }, []);

  async function logout() {
    await fetch("/api/session/", { method: "DELETE", credentials: "same-origin" });
    setAuthenticated(false);
    if (loginMode === "access") {
      window.location.assign("/cdn-cgi/access/logout");
    }
  }

  return (
    <Provider locale="de-DE" colorScheme="dark">
      <div
        className={style({
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: 24,
          minHeight: "100dvh",
          boxSizing: "border-box",
        })}
      >
        {authenticated !== true && (
          <header
            className={style({
              display: "flex",
              gap: 12,
              alignItems: "center",
              justifyContent: "space-between",
            })}
          >
            <strong className={style({ font: "heading-sm" })}>flareding</strong>
          </header>
        )}
        {authenticated === null ? (
          <StatusLight variant="informative">Sitzung wird geprüft …</StatusLight>
        ) : authenticated ? (
          <BookmarkManager onLogout={logout} />
        ) : loginMode === "access" ? (
          <main
            className={style({ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 })}
          >
            <h1 className={style({ font: "heading-xl" })}>Cloudflare Access</h1>
            <p className={style({ font: "body", color: "gray-700" })}>
              {accessError || "Die Anmeldung über Cloudflare Access ist erforderlich."}
            </p>
            <Button
              variant="accent"
              onPress={() => window.location.assign("/cdn-cgi/access/login")}
            >
              Über Cloudflare anmelden
            </Button>
          </main>
        ) : (
          <Login onLogin={() => setAuthenticated(true)} />
        )}
        {authenticated !== true && (
          <footer className={style({ font: "detail", color: "gray-600" })}>
            Flareding · Cloudflare Workers · SQLite Durable Objects
          </footer>
        )}
      </div>
    </Provider>
  );
}
