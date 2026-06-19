import type { Metadata } from 'next';
import './globals.css';
import { ClientShell } from './ClientShell';

export const metadata: Metadata = {
  title: 'Analytics Dashboard',
  description: 'Business analytics and reporting dashboard',
};

const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=document.documentElement;if(t==='dark'){d.classList.remove('light');d.classList.add('dark');}else{d.classList.remove('dark');d.classList.add('light');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}
