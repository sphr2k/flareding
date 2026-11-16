import type { TextFieldRef } from "@react-spectrum/s2/TextField";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import type { RefObject } from "react";
import { Button } from "@react-spectrum/s2/Button";
import { ActionMenu, MenuItem } from "@react-spectrum/s2/ActionMenu";
import { UnifiedSearch } from "./UnifiedSearch.js";

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  searchRef: RefObject<TextFieldRef<HTMLInputElement> | null>;
  onAddOpenChange: (open: boolean) => void;
  isNarrow: boolean;
  onLogout: () => void;
  onSettings?: () => void;
}

export function AppHeader({
  search,
  onSearchChange,
  tags,
  onTagsChange,
  searchRef,
  onAddOpenChange,
  onLogout,
  onSettings,
  isNarrow,
}: Props) {
  return (
    <header
      className={style({
        gridArea: "toolbar",
        display: "flex",
        alignItems: "center",
        gap: 12,
        paddingX: 20,
        paddingY: 12,
        boxSizing: "border-box",
        minWidth: 0,
        flexWrap: { default: "wrap", "@media (min-width: 768px)": "nowrap" },
      })}
    >
      <strong
        className={style({
          font: "heading-sm",
          flexShrink: 0,
          marginEnd: { default: "auto", "@media (min-width: 768px)": 0 },
        })}
      >
        flareding
      </strong>
      <div
        className={style({
          display: "flex",
          flexGrow: 1,
          minWidth: 0,
          justifyContent: "center",
          order: { default: 1, "@media (min-width: 768px)": 0 },
          flexBasis: { default: "full", "@media (min-width: 768px)": "auto" },
        })}
      >
        <UnifiedSearch
          query={search}
          onQueryChange={onSearchChange}
          tags={tags}
          onTagsChange={onTagsChange}
          searchRef={searchRef}
        />
      </div>
      {isNarrow && (
        <Button variant="accent" size="S" onPress={() => onAddOpenChange(true)}>
          + Add
        </Button>
      )}
      <ActionMenu
        aria-label="Account"
        size="M"
        onAction={(key) => {
          if (key === "settings") onSettings?.();
          if (key === "logout") onLogout();
        }}
      >
        {onSettings && <MenuItem id="settings">Settings</MenuItem>}
        <MenuItem id="logout">Logout</MenuItem>
      </ActionMenu>
    </header>
  );
}
