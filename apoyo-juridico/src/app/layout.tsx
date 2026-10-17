import type { Metadata } from "next";
// 1. Importamos la fuente Inter optimizada de Google
import { Inter } from "next/font/google";
import "./globals.css";

// 2. La configuramos y creamos una variable CSS
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter"
});

export const metadata: Metadata = {
  title: "Apoyo Jurídico | Dashboard",
  description: "Sistema de Gestión de Expedientes LegalTech",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      {/* 3. Inyectamos la variable de la fuente a todo el body */}
      <body className={`${inter.variable} font-sans antialiased text-slate-800`}>
        {children}
      </body>
    </html>
  );
}