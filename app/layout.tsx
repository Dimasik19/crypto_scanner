import "./globals.css";
import Script from "next/script";

export const metadata = {
  title: "Value Growth Tool",
  description: "BTC and ETH base asset accumulation strategy for altcoin pairs"
};

const themeScript = `
try {
  var theme = localStorage.getItem("asset-cycle-theme") === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
} catch {}
`;

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
