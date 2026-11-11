import { useState } from "react";
import { Card, Content, Footer, Text } from "@react-spectrum/s2/CardView";
import { ActionMenu, MenuItem } from "@react-spectrum/s2/ActionMenu";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import type { BookmarkDTO } from "../../api/bookmark-contract.js";
import { SiteIcon } from "./SiteIcon.js";
import { normalizeSiteHost, siteCardBackground } from "../lib/site-icon.js";

interface Props {
  bookmark: BookmarkDTO;
  onEdit: (bookmark: BookmarkDTO) => void;
  onToggleArchive: (bookmark: BookmarkDTO) => void;
  isPending?: boolean;
}

export function BookmarkCard({ bookmark, onEdit, onToggleArchive, isPending = false }: Props) {
  const [accent, setAccent] = useState<number | null | undefined>(undefined);
  const host = normalizeSiteHost(bookmark.url) ?? "Unknown website";
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
      UNSAFE_style={{ backgroundImage: siteCardBackground(host, accent) }}
    >
      <Content styles={style({ paddingBottom: 0 })}>
        <Text
          slot="title"
          styles={style({
            display: "flex",
            gap: 12,
            alignItems: "start",
            minWidth: 0,
          })}
        >
          <SiteIcon url={bookmark.url} iconSrc={bookmark.favicon_url} onAccent={setAccent} />
          <span
            className={style({
              display: "flex",
              flexDirection: "column",
              gap: 4,
              minWidth: 0,
              flexGrow: 1,
            })}
          >
            <span className={style({ lineClamp: 3, overflowWrap: "anywhere" })}>{title}</span>
            <span className={style({ font: "detail", color: "gray-700" })}>{host}</span>
          </span>
        </Text>
        <ActionMenu
          styles={style({ alignSelf: "start", marginTop: 8, marginBottom: 0 })}
          aria-label={`Actions for ${title}`}
          size="S"
          isDisabled={isPending}
          onAction={(key) => {
            if (key === "edit") onEdit(bookmark);
            if (key === "archive") onToggleArchive(bookmark);
          }}
        >
          <MenuItem id="edit">Edit</MenuItem>
          <MenuItem id="archive">{bookmark.is_archived ? "Unarchive" : "Archive"}</MenuItem>
        </ActionMenu>
        {bookmark.description && <Text slot="description">{bookmark.description}</Text>}
      </Content>
      {bookmark.tag_names.length > 0 && (
        <Footer styles={style({ paddingTop: 8 })}>
          <span className={style({ font: "detail", color: "gray-700" })}>
            {bookmark.tag_names.slice(0, 3).join(" · ")}
            {bookmark.tag_names.length > 3 ? ` +${bookmark.tag_names.length - 3}` : ""}
          </span>
        </Footer>
      )}
    </Card>
  );
}
