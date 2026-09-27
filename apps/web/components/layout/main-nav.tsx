'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useDictionary } from '../../lib/i18n/use-locale'

const items = [
  { href: '/', key: 'principal' },
  { href: '/investigation', key: 'investigation' },
  { href: '/operation', key: 'operation' }
] as const

// Client component (J1): the shared chrome reads the reactive locale through
// useDictionary so a language switch updates it together with Principal
// (plan 15 never-mix rule) instead of staying on the server default.
//
// C4 (FASE C): prototype active-link treatment — the current section carries
// aria-current="page" and the primary border-b-2 that sits on the h-14
// header edge ('/' matches only the index so section roots never collide);
// the inactive border is transparent so the baseline never shifts.
export function MainNav() {
  const { dictionary } = useDictionary()
  const pathname = usePathname()

  return (
    <nav aria-label="Primary" className="hidden h-14 items-center gap-1 md:flex">
      {items.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname !== null && pathname.startsWith(item.href)
        return (
          <Link
            aria-current={active ? 'page' : undefined}
            className={`flex h-14 items-center border-b-2 px-3 font-mono uppercase text-label-caps ${
              active
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            href={item.href}
            key={item.href}
          >
            {dictionary.nav[item.key]}
          </Link>
        )
      })}
    </nav>
  )
}
