import { Button } from "@react-spectrum/s2/Button";
import { DialogContainer } from "@react-spectrum/s2/Dialog";
import { AlertDialog } from "@react-spectrum/s2/AlertDialog";
import { CardView } from "@react-spectrum/s2/CardView";
import { InlineAlert, Heading, Content } from "@react-spectrum/s2/InlineAlert";
import { Picker, PickerItem } from "@react-spectrum/s2/Picker";
import { Provider } from "@react-spectrum/s2/Provider";
import { StatusLight } from "@react-spectrum/s2/StatusLight";
import { TextField, type TextFieldRef } from "@react-spectrum/s2/TextField";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CollectionNavigation } from "./components/CollectionNavigation.js";
import { AppHeader } from "./components/AppHeader.js";
import { CollectionToolbar } from "./components/CollectionToolbar.js";
import { BookmarkDialog } from "./components/BookmarkDialog.js";
import { SettingsDialog } from "./components/SettingsDialog.js";
import { BookmarkCard } from "./components/BookmarkCard.js";
import type { BookmarkDTO } from "../api/linkding/v1/contract.js";
import { flaredingV1BookmarkSearchOutput } from "../api/flareding/v1/contract.js";
import {
  readSearchState,
  writeSearchState,
  pendingTag,
  stripPendingTag,
} from "./lib/search-filters.js";

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
  query: string,
  view: BookmarkView,
  tags: string[],
  offset: number,
  bundle: number | null,
): Promise<BookmarkPage> {
  const response = await fetch("/api/bookmarks/search/", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: pendingTag(query) === null ? query : stripPendingTag(query),
      tags,
      ...(bundle === null ? {} : { bundle }),
      view,
      limit: 60,
      offset,
    }),
  });
  if (!response.ok)
    throw new Error(response.status === 401 ? "Session expired" : "Could not load bookmarks");
  return flaredingV1BookmarkSearchOutput.parse(await response.json());
}

interface Bundle {
  id: number;
  name: string;
}

async function getBundles(): Promise<Bundle[]> {
  const bundles: Bundle[] = [];
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(`/api/bundles/?limit=100&offset=${offset}`, {
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("Could not load collections");
    const page = (await response.json()) as { count: number; results: Bundle[] };
    bundles.push(...page.results);
    if (!page.results.length || bundles.length >= page.count) return bundles;
  }
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
            ? "Access has not been configured for this instance."
            : "Invalid token.",
        );
      setToken(""); // The API token is never persisted in browser storage.
      onLogin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={style({ display: "flex", flexDirection: "column", gap: 20, maxWidth: 440 })}>
      <h1 className={style({ font: "heading-2xl", margin: 0 })}>Your bookmarks.</h1>
      <p className={style({ font: "body", color: "gray-700", margin: 0 })}>
        Sign in with your linkding-compatible API token.
      </p>
      <form
        onSubmit={login}
        className={style({ display: "flex", flexDirection: "column", gap: 16 })}
      >
        <TextField
          label="API token"
          type="password"
          value={token}
          onChange={setToken}
          placeholder="Your API token"
          isRequired
        />
        <Button type="submit" variant="accent" isPending={busy} isDisabled={!token.trim()}>
          Sign in
        </Button>
      </form>
      {error && (
        <InlineAlert variant="negative">
          <Heading>Sign-in failed</Heading>
          <Content>{error}</Content>
        </InlineAlert>
      )}
    </main>
  );
}

