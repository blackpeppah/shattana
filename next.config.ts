import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

export default function config(phase: string): NextConfig {
  const devHost = phase === PHASE_DEVELOPMENT_SERVER ? process.env.SHATTANA_DEV_HOST?.trim() : undefined;

  return {
    serverExternalPackages: ['@electric-sql/pglite', 'pg'],
    allowedDevOrigins: devHost ? [devHost] : undefined,
  };
}
