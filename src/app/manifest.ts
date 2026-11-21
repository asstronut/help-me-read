import type { MetadataRoute } from "next";

// Makes the app installable (the install icon in Chrome/Edge's address bar).
// The colours are the sepia `bg` token and the icon's ink: a manifest can't read CSS variables.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Help Me Read",
    short_name: "Help Me Read",
    description: "A single-user reader with AI actions",
    start_url: "/library",
    display: "standalone",
    background_color: "#f4ecd8",
    theme_color: "#f4ecd8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
