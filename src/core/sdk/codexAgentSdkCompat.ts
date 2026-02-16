import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { createInterface } from 'readline';

export type SdkBeta = string;

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  url?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export type PermissionBehavior = 'allow' | 'deny' | 'ask';
export type PermissionUpdateDestination = 'userSettings' | 'projectSettings' | 'localSettings' | 'session' | 'cliArg';
export type PermissionMode = 'acceptEdits' | 'bypassPermissions' | 'default' | 'delegate' | 'dontAsk' | 'plan';
export type SDKPermissionMode = PermissionMode;

export type PermissionRuleValue = {
  toolName: string;
  ruleContent?: string;
};

export type PermissionUpdate = {
  type: string;
  behavior?: PermissionBehavior;
  destination?: PermissionUpdateDestination;
  rules?: PermissionRuleValue[];
  mode?: PermissionMode;
  directories?: string[];
  [key: string]: unknown;
};

export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[]; toolUseID?: string }
  | { behavior: 'deny'; message: string; interrupt?: boolean; toolUseID?: string };

export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal?: AbortSignal;
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    toolUseID?: string;
    agentID?: string;
  }
) => Promise<PermissionResult>;

export type SDKToolUseResult = string | Record<string, unknown> | unknown[];

export interface SDKContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'image';
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | unknown;
  is_error?: boolean;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface SDKMessageContent {
  content?: SDKContentBlock[];
  role?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface SDKStreamEvent {
  type: 'content_block_start' | 'content_block_delta';
  index?: number;
  content_block?: SDKContentBlock;
  delta?: {
    type: 'text_delta' | 'thinking_delta';
    text?: string;
    thinking?: string;
  };
}

export interface ModelUsageInfo {
  inputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface SDKNonResultMessage {
  type: 'system' | 'assistant' | 'user' | 'stream_event' | 'error' | 'tool_progress' | 'auth_status';
  subtype?: 'init' | 'compact_boundary' | 'status' | 'hook_response' | string;
  uuid?: string;
  session_id?: string;
  message?: SDKMessageContent;
  tool_use_result?: SDKToolUseResult;
  parent_tool_use_id?: string | null;
  event?: SDKStreamEvent;
  error?: string;
  tool_use_id?: string;
  tool_name?: string;
  elapsed_time_seconds?: number;
  isAuthenticating?: boolean;
  _blocked?: boolean;
  _blockReason?: string;
  output?: string | string[];
  modelUsage?: Record<string, ModelUsageInfo>;
  model?: string;
  agents?: string[];
  skills?: string[];
  slash_commands?: string[];
  permissionMode?: string;
}

export interface SDKResultMessage {
  type: 'result';
  subtype?: string;
  uuid?: string;
  session_id?: string;
  modelUsage?: Record<string, ModelUsageInfo>;
  model?: string;
}

export type SDKMessage = SDKNonResultMessage | SDKResultMessage;

export interface SDKUserMessage {
  type: 'user';
  uuid?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  message: {
    role?: 'user';
    content?: string | SDKContentBlock[];
  };
}

export interface SlashCommand {
  name: string;
  description?: string;
  argumentHint?: string;
}

export interface RewindFilesResult {
  canRewind: boolean;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
  message?: string;
  error?: string;
}

export interface HookCallbackMatcher {
  matcher?: string;
  hooks: Array<(
    hookInput: unknown,
    toolUseID: string,
    options: { signal?: AbortSignal }
  ) => Promise<{ continue: boolean; hookSpecificOutput?: unknown }>>;
}

export interface HooksConfig {
  PreToolUse?: HookCallbackMatcher[];
  [eventName: string]: HookCallbackMatcher[] | undefined;
}

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface SpawnedProcess {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr?: NodeJS.ReadableStream | null;
}

export type AgentDefinition = {
  description: string;
  tools?: string[];
  disallowedTools?: string[];
  prompt: string;
  model?: string;
  mcpServers?: unknown[];
  skills?: string[];
  maxTurns?: number;
  hooks?: Record<string, unknown>;
};

export interface Options {
  cwd: string;
  systemPrompt?: string | { content: string; cacheControl?: { type: string } };
  model?: string;
  abortController?: AbortController;
  pathToClaudeCodeExecutable?: string;
  settingSources?: Array<'user' | 'project' | 'local' | string>;
  env?: Record<string, string>;
  includePartialMessages?: boolean;
  betas?: SdkBeta[];
  extraArgs?: Record<string, unknown>;
  disallowedTools?: string[];
  tools?: string[];
  hooks?: HooksConfig;
  allowDangerouslySkipPermissions?: boolean;
  permissionMode?: PermissionMode;
  maxThinkingTokens?: number;
  canUseTool?: CanUseTool;
  mcpServers?: Record<string, McpServerConfig>;
  additionalDirectories?: string[];
  resume?: string;
  resumeSessionAt?: string;
  forkSession?: boolean;
  enableFileCheckpointing?: boolean;
  persistSession?: boolean;
  plugins?: Record<string, unknown>;
  agents?: Record<string, AgentDefinition>;
  spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess;
}

export interface Query extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
  setMaxThinkingTokens(tokens?: number | null): Promise<void>;
  setPermissionMode(mode: PermissionMode | string): Promise<void>;
  setMcpServers(servers: Record<string, McpServerConfig>): Promise<void>;
  supportedCommands(): Promise<SlashCommand[]>;
  rewindFiles(_sdkUserUuid: string, _options?: { dryRun?: boolean }): Promise<RewindFilesResult>;
}

interface QueryParams {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options: Options;
}

interface CodexJsonEvent {
  type: string;
  thread_id?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
  };
  item?: {
    id?: string;
    type?: string;
    text?: string;
    command?: string;
    aggregated_output?: string;
    exit_code?: number | null;
    status?: string;
  };
  error?: unknown;
  [key: string]: unknown;
}

