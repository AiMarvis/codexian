/**
 * Model type definitions and constants.
 */

import type { SdkBeta } from '@/core/sdk/codexAgentSdkCompat';

/** Model identifier (string to support custom models via environment variables). */
export type CodexModel = string;
/** @deprecated Use CodexModel. Kept for compatibility with existing internal types/tests. */
export type ClaudeModel = CodexModel;

export const DEFAULT_CODEX_MODELS: { value: CodexModel; label: string; description: string }[] = [
  { value: 'gpt-5-codex', label: 'GPT-5 Codex', description: 'Best for coding tasks' },
  { value: 'gpt-5', label: 'GPT-5', description: 'General high-capability model' },
  { value: 'o4-mini', label: 'o4-mini', description: 'Fast and lightweight' },
];

/** @deprecated Use DEFAULT_CODEX_MODELS. */
export const DEFAULT_CLAUDE_MODELS = DEFAULT_CODEX_MODELS;

export const BETA_1M_CONTEXT: SdkBeta = 'context-1m-2025-08-07';

export interface ModelWithBetas {
  model: string;
  betas: SdkBeta[];
}

export interface ModelWithoutBetas {
  model: string;
  betas?: undefined;
}

/** Resolves a model to its base model and optional beta flags. */
export function resolveModelWithBetas(model: string, include1MBeta: true): ModelWithBetas;
export function resolveModelWithBetas(model: string, include1MBeta?: false): ModelWithoutBetas;
export function resolveModelWithBetas(model: string, include1MBeta: boolean): ModelWithBetas | ModelWithoutBetas;
export function resolveModelWithBetas(model: string, include1MBeta = false): ModelWithBetas | ModelWithoutBetas {
  if (!model || typeof model !== 'string') {
    throw new Error('resolveModelWithBetas: model is required and must be a non-empty string');
  }
  if (include1MBeta) {
    return {
      model,
      betas: [BETA_1M_CONTEXT],
    };
  }
  return { model };
}

export type ThinkingBudget = 'off' | 'low' | 'medium' | 'high' | 'xhigh';

export const THINKING_BUDGETS: { value: ThinkingBudget; label: string; tokens: number }[] = [
  { value: 'off', label: 'Off', tokens: 0 },
  { value: 'low', label: 'Low', tokens: 4000 },
  { value: 'medium', label: 'Med', tokens: 8000 },
  { value: 'high', label: 'High', tokens: 16000 },
  { value: 'xhigh', label: 'Ultra', tokens: 32000 },
];

/** Default thinking budget per model tier. */
export const DEFAULT_THINKING_BUDGET: Record<string, ThinkingBudget> = {
  'o4-mini': 'off',
  'gpt-5-codex': 'medium',
  'gpt-5': 'low',
};

export const CONTEXT_WINDOW_STANDARD = 200_000;
export const CONTEXT_WINDOW_1M = 1_000_000;

export function getContextWindowSize(
  model: string,
  is1MEnabled = false,
  customLimits?: Record<string, number>
): number {
  if (customLimits && model in customLimits) {
    const limit = customLimits[model];
    if (typeof limit === 'number' && limit > 0 && !isNaN(limit) && isFinite(limit)) {
      return limit;
    }
  }

  // Keep compatibility toggle for installations that still expose a 1M option.
  if (is1MEnabled && model.includes('gpt-5')) {
    return CONTEXT_WINDOW_1M;
  }
  return CONTEXT_WINDOW_STANDARD;
}
