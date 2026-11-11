import { faviconAccent } from "../lib/favicon-accent.js";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { useEffect, useState } from "react";
import {
  getSiteColor,
  normalizeSiteHost,
  siteMonogram,
  trustedSiteIconSrc,
} from "../lib/site-icon.js";

interface SiteIconProps {
  url: string;
  /** Optional trusted same-origin image path; never an arbitrary remote URL. */
  iconSrc?: string | null;
  onAccent?: (accent: number | null | undefined) => void;
  size?: "normal" | "small";
}

/** No external image fetch unless the caller explicitly provides a trusted same-origin path. */
export function SiteIcon({ url, iconSrc, size = "normal", onAccent }: SiteIconProps) {
  const host = normalizeSiteHost(url);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
    onAccent?.(undefined);
  }, [iconSrc, onAccent]);
  const safeSrc = trustedSiteIconSrc(iconSrc ?? null, window.location.origin);

  const dimension = size === "normal" ? 40 : 32;

  return (
    <span
      role="img"
      aria-label={host ? `Website: ${host}` : "Unknown website"}
      className={[
        style({
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "lg",
          flexShrink: 0,
          font: "heading-sm",
          overflow: "hidden",
        }),
        !safeSrc || broken ? style({ backgroundColor: "gray-100", color: "gray-800" }) : "",
      ].join(" ")}
      style={{
        width: dimension,
        height: dimension,
        ...(!safeSrc || broken
          ? { backgroundColor: `hsl(${getSiteColor(host ?? "?").hue} 10% 20%)`, color: "#fff" }
          : {}),
      }}
    >
      {safeSrc && !broken ? (
        <img
          src={safeSrc}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={(event) => {
            try {
              onAccent?.(faviconAccent(host ?? "?", event.currentTarget));
            } catch {
              onAccent?.(undefined);
            }
          }}
          onError={() => {
            setBroken(true);
            onAccent?.(undefined);
          }}
          style={{ width: "80%", height: "80%", objectFit: "contain" }}
        />
      ) : (
        <span aria-hidden="true">{siteMonogram(host || "?")}</span>
      )}
    </span>
  );
}
