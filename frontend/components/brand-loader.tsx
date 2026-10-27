'use client'

export default function BrandLoader() {
  return <main className="brand-loading-screen" role="status" aria-live="polite" aria-label="Opening Bookshop">
    <div className="brand-loading-content">
      <img className="brand-loading-emblem" src="/nifunze-favicon.png" alt="Bookshop emblem" />
      <div className="brand-fish-stage" aria-hidden="true">
        <svg className="brand-fish" viewBox="0 0 120 72" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 36 2 18v36l14-18c21-21 48-25 78-1-30 24-57 20-78 1Z" fill="currentColor" />
          <circle cx="75" cy="30" r="3" fill="#fff"/>
          <path d="M37 36c10-7 20-10 32-10" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".65"/>
        </svg>
        <div className="brand-fish-wave" />
      </div>
      <h1>Bookshop</h1>
      <p>Preparing your workspace</p>
      <div className="brand-loading-track"><span /></div>
    </div>
  </main>
}
