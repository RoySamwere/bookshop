import type { Metadata } from 'next'
import Link from 'next/link'
import { BrandMark } from '../../components/brand-mark'
import { brand } from '../../lib/brand'

export const metadata: Metadata = { title: 'Terms of use' }

/** Plain-language account terms. Review with the business before the public launch. */
export default function TermsPage() {
  return <div className="hk-page">
    <header className="hk-header">
      <div className="hk-wrap hk-header-row">
        <Link href="/" className="hk-brand"><BrandMark size={38} /><span>{brand.name}</span></Link>
        <nav className="hk-header-nav" aria-label="Account"><Link className="hk-header-cta" href="/register">Create an account</Link></nav>
      </div>
    </header>
    <main className="hk-wrap">
      <article className="hk-legal">
        <h1>Terms of use</h1>
        <p>These terms cover accounts on the {brand.name} website while we prepare to open. We will update them before online ordering starts, and tell account holders when we do.</p>

        <h2>Your account</h2>
        <p>Give accurate details when you register and keep your password private. You are responsible for activity on your account. Tell us straight away if you think someone else has used it.</p>

        <h2>Staff access</h2>
        <p>Asking for staff access does not grant it. An administrator reviews every request and may approve it with a specific role or decline it. Staff access may be changed or withdrawn at any time.</p>

        <h2>How we use your information</h2>
        <ul>
          <li>Your name, email address and optional phone number are used to run your account and contact you about it.</li>
          <li>If you join the launch list, your email address is used only to tell you about our opening.</li>
          <li>We record sign-ins and account changes to keep accounts secure.</li>
        </ul>

        <h2>Closing your account</h2>
        <p>An administrator may deactivate accounts that break these terms or that are used to harm others. You can ask us to close your account at any time.</p>

        <p className="mt-10"><Link href="/" className="hk-auth-link">Back to the website</Link></p>
      </article>
    </main>
  </div>
}
