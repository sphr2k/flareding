import ViewGridFluid from "@react-spectrum/s2/icons/ViewGridFluid";
import ViewList from "@react-spectrum/s2/icons/ViewList";
import { Tooltip, TooltipTrigger } from "@react-spectrum/s2/Tooltip";
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
          <h1 className={style({ font: "heading-xl", margin: 0 })}>
            {view === "all" ? "Bookmarks" : view === "unread" ? "Unread" : "Archived"}
          </h1>
        )}
        <div
          className={style({ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" })}
        >
          <span className={style({ font: "detail", color: "gray-700" })} aria-live="polite">
            {count === undefined ? "Loading…" : `${count.toLocaleString("en-US")} Bookmarks`}
          </span>
          <Button variant="secondary" size="S" onPress={() => setShowTagFilter(!showTagFilter)}>
            {tagFilter ? "Tag filter active" : "Tag filter"}
          </Button>
          {!isNarrow && (
            <SegmentedControl
              aria-label="View"
              selectedKey={display}
              onSelectionChange={(key) => onDisplayChange(key as DisplayMode)}
            >
              <TooltipTrigger>
                <SegmentedControlItem id="cards" aria-label="Cards">
                  <ViewGridFluid />
                </SegmentedControlItem>
                <Tooltip>Cards</Tooltip>
              </TooltipTrigger>
              <TooltipTrigger>
                <SegmentedControlItem id="list" aria-label="List">
                  <ViewList />
                </SegmentedControlItem>
                <Tooltip>List</Tooltip>
              </TooltipTrigger>
            </SegmentedControl>
          )}
        </div>
      </div>
      {(showTagFilter || tagFilter) && (
        <div className={style({ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" })}>
          <SearchField
            label="Filter by tag"
            placeholder="Exact tag name"
            value={tagFilter}
            onChange={onTagFilterChange}
            size="S"
          />
          {tagFilter && (
            <Button variant="secondary" size="S" onPress={() => onTagFilterChange("")}>
              Clear filter
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
