import { Button } from "@react-spectrum/s2/Button";
import {
  CardView,
  Card,
  Content as CardContent,
  Text as CardText,
  Footer,
} from "@react-spectrum/s2/CardView";
import { ActionMenu, MenuItem } from "@react-spectrum/s2/ActionMenu";
import { InlineAlert, Heading, Content } from "@react-spectrum/s2/InlineAlert";
import { Link } from "@react-spectrum/s2/Link";
import { Provider } from "@react-spectrum/s2/Provider";
import { SearchField } from "@react-spectrum/s2/SearchField";
import { StatusLight } from "@react-spectrum/s2/StatusLight";
import { Tag, TagGroup } from "@react-spectrum/s2/TagGroup";
import { TextField } from "@react-spectrum/s2/TextField";
import { Tabs, TabList, Tab, TabPanel } from "@react-spectrum/s2/Tabs";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  const [search, setSearch] = useState("");
  const [view, setView] = useState<BookmarkView>("all");
  const [tagFilter, setTagFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const debouncedTag = useDebouncedValue(tagFilter);
  const [display, setDisplay] = useState<"cards" | "list">("cards");
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const { data, isPending, error } = useQuery({
    queryKey: ["bookmarks", debouncedSearch, view, debouncedTag, offset],
    queryFn: () => getBookmarks(debouncedSearch, view, debouncedTag, offset),
    staleTime: 15_000,
  });
  const create = useMutation({
    mutationFn: async () =>
      sendBookmark("POST", "/api/bookmarks/", {
        url,
        title,
        tag_names: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      }),
    onSuccess: async () => {
      setUrl("");
      setTitle("");
      setTags("");
      setAdding(false);
      await cache.invalidateQueries({ queryKey: ["bookmarks"] });
    },
  });
  const archive = useMutation({
    mutationFn: async ({ id, isArchived }: { id: number; isArchived: boolean }) =>
      sendBookmark("POST", `/api/bookmarks/${id}/${isArchived ? "unarchive" : "archive"}/`),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["bookmarks"] });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <main className={style({ display: "flex", flexDirection: "column", gap: 24, maxWidth: 1000 })}>
      <div className={style({ display: "flex", flexDirection: "column", gap: 8 })}>
        <h1 className={style({ font: "heading-2xl", margin: 0 })}>Deine Bookmarks.</h1>
        <p className={style({ font: "body", color: "gray-700", margin: 0 })}>
          Links speichern, durchsuchen und mit Tags organisieren.
        </p>
      </div>
      <div className={style({ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 12 })}>
        <SearchField
          label="Bookmarks durchsuchen"
          placeholder="Titel, URL oder Beschreibung"
          value={search}
          onChange={(value) => {
            setSearch(value);
            setOffset(0);
          }}
        />
        <Button variant="accent" onPress={() => setAdding(!adding)}>
          {adding ? "Abbrechen" : "Bookmark hinzufügen"}
        </Button>
        <SearchField
          label="Tag"
          placeholder="Exakter Tagname"
          value={tagFilter}
          onChange={(value) => {
            setTagFilter(value);
            setOffset(0);
          }}
        />
        <Button
          variant="secondary"
          onPress={() => setDisplay(display === "cards" ? "list" : "cards")}
        >
          {display === "cards" ? "Listenansicht" : "Kachelansicht"}
        </Button>
        <Button variant="secondary" onPress={onLogout}>
          Abmelden
        </Button>
      </div>
      <Tabs
        aria-label="Bookmark-Sammlungen"
        selectedKey={view}
        onSelectionChange={(key) => {
          setView(key as BookmarkView);
          setOffset(0);
        }}
        density="compact"
      >
        <TabList aria-label="Bookmark-Sammlungen">
          <Tab id="all">Alle</Tab>
          <Tab id="unread">Ungelesen</Tab>
          <Tab id="archived">Archiviert</Tab>
        </TabList>
        <TabPanel id="all">Gespeicherte Bookmarks</TabPanel>
        <TabPanel id="unread">Noch nicht gelesene Bookmarks</TabPanel>
        <TabPanel id="archived">Archivierte Bookmarks</TabPanel>
      </Tabs>
      {adding && (
        <form
          onSubmit={submit}
          className={style({
            display: "flex",
            flexDirection: "column",
            gap: 16,
            backgroundColor: "layer-1",
            borderRadius: "lg",
            padding: 24,
          })}
        >
          <h2 className={style({ font: "heading-lg", margin: 0 })}>Neuer Bookmark</h2>
          <TextField label="URL" type="url" value={url} onChange={setUrl} isRequired />
          <TextField label="Titel" value={title} onChange={setTitle} />
          <TextField label="Tags (kommagetrennt)" value={tags} onChange={setTags} />
          <div>
            <Button
              variant="accent"
              type="submit"
              isPending={create.isPending}
              isDisabled={!url.trim()}
            >
              Speichern
            </Button>
          </div>
          {create.error && (
            <InlineAlert variant="negative">
              <Heading>Speichern fehlgeschlagen</Heading>
              <Content>{create.error.message}</Content>
            </InlineAlert>
          )}
        </form>
      )}
      {error && (
        <InlineAlert variant="negative">
          <Heading>Bookmarks konnten nicht geladen werden</Heading>
          <Content>{error.message}</Content>
        </InlineAlert>
      )}
      {isPending && <StatusLight variant="informative">Lade Bookmarks …</StatusLight>}
      {data && (
        <section className={style({ display: "flex", flexDirection: "column", gap: 12 })}>
          <p className={style({ font: "detail", color: "gray-700", margin: 0 })}>
            {data.count}{" "}
            {view === "archived"
              ? "archivierte"
              : view === "unread"
                ? "ungelesene"
                : "gespeicherte"}{" "}
            Bookmarks
          </p>
          {display === "cards" ? (
            <CardView
              aria-label="Gespeicherte Bookmarks"
              layout="grid"
              size="S"
              density="compact"
              variant="secondary"
              items={data.results}
              dependencies={[view, archive.isPending]}
              styles={style({ width: "full" })}
            >
              {(bookmark) => {
                let domain = "";
                try {
                  domain = new URL(bookmark.url).hostname;
                } catch {
                  domain = "Unbekannte Adresse";
                }
                const safe = /^https?:\/\//i.test(bookmark.url);
                return (
                  <Card
                    id={bookmark.id}
                    textValue={bookmark.title || bookmark.url}
                    {...(safe
                      ? { href: bookmark.url, target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    <CardContent>
                      <CardText slot="title">{bookmark.title || bookmark.url}</CardText>
                      <ActionMenu
                        onAction={(key) => {
                          if (key === "archive")
                            archive.mutate({
                              id: bookmark.id,
                              isArchived: bookmark.is_archived,
                            });
                        }}
                      >
                        <MenuItem id="archive">
                          {bookmark.is_archived ? "Wiederherstellen" : "Archivieren"}
                        </MenuItem>
                      </ActionMenu>
                      <CardText slot="description">
                        {domain}
                        {bookmark.description ? ` · ${bookmark.description.slice(0, 130)}` : ""}
                      </CardText>
                    </CardContent>
                    <Footer>
                      <span>
                        {bookmark.tag_names.slice(0, 3).join(" · ")}
                        {bookmark.tag_names.length > 3 ? ` +${bookmark.tag_names.length - 3}` : ""}
                      </span>
                    </Footer>
                  </Card>
                );
              }}
            </CardView>
          ) : (
            <div className={style({ display: "flex", flexDirection: "column", gap: 12 })}>
              {data.results.map((bookmark) => (
                <article
                  key={bookmark.id}
                  className={style({
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    backgroundColor: "layer-1",
                    borderRadius: "lg",
                    padding: 20,
                  })}
                >
                  <div
                    className={style({
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    })}
                  >
                    <div className={style({ display: "flex", flexDirection: "column", gap: 4 })}>
                      <h2 className={style({ font: "heading-sm", margin: 0 })}>
                        <Link href={bookmark.url} target="_blank" rel="noopener noreferrer">
                          {bookmark.title || bookmark.url}
                        </Link>
                      </h2>
                      <p className={style({ font: "detail", color: "gray-700", margin: 0 })}>
                        {bookmark.url}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      onPress={() =>
                        archive.mutate({ id: bookmark.id, isArchived: bookmark.is_archived })
                      }
                      isDisabled={archive.isPending}
                    >
                      {bookmark.is_archived ? "Wiederherstellen" : "Archivieren"}
                    </Button>
                  </div>
                  {bookmark.description && (
                    <p className={style({ font: "body-sm", margin: 0 })}>{bookmark.description}</p>
                  )}
                  {bookmark.tag_names.length > 0 && (
                    <TagGroup
                      label="Tags"
                      items={bookmark.tag_names.map((name) => ({ id: name, name }))}
                    >
                      {(item) => <Tag>{item.name}</Tag>}
                    </TagGroup>
                  )}
                </article>
              ))}
            </div>
          )}
          {data.count === 0 && (
            <InlineAlert variant="informative" fillStyle="subtleFill">
              <Heading>Keine Bookmarks gefunden</Heading>
              <Content>Füge einen Link hinzu oder ändere deine Suchanfrage.</Content>
            </InlineAlert>
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
          gap: 32,
          padding: 32,
          minHeight: "100dvh",
          boxSizing: "border-box",
        })}
      >
        <header
          className={style({
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "center",
            justifyContent: "space-between",
          })}
        >
          <strong className={style({ font: "heading-xl" })}>flareding</strong>
          <StatusLight variant="neutral">Privater Bookmark-Dienst</StatusLight>
        </header>
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
        <footer className={style({ font: "detail", color: "gray-600" })}>
          Flareding · Cloudflare Workers · SQLite Durable Objects
        </footer>
      </div>
    </Provider>
  );
}