interface SpawnedTurn {
  kill: () => void;
}

class CodexQuery implements Query {
  private readonly input: string | AsyncIterable<SDKUserMessage>;
  private readonly queue: SDKMessage[] = [];
  private readonly waiters: Array<(value: IteratorResult<SDKMessage>) => void> = [];
  private runningTurn: SpawnedTurn | null = null;
  private finished = false;
  private initEmitted = false;
  private permissionMode: string | undefined;
  private model: string | undefined;
  private maxThinkingTokens: number | undefined;
  private mcpServers: Record<string, McpServerConfig> | undefined;
  private sessionId: string | null;
  private forcedSessionId: string | null;

  constructor(params: QueryParams) {
    this.input = params.prompt;
    this.permissionMode = params.options.permissionMode;
    this.model = params.options.model;
    this.maxThinkingTokens = params.options.maxThinkingTokens;
    this.mcpServers = params.options.mcpServers;
    this.sessionId = params.options.resume ?? null;
    this.forcedSessionId = params.options.resume ?? null;

    if (this.isAsyncIterable(this.input)) {
      void this.runPersistentLoop(params.options);
      return;
    }

    void this.runSingleTurn(this.normalizePromptText(this.input), [], params.options)
      .catch((error: unknown) => {
        this.enqueue({ type: 'error', error: this.toErrorMessage(error) });
      })
      .finally(() => {
        this.enqueue({ type: 'result', session_id: this.sessionId ?? undefined, uuid: randomUUID() });
        this.finish();
      });
  }

  private isAsyncIterable(value: unknown): value is AsyncIterable<SDKUserMessage> {
    return !!value && typeof value === 'object' && Symbol.asyncIterator in value;
  }

  private async runPersistentLoop(options: Options): Promise<void> {
    try {
      for await (const message of this.input as AsyncIterable<SDKUserMessage>) {
        const prompt = this.extractPromptText(message);
        const images = this.extractImages(message);

        this.enqueue({
          type: 'user',
          uuid: randomUUID(),
          session_id: this.sessionId ?? undefined,
          message: {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
          },
        });

        await this.runSingleTurn(prompt, images, options);
        this.enqueue({ type: 'result', session_id: this.sessionId ?? undefined, uuid: randomUUID() });
      }
    } catch (error: unknown) {
      this.enqueue({ type: 'error', error: this.toErrorMessage(error) });
      this.enqueue({ type: 'result', session_id: this.sessionId ?? undefined, uuid: randomUUID() });
    } finally {
      this.finish();
    }
  }

