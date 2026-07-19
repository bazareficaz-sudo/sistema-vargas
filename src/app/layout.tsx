import type { Metadata } from "next";
import { Inter } from "next/font/google";
import GlobalLoadingIndicator from "@/components/GlobalLoadingIndicator";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sistema Vargas — Gestão",
  description: "Plataforma de gestão comercial",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var v=localStorage.getItem('layout_menu');if(v==='topbar')document.documentElement.dataset.layoutMenu='topbar'}catch(e){}`,
          }}
        />
        {children}
        <GlobalLoadingIndicator />
      </body>
    </html>
  );
}
