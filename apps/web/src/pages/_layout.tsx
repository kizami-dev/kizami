import type { ReactNode } from "react";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/header.css";
import "../styles/login.css";
import "../styles/punch-home.css";
import "../styles/monthly.css";
import "../styles/corrections.css";
import "../styles/notifications.css";
import "../styles/settings.css";
import "../styles/org-settings.css";

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>KIZAMI</title>
      <meta name="description" content="1分単位で時を刻む勤怠管理。" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Shippori+Antique+B1&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
      />
      {children}
    </>
  );
}

export const getConfig = async () => {
  return { render: "static" } as const;
};
