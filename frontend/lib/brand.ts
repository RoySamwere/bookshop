/**
 * Public brand and contact details. Change them in frontend/.env.local (see .env.example)
 * without touching code. Contact lines that are left empty are simply not shown.
 */
const clean = (value: string | undefined) => (value || '').trim()

export const brand = {
  name: clean(process.env.NEXT_PUBLIC_BRAND_NAME) || 'Hekima Bookshop',
  shortName: clean(process.env.NEXT_PUBLIC_BRAND_SHORT_NAME) || 'Hekima',
  description: 'Books, learning materials and educational resources for readers and learners of every age.',
  contact: {
    email: clean(process.env.NEXT_PUBLIC_CONTACT_EMAIL),
    phone: clean(process.env.NEXT_PUBLIC_CONTACT_PHONE),
    whatsapp: clean(process.env.NEXT_PUBLIC_CONTACT_WHATSAPP),
    address: clean(process.env.NEXT_PUBLIC_CONTACT_ADDRESS),
    hours: clean(process.env.NEXT_PUBLIC_CONTACT_HOURS),
  },
}

export const hasContactDetails = Object.values(brand.contact).some(Boolean)

/**
 * The categories previewed on the Coming Soon page. Slugs are stable so they can become
 * shop routes (e.g. /shop/textbooks) when online ordering arrives.
 */
export const featuredCategories = [
  { slug: 'textbooks', name: 'Textbooks', spine: 'TEXTBOOKS', tone: 'crimson', description: 'Course books, revision guides and teacher resources for primary and secondary learners.' },
  { slug: 'childrens-books', name: "Children's books", spine: "CHILDREN'S", tone: 'ochre', description: 'Picture books, early readers and stories for young people to grow into.' },
  { slug: 'fiction', name: 'Fiction', spine: 'FICTION', tone: 'forest', description: 'Novels and short stories from Kenyan, African and international writers.' },
  { slug: 'nonfiction', name: 'Nonfiction', spine: 'NONFICTION', tone: 'slate', description: 'Biography, history, business and practical guides for curious minds.' },
  { slug: 'stationery', name: 'Stationery', spine: 'STATIONERY', tone: 'plum', description: 'Exercise books, pens, geometry sets and everyday study supplies.' },
] as const

export type FeaturedCategory = (typeof featuredCategories)[number]
