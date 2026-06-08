import './globals.css';
import type { ReactNode } from 'react';
import { Fraunces, Inter } from 'next/font/google';
import { UserProvider } from '../lib/useUser';
import { TopNav } from '../components/TopNav';
import { LegalFooter } from '../components/LegalFooter';
import { Secretariat } from '../components/Secretariat';

const display = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const body = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata = {
  title: 'Furlong — Bloodstock Intelligence',
  description: 'Catalog-to-shortlist intelligence for thoroughbred yearling buyers.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Allow zoom for accessibility; cap to avoid layout-breaking over-zoom.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="bg-paper-100 font-sans text-ink antialiased">
        <UserProvider>
          <TopNav />
          {children}
          <LegalFooter />
          <Secretariat />
        </UserProvider>
      </body>
    </html>
  );
}
