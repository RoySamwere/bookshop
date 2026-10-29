import { Link } from 'react-router-dom'
import { BrandMark } from '../components/brand-mark'
import { Bookshelf } from '../components/public/bookshelf'
import { LaunchSignup } from '../components/public/launch-signup'
import { LegacyLinkRedirect } from '../components/public/legacy-link-redirect'
import { brand, featuredCategories, hasContactDetails } from '../lib/brand'

export default function ComingSoonPage() {
  const year = new Date().getFullYear()
  const { contact } = brand

  return <div className="hk-page">
    <LegacyLinkRedirect />
    <a className="hk-skip" href="#main">Skip to content</a>

    <header className="hk-header">
      <div className="hk-wrap hk-header-row">
        <Link to="/" className="hk-brand" aria-label={`${brand.name} home`}>
          <BrandMark size={38} />
          <span>{brand.name}</span>
        </Link>
        <nav className="hk-header-nav" aria-label="Page sections">
          <a href="#categories">What we&apos;ll stock</a>
          <a href="#contact">Contact</a>
          <a className="hk-header-cta" href="#notify-email">Get launch news</a>
        </nav>
      </div>
    </header>

    <main id="main">
      <section className="hk-hero" aria-labelledby="hero-title">
        <div className="hk-wrap hk-hero-grid">
          <div className="hk-hero-copy">
            <p className="hk-status"><span className="hk-status-dot" aria-hidden="true" /> Opening soon</p>
            <h1 id="hero-title" className="hk-hero-title">A new home for books and learning is almost ready.</h1>
            <p className="hk-hero-lede">
              {brand.name} will offer books, learning materials and educational resources for students, teachers,
              parents and everyday readers. We are stocking the shelves now.
            </p>
            <LaunchSignup id="notify" />
          </div>
          <div className="hk-hero-art">
            <Bookshelf />
          </div>
        </div>
      </section>

      <section id="categories" className="hk-section" aria-labelledby="categories-title">
        <div className="hk-wrap hk-categories">
          <div className="hk-section-intro">
            <h2 id="categories-title" className="hk-section-title">What you&apos;ll find on our shelves</h2>
            <p>Five sections to start with, from the books on a school list to the pens that go with them. Online ordering will follow the opening.</p>
          </div>
          <ul className="hk-category-list">
            {featuredCategories.map(category => <li key={category.slug} className="hk-category">
              <span className={`hk-category-spine hk-tone-${category.tone}`} aria-hidden="true" />
              <div>
                <h3>{category.name}</h3>
                <p>{category.description}</p>
              </div>
            </li>)}
          </ul>
        </div>
      </section>

      <section id="contact" className="hk-section hk-section-alt" aria-labelledby="contact-title">
        <div className="hk-wrap hk-contact">
          <div className="hk-section-intro">
            <h2 id="contact-title" className="hk-section-title">Contact</h2>
            {hasContactDetails
              ? <p>Questions before we open? Reach us here.</p>
              : <p>Our phone number, email and shop location will be published here before we open. Join the launch list above to hear first.</p>}
          </div>
          {hasContactDetails && <dl className="hk-contact-list">
            {contact.email && <div><dt>Email</dt><dd><a href={`mailto:${contact.email}`}>{contact.email}</a></dd></div>}
            {contact.phone && <div><dt>Phone</dt><dd><a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}>{contact.phone}</a></dd></div>}
            {contact.whatsapp && <div><dt>WhatsApp</dt><dd><a href={`https://wa.me/${contact.whatsapp.replace(/\D/g, '')}`} rel="noopener noreferrer" target="_blank">{contact.whatsapp}</a></dd></div>}
            {contact.address && <div><dt>Visit</dt><dd>{contact.address}</dd></div>}
            {contact.hours && <div><dt>Hours</dt><dd>{contact.hours}</dd></div>}
          </dl>}
        </div>
      </section>
    </main>

    <footer className="hk-footer">
      <div className="hk-wrap hk-footer-grid">
        <div className="hk-footer-brand">
          <Link to="/" className="hk-brand hk-brand-light"><BrandMark size={34} /><span>{brand.name}</span></Link>
          <p>{brand.description}</p>
        </div>
        <nav className="hk-footer-nav" aria-label="Footer">
          <a href="#categories">What we&apos;ll stock</a>
          <a href="#notify-email">Launch news</a>
          <a href="#contact">Contact</a>
          <Link to="/terms">Terms of use</Link>
        </nav>
        <div className="hk-footer-staff">
          <p>Working at {brand.shortName}?</p>
          <Link to="/login" className="hk-staff-link">Bookshop Management System</Link>
        </div>
      </div>
      <div className="hk-wrap hk-footer-legal">© {year} {brand.name}. All rights reserved.</div>
    </footer>
  </div>
}
