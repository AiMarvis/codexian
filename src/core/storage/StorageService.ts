/**
 * StorageService - Main coordinator for distributed storage system.
 *
 * Manages:
 * - CC settings in .claude/settings.json (CC-compatible, shareable)
 * - Claudian settings in .claude/claudian-settings.json (Claudian-specific)
 * - Slash commands in .claude/commands/*.md
 * - Chat sessions in .claude/sessions/*.jsonl
 * - MCP configs in .claude/mcp.json
 *
 * Handles migration from legacy formats:
 * - Old settings.json with Claudian fields → split into CC + Claudian files
 * - Old permissions array → CC permissions object
 * - data.json state → claudian-settings.json
 */

import type { App, Plugin } from 'obsidian';
import { Notice } from 'obsidian';

import type {
  CCSettings,
  CCPermissions,
  ClaudeModel,
  Conversation,
  LegacyPermission,
  SlashCommand,
} from '../types';
import {
  createPermissionRule,
  DEFAULT_CC_PERMISSIONS,
  DEFAULT_CC_SETTINGS,
  DEFAULT_SETTINGS,
  legacyPermissionsToCCPermissions,
} from '../types';
import { AGENTS_PATH, AgentVaultStorage } from './AgentVaultStorage';
import {
  CC_SETTINGS_PATH,
  CCSettingsStorage,
  isLegacyPermissionsFormat,
  LEGACY_CC_SETTINGS_PATH,
} from './CCSettingsStorage';
import {
  CLAUDIAN_SETTINGS_PATH,
  ClaudianSettingsStorage,
  LEGACY_CLAUDIAN_SETTINGS_PATH,
  normalizeBlockedCommands,
  type StoredClaudianSettings,
} from './ClaudianSettingsStorage';
import { MCP_CONFIG_PATH, McpStorage } from './McpStorage';
import {
  CLAUDIAN_ONLY_FIELDS,
  convertEnvObjectToString,
  mergeEnvironmentVariables,
} from './migrationConstants';
import { runLegacyPluginIdMigrationOnce } from './LegacyPluginIdMigration';
import { SESSIONS_PATH, SessionStorage } from './SessionStorage';
import { SKILLS_PATH, SkillStorage } from './SkillStorage';
import { COMMANDS_PATH, SlashCommandStorage } from './SlashCommandStorage';
import { VaultFileAdapter } from './VaultFileAdapter';

/** Base path for all Codexian storage. */
export const CODEXIAN_PATH = '.codexian';
/** @deprecated Legacy alias. */
export const CLAUDE_PATH = CODEXIAN_PATH;
export const LEGACY_CLAUDE_PATH = '.claude';
export const CLAUDE_TO_CODEX_MIGRATION_MARKER = `${CODEXIAN_PATH}/migrations/claude-to-codex-v1.json`;
const LEGACY_CLAUDIAN_PLUGIN_DATA_PATH = '.obsidian/plugins/claudian/data.json';

/** Legacy settings path (now CC settings). */
export const SETTINGS_PATH = CC_SETTINGS_PATH;

/**
 * Combined settings for the application.
 * Merges CC settings (permissions) with Claudian settings.
 */
export interface CombinedSettings {
  /** CC-compatible settings (permissions, etc.) */
  cc: CCSettings;
  /** Claudian-specific settings */
  claudian: StoredClaudianSettings;
}

/** Legacy data format (pre-split migration). */
interface LegacySettingsJson {
  // Old Claudian fields that were in settings.json
  userName?: string;
  enableBlocklist?: boolean;
  blockedCommands?: unknown;
  model?: string;
  thinkingBudget?: string;
  permissionMode?: string;
  lastNonPlanPermissionMode?: string;
  permissions?: LegacyPermission[];
  excludedTags?: string[];
  mediaFolder?: string;
  environmentVariables?: string;
  envSnippets?: unknown[];
  systemPrompt?: string;
  allowedExportPaths?: string[];
  keyboardNavigation?: unknown;
  claudeCliPath?: string;
  claudeCliPaths?: unknown;
  loadUserClaudeSettings?: boolean;
  enableAutoTitleGeneration?: boolean;
  titleGenerationModel?: string;

