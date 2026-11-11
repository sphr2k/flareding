import { Button } from "@react-spectrum/s2/Button";
import { SearchField } from "@react-spectrum/s2/SearchField";
import { SegmentedControl, SegmentedControlItem } from "@react-spectrum/s2/SegmentedControl";
import { Tabs, TabList, Tab, TabPanel } from "@react-spectrum/s2/Tabs";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { useState } from "react";

export type CollectionView = "all" | "unread" | "archived";
export type DisplayMode = "cards" | "list";

interface Props {
  view: CollectionView;
  onViewChange: (next: CollectionView) => void;
  display: DisplayMode;
  isNarrow?: boolean;
  onDisplayChange: (next: DisplayMode) => void;
  count?: number;
  tagFilter: string;
  onTagFilterChange: (value: string) => void;
}

export function CollectionToolbar({
  view,
  onViewChange,
  display,
  isNarrow = false,
  onDisplayChange,
  count,
  tagFilter,
  onTagFilterChange,
}: Props) {
  const [showTagFilter, setShowTagFilter] = useState(false);
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
        <Tabs
          aria-label="Bookmark-Sammlungen"
          selectedKey={view}
          onSelectionChange={(key) => onViewChange(key as CollectionView)}
          density="compact"
        >
          <TabList aria-label="Bookmark-Sammlungen">
            <Tab id="all">Alle</Tab>
            <Tab id="unread">Ungelesen</Tab>
            <Tab id="archived">Archiviert</Tab>
          </TabList>
          <TabPanel id="all">{null}</TabPanel>
          <TabPanel id="unread">{null}</TabPanel>
          <TabPanel id="archived">{null}</TabPanel>
        </Tabs>
        <div
          className={style({ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" })}
        >
          <span className={style({ font: "detail", color: "gray-700" })} aria-live="polite">
            {count === undefined ? "Lade …" : `${count.toLocaleString("de-DE")} Bookmarks`}
          </span>
          <Button variant="secondary" size="S" onPress={() => setShowTagFilter(!showTagFilter)}>
            {tagFilter ? "Tagfilter aktiv" : "Tagfilter"}
          </Button>
          {!isNarrow && (
            <SegmentedControl
              aria-label="Anzeige"
              selectedKey={display}
              onSelectionChange={(key) => onDisplayChange(key as DisplayMode)}
            >
              <SegmentedControlItem id="cards">Kacheln</SegmentedControlItem>
              <SegmentedControlItem id="list">Liste</SegmentedControlItem>
            </SegmentedControl>
          )}
        </div>
      </div>
      {(showTagFilter || tagFilter) && (
        <div className={style({ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" })}>
          <SearchField
            label="Nach Tag filtern"
            placeholder="Exakter Tagname"
            value={tagFilter}
            onChange={onTagFilterChange}
            size="S"
          />
          {tagFilter && (
            <Button variant="secondary" size="S" onPress={() => onTagFilterChange("")}>
              Filter entfernen
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
