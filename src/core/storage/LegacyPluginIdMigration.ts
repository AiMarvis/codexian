import type { VaultFileAdapter } from './VaultFileAdapter';

const COMMUNITY_PLUGINS_PATH = '.obsidian/community-plugins.json';
const HOTKEYS_PATH = '.obsidian/hotkeys.json';

const LEGACY_PLUGIN_ID = 'claudian';
const CODEXIAN_PLUGIN_ID = 'codexian';
const LEGACY_HOTKEY_PREFIX = 'claudian:';
const CODEXIAN_HOTKEY_PREFIX = 'codexian:';

export const CLAUDIAN_PLUGIN_ID_MIGRATION_MARKER = '.codexian/migrations/claudian-plugin-id-v1.json';

export interface LegacyPluginIdMigrationResult {
  migrated: boolean;
  updatedCommunityPlugins: boolean;
  updatedHotkeys: boolean;
  warnings: string[];
}

export async function runLegacyPluginIdMigrationOnce(
  adapter: VaultFileAdapter
): Promise<LegacyPluginIdMigrationResult> {
  if (await adapter.exists(CLAUDIAN_PLUGIN_ID_MIGRATION_MARKER)) {
    return {
      migrated: false,
      updatedCommunityPlugins: false,
      updatedHotkeys: false,
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const updatedCommunityPlugins = await migrateCommunityPlugins(adapter, warnings);
  const updatedHotkeys = await migrateHotkeys(adapter, warnings);

  await adapter.write(
    CLAUDIAN_PLUGIN_ID_MIGRATION_MARKER,
    JSON.stringify(
      {
        version: 1,
        migratedAt: Date.now(),
        updatedCommunityPlugins,
        updatedHotkeys,
      },
      null,
      2
    )
  );

  return {
    migrated: true,
    updatedCommunityPlugins,
    updatedHotkeys,
    warnings,
  };
}

async function migrateCommunityPlugins(
  adapter: VaultFileAdapter,
  warnings: string[]
): Promise<boolean> {
  if (!(await adapter.exists(COMMUNITY_PLUGINS_PATH))) {
    return false;
  }

  try {
    const content = await adapter.read(COMMUNITY_PLUGINS_PATH);
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) {
      warnings.push(`${COMMUNITY_PLUGINS_PATH}: expected array`);
      return false;
    }

    let changed = false;
    const seen = new Set<string>();
    const next: unknown[] = [];

    for (const item of parsed) {
      if (typeof item !== 'string') {
        next.push(item);
        continue;
      }

      const rewritten = item === LEGACY_PLUGIN_ID ? CODEXIAN_PLUGIN_ID : item;
      if (rewritten !== item) {
        changed = true;
      }

      if (seen.has(rewritten)) {
        changed = true;
        continue;
      }

      seen.add(rewritten);
      next.push(rewritten);
    }

    if (!changed) {
      return false;
    }

    await adapter.write(COMMUNITY_PLUGINS_PATH, JSON.stringify(next, null, 2));
    return true;
  } catch {
    warnings.push(`${COMMUNITY_PLUGINS_PATH}: invalid JSON`);
    return false;
  }
}

async function migrateHotkeys(
  adapter: VaultFileAdapter,
  warnings: string[]
): Promise<boolean> {
  if (!(await adapter.exists(HOTKEYS_PATH))) {
    return false;
  }

  try {
    const content = await adapter.read(HOTKEYS_PATH);
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warnings.push(`${HOTKEYS_PATH}: expected object`);
      return false;
    }

    const hotkeys = parsed as Record<string, unknown>;
    let changed = false;

    for (const key of Object.keys(hotkeys)) {
      if (!key.startsWith(LEGACY_HOTKEY_PREFIX)) {
        continue;
      }

      const suffix = key.slice(LEGACY_HOTKEY_PREFIX.length);
      const codexianKey = `${CODEXIAN_HOTKEY_PREFIX}${suffix}`;
      if (!(codexianKey in hotkeys)) {
        hotkeys[codexianKey] = hotkeys[key];
      }

      delete hotkeys[key];
      changed = true;
    }

    if (!changed) {
      return false;
    }

    await adapter.write(HOTKEYS_PATH, JSON.stringify(hotkeys, null, 2));
    return true;
  } catch {
    warnings.push(`${HOTKEYS_PATH}: invalid JSON`);
    return false;
  }
}
