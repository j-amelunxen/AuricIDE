import type { Metadata } from 'next';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { CrashBoundary, GlobalErrorHandlers } from './components/CrashBoundary';
import { FreezeProbe } from './components/FreezeProbe';
import { SharedPrefsGate } from './components/SharedPrefsGate';
import { WdioTauriBridge } from './components/WdioTauriBridge';
import { TITLEBAR_BOOT_SCRIPT } from '@/lib/platform/titlebar';
import { THEME_BOOT_SCRIPT } from '@/lib/theme/catalog/storage';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AuricIDE',
  description: 'AI-native Markdown editor',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        {/* Apply the saved theme before paint (snapshot bag, else data-accent). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {/* Reserve the traffic lights' gutter before the header first paints,
            so the logo is never drawn underneath them for a frame. */}
        <script dangerouslySetInnerHTML={{ __html: TITLEBAR_BOOT_SCRIPT }} />
      </head>
      <body className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} subpixel-antialiased`}>
        <WdioTauriBridge />
        <GlobalErrorHandlers />
        <FreezeProbe />
        <CrashBoundary>
          <SharedPrefsGate>{children}</SharedPrefsGate>
        </CrashBoundary>
      </body>
    </html>
  );
}
