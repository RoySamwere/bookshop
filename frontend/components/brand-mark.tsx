/** Hekima Bookshop mark: an open book in gilt on a night-shelf navy tile. */
export function BrandMark({ size = 36, className = '', title }: { size?: number; className?: string; title?: string }) {
  return <svg width={size} height={size} viewBox="0 0 40 40" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
    <rect width="40" height="40" rx="10" fill="#13254A" />
    <path d="M7.5 12.5c4.4-1.6 8.6-1.2 11.6 1.2v15.6c-3-2.2-7.2-2.6-11.6-1.1z" fill="#D4A52B" />
    <path d="M32.5 12.5c-4.4-1.6-8.6-1.2-11.6 1.2v15.6c3-2.2 7.2-2.6 11.6-1.1z" fill="#F2DFA7" />
    <path d="M20 8.2v3.6M17.6 9.4l1 1.2M22.4 9.4l-1 1.2" stroke="#F2DFA7" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
}
