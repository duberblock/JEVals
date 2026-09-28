'use client'

import Link from 'next/link'

import { CircleHelp, Settings as SettingsIcon } from 'lucide-react'

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
    <nav
      aria-label="Mobile primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background md:hidden"
    >
      {/* Utilities row: the header's gear/help links are lg-only, so this
          row is mobile's only door into Settings and the walkthrough. The
          PRIMARY bar below stays exactly the three canonical sections (§3). */}
      <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
        <Link
          className="flex min-h-9 items-center justify-center gap-2 px-2 py-2 text-xs font-medium text-muted-foreground"
          data-testid="mobile-settings-link"
          href="/settings"
        >
          <SettingsIcon aria-hidden="true" className="size-4" size={16} />
          {dictionary.settings.headerTitle}
        </Link>
        <Link
          className="flex min-h-9 items-center justify-center gap-2 px-2 py-2 text-xs font-medium text-muted-foreground"
          data-testid="mobile-how-it-works-link"
          href="/how-it-works"
        >
          <CircleHelp aria-hidden="true" className="size-4" size={16} />
          {dictionary.howItWorks.title}
        </Link>
      </div>
      <div className="grid grid-cols-3">
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
      </div>
    </nav>
  )
}
