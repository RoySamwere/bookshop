/** Nifunze emblem (public/favicon.png, the supplied logo) on a white tile so it reads on light and dark backgrounds. */
export function BrandMark({ size = 36, className = '', title }: { size?: number; className?: string; title?: string }) {
  return <span className={`inline-grid flex-none place-items-center overflow-hidden bg-white ${className}`} style={{ width: size, height: size, borderRadius: Math.round(size * 0.25), padding: Math.round(size * 0.12) }} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
    {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset; images are unoptimized */}
    <img src="/favicon.png" alt="" width={size} height={size} className="block h-full w-full object-contain" />
  </span>
}