  private async runSingleTurn(prompt: string, images: string[], options: Options): Promise<void> {
    const command = options.pathToClaudeCodeExecutable || 'codex';
    const args = this.buildCodexArgs(prompt, images);
    await this.spawnTurn(command, args, options, (event) => this.handleCodexEvent(event));
  }

  private buildCodexArgs(prompt: string, images: string[]): string[] {
    const args: string[] = ['exec', '--json'];

    if (this.model) {
      args.push('--model', this.model);
    }

    this.applyPermissionAndSandboxArgs(args);

    if (this.maxThinkingTokens && this.maxThinkingTokens > 0) {
      args.push('-c', `model_reasoning_effort=${JSON.stringify(this.mapThinkingBudget(this.maxThinkingTokens))}`);
    }

    for (const image of images) {
      args.push('--image', image);
    }

    if (this.forcedSessionId) {
      args.push('resume', this.forcedSessionId, prompt);
      this.forcedSessionId = null;
      return args;
    }

    if (this.sessionId) {
      args.push('resume', this.sessionId, prompt);
      return args;
    }

    args.push(prompt);
    return args;
  }

  private applyPermissionAndSandboxArgs(args: string[]): void {
    if (this.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-bypass-approvals-and-sandbox');
      return;
    }

    args.push('-c', 'approval_policy="on-request"');
    if (this.permissionMode === 'plan') {
      args.push('--sandbox', 'read-only');
      return;
    }
    args.push('--sandbox', 'workspace-write');
  }

  private mapThinkingBudget(tokens: number): 'minimal' | 'low' | 'medium' | 'high' {
    if (tokens <= 4_000) return 'minimal';
    if (tokens <= 8_000) return 'low';
    if (tokens <= 16_000) return 'medium';
    return 'high';
  }

  private spawnTurn(
    command: string,
    args: string[],
    options: Options,
    onEvent: (event: CodexJsonEvent) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        ...(options.env || {}),
      };

      const child = spawn(command, args, {
        cwd: options.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.runningTurn = {
        kill: () => {
          try {
            child.kill('SIGTERM');
          } catch {
            // Ignore process kill errors.
          }
        },
      };

      const stdout = createInterface({ input: child.stdout });
      const stderr = createInterface({ input: child.stderr });

      stdout.on('line', (line: string) => {
        const event = this.tryParseJson(line);
        if (event) {
          onEvent(event);
        }
      });

      stderr.on('line', () => {
        // Codex prints operational logs on stderr; ignore by design.
      });

      child.once('error', (error: unknown) => {
        this.runningTurn = null;
        reject(error);
      });

      child.once('close', (code: number | null) => {
        this.runningTurn = null;
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`codex exited with code ${String(code)}`));
      });

      const signal = options.abortController?.signal;
      if (!signal) {
        return;
      }

      if (signal.aborted) {
        this.runningTurn?.kill();
        return;
      }