  // CC fields
  $schema?: string;
  env?: Record<string, string>;
}

/** Legacy data.json format. */
interface LegacyDataJson {
  activeConversationId?: string | null;
  lastEnvHash?: string;
  lastClaudeModel?: ClaudeModel;
  lastCustomModel?: ClaudeModel;
  conversations?: Conversation[];
  slashCommands?: SlashCommand[];
  migrationVersion?: number;
  // May also contain old settings if not yet migrated
  [key: string]: unknown;
}

// CLAUDIAN_ONLY_FIELDS is imported from ./migrationConstants

export class StorageService {
  readonly ccSettings: CCSettingsStorage;
  readonly claudianSettings: ClaudianSettingsStorage;
  readonly commands: SlashCommandStorage;
  readonly skills: SkillStorage;
  readonly sessions: SessionStorage;
  readonly mcp: McpStorage;
  readonly agents: AgentVaultStorage;

  private adapter: VaultFileAdapter;
  private plugin: Plugin;
  private app: App;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.adapter = new VaultFileAdapter(this.app);
    this.ccSettings = new CCSettingsStorage(this.adapter);
    this.claudianSettings = new ClaudianSettingsStorage(this.adapter);
    this.commands = new SlashCommandStorage(this.adapter);
    this.skills = new SkillStorage(this.adapter);
    this.sessions = new SessionStorage(this.adapter);
    this.mcp = new McpStorage(this.adapter);
    this.agents = new AgentVaultStorage(this.adapter);
  }

  async initialize(): Promise<CombinedSettings> {
    await this.ensureDirectories();

    try {
      const pluginIdMigration = await runLegacyPluginIdMigrationOnce(this.adapter);
      if (pluginIdMigration.warnings.length > 0) {
        const warningText = pluginIdMigration.warnings.join('; ');
        new Notice(`Codexian legacy plugin migration skipped entries: ${warningText}`);
      }
      await this.migrateLegacyClaudeDataOnce();
      await this.runMigrations();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      new Notice(`Codexian migration failed at startup: ${reason}. Continuing with defaults.`);
    }

    const cc = await this.loadCCSettingsSafe();
    const claudian = await this.loadClaudianSettingsSafe();

    return { cc, claudian };
  }

  private async loadCCSettingsSafe(): Promise<CCSettings> {
    try {
      return await this.ccSettings.load();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.preserveCorruptedSettingFile(LEGACY_CC_SETTINGS_PATH, CC_SETTINGS_PATH);
      new Notice(`Codexian settings load failed: ${reason}. Using default CC settings for this session.`);
      await this.ccSettings.save({ ...DEFAULT_CC_SETTINGS });
      return { ...DEFAULT_CC_SETTINGS };
    }
  }

  private async loadClaudianSettingsSafe(): Promise<StoredClaudianSettings> {
    try {
      return await this.claudianSettings.load();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.preserveCorruptedSettingFile(LEGACY_CLAUDIAN_SETTINGS_PATH, CLAUDIAN_SETTINGS_PATH);
      new Notice(`Codexian plugin settings load failed: ${reason}. Using default plugin settings for this session.`);
      const { slashCommands: _slashCommands, ...defaults } = DEFAULT_SETTINGS;
      const fallback: StoredClaudianSettings = {
        ...defaults,
      };
      await this.claudianSettings.save(fallback);
      return fallback;
    }
  }

  private async preserveCorruptedSettingFile(
    legacyPath: string,
    primaryPath: string
  ): Promise<void> {
    const backupSuffix = `.backup-${this.getTimestampForBackup()}`;
    const targets = [primaryPath, legacyPath];

    for (const target of targets) {
      if (!(await this.adapter.exists(target))) {
        continue;
      }

      try {
        await this.adapter.rename(target, `${target}${backupSuffix}`);
      } catch {
        // non-blocking: keep existing file if rename fails
      }
    }
  }

  private async runMigrations(): Promise<void> {
    const ccExists = await this.ccSettings.exists();
    const claudianExists = await this.claudianSettings.exists();
    const dataJson = await this.loadDataJson();

    // Check if old settings.json has Claudian fields that need migration
    if (ccExists && !claudianExists) {
      await this.migrateFromOldSettingsJson();
    }

    if (dataJson) {
      const hasState = this.hasStateToMigrate(dataJson);
      const hasLegacyContent = this.hasLegacyContentToMigrate(dataJson);

      // Migrate data.json state to claudian-settings.json
      if (hasState) {
        await this.migrateFromDataJson(dataJson);
      }

      // Migrate slash commands and conversations from data.json
      let legacyContentHadErrors = false;
      if (hasLegacyContent) {
        const result = await this.migrateLegacyDataJsonContent(dataJson);
        legacyContentHadErrors = result.hadErrors;
      }

      // Clear legacy data.json only after successful migrations
      if ((hasState || hasLegacyContent) && !legacyContentHadErrors) {
        await this.clearLegacyDataJson();
      }
    }
  }

  private async migrateLegacyClaudeDataOnce(): Promise<void> {
    if (await this.adapter.exists(CLAUDE_TO_CODEX_MIGRATION_MARKER)) {
      return;
    }

    if (!(await this.adapter.exists(LEGACY_CLAUDE_PATH))) {
      return;
    }

    const backupPath = `.claude.backup-${this.getTimestampForBackup()}`;
    const createdTargets: string[] = [];

    try {
      // Safety-first backup before any write to the new storage root.
      await this.copyDirectoryRecursive(LEGACY_CLAUDE_PATH, backupPath);

      const mappings: Array<{ source: string; target: string }> = [
        { source: LEGACY_CLAUDIAN_SETTINGS_PATH, target: CLAUDIAN_SETTINGS_PATH },
        { source: LEGACY_CC_SETTINGS_PATH, target: CC_SETTINGS_PATH },
        { source: `${LEGACY_CLAUDE_PATH}/sessions`, target: SESSIONS_PATH },
        { source: `${LEGACY_CLAUDE_PATH}/commands`, target: COMMANDS_PATH },
        { source: `${LEGACY_CLAUDE_PATH}/agents`, target: AGENTS_PATH },
        { source: `${LEGACY_CLAUDE_PATH}/skills`, target: SKILLS_PATH },
        { source: `${LEGACY_CLAUDE_PATH}/mcp.json`, target: MCP_CONFIG_PATH },
      ];

      for (const mapping of mappings) {
        if (!(await this.adapter.exists(mapping.source))) {
          continue;
        }

        if (await this.adapter.exists(mapping.target)) {
          continue;
        }

        await this.copyPathRecursive(mapping.source, mapping.target);
        createdTargets.push(mapping.target);
      }

      await this.adapter.ensureFolder(`${CODEXIAN_PATH}/migrations`);
      await this.adapter.write(
        CLAUDE_TO_CODEX_MIGRATION_MARKER,
        JSON.stringify({
          version: 1,
          migratedAt: Date.now(),
          backupPath,
          sourceRoot: LEGACY_CLAUDE_PATH,
          targetRoot: CODEXIAN_PATH,
        }, null, 2)
      );
    } catch (error) {
      for (const target of createdTargets.reverse()) {
        await this.removePathRecursive(target);
      }
      new Notice(
        `Codexian migration failed. New files were rolled back. Legacy backup is available at ${backupPath}.`
      );
      throw error;
    }
  }

  private getTimestampForBackup(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  private async copyPathRecursive(source: string, target: string): Promise<void> {
    if (!(await this.adapter.exists(source))) {
      return;
    }

    // If list() succeeds, this is a folder; if it throws, treat as file.
    try {
      await this.adapter.listFiles(source);
      await this.copyDirectoryRecursive(source, target);
      return;
    } catch {
      // Fall through to file copy.
    }

    const content = await this.adapter.read(source);
    await this.adapter.write(target, content);
  }

  private async copyDirectoryRecursive(sourceDir: string, targetDir: string): Promise<void> {
    if (!(await this.adapter.exists(sourceDir))) {
      return;
    }

    await this.adapter.ensureFolder(targetDir);

    const files = await this.adapter.listFiles(sourceDir);
    for (const file of files) {
      const fileName = file.split('/').pop();
      if (!fileName) {
        continue;
      }
      const content = await this.adapter.read(file);
      await this.adapter.write(`${targetDir}/${fileName}`, content);
    }

    const folders = await this.adapter.listFolders(sourceDir);
    for (const folder of folders) {
      const folderName = folder.split('/').pop();
      if (!folderName) {
        continue;
      }
      await this.copyDirectoryRecursive(folder, `${targetDir}/${folderName}`);
    }
  }

  private async removePathRecursive(target: string): Promise<void> {
    if (!(await this.adapter.exists(target))) {
      return;
    }

    try {
      await this.adapter.listFiles(target);
      await this.removeDirectoryRecursive(target);
      return;
    } catch {
      // It's likely a file.
    }

    await this.adapter.delete(target);
  }

  private async removeDirectoryRecursive(dir: string): Promise<void> {
    if (!(await this.adapter.exists(dir))) {
      return;
    }

    const files = await this.adapter.listFiles(dir);
    for (const file of files) {
      await this.adapter.delete(file);
    }

    const folders = await this.adapter.listFolders(dir);
    for (const folder of folders) {
      await this.removeDirectoryRecursive(folder);
    }

    await this.adapter.deleteFolder(dir);
  }

  private hasStateToMigrate(data: LegacyDataJson): boolean {
    return (
      data.lastEnvHash !== undefined ||
      data.lastClaudeModel !== undefined ||
      data.lastCustomModel !== undefined
    );
  }

  private hasLegacyContentToMigrate(data: LegacyDataJson): boolean {
    return (
      (data.slashCommands?.length ?? 0) > 0 ||
      (data.conversations?.length ?? 0) > 0
    );
  }

  /**
   * Migrate from old settings.json (with Claudian fields) to split format.
   *
   * Handles:
   * - Legacy Claudian fields (userName, model, etc.) → claudian-settings.json
   * - Legacy permissions array → CC permissions object
   * - CC env object → Claudian environmentVariables string
   * - Preserves existing CC permissions if already in CC format
   */
  private async migrateFromOldSettingsJson(): Promise<void> {
    const content = await this.adapter.read(CC_SETTINGS_PATH);
    const oldSettings = JSON.parse(content) as LegacySettingsJson;

    const hasClaudianFields = Array.from(CLAUDIAN_ONLY_FIELDS).some(
      field => (oldSettings as Record<string, unknown>)[field] !== undefined
    );

    if (!hasClaudianFields) {
      return;
    }

    // Handle environment variables: merge Claudian string format with CC object format
    let environmentVariables = oldSettings.environmentVariables ?? '';
    if (oldSettings.env && typeof oldSettings.env === 'object') {
      const envFromCC = convertEnvObjectToString(oldSettings.env);
      if (envFromCC) {
        environmentVariables = mergeEnvironmentVariables(environmentVariables, envFromCC);
      }
    }

    const claudianFields: Partial<StoredClaudianSettings> = {
      userName: oldSettings.userName ?? DEFAULT_SETTINGS.userName,
      enableBlocklist: oldSettings.enableBlocklist ?? DEFAULT_SETTINGS.enableBlocklist,
      blockedCommands: normalizeBlockedCommands(oldSettings.blockedCommands),
      model: (oldSettings.model as ClaudeModel) ?? DEFAULT_SETTINGS.model,
      thinkingBudget: (oldSettings.thinkingBudget as StoredClaudianSettings['thinkingBudget']) ?? DEFAULT_SETTINGS.thinkingBudget,
      permissionMode: (oldSettings.permissionMode as StoredClaudianSettings['permissionMode']) ?? DEFAULT_SETTINGS.permissionMode,
      excludedTags: oldSettings.excludedTags ?? DEFAULT_SETTINGS.excludedTags,
      mediaFolder: oldSettings.mediaFolder ?? DEFAULT_SETTINGS.mediaFolder,
      environmentVariables, // Merged from both sources
      envSnippets: oldSettings.envSnippets as StoredClaudianSettings['envSnippets'] ?? DEFAULT_SETTINGS.envSnippets,
      systemPrompt: oldSettings.systemPrompt ?? DEFAULT_SETTINGS.systemPrompt,
      allowedExportPaths: oldSettings.allowedExportPaths ?? DEFAULT_SETTINGS.allowedExportPaths,
      persistentExternalContextPaths: DEFAULT_SETTINGS.persistentExternalContextPaths,
      keyboardNavigation: oldSettings.keyboardNavigation as StoredClaudianSettings['keyboardNavigation'] ?? DEFAULT_SETTINGS.keyboardNavigation,
      codexCliPath: oldSettings.claudeCliPath ?? DEFAULT_SETTINGS.codexCliPath,
      codexCliPathsByHost: DEFAULT_SETTINGS.codexCliPathsByHost, // Migration to hostname-based handled in main.ts
      loadUserCodexSettings: oldSettings.loadUserClaudeSettings ?? DEFAULT_SETTINGS.loadUserCodexSettings,
      claudeCliPath: oldSettings.claudeCliPath ?? DEFAULT_SETTINGS.claudeCliPath,
      claudeCliPathsByHost: DEFAULT_SETTINGS.claudeCliPathsByHost,
      loadUserClaudeSettings: oldSettings.loadUserClaudeSettings ?? DEFAULT_SETTINGS.loadUserClaudeSettings,
      enableAutoTitleGeneration: oldSettings.enableAutoTitleGeneration ?? DEFAULT_SETTINGS.enableAutoTitleGeneration,
      titleGenerationModel: oldSettings.titleGenerationModel ?? DEFAULT_SETTINGS.titleGenerationModel,
      lastClaudeModel: DEFAULT_SETTINGS.lastClaudeModel,
      lastCustomModel: DEFAULT_SETTINGS.lastCustomModel,
      lastEnvHash: DEFAULT_SETTINGS.lastEnvHash,
    };

    // Save Claudian settings FIRST (before stripping from settings.json)
    await this.claudianSettings.save(claudianFields as StoredClaudianSettings);

    // Verify Claudian settings were saved
    const savedClaudian = await this.claudianSettings.load();
    if (!savedClaudian || savedClaudian.userName === undefined) {
      throw new Error('Failed to verify claudian-settings.json was saved correctly');
    }

    // Handle permissions: convert legacy format OR preserve existing CC format
    let ccPermissions: CCPermissions;
    if (isLegacyPermissionsFormat(oldSettings)) {
      ccPermissions = legacyPermissionsToCCPermissions(oldSettings.permissions);
    } else if (oldSettings.permissions && typeof oldSettings.permissions === 'object' && !Array.isArray(oldSettings.permissions)) {
      // Already in CC format - preserve it including defaultMode and additionalDirectories
      const existingPerms = oldSettings.permissions as unknown as CCPermissions;
      ccPermissions = {
        allow: existingPerms.allow ?? [],
        deny: existingPerms.deny ?? [],
        ask: existingPerms.ask ?? [],
        defaultMode: existingPerms.defaultMode,
        additionalDirectories: existingPerms.additionalDirectories,
      };
    } else {
      ccPermissions = { ...DEFAULT_CC_PERMISSIONS };
    }

    // Rewrite settings.json with only CC fields
    const ccSettings: CCSettings = {
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      permissions: ccPermissions,
    };

    // Pass true to strip Claudian-only fields during migration
    await this.ccSettings.save(ccSettings, true);
  }

  private async migrateFromDataJson(dataJson: LegacyDataJson): Promise<void> {
    const claudian = await this.claudianSettings.load();

    // Only migrate if not already set (claudian-settings.json takes precedence)
    if (dataJson.lastEnvHash !== undefined && !claudian.lastEnvHash) {
      claudian.lastEnvHash = dataJson.lastEnvHash;
    }
    if (dataJson.lastClaudeModel !== undefined && !claudian.lastClaudeModel) {
      claudian.lastClaudeModel = dataJson.lastClaudeModel;
    }
    if (dataJson.lastCustomModel !== undefined && !claudian.lastCustomModel) {
      claudian.lastCustomModel = dataJson.lastCustomModel;
    }

    await this.claudianSettings.save(claudian);
  }

  private async migrateLegacyDataJsonContent(dataJson: LegacyDataJson): Promise<{ hadErrors: boolean }> {
    let hadErrors = false;

    if (dataJson.slashCommands && dataJson.slashCommands.length > 0) {
      for (const command of dataJson.slashCommands) {
        try {
          const filePath = this.commands.getFilePath(command);
          if (await this.adapter.exists(filePath)) {
            continue;
          }
          await this.commands.save(command);
        } catch {
          hadErrors = true;
        }
      }
    }

    if (dataJson.conversations && dataJson.conversations.length > 0) {
      for (const conversation of dataJson.conversations) {
        try {
          const filePath = this.sessions.getFilePath(conversation.id);
          if (await this.adapter.exists(filePath)) {
            continue;
          }
          await this.sessions.saveConversation(conversation);
        } catch {
          hadErrors = true;
        }
      }
    }

    return { hadErrors };
  }

  private async clearLegacyDataJson(): Promise<void> {
    const dataJson = await this.loadDataJson();
    if (!dataJson) {
      return;
    }

    const cleaned: Record<string, unknown> = { ...dataJson };
    delete cleaned.lastEnvHash;
    delete cleaned.lastClaudeModel;
    delete cleaned.lastCustomModel;
    delete cleaned.conversations;
    delete cleaned.slashCommands;
    delete cleaned.migrationVersion;

    if (Object.keys(cleaned).length === 0) {
      await this.plugin.saveData({});
      return;
    }

    await this.plugin.saveData(cleaned);
  }

  private async loadDataJson(): Promise<LegacyDataJson | null> {
    try {
      const data = await this.plugin.loadData();
      return data || null;
    } catch {
      // data.json may not exist on fresh installs
      return null;
    }
  }

  async ensureDirectories(): Promise<void> {
    await this.adapter.ensureFolder(CODEXIAN_PATH);
    await this.adapter.ensureFolder(COMMANDS_PATH);
    await this.adapter.ensureFolder(SKILLS_PATH);
    await this.adapter.ensureFolder(SESSIONS_PATH);
    await this.adapter.ensureFolder(AGENTS_PATH);
  }

  async loadAllSlashCommands(): Promise<SlashCommand[]> {
    const commands = await this.commands.loadAll();
    const skills = await this.skills.loadAll();
    return [...commands, ...skills];
  }

  getAdapter(): VaultFileAdapter {
    return this.adapter;
  }

  async getPermissions(): Promise<CCPermissions> {
    return this.ccSettings.getPermissions();
  }

  async updatePermissions(permissions: CCPermissions): Promise<void> {
    return this.ccSettings.updatePermissions(permissions);
  }

  async addAllowRule(rule: string): Promise<void> {
    return this.ccSettings.addAllowRule(createPermissionRule(rule));
  }

  async addDenyRule(rule: string): Promise<void> {
    return this.ccSettings.addDenyRule(createPermissionRule(rule));
  }

  /**
   * Remove a permission rule from all lists.
   */
  async removePermissionRule(rule: string): Promise<void> {
    return this.ccSettings.removeRule(createPermissionRule(rule));
  }

  async updateClaudianSettings(updates: Partial<StoredClaudianSettings>): Promise<void> {
    return this.claudianSettings.update(updates);
  }

  async saveClaudianSettings(settings: StoredClaudianSettings): Promise<void> {
    return this.claudianSettings.save(settings);
  }

  async loadClaudianSettings(): Promise<StoredClaudianSettings> {
    return this.claudianSettings.load();
  }

  /**
   * Get legacy activeConversationId from storage (claudian-settings.json or data.json).
   */
  async getLegacyActiveConversationId(): Promise<string | null> {
    const fromSettings = await this.claudianSettings.getLegacyActiveConversationId();
    if (fromSettings) {
      return fromSettings;
    }

    const dataJson = await this.loadDataJson();
    if (dataJson && typeof dataJson.activeConversationId === 'string') {
      return dataJson.activeConversationId;
    }

    return null;
  }

  /**
   * Remove legacy activeConversationId from storage after migration.
   */
  async clearLegacyActiveConversationId(): Promise<void> {
    await this.claudianSettings.clearLegacyActiveConversationId();

    const dataJson = await this.loadDataJson();
    if (!dataJson || !('activeConversationId' in dataJson)) {
      return;
    }

    const cleaned: Record<string, unknown> = { ...dataJson };
    delete cleaned.activeConversationId;
    await this.plugin.saveData(cleaned);
  }

  /**
   * Get tab manager state from data.json with runtime validation.
   */
  async getTabManagerState(): Promise<TabManagerPersistedState | null> {
    try {
      const data = await this.plugin.loadData();
      const dataRecord = data && typeof data === 'object'
        ? data as Record<string, unknown>
        : null;
      const currentState = this.validateTabManagerState(dataRecord?.tabManagerState);
      if (currentState) {
        return currentState;
      }

      const legacyState = await this.getLegacyClaudianTabManagerState();
      if (!legacyState) {
        return null;
      }

      await this.plugin.saveData({
        ...(dataRecord ?? {}),
        tabManagerState: legacyState,
      });

      return legacyState;
    } catch {
      return null;
    }
  }

  private async getLegacyClaudianTabManagerState(): Promise<TabManagerPersistedState | null> {
    if (!(await this.adapter.exists(LEGACY_CLAUDIAN_PLUGIN_DATA_PATH))) {
      return null;
    }

    try {
      const content = await this.adapter.read(LEGACY_CLAUDIAN_PLUGIN_DATA_PATH);
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return this.validateTabManagerState(parsed?.tabManagerState);
    } catch {
      return null;
    }
  }

  /**
   * Validates and sanitizes tab manager state from storage.
   * Returns null if the data is invalid or corrupted.
   */
  private validateTabManagerState(data: unknown): TabManagerPersistedState | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const state = data as Record<string, unknown>;

    if (!Array.isArray(state.openTabs)) {
      return null;
    }

    const validatedTabs: Array<{ tabId: string; conversationId: string | null }> = [];
    for (const tab of state.openTabs) {
      if (!tab || typeof tab !== 'object') {
        continue; // Skip invalid entries
      }
      const tabObj = tab as Record<string, unknown>;
      if (typeof tabObj.tabId !== 'string') {
        continue; // Skip entries without valid tabId
      }
      validatedTabs.push({
        tabId: tabObj.tabId,
        conversationId:
          typeof tabObj.conversationId === 'string' ? tabObj.conversationId : null,
      });
    }

    const activeTabId =
      typeof state.activeTabId === 'string' ? state.activeTabId : null;

    return {
      openTabs: validatedTabs,
      activeTabId,
    };
  }

  async setTabManagerState(state: TabManagerPersistedState): Promise<void> {
    try {
      const data = (await this.plugin.loadData()) || {};
      data.tabManagerState = state;
      await this.plugin.saveData(data);
    } catch {
      new Notice('Failed to save tab layout');
    }
  }
}

/**
 * Persisted state for the tab manager.
 * Stored in data.json (machine-specific, not shared).
 */
export interface TabManagerPersistedState {
  openTabs: Array<{ tabId: string; conversationId: string | null }>;
  activeTabId: string | null;
}
