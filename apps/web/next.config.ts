import type { NextConfig } from 'next'

const nextConfig = {
  agentRules: false,
  // Docker builds set NEXT_OUTPUT_STANDALONE=1 to emit .next/standalone
  // (a minimal server.js + just-enough node_modules); local dev and
  // `npm run start` / serve-auth keep the classic output.
  ...(process.env.NEXT_OUTPUT_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
} satisfies NextConfig & { agentRules?: boolean }

export default nextConfig
