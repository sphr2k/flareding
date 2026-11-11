import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { useEffect, useState } from "react";
import { normalizeSiteHost, siteMonogram, siteTone } from "../lib/site-icon.js";

const tones = [
  style({ backgroundColor: "blue-100", color: "blue-900" }),
  style({ backgroundColor: "purple-100", color: "purple-900" }),
  style({ backgroundColor: "green-100", color: "green-900" }),
  style({ backgroundColor: "orange-100", color: "orange-900" }),
  style({ backgroundColor: "turquoise-100", color: "turquoise-900" }),
  style({ backgroundColor: "magenta-100", color: "magenta-900" }),
];

interface SiteIconProps {
  url: string;
  /** Optional trusted same-origin image path; never an arbitrary remote URL. */
  iconSrc?: string | null;
  size?: "normal" | "small";
}

/** No external image fetch unless the caller explicitly provides a trusted same-origin path. */
export function SiteIcon({ url, iconSrc, size = "normal" }: SiteIconProps) {
  const host = normalizeSiteHost(url);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [iconSrc]);
  const safeSrc = iconSrc?.startsWith("/site-icons/") ? iconSrc : null;
  const tone = host ? siteTone(host) : 0;
  const dimension = size === "normal" ? 40 : 32;

  return (
    <span
      role="img"
      aria-label={host ? `Website: ${host}` : "Unbekannte Website"}
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
        tones[tone],
      ].join(" ")}
      style={{ width: dimension, height: dimension }}
    >
      {safeSrc && !broken ? (
        <img
          src={safeSrc}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          style={{ width: "80%", height: "80%", objectFit: "contain" }}
        />
      ) : (
        <span aria-hidden="true">{siteMonogram(host || "?")}</span>
      )}
    </span>
  );
}