function BookmarkManager({
  onLogout,
  accessLogin,
}: {
  onLogout: () => void;
  accessLogin: boolean;
}) {
  const cache = useQueryClient();
  const searchRef = useRef<TextFieldRef<HTMLInputElement>>(null);
  const [urlState, setUrlState] = useState(() => readSearchState(window.location.search));
  const { query: search, tags: tagFilters, view, offset } = urlState;
  const setSearch = (query: string) =>
    setUrlState((previous) => ({ ...previous, query, offset: 0 }));
  const setTags = (tags: string[]) => setUrlState((previous) => ({ ...previous, tags, offset: 0 }));
  const setView = (view: BookmarkView) =>
    setUrlState((previous) => ({ ...previous, view, offset: 0 }));
  const setOffset = (next: number | ((previous: number) => number)) =>
    setUrlState((previous) => ({
      ...previous,
      offset: typeof next === "function" ? next(previous.offset) : next,
    }));
  const debouncedSearch = useDebouncedValue(search);
  useEffect(() => {
    const current = window.location.search;
    const next = writeSearchState(current, urlState);
    if (next !== current.replace(/^\?/, "")) {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + (next ? `?${next}` : "") + window.location.hash,
      );
    }
  }, [urlState]);
  useEffect(() => {
    const restore = () => setUrlState(readSearchState(window.location.search));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const [isNarrow, setNarrow] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    // Keep the mobile navigation compact; bookmarks always use CardView.
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const [bundle, setBundle] = useState<number | null>(null);
  const bundles = useQuery({ queryKey: ["bundles"], queryFn: getBundles });
  const [adding, setAdding] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState<BookmarkDTO | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BookmarkDTO | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const { data, isPending, error } = useQuery({
    queryKey: ["bookmarks", debouncedSearch, view, tagFilters, offset, bundle],
    queryFn: () => getBookmarks(debouncedSearch, view, tagFilters, offset, bundle),
    staleTime: 15_000,
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

  const remove = useMutation({
    mutationFn: (bookmark: BookmarkDTO) => sendBookmark("DELETE", `/api/bookmarks/${bookmark.id}/`),
    onSuccess: async () => {
      if (data?.results.length === 1 && offset > 0) {
        setOffset((previous) => Math.max(0, previous - 60));
      }
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["bookmarks"] }),
        cache.invalidateQueries({ queryKey: ["tags"] }),
      ]);
    },
    onError: (cause) => {
      setDeleteError(cause instanceof Error ? cause.message : "Could not delete bookmark.");
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
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      <DialogContainer onDismiss={() => setConfirmDelete(null)}>
        {confirmDelete && (
          <AlertDialog
            title="Delete bookmark?"
            variant="destructive"
            cancelLabel="Cancel"
            primaryActionLabel="Delete"
            autoFocusButton="cancel"
            onCancel={() => setConfirmDelete(null)}
            onPrimaryAction={() => {
              const selected = confirmDelete;
              setConfirmDelete(null);
              setDeleteError("");
              remove.mutate(selected);
            }}
          >
            “{confirmDelete.title || confirmDelete.url}” will be permanently deleted. This cannot be
            undone.
          </AlertDialog>
        )}
      </DialogContainer>
      {(editing || adding) && (
        <BookmarkDialog
          key={editing?.id ?? "new"}
          bookmark={editing ?? undefined}
          onClose={() => {
            setEditing(null);
            setAdding(false);
          }}
          onSave={async (input) => {
            await sendBookmark(
              editing ? "PATCH" : "POST",
              editing ? `/api/bookmarks/${editing.id}/` : "/api/bookmarks/",
              { ...input },
            );
            await cache.invalidateQueries({ queryKey: ["bookmarks"] });
            await cache.invalidateQueries({ queryKey: ["tags"] });
          }}
        />
      )}
      <div
        className={style({
          display: "grid",
          gridTemplateAreas: {
            default: ["toolbar", "content"],
            "@media (min-width: 768px)": ["toolbar toolbar", "sidebar content"],
          },
          gridTemplateColumns: {
            default: ["minmax(0, 1fr)"],
            "@media (min-width: 768px)": ["auto", "minmax(0, 1fr)"],
          },
          gridTemplateRows: ["auto", "minmax(0, 1fr)"],
          height: "100dvh",
          backgroundColor: "layer-1",
          overflow: "clip",
        })}
      >
        <AppHeader
          search={search}
          onSearchChange={setSearch}
          tags={tagFilters}
          onTagsChange={setTags}
          searchRef={searchRef}
          onAddOpenChange={setAdding}
          onLogout={onLogout}
          onSettings={accessLogin ? () => setSettingsOpen(true) : undefined}
          isNarrow={isNarrow}
        />
        {!isNarrow && (
          <CollectionNavigation view={view} onViewChange={setView} onAdd={() => setAdding(true)} />
        )}
        <main
          className={style({
            display: "flex",
            flexDirection: "column",
            gap: 24,
            gridArea: "content",
            minWidth: 0,
            minHeight: 0,
            overflow: "auto",
            padding: 20,
            backgroundColor: "base",
            borderTopRadius: "xl",
            boxSizing: "border-box",
          })}
        >
          <CollectionToolbar
            view={view}
            onViewChange={setView}
            isNarrow={isNarrow}
            count={data?.count}
          />
          {bundles.error && (
            <InlineAlert variant="negative">
              <Heading>Could not load collections</Heading>
              <Content>{bundles.error.message}</Content>
            </InlineAlert>
          )}
          {!!bundles.data?.length && (
            <Picker
              label="Collection"
              value={bundle === null ? "all" : String(bundle)}
              onChange={(key) => {
                setBundle(key === "all" ? null : Number(key));
                setOffset(0);
              }}
            >
              <PickerItem id="all">All collections</PickerItem>
              {bundles.data.map((item) => (
                <PickerItem key={item.id} id={String(item.id)}>
                  {item.name}
                </PickerItem>
              ))}
            </Picker>
          )}
          {deleteError && (
            <InlineAlert variant="negative">
              <Heading>Could not delete bookmark</Heading>
              <Content>{deleteError}</Content>
            </InlineAlert>
          )}
          {error && (
            <InlineAlert variant="negative">
              <Heading>Could not load bookmarks</Heading>
              <Content>{error.message}</Content>
            </InlineAlert>
          )}
          {isPending && <StatusLight variant="informative">Loading bookmarks…</StatusLight>}
          {data && (
            <section
              aria-label="Bookmark collection"
              className={style({
                display: "flex",
                flexDirection: "column",
                gap: 16,
                width: "full",
              })}
            >
              {data.count === 0 ? (
                <InlineAlert variant="informative" fillStyle="subtleFill">
                  <Heading>No bookmarks found</Heading>
                  <Content>Change your search or filters, or add a bookmark.</Content>
                </InlineAlert>
              ) : (
                <CardView
                  aria-label="Bookmark cards"
                  layout="waterfall"
                  size={isNarrow ? "XL" : "L"}
                  density="compact"
                  variant="secondary"
                  items={data.results}
                  dependencies={[view, archive.isPending, remove.isPending]}
                  // Adobe Photos example offsets the native CardView gutter via its public styles prop.
                  styles={style({ marginX: -16, alignSelf: "stretch" })}
                >
                  {(bookmark) => (
                    <BookmarkCard
                      bookmark={bookmark}
                      onEdit={setEditing}
                      onToggleArchive={(item) => archive.mutate(item)}
                      onDelete={setConfirmDelete}
                      isPending={archive.isPending || remove.isPending}
                    />
                  )}
                </CardView>
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
                    Previous
                  </Button>
                  <span className={style({ font: "detail", color: "gray-700" })}>
                    {offset + 1}–{Math.min(offset + 60, data.count)} of {data.count}
                  </span>
                  <Button
                    variant="secondary"
                    isDisabled={!data.next}
                    onPress={() => setOffset(offset + 60)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </section>
          )}
        </main>
      </div>
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
        // Keep legacy workers.dev MCP and API endpoints, but use the canonical
        // Access-protected hostname for interactive sessions.
        if (
          info.login === "access" &&
          window.location.hostname === "flareding-staging.janwer.workers.dev"
        ) {
          window.location.replace(
            `https://bookmarks.janwerner.de${window.location.pathname}${window.location.search}${window.location.hash}`,
          );
          return;
        }
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
          setAccessError("Cloudflare Access could not verify your sign-in.");
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
    <Provider locale="en-US" colorScheme="dark">
      <div
        className={[
          style({
            display: "flex",
            flexDirection: "column",
            gap: 16,
            minHeight: "100dvh",
            boxSizing: "border-box",
          }),
          authenticated !== true ? style({ padding: 16 }) : "",
        ].join(" ")}
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
          <StatusLight variant="informative">Checking session…</StatusLight>
        ) : authenticated ? (
          <BookmarkManager onLogout={logout} accessLogin={loginMode === "access"} />
        ) : loginMode === "access" ? (
          <main
            className={style({ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 })}
          >
            <h1 className={style({ font: "heading-xl" })}>Cloudflare Access</h1>
            <p className={style({ font: "body", color: "gray-700" })}>
              {accessError || "Sign in with Cloudflare Access to continue."}
            </p>
            <Button
              variant="accent"
              onPress={() => window.location.assign("/cdn-cgi/access/login")}
            >
              Sign in with Cloudflare
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
