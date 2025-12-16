/**
 * Security Hooks
 *
 * PreToolUse hooks for enforcing blocklist and vault restriction.
 */

import type { HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk';

import type { PathCheckContext } from '../security/BashPathValidator';
import { findBashCommandPathViolation } from '../security/BashPathValidator';
import { isCommandBlocked } from '../security/BlocklistChecker';
import { getPathFromToolInput } from '../tools/toolInput';
import { isEditTool, isFileTool, TOOL_BASH } from '../tools/toolNames';

/** Context for blocklist checking. */
export interface BlocklistContext {
  blockedCommands: string[];
  enableBlocklist: boolean;
}

/** Context for vault restriction checking. */
export interface VaultRestrictionContext {
  isPathWithinVault: (filePath: string) => boolean;
  isAllowedExportPath: (filePath: string) => boolean;
  onEditBlocked?: (toolName: string, toolInput: Record<string, unknown>) => void;
}

/**
 * Create a PreToolUse hook to enforce the command blocklist.
 */
export function createBlocklistHook(getContext: () => BlocklistContext): HookCallbackMatcher {
  return {
    matcher: TOOL_BASH,
    hooks: [
      async (hookInput) => {
        const input = hookInput as {
          tool_name: string;
          tool_input: { command?: string };
        };
        const command = input.tool_input?.command || '';
        const context = getContext();

        if (isCommandBlocked(command, context.blockedCommands, context.enableBlocklist)) {
          return {
            continue: false,
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              permissionDecision: 'deny' as const,
              permissionDecisionReason: `Command blocked by blocklist: ${command}`,
            },
          };
        }

        return { continue: true };
      },
    ],
  };
}

/**
 * Create a PreToolUse hook to restrict file access to the vault.
 */
export function createVaultRestrictionHook(context: VaultRestrictionContext): HookCallbackMatcher {
  return {
    hooks: [
      async (hookInput) => {
        const input = hookInput as {
          tool_name: string;
          tool_input: Record<string, unknown>;
        };

        const toolName = input.tool_name;

        // Bash: inspect command for paths that escape the vault
        if (toolName === TOOL_BASH) {
          const command = (input.tool_input?.command as string) || '';
          const pathCheckContext: PathCheckContext = {
            isPathWithinVault: (p) => context.isPathWithinVault(p),
            isAllowedExportPath: (p) => context.isAllowedExportPath(p),
          };
          const violation = findBashCommandPathViolation(command, pathCheckContext);
          if (violation) {
            const reason =
              violation.type === 'export_path_read'
                ? `Access denied: Command path "${violation.path}" is in an allowed export directory, but export paths are write-only.`
                : `Access denied: Command path "${violation.path}" is outside the vault. Agent is restricted to vault directory only.`;
            return {
              continue: false,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse' as const,
                permissionDecision: 'deny' as const,
                permissionDecisionReason: reason,
              },
            };
          }
          return { continue: true };
        }

        // Skip if not a file-related tool
        if (!isFileTool(toolName)) {
          return { continue: true };
        }

        // Get the path from tool input
        const filePath = getPathFromToolInput(toolName, input.tool_input);

        if (filePath && !context.isPathWithinVault(filePath)) {
          // Allow write operations to allowed export paths
          if (isEditTool(toolName) && context.isAllowedExportPath(filePath)) {
            return { continue: true };
          }

          // Clean up edit state when blocking Write/Edit/NotebookEdit
          if (isEditTool(toolName)) {
            context.onEditBlocked?.(toolName, input.tool_input);
          }

          return {
            continue: false,
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              permissionDecision: 'deny' as const,
              permissionDecisionReason: `Access denied: Path "${filePath}" is outside the vault. Agent is restricted to vault directory only.`,
            },
          };
        }

        return { continue: true };
      },
    ],
  };
}
