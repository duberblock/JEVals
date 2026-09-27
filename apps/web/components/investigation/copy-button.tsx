'use client'

import { useState } from 'react'

import { Button } from '../ui/button'

// §45.1 copy action with the JsonInput transient-Copied pattern: the exact
// payload goes to the clipboard and the label confirms briefly.
export function CopyButton({
  copiedLabel,
  label,
  size = 'sm',
  value,
}: {
  copiedLabel: string
  label: string
  size?: 'xs' | 'sm' | 'default' | 'lg'
  value: string | (() => string)
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      const text = typeof value === 'function' ? value() : value
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (permissions): silently keep the Copy label.
    }
  }

  return (
    <Button onClick={copy} size={size} type="button" variant="outline">
      {copied ? copiedLabel : label}
    </Button>
  )
}
