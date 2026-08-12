import type { Metadata } from 'next';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';
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
        {/* Apply the saved theme before paint (snapshot bag, else data-accent). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var r=document.documentElement;var s=localStorage.getItem('auric.theme.snapshot')||localStorage.getItem('auric.seeming.snapshot');if(s){var bag=JSON.parse(s);for(var k in bag){if(k.indexOf('--')===0&&typeof bag[k]==='string')r.style.setProperty(k,bag[k]);}}else{var a=localStorage.getItem('auric.theme')||localStorage.getItem('auric.seeming')||localStorage.getItem('auric.accent');if(a)r.setAttribute('data-accent',a);}}catch(e){}",
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
