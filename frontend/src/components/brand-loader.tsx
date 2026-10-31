'use client'

import { brand } from '../lib/brand'

/** Coral-red transparent fish mark used only for the page-loading experience. */
export default function BrandLoader() {
  return <main className="brand-loading-screen" role="status" aria-live="polite" aria-label="Opening Bookshop">
    <div className="brand-loading-content">
      <div className="brand-fish-stage" aria-hidden="true">
        <svg className="brand-fish" viewBox="0 0 120 112" fill="none" xmlns="http://www.w3.org/2000/svg" style={{color:'#fa5360',width:108,height:108,overflow:'visible'}}>
          <g stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 51C23 30 48 24 73 39C86 47 91 60 86 70C73 91 36 91 16 72C8 64 7 57 12 51Z"/>
            <path d="M71 47C86 25 104 28 105 42C106 54 96 61 91 62C106 69 104 86 94 91C83 97 71 84 71 73"/>
            <path d="M45 31C49 14 65 10 75 16C66 24 63 31 61 37"/>
            <path d="M28 79C28 91 42 99 57 96L55 85"/>
            <path d="M53 39C61 51 59 68 46 79"/>
            <circle cx="31" cy="50" r="3" fill="currentColor" stroke="none"/>
          </g>
        </svg>
      </div>
      <h1>{brand.name}</h1>
      <p>Preparing your workspace</p>
      <div className="brand-loading-track"><span /></div>
    </div>
  </main>
}
