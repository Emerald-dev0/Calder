import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Calder",
    short_name: "Calder",
    description: "Communication infrastructure that gets out of your way.",
    start_url: "/",
    display: "standalone",
    background_color: "#F5F4EF",
    theme_color: "#F5F4EF",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
