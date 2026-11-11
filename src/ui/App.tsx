import { Button } from "@react-spectrum/s2/Button";
import { InlineAlert, Heading, Content } from "@react-spectrum/s2/InlineAlert";
import { Provider } from "@react-spectrum/s2/Provider";
import { SearchField } from "@react-spectrum/s2/SearchField";
import { StatusLight } from "@react-spectrum/s2/StatusLight";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };

/**
 * Temporary, non-interactive shell until the authenticated bookmark API ships.
 * All interactive controls are intentionally disabled rather than accepting
 * data without a configured account/session.
 */
export function App() {
  return (
    <Provider locale="de-DE" colorScheme="dark" background="base">
      <div
        className={style({
          display: "flex",
          flexDirection: "column",
          gap: 32,
          padding: 32,
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
          <strong className={style({ fontSize: "heading-xl" })}>flareding</strong>
          <StatusLight variant="neutral">Privater Bookmark-Dienst</StatusLight>
        </header>
        <main
          className={style({
            display: "flex",
            flexDirection: "column",
            gap: 24,
            maxWidth: 900,
          })}
        >
          <div
            className={style({
              display: "flex",
              flexDirection: "column",
              gap: 8,
            })}
          >
            <h1 className={style({ font: "heading-2xl" })}>Deine Bookmarks.</h1>
            <p className={style({ font: "body", color: "gray-700" })}>
              Links speichern, wiederfinden und mit konsistenten Tags organisieren.
            </p>
          </div>
          <div
            className={style({
              display: "flex",
              flexWrap: "wrap",
              alignItems: "end",
              gap: 12,
            })}
          >
            <SearchField
              label="Bookmarks durchsuchen"
              placeholder="Titel, URL oder Tag"
              isDisabled
            />
            <Button variant="accent" isDisabled>
              Bookmark hinzufügen
            </Button>
          </div>
          <InlineAlert variant="informative" fillStyle="subtleFill">
            <Heading>Flareding wird eingerichtet</Heading>
            <Content>
              Die Oberfläche wird mit der Token- und Session-Authentifizierung aktiviert. Bis dahin
              ist kein Zugriff auf gespeicherte Bookmarks oder ungeschützte Schreiboperationen
              möglich.
            </Content>
          </InlineAlert>
        </main>
        <footer className={style({ font: "detail", color: "gray-600" })}>
          Flareding · Cloudflare Workers · SQLite Durable Objects
        </footer>
      </div>
    </Provider>
  );
}