      signal.addEventListener('abort', () => {
        this.runningTurn?.kill();
      }, { once: true });
    });
  }

  private handleCodexEvent(event: CodexJsonEvent): void {
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
      this.sessionId = event.thread_id;
      if (!this.initEmitted) {
        this.initEmitted = true;
        this.enqueue({
          type: 'system',
          subtype: 'init',
          session_id: event.thread_id,
          uuid: randomUUID(),
          permissionMode: this.permissionMode,
        });
      }
      return;
    }

    if (event.type === 'item.started' && event.item?.type === 'command_execution') {
      const id = event.item.id || randomUUID();
      this.enqueue({
        type: 'assistant',
        uuid: randomUUID(),
        message: {
          content: [
            {
              type: 'tool_use',
              id,
              name: 'Bash',
              input: {
                command: event.item.command || '',
              },
            },
          ],
        },
      });
      return;
    }

    if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
      const id = event.item.id || randomUUID();
      this.enqueue({
        type: 'user',
        uuid: randomUUID(),
        parent_tool_use_id: id,
        tool_use_result: {
          output: event.item.aggregated_output || '',
          exitCode: event.item.exit_code,
        },
      });
      return;
    }

    if (event.type === 'item.completed' && event.item?.type === 'reasoning') {
      if (!event.item.text) return;
      this.enqueue({
        type: 'assistant',
        uuid: randomUUID(),
        message: {
          content: [
            {
              type: 'thinking',
              thinking: event.item.text,
            },
          ],
        },
      });
      return;
    }

    if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
      if (!event.item.text) return;
      this.enqueue({
        type: 'assistant',
        uuid: randomUUID(),
        message: {
          content: [
            {
              type: 'text',
              text: event.item.text,
            },
          ],
        },
      });
      return;
    }

    if (event.type === 'turn.completed') {
      this.enqueue({
        type: 'assistant',
        uuid: randomUUID(),
        message: {
          content: [],
          usage: {
            input_tokens: event.usage?.input_tokens || 0,
            output_tokens: event.usage?.output_tokens || 0,
            cache_read_input_tokens: event.usage?.cached_input_tokens || 0,
            cache_creation_input_tokens: 0,
          },
        },
      });
      return;
    }

    if (event.type === 'error') {
      this.enqueue({
        type: 'error',
        uuid: randomUUID(),
        error: this.toErrorMessage(event.error),
      });
    }
  }

  private extractPromptText(message: SDKUserMessage): string {
    const content = message.message?.content;
    if (!content) return '';
    if (typeof content === 'string') return this.normalizePromptText(content);

    return this.normalizePromptText(
      content
        .filter((block): block is SDKContentBlock => block.type === 'text')
        .map((block) => block.text || '')
        .join('\n\n')
    );
  }

  private extractImages(message: SDKUserMessage): string[] {
    const content = message.message?.content;
    if (!content || typeof content === 'string') return [];

    const images: string[] = [];
    for (const block of content) {
      if (block.type !== 'image') continue;
      const mediaType = block.source?.media_type || 'image/png';
      const data = block.source?.data || '';
      if (!data) continue;
      images.push(`data:${mediaType};base64,${data}`);
    }
    return images;
  }

  private normalizePromptText(text: string): string {
    return text.trim();
  }

  private tryParseJson(line: string): CodexJsonEvent | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      return null;
    }

    try {
      return JSON.parse(trimmed) as CodexJsonEvent;
    } catch {
      return null;
    }
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
      return (error as { message: string }).message;
    }
    return 'Unknown Codex error';
  }

  private enqueue(message: SDKMessage): void {
    if (this.finished) return;

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: message, done: false });
      return;
    }

    this.queue.push(message);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.({ value: undefined, done: true });
    }
  }

  async interrupt(): Promise<void> {
    this.runningTurn?.kill();
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
  }

  async setMaxThinkingTokens(tokens?: number | null): Promise<void> {
    this.maxThinkingTokens = tokens ?? undefined;
  }

  async setPermissionMode(mode: PermissionMode | string): Promise<void> {
    this.permissionMode = mode;
  }

  async setMcpServers(servers: Record<string, McpServerConfig>): Promise<void> {
    this.mcpServers = servers;
  }

  async supportedCommands(): Promise<SlashCommand[]> {
    return [];
  }

  async rewindFiles(_sdkUserUuid: string, _options?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    return {
      canRewind: false,
      filesChanged: [],
      insertions: 0,
      deletions: 0,
      message: 'Rewind is not supported in Codex CLI mode.',
      error: 'unsupported',
    };
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: async (): Promise<IteratorResult<SDKMessage>> => {
        if (this.queue.length > 0) {
          const value = this.queue.shift() as SDKMessage;
          return { value, done: false };
        }

        if (this.finished) {
          return { value: undefined, done: true };
        }

        return new Promise<IteratorResult<SDKMessage>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

export function query(params: QueryParams): Query {
  return new CodexQuery(params);
}
