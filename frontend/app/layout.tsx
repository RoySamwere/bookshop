import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Nifunze Bookshop | Retail Operations',
  description: 'A modern point of sale and inventory workspace for Nifunze Bookshop.',
  icons: { icon: '/nifunze-favicon.png', shortcut: '/nifunze-favicon.png', apple: '/nifunze-favicon.png' },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f9ff' },
    { media: '(prefers-color-scheme: dark)', color: '#10264e' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        
      </body>
    </html>
  )
}
