import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Calder",
    short_name: "Calder",
    description: "Communication infrastructure for the applications you build.",
    start_url: "/",
    display: "standalone",
    background_color: "#0B0C0E",
    theme_color: "#F5F4EF",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
