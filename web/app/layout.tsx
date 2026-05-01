import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Orchid — AI Conversation Context',
  description:
    'See the conversations behind your code. Orchid captures AI coding sessions and makes them available to reviewers, teammates, and agents.',
  icons: {
    icon: '/orchid.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body
        className="h-full"
        style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
      >
        {children}
      </body>
    </html>
  );
}
