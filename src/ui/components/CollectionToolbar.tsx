import { Tabs, TabList, Tab, TabPanel } from "@react-spectrum/s2/Tabs";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };

export type CollectionView = "all" | "unread" | "archived";

interface Props {
  view: CollectionView;
  onViewChange: (next: CollectionView) => void;
  isNarrow?: boolean;
  count?: number;
}

export function CollectionToolbar({ view, onViewChange, isNarrow = false, count }: Props) {
  return (
    <div className={style({ display: "flex", flexDirection: "column", gap: 8, width: "full" })}>
      <div
        className={style({
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "center",
          justifyContent: "space-between",
          width: "full",
        })}
      >
        {isNarrow ? (
          <Tabs
            aria-label="Bookmark collections"
            selectedKey={view}
            onSelectionChange={(key) => onViewChange(key as CollectionView)}
            density="compact"
          >
            <TabList aria-label="Bookmark collections">
              <Tab id="all">All</Tab>
              <Tab id="unread">Unread</Tab>
              <Tab id="archived">Archived</Tab>
            </TabList>
            <TabPanel id="all">{null}</TabPanel>
            <TabPanel id="unread">{null}</TabPanel>
            <TabPanel id="archived">{null}</TabPanel>
          </Tabs>
        ) : (
          <h1 className={style({ font: "heading-lg", margin: 0 })}>
            {view === "all" ? "Bookmarks" : view === "unread" ? "Unread" : "Archived"}
          </h1>
        )}
        <div
          className={style({ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" })}
        >
          <span className={style({ font: "detail", color: "gray-700" })} aria-live="polite">
            {count === undefined ? "Loading…" : `${count.toLocaleString("en-US")} Bookmarks`}
          </span>
        </div>
      </div>
    </div>
  );
}
