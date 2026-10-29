import { featuredCategories } from '../../lib/brand'

// Heights and widths vary like a real shelf; the fourth book leans on its neighbour.
const SHAPES = [
  { height: 92, width: 16 },
  { height: 80, width: 14 },
  { height: 88, width: 13 },
  { height: 84, width: 15, leaning: true },
  { height: 74, width: 14 },
]

/** The five launch categories as cloth-bound spines on a shelf. Decorative: the same list is readable below. */
export function Bookshelf({ compact = false }: { compact?: boolean }) {
  return <div className={`hk-shelf${compact ? ' hk-shelf-compact' : ''}`} aria-hidden="true">
    <div className="hk-shelf-books">
      {featuredCategories.map((category, index) => {
        const shape = SHAPES[index]
        return <div key={category.slug}
          className={`hk-spine hk-tone-${category.tone}${'leaning' in shape ? ' hk-spine-leaning' : ''}`}
          style={{ '--spine-h': `${shape.height}%`, '--spine-w': `${shape.width}%`, '--spine-delay': `${120 + index * 90}ms` } as React.CSSProperties}>
          <span className="hk-spine-band" />
          <span className="hk-spine-title">{category.spine}</span>
          <span className="hk-spine-band hk-spine-band-low" />
          <span className="hk-spine-foot">H</span>
        </div>
      })}
      <div className="hk-bookend" />
    </div>
    <div className="hk-shelf-ledge" />
  </div>
}
