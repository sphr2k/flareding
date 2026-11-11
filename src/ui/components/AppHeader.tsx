import { ActionMenu, MenuItem } from "@react-spectrum/s2/ActionMenu";
import { SearchField } from "@react-spectrum/s2/SearchField";
import type { TextFieldRef } from "@react-spectrum/s2/TextField";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import type { RefObject } from "react";
import { AddBookmarkDialog } from "./AddBookmarkDialog.js";

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  searchRef: RefObject<TextFieldRef<HTMLInputElement> | null>;
  isAddOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
  onCreate: (input: { url: string; title: string; tag_names: string[] }) => Promise<void>;
  onLogout: () => void;
}

export function AppHeader({
  search,
  onSearchChange,
  searchRef,
  isAddOpen,
  onAddOpenChange,
  onCreate,
  onLogout,
}: Props) {
  return (
    <header className={`flareding-app-header ${style({ paddingY: 8, width: "full" })}`}>
      <strong className={style({ font: "heading-sm", flexShrink: 0 })}>flareding</strong>
      <div className="flareding-header-search">
        <SearchField
          label="Bookmarks durchsuchen"
          placeholder="Titel, URL oder Beschreibung …"
          value={search}
          onChange={onSearchChange}
          ref={searchRef}
          styles={style({ width: "full" })}
        />
      </div>
      <AddBookmarkDialog isOpen={isAddOpen} onOpenChange={onAddOpenChange} onCreate={onCreate} />
      <ActionMenu
        aria-label="Konto und Einstellungen"
        size="M"
        onAction={(key) => {
          if (key === "logout") onLogout();
        }}
      >
        <MenuItem id="logout">Abmelden</MenuItem>
      </ActionMenu>
    </header>
  );
}
