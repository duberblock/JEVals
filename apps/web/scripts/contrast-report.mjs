/**
 * Plan A8 — WCAG contrast as an executable gate for the Rose Quartz /
 * Technical Laboratory design-token migration. The resulting table is the
 * contrast report pasted into the PR.
 *
 * Zero-dependency Node (built-ins only, pattern of scripts/serve-auth.mjs):
 * recomputes every semantic foreground/background pair of app/globals.css
 * (light AND dark themes) and exits 1 if ANY pair fails WCAG AA at the
 * 4.5:1 text threshold, 0 otherwise.
 */

// ---------- oklch -> sRGB ----------
function oklchToLinearSrgb(L, C, H) {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function gammaEncode(v) {
  const c = Math.min(1, Math.max(0, v))
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

function parseColor(token) {
  const t = token.trim()
  const hex = t.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255)
  }
  const ok = t.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/)
  if (ok) return oklchToLinearSrgb(+ok[1], +ok[2], +ok[3]).map(gammaEncode)
  throw new Error(`unparseable color token: ${token}`)
}

// ---------- WCAG ----------
function relativeLuminance(token) {
  const [r, g, b] = parseColor(token).map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

// ---------- pairs (must mirror app/globals.css exactly) ----------
const LIGHT_CARD = '#ffffff'
const DARK_CARD = 'oklch(0.245 0.018 2.73)'
const PAIRS = [
  // light — filled semantics
  { name: 'primary / on-primary', theme: 'light', fg: '#ffffff', bg: '#8b4a5c' },
  { name: 'success / on-success', theme: 'light', fg: '#ffffff', bg: '#356762' },
  { name: 'warning / on-warning', theme: 'light', fg: '#ffd9e0', bg: '#6f3345' },
  { name: 'destructive / on-error', theme: 'light', fg: '#ffffff', bg: '#ba1a1a' },
  { name: 'secondary / on-secondary-fixed', theme: 'light', fg: '#22191b', bg: '#f0dee1' },
  // light — text on surfaces
  { name: 'source-emulator text on card', theme: 'light', fg: '#356762', bg: LIGHT_CARD },
  { name: 'source-jev text on card', theme: 'light', fg: '#8b4a5c', bg: LIGHT_CARD },
  { name: 'source-judge text on card', theme: 'light', fg: '#1c1b1c', bg: LIGHT_CARD },
  { name: 'source-independent text on card', theme: 'light', fg: '#685b5d', bg: LIGHT_CARD },
  // R38: the migrated verdict/status text tokens. Card is the worst-case
  // PLAIN surface; the rail's selected row paints bg-muted (brighter than
  // card in dark, slightly darker than white in light), so muted pairs pin
  // that worst case too. The success/warning VALUES intentionally share the
  // source-emulator/source-jev hues (ADR-012 derivation: tertiary→success,
  // rose deep register→warning) — the value duplication below documents that
  // identity; if the tokens ever diverge, these literals must follow.
  { name: 'success text on card', theme: 'light', fg: '#356762', bg: LIGHT_CARD },
  { name: 'warning text on card', theme: 'light', fg: '#6f3345', bg: LIGHT_CARD },
  { name: 'success text on muted', theme: 'light', fg: '#356762', bg: '#f1edee' },
  { name: 'warning text on muted', theme: 'light', fg: '#6f3345', bg: '#f1edee' },
  { name: 'muted-foreground on background', theme: 'light', fg: '#524346', bg: '#fcf8f9' },
  { name: 'foreground on background', theme: 'light', fg: '#1c1b1c', bg: '#fcf8f9' },
  // dark — filled semantics
  { name: 'primary / on-primary-fixed', theme: 'dark', fg: '#39081a', bg: 'oklch(0.780 0.125 5.93)' },
  { name: 'success / on-tertiary-fixed', theme: 'dark', fg: '#00201e', bg: '#9dd0ca' },
  { name: 'warning / on-primary-fixed', theme: 'dark', fg: '#39081a', bg: '#ffb1c3' },
  { name: 'destructive / on-error-container', theme: 'dark', fg: '#93000a', bg: '#ffdad6' },
  { name: 'secondary-foreground on secondary', theme: 'dark', fg: 'oklch(0.960 0.005 5.93)', bg: 'oklch(0.290 0.020 2.73)' },
  // dark — text on surfaces
  { name: 'source-emulator text on card', theme: 'dark', fg: '#9dd0ca', bg: DARK_CARD },
  { name: 'source-jev text on card', theme: 'dark', fg: '#ffb1c3', bg: DARK_CARD },
  { name: 'source-judge text on card', theme: 'dark', fg: '#f4f0f1', bg: DARK_CARD },
  { name: 'source-independent text on card', theme: 'dark', fg: '#d3c2c5', bg: DARK_CARD },
  { name: 'success text on card', theme: 'dark', fg: '#9dd0ca', bg: DARK_CARD },
  { name: 'warning text on card', theme: 'dark', fg: '#ffb1c3', bg: DARK_CARD },
  { name: 'success text on muted', theme: 'dark', fg: '#9dd0ca', bg: 'oklch(0.280 0.018 2.73)' },
  { name: 'warning text on muted', theme: 'dark', fg: '#ffb1c3', bg: 'oklch(0.280 0.018 2.73)' },
  { name: 'muted-foreground on background', theme: 'dark', fg: 'oklch(0.780 0.015 2.73)', bg: 'oklch(0.200 0.015 2.73)' },
  { name: 'foreground on background', theme: 'dark', fg: 'oklch(0.960 0.005 5.93)', bg: 'oklch(0.200 0.015 2.73)' },
]

const rows = PAIRS.map((p) => {
  const ratio = contrastRatio(p.fg, p.bg)
  return { ...p, ratio, pass: ratio >= 4.5 }
})

console.log('| pair | theme | fg | bg | ratio | AA (4.5) |')
console.log('| --- | --- | --- | --- | --- | --- |')
for (const r of rows) {
  console.log(
    `| ${r.name} | ${r.theme} | \`${r.fg}\` | \`${r.bg}\` | ${r.ratio.toFixed(2)} | ${r.pass ? 'pass' : 'FAIL'} |`
  )
}

const failures = rows.filter((r) => !r.pass)
if (failures.length > 0) {
  console.error(`\n${failures.length} pair(s) failed WCAG AA (4.5:1).`)
  process.exit(1)
}
console.log(`\nAll ${rows.length} pairs pass WCAG AA (>= 4.5:1).`)
