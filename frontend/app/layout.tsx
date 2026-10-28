import type { Metadata, Viewport } from 'next'
import { brand } from '../lib/brand'
import './globals.css'
import './workspace.css'
import './public.css'

export const metadata: Metadata = {
  title: { default: `${brand.name} | Opening soon`, template: `%s | ${brand.name}` },
  description: brand.description,
  icons: { icon: '/favicon.png', shortcut: '/favicon.png', apple: '/favicon.png' },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#13254a',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Loaded by the browser, so offline builds still work; system serif and sans fallbacks apply until it arrives. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Libre+Caslon+Display&display=swap" />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
