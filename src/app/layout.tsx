import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Самоход — робот, который сам ведёт рекламу в Яндексе и VK",
  description: "Расскажите о бизнесе, выберите бюджет — сервис сам запустит и будет вести рекламу в Яндексе и ВКонтакте.",
};

export const viewport: Viewport = { themeColor: "#f5f6fa", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
