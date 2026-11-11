import { Button } from "@react-spectrum/s2/Button";
import { ToggleButtonGroup } from "@react-spectrum/s2/ToggleButtonGroup";
import { ToggleButton } from "@react-spectrum/s2/ToggleButton";
import { Tooltip, TooltipTrigger } from "@react-spectrum/s2/Tooltip";
import Add from "@react-spectrum/s2/icons/Add";
import Bookmark from "@react-spectrum/s2/icons/Bookmark";
import Email from "@react-spectrum/s2/icons/Email";
import Archive from "@react-spectrum/s2/icons/Archive";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import type { CollectionView } from "./CollectionToolbar.js";

export function CollectionNavigation({
  view,
  onViewChange,
  onAdd,
}: {
  view: CollectionView;
  onViewChange: (view: CollectionView) => void;
  onAdd: () => void;
}) {
  return (
    <nav
      aria-label="Bookmark collections"
      className={style({
        gridArea: "sidebar",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        paddingX: 12,
        paddingBottom: 16,
      })}
    >
      <TooltipTrigger placement="end">
        <Button variant="accent" size="L" aria-label="Add bookmark" onPress={onAdd}>
          <Add />
        </Button>
        <Tooltip>Add bookmark</Tooltip>
      </TooltipTrigger>
      <ToggleButtonGroup
        aria-label="Collections"
        orientation="vertical"
        size="L"
        isQuiet
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[view]}
        onSelectionChange={(keys) => {
          const key = [...keys][0];
          if (key) onViewChange(key as CollectionView);
        }}
      >
        <TooltipTrigger placement="end">
          <ToggleButton id="all" aria-label="All">
            <Bookmark />
          </ToggleButton>
          <Tooltip>All bookmarks</Tooltip>
        </TooltipTrigger>
        <TooltipTrigger placement="end">
          <ToggleButton id="unread" aria-label="Unread">
            <Email />
          </ToggleButton>
          <Tooltip>Unread</Tooltip>
        </TooltipTrigger>
        <TooltipTrigger placement="end">
          <ToggleButton id="archived" aria-label="Archived">
            <Archive />
          </ToggleButton>
          <Tooltip>Archived</Tooltip>
        </TooltipTrigger>
      </ToggleButtonGroup>
    </nav>
  );
}
