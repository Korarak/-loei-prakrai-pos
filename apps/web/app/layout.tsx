import type { Metadata, Viewport } from 'next';
import { Anuphan, IBM_Plex_Sans_Thai } from 'next/font/google';
import { ConfirmProvider } from '@/lib/dialog';
import './globals.css';

const body = IBM_Plex_Sans_Thai({ subsets: ['thai', 'latin'], weight: ['400', '500', '600', '700'], variable: '--font-body' });
const display = Anuphan({ subsets: ['thai', 'latin'], weight: ['600', '700'], variable: '--font-display' });

export const metadata: Metadata = { title: 'ประกาย POS', description: 'ระบบขายหน้าร้านสำหรับร้านอาหาร' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#17784A' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${body.variable} ${display.variable}`}>
      <body><ConfirmProvider>{children}</ConfirmProvider></body>
    </html>
  );
}
