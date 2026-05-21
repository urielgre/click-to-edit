import * as React from "react";
import { ClickToEditProvider } from "click-to-edit";

export const metadata = {
  title: "click-to-edit demo",
  description: "Local dogfood app for the click-to-edit package",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        <ClickToEditProvider>{children}</ClickToEditProvider>
      </body>
    </html>
  );
}
