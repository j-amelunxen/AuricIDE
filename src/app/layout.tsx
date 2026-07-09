import type { Metadata } from 'next';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import 'material-symbols/outlined.css';
import './globals.css';
import { CrashBoundary, GlobalErrorHandlers } from './components/CrashBoundary';

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
        {/* Apply the saved accent before paint so there's no purple flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var a=localStorage.getItem('auric.accent');if(a)document.documentElement.setAttribute('data-accent',a)}catch(e){}",
          }}
        />
      </head>
      <body className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} subpixel-antialiased`}>
        <GlobalErrorHandlers />
        <CrashBoundary>{children}</CrashBoundary>
      </body>
    </html>
  );
}
