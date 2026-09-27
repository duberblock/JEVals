import type { NextConfig } from 'next'

const nextConfig = {
  agentRules: false
} satisfies NextConfig & { agentRules?: boolean }

export default nextConfig
