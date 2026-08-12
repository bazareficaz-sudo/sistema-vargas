import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import GlobalLoadingIndicator from "@/components/GlobalLoadingIndicator";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Sem esta declaração o navegador do celular renderiza a página como se a
// tela tivesse ~980px e depois encolhe tudo — é o que fazia os textos
// saírem minúsculos e exigirem zoom. Não afeta o desktop em nada.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Sem limite de zoom: o operador precisa poder ampliar uma tabela densa,
  // e travar isso é barreira de acessibilidade, não refinamento visual.
  maximumScale: 5,
}

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
