import type { Metadata, Viewport } from 'next'
import './globals.css'
import './workspace.css'

export const metadata: Metadata = {
  title: 'Nifunze Bookshop | Retail Operations',
  description: 'A modern point of sale and inventory workspace for Nifunze Bookshop.',
  icons: { icon: '/favicon.png', shortcut: '/favicon.png', apple: '/favicon.png' },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#192b55',
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
