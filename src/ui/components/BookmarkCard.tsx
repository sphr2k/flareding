import { Card, Content, Footer, Text } from "@react-spectrum/s2/CardView";
import { ActionMenu, MenuItem } from "@react-spectrum/s2/ActionMenu";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import type { BookmarkDTO } from "../../api/bookmark-contract.js";
import { SiteIcon } from "./SiteIcon.js";
import { normalizeSiteHost } from "../lib/site-icon.js";

interface Props {
  bookmark: BookmarkDTO;
  onToggleArchive: (bookmark: BookmarkDTO) => void;
  isPending?: boolean;
}

export function BookmarkCard({ bookmark, onToggleArchive, isPending = false }: Props) {
  const host = normalizeSiteHost(bookmark.url) ?? "Unbekannte Website";
  const title = bookmark.title || bookmark.url;

  return (
    <Card
      id={bookmark.id}
      textValue={title}
      href={bookmark.url}
      target="_blank"
      rel="noopener noreferrer"
      size="XL"
      density="compact"
      variant="secondary"
    >
      <Content>
        <div
          className={style({
            display: "flex",
            gap: 12,
            alignItems: "start",
            minWidth: 0,
          })}
        >
          <SiteIcon url={bookmark.url} />
          <div
            className={style({
              display: "flex",
              flexDirection: "column",
              gap: 4,
              minWidth: 0,
              flexGrow: 1,
            })}
          >
            <Text slot="title">{title}</Text>
            <span className={style({ font: "detail", color: "gray-700" })}>{host}</span>
          </div>
          <ActionMenu
            aria-label={`Aktionen für ${title}`}
            size="S"
            isDisabled={isPending}
            onAction={(key) => {
              if (key === "archive") onToggleArchive(bookmark);
            }}
          >
            <MenuItem id="archive">
              {bookmark.is_archived ? "Wiederherstellen" : "Archivieren"}
            </MenuItem>
          </ActionMenu>
        </div>
        {bookmark.description && (
          <Text slot="description">{bookmark.description.slice(0, 220)}</Text>
        )}
      </Content>
      {bookmark.tag_names.length > 0 && (
        <Footer>
          <span className={style({ font: "detail", color: "gray-700" })}>
            {bookmark.tag_names.slice(0, 3).join(" · ")}
            {bookmark.tag_names.length > 3 ? ` +${bookmark.tag_names.length - 3}` : ""}
          </span>
        </Footer>
      )}
    </Card>
  );
}
