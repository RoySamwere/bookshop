import Link from 'next/link'
import type { ReactNode } from 'react'
import { BrandMark } from '../brand-mark'
import { Bookshelf } from '../public/bookshelf'
import { brand } from '../../lib/brand'

/** Two-panel layout shared by sign-in, registration, password recovery and verification. */
export function AuthShell({ story, children, topline }: { story: { title: string; body: string }; children: ReactNode; topline?: ReactNode }) {
  return <main className="hk-auth">
    <aside className="hk-auth-aside">
      <Link href="/" className="hk-brand"><BrandMark size={38} /><span>{brand.name}</span></Link>
      <div className="hk-auth-story">
        <h1>{story.title}</h1>
        <p>{story.body}</p>
      </div>
      <Bookshelf compact />
    </aside>
    <section className="hk-auth-main">
      <div className="hk-auth-topline">{topline ?? <Link href="/">Back to the website</Link>}</div>
      <div className="hk-auth-card">
        <Link href="/" className="hk-brand hk-auth-mobile-brand"><BrandMark size={34} /><span>{brand.name}</span></Link>
        {children}
      </div>
    </section>
  </main>
}

export function AuthHeading({ title, children }: { title: string; children?: ReactNode }) {
  return <>
    <h2 tabIndex={-1}>{title}</h2>
    {children && <p className="hk-auth-lede">{children}</p>}
  </>
}
