'use client'

import { Drawer } from '@base-ui/react/drawer'
import { useId, type ReactNode } from 'react'

// Minimal bottom sheet for < lg screens (plan section 17), built on the
// @base-ui/react Drawer primitive — no extra dependency. The sheet slides
// from the bottom by default.
export function BottomDrawer({
  label,
  title,
  closeLabel,
  children,
  className,
}: {
  label: ReactNode
  title: string
  closeLabel: string
  children: ReactNode
  className?: string
}) {
  // F9: per-instance id — two drawers (e.g. validation summary and questions
  // detected) can be in the tree at once; a hardcoded id would collide.
  const titleId = useId()

  return (
    <Drawer.Root>
      <Drawer.Trigger
        className={
          className ??
          'flex min-h-11 w-full items-center rounded-lg bg-muted px-3 py-2 text-left text-sm font-semibold text-foreground'
        }
      >
        {label}
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <Drawer.Viewport className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85vh] max-w-lg">
          <Drawer.Popup
            aria-labelledby={titleId}
            aria-modal={true}
            className="max-h-[85vh] overflow-y-auto rounded-t-2xl bg-background p-4 pb-8 text-foreground ring-1 ring-foreground/10"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/40" aria-hidden="true" />
            <div className="mb-3 flex items-center justify-between gap-4">
              <Drawer.Title id={titleId} className="text-sm font-bold tracking-wide">
                {title}
              </Drawer.Title>
              <Drawer.Close className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                {closeLabel}
              </Drawer.Close>
            </div>
            {children}
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
