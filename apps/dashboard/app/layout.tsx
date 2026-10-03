import type { Metadata } from "next";
import "./globals.css";
import {
  ThemeProvider,
  THEME_INIT_SCRIPT,
  ToastProvider,
} from "../components/design-system";

export const metadata: Metadata = {
  title: "Calder — Transactional Email Infrastructure",
  description:
    "Developer-grade email infrastructure: manage domains, scoped API keys, templates, real-time delivery logs, and HMAC webhooks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body style={{ margin: 0 }}>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
