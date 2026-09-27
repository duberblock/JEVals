'use client'

import Link from 'next/link'

import { useDictionary } from '../../lib/i18n/use-locale'

const items = [
  { href: '/', key: 'principal' },
  { href: '/investigation', key: 'investigation' },
  { href: '/operation', key: 'operation' }
] as const

// Client component (J1): same reactive-locale mechanism as MainNav so the
// bottom bar never mixes languages with the rest of the tree.
export function MobileNav() {
  const { dictionary } = useDictionary()

  return (
    <nav aria-label="Mobile primary" className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-3 border-t border-border bg-background md:hidden">
      {items.map((item) => (
        // §16: min-h-11 keeps each primary link a ~44px touch target.
        <Link
          className="flex min-h-11 items-center justify-center px-2 py-3 text-center text-xs font-semibold text-foreground"
          href={item.href}
          key={item.href}
        >
          {dictionary.nav[item.key]}
        </Link>
      ))}
    </nav>
  )
}
