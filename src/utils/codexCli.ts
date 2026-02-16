/**
 * Codexian - Codex CLI resolver
 *
 * Shared resolver for Codex CLI path detection across services.
 */

import * as fs from 'fs';

import { type HostnameCliPaths } from '../core/types/settings';
import { getHostnameKey, parseEnvironmentVariables } from './env';
import { expandHomePath, findCodexCLIPath } from './path';

export class CodexCliResolver {
  private resolvedPath: string | null = null;
  private lastHostnamePath = '';
  private lastLegacyPath = '';
  private lastEnvText = '';
  private readonly cachedHostname = getHostnameKey();

  resolve(
    hostnamePaths: HostnameCliPaths | undefined,
    legacyPath: string | undefined,
    envText: string
  ): string | null {
    const hostnameKey = this.cachedHostname;

    const hostnamePath = (hostnamePaths?.[hostnameKey] ?? '').trim();
    const normalizedLegacy = (legacyPath ?? '').trim();
    const normalizedEnv = envText ?? '';

    if (
      this.resolvedPath &&
      hostnamePath === this.lastHostnamePath &&
      normalizedLegacy === this.lastLegacyPath &&
      normalizedEnv === this.lastEnvText
    ) {
      return this.resolvedPath;
    }

    this.lastHostnamePath = hostnamePath;
    this.lastLegacyPath = normalizedLegacy;
    this.lastEnvText = normalizedEnv;

    this.resolvedPath = resolveCodexCliPath(hostnamePath, normalizedLegacy, normalizedEnv);
    return this.resolvedPath;
  }

  reset(): void {
    this.resolvedPath = null;
    this.lastHostnamePath = '';
    this.lastLegacyPath = '';
    this.lastEnvText = '';
  }
}

export function resolveCodexCliPath(
  hostnamePath: string | undefined,
  legacyPath: string | undefined,
  envText: string
): string | null {
  const trimmedHostname = (hostnamePath ?? '').trim();
  if (trimmedHostname) {
    try {
      const expandedPath = expandHomePath(trimmedHostname);
      if (fs.existsSync(expandedPath)) {
        const stat = fs.statSync(expandedPath);
        if (stat.isFile()) {
          return expandedPath;
        }
      }
    } catch {
      // Fall through to next resolution method
    }
  }

  const trimmedLegacy = (legacyPath ?? '').trim();
  if (trimmedLegacy) {
    try {
      const expandedPath = expandHomePath(trimmedLegacy);
      if (fs.existsSync(expandedPath)) {
        const stat = fs.statSync(expandedPath);
        if (stat.isFile()) {
          return expandedPath;
        }
      }
    } catch {
      // Fall through to auto-detect
    }
  }

  const customEnv = parseEnvironmentVariables(envText || '');
  return findCodexCLIPath(customEnv.PATH);
}
