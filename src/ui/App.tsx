import { Button } from "@react-spectrum/s2/Button";
import { InlineAlert, Heading, Content } from "@react-spectrum/s2/InlineAlert";
import { Link } from "@react-spectrum/s2/Link";
import { Provider } from "@react-spectrum/s2/Provider";
import { SearchField } from "@react-spectrum/s2/SearchField";
import { StatusLight } from "@react-spectrum/s2/StatusLight";
import { Tag, TagGroup } from "@react-spectrum/s2/TagGroup";
import { TextField } from "@react-spectrum/s2/TextField";
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

async function getBookmarks(search: string, archived: boolean): Promise<BookmarkPage> {
  const url = new URL(
    archived ? "/api/bookmarks/archived/" : "/api/bookmarks/",
    window.location.origin,
  );
  if (search.trim()) url.searchParams.set("q", search.trim());
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
  const [archived, setArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const { data, isPending, error } = useQuery({
    queryKey: ["bookmarks", search, archived],
    queryFn: () => getBookmarks(search, archived),
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
          onChange={setSearch}
        />
        <Button variant="accent" onPress={() => setAdding(!adding)}>
          {adding ? "Abbrechen" : "Bookmark hinzufügen"}
        </Button>
        <Button variant="secondary" onPress={() => setArchived(!archived)}>
          {archived ? "Gespeicherte anzeigen" : "Archiv anzeigen"}
        </Button>
        <Button variant="secondary" onPress={onLogout}>
          Abmelden
        </Button>
      </div>
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
            {data.count} {archived ? "archivierte" : "gespeicherte"} Bookmarks
          </p>
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
          {data.count === 0 && (
            <InlineAlert variant="informative" fillStyle="subtleFill">
              <Heading>Keine Bookmarks gefunden</Heading>
              <Content>Füge einen Link hinzu oder ändere deine Suchanfrage.</Content>
            </InlineAlert>
          )}
          {data.next && (
            <p className={style({ font: "detail", color: "gray-700" })}>
              Weitere Einträge sind über die paginierte API verfügbar.
            </p>
          )}
        </section>
      )}
    </main>
  );
}

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/session/", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return false;
        const data = (await response.json()) as { authenticated: boolean };
        return data.authenticated;
      })
      .then((ready) => {
        if (active) setAuthenticated(ready);
      })
      .catch(() => {
        if (active) setAuthenticated(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function logout() {
    await fetch("/api/session/", { method: "DELETE", credentials: "same-origin" });
    setAuthenticated(false);
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
