import type { MetadataRoute } from "next";

// Makes the app installable to a phone's home screen. The team uses this daily
// in the field; an installed app opens straight to the attendance screen and
// keeps working through a dead spot (see public/sw.js).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "נוכחות — מעלה גמלא",
    short_name: "נוכחות",
    description: "מערכת סימון נוכחות לחינוך הבלתי פורמלי",
    start_url: "/events",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8fafc",
    theme_color: "#0f172a",
    lang: "he",
    dir: "rtl",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Android crops maskable icons to its own shape; the check is inside the
      // safe area so it survives the crop.
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
