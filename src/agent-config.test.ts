import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';

let tmpRoot: string;
let projectRoot: string;
let claudeclawConfig: string;
let storeDir: string;

// Mock config BEFORE importing agent-config so STORE_DIR/PROJECT_ROOT point at tmp.
vi.mock('./config.js', () => {
  return {
    get CLAUDECLAW_CONFIG() { return claudeclawConfig; },
    get PROJECT_ROOT() { return projectRoot; },
    get STORE_DIR() { return storeDir; },
    get SHARED_CLAUDE_DIR() { return ''; },
  };
});

// Mock env reader so loadAgentConfig doesn't fail on missing bot token.
vi.mock('./env.js', () => ({
  readEnvFile: () => ({ TEST_BOT_TOKEN: 'dummy' }),
}));

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeclaw-agent-config-'));
  projectRoot = path.join(tmpRoot, 'project');
  claudeclawConfig = path.join(tmpRoot, 'config');
  storeDir = path.join(tmpRoot, 'store');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(claudeclawConfig, { recursive: true });
  fs.mkdirSync(storeDir, { recursive: true });
  process.env.TEST_BOT_TOKEN = 'dummy';
});

afterEach(() => {
  delete process.env.TEST_BOT_TOKEN;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeAgentYaml(agentId: string, content: Record<string, unknown>): string {
  const agentDir = path.join(projectRoot, 'agents', agentId);
  fs.mkdirSync(agentDir, { recursive: true });
  const yamlPath = path.join(agentDir, 'agent.yaml');
  fs.writeFileSync(yamlPath, yaml.dump(content), 'utf-8');
  return yamlPath;
}

describe('setAgentDescription', () => {
  it('updates the description field in agent.yaml', async () => {
    const yamlPath = writeAgentYaml('raka', {
      name: 'Raka',
      description: 'Old description',
      telegram_bot_token_env: 'TEST_BOT_TOKEN',
      model: 'claude-haiku-4-5',
    });

    const { setAgentDescription, loadAgentConfig } = await import('./agent-config.js');
    setAgentDescription('raka', 'New research librarian');

    const raw = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
    expect(raw.description).toBe('New research librarian');
    expect(raw.model).toBe('claude-haiku-4-5');
    expect(raw.name).toBe('Raka');

    const config = loadAgentConfig('raka');
    expect(config.description).toBe('New research librarian');
  });

  it('trims whitespace before saving', async () => {
    writeAgentYaml('raka', {
      name: 'Raka',
      description: 'old',
      telegram_bot_token_env: 'TEST_BOT_TOKEN',
    });

    const { setAgentDescription, loadAgentConfig } = await import('./agent-config.js');
    setAgentDescription('raka', '  padded value  ');

    expect(loadAgentConfig('raka').description).toBe('padded value');
  });

  it('rejects empty description', async () => {
    writeAgentYaml('raka', {
      name: 'Raka',
      description: 'keep me',
      telegram_bot_token_env: 'TEST_BOT_TOKEN',
    });

    const { setAgentDescription, loadAgentConfig } = await import('./agent-config.js');
    expect(() => setAgentDescription('raka', '   ')).toThrow(/empty/);
    expect(loadAgentConfig('raka').description).toBe('keep me');
  });

  it('throws when agent does not exist', async () => {
    const { setAgentDescription } = await import('./agent-config.js');
    expect(() => setAgentDescription('ghost', 'hi')).toThrow(/not found/);
  });
});

describe('main description', () => {
  it('returns default when no config file exists', async () => {
    const { getMainDescription, DEFAULT_MAIN_DESCRIPTION } = await import('./agent-config.js');
    expect(getMainDescription()).toBe(DEFAULT_MAIN_DESCRIPTION);
  });

  it('persists and reads back the description', async () => {
    const { setMainDescription, getMainDescription } = await import('./agent-config.js');
    setMainDescription('My personal assistant');
    expect(getMainDescription()).toBe('My personal assistant');
  });

  it('trims whitespace on save', async () => {
    const { setMainDescription, getMainDescription } = await import('./agent-config.js');
    setMainDescription('  trimmed  ');
    expect(getMainDescription()).toBe('trimmed');
  });

  it('rejects empty description', async () => {
    const { setMainDescription } = await import('./agent-config.js');
    expect(() => setMainDescription('   ')).toThrow(/empty/);
  });

  it('falls back to default when file is corrupt', async () => {
    fs.writeFileSync(path.join(storeDir, 'main-config.json'), 'not valid json', 'utf-8');
    const { getMainDescription, DEFAULT_MAIN_DESCRIPTION } = await import('./agent-config.js');
    expect(getMainDescription()).toBe(DEFAULT_MAIN_DESCRIPTION);
  });

  it('preserves other keys in main-config.json', async () => {
    const configPath = path.join(storeDir, 'main-config.json');
    fs.writeFileSync(configPath, JSON.stringify({ other: 'value' }), 'utf-8');

    const { setMainDescription } = await import('./agent-config.js');
    setMainDescription('hello');

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(raw.description).toBe('hello');
    expect(raw.other).toBe('value');
  });
});

describe('resolveAgentDisplayName', () => {
  it('returns the configured name when agent.yaml has a name field', async () => {
    writeAgentYaml('felix', {
      name: 'Felix',
      description: 'Test agent',
      telegram_bot_token_env: 'TEST_BOT_TOKEN',
    });

    const { resolveAgentDisplayName } = await import('./agent-config.js');
    expect(resolveAgentDisplayName('felix')).toBe('Felix');
  });

  it('returns capitalized id when agent.yaml has no name field', async () => {
    // Write a minimal agent.yaml with name set (required by loadAgentConfig)
    // but test the fallback path by writing yaml without name
    const agentDir = path.join(projectRoot, 'agents', 'noname');
    fs.mkdirSync(agentDir, { recursive: true });
    // loadAgentConfig requires 'name', so if name is missing it throws.
    // resolveAgentDisplayName catches the throw and falls back to capitalize(id).
    fs.writeFileSync(
      path.join(agentDir, 'agent.yaml'),
      yaml.dump({ description: 'no name here', telegram_bot_token_env: 'TEST_BOT_TOKEN' }),
      'utf-8',
    );

    const { resolveAgentDisplayName } = await import('./agent-config.js');
    expect(resolveAgentDisplayName('noname')).toBe('Noname');
  });

  it('returns capitalized id when agent.yaml does not exist (no throw)', async () => {
    const { resolveAgentDisplayName } = await import('./agent-config.js');
    // 'ghost' has no agent.yaml anywhere
    expect(resolveAgentDisplayName('ghost')).toBe('Ghost');
  });
});

describe('loadAgentConfig main fallback', () => {
  it('succeeds without telegram_bot_token_env when TELEGRAM_BOT_TOKEN env var is set', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fallback-token';

    writeAgentYaml('main', {
      name: 'Holden',
      description: 'Hub agent',
      // No telegram_bot_token_env - should fall back to TELEGRAM_BOT_TOKEN
    });

    const { loadAgentConfig } = await import('./agent-config.js');
    const config = loadAgentConfig('main');
    expect(config.name).toBe('Holden');
    expect(config.botToken).toBe('fallback-token');

    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('uses the name from agent.yaml', async () => {
    writeAgentYaml('main', {
      name: 'Holden',
      description: 'Hub agent',
      telegram_bot_token_env: 'TEST_BOT_TOKEN',
    });

    const { loadAgentConfig } = await import('./agent-config.js');
    const config = loadAgentConfig('main');
    expect(config.name).toBe('Holden');
  });
});

describe('provider config', () => {
  it('keeps legacy installs on Claude when no provider is configured', async () => {
    const { getMainProviderConfig } = await import('./provider.js');
    expect(getMainProviderConfig()).toEqual({ type: 'claude', model: 'claude-opus-4-6' });
  });

  it('maps legacy Claude model to Claude provider', async () => {
    writeAgentYaml('legacy', {
      name: 'Legacy',
      description: 'old',
      telegram_bot_token_env: 'TEST_BOT_TOKEN',
      model: 'claude-sonnet-4-6',
    });

    const { loadAgentConfig } = await import('./agent-config.js');
    const config = loadAgentConfig('legacy');
    expect(config.provider).toEqual({ type: 'claude', model: 'claude-sonnet-4-6' });
  });

  it('loads explicit OpenCode provider without a model override', async () => {
    writeAgentYaml('open', {
      name: 'Open',
      description: 'new',
      telegram_bot_token_env: 'TEST_BOT_TOKEN',
      provider: { type: 'opencode' },
    });

    const { loadAgentConfig } = await import('./agent-config.js');
    const config = loadAgentConfig('open');
    expect(config.provider).toEqual({ type: 'opencode' });
    expect(config.model).toBeUndefined();
  });

  it('loads built-in ACP provider presets', async () => {
    writeAgentYaml('gemini-agent', {
      name: 'Gemini Agent',
      description: 'gemini',
      telegram_bot_token_env: 'TEST_BOT_TOKEN',
      provider: { type: 'gemini' },
    });
    writeAgentYaml('codex-agent', {
      name: 'Codex Agent',
      description: 'codex',
      telegram_bot_token_env: 'TEST_BOT_TOKEN',
      provider: { type: 'codex' },
    });

    const { loadAgentConfig } = await import('./agent-config.js');
    expect(loadAgentConfig('gemini-agent').provider).toEqual({ type: 'gemini' });
    expect(loadAgentConfig('codex-agent').provider).toEqual({ type: 'codex' });
  });

  it('persists provider model and removes legacy model', async () => {
    const yamlPath = writeAgentYaml('switcher', {
      name: 'Switcher',
      description: 'switch',
      telegram_bot_token_env: 'TEST_BOT_TOKEN',
      model: 'claude-haiku-4-5',
    });

    const { setAgentProvider, loadAgentConfig } = await import('./agent-config.js');
    setAgentProvider('switcher', {
      type: 'opencode',
      model: 'opencode/gpt-5.3-codex',
      runtimeMode: 'deep',
      thinkingMode: 'on',
    });

    const raw = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
    expect(raw.model).toBeUndefined();
    expect(raw.provider).toEqual({
      type: 'opencode',
      model: 'opencode/gpt-5.3-codex',
      runtimeMode: 'deep',
      thinkingMode: 'on',
    });
    expect(loadAgentConfig('switcher').provider).toEqual({
      type: 'opencode',
      model: 'opencode/gpt-5.3-codex',
      runtimeMode: 'deep',
      thinkingMode: 'on',
    });
  });

  it('namespaces sessions by provider so switched providers start fresh', async () => {
    const {
      encodeProviderSession,
      decodeProviderSession,
      sessionBelongsToProvider,
    } = await import('./provider.js');

    const claudeSession = encodeProviderSession({ type: 'claude' }, 'abc');
    expect(claudeSession).toBe('claude:abc');
    expect(sessionBelongsToProvider(claudeSession, { type: 'opencode' })).toBe(false);
    expect(decodeProviderSession({ type: 'opencode' }, claudeSession)).toBeUndefined();
    expect(decodeProviderSession({ type: 'claude' }, claudeSession)).toBe('abc');
  });

  it('namespaces built-in ACP provider sessions separately', async () => {
    const {
      encodeProviderSession,
      decodeProviderSession,
      sessionBelongsToProvider,
    } = await import('./provider.js');

    const geminiSession = encodeProviderSession({ type: 'gemini' }, 'abc');
    expect(geminiSession).toBe('gemini:abc');
    expect(sessionBelongsToProvider(geminiSession, { type: 'codex' })).toBe(false);
    expect(decodeProviderSession({ type: 'codex' }, geminiSession)).toBeUndefined();
    expect(decodeProviderSession({ type: 'gemini' }, geminiSession)).toBe('abc');
  });
});

describe('ensureSharedCapabilitySymlinks', () => {
  let sharedDir: string;
  let agentDir: string;

  beforeEach(() => {
    sharedDir = path.join(tmpRoot, 'shared', '.claude');
    agentDir = path.join(tmpRoot, 'agents', 'ventures');
    fs.mkdirSync(path.join(sharedDir, 'skills', 'copywriting'), { recursive: true });
    fs.mkdirSync(path.join(sharedDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(sharedDir, 'agents', 'technical-writer.md'), '# tw', 'utf-8');
    fs.mkdirSync(agentDir, { recursive: true });
  });

  it('symlinks skills + agents into the agent .claude/ and resolves through them', async () => {
    const { ensureSharedCapabilitySymlinks } = await import('./agent-config.js');
    const linked = ensureSharedCapabilitySymlinks(agentDir, sharedDir);

    expect(linked.sort()).toEqual(['agents', 'skills']);
    for (const sub of ['skills', 'agents']) {
      const dst = path.join(agentDir, '.claude', sub);
      expect(fs.lstatSync(dst).isSymbolicLink()).toBe(true);
    }
    // Symlink resolves to the real shared content.
    expect(fs.existsSync(path.join(agentDir, '.claude', 'skills', 'copywriting'))).toBe(true);
    expect(fs.readFileSync(path.join(agentDir, '.claude', 'agents', 'technical-writer.md'), 'utf-8')).toBe('# tw');
  });

  it('is idempotent and never clobbers an existing per-agent settings.json', async () => {
    const { ensureSharedCapabilitySymlinks } = await import('./agent-config.js');
    // Pre-existing per-agent settings (e.g. Librarian's Karakeep MCP key).
    fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, '.claude', 'settings.json'), '{"mcpServers":{}}', 'utf-8');

    ensureSharedCapabilitySymlinks(agentDir, sharedDir);
    const second = ensureSharedCapabilitySymlinks(agentDir, sharedDir);

    expect(second).toEqual([]); // nothing new on the second run
    expect(fs.readFileSync(path.join(agentDir, '.claude', 'settings.json'), 'utf-8')).toBe('{"mcpServers":{}}');
  });

  it('does not clobber a hand-curated real dir at the target', async () => {
    const { ensureSharedCapabilitySymlinks } = await import('./agent-config.js');
    // Agent already has a curated skills/ dir — leave it alone, only link agents/.
    fs.mkdirSync(path.join(agentDir, '.claude', 'skills', 'custom-only'), { recursive: true });

    const linked = ensureSharedCapabilitySymlinks(agentDir, sharedDir);

    expect(linked).toEqual(['agents']);
    expect(fs.lstatSync(path.join(agentDir, '.claude', 'skills')).isDirectory()).toBe(true);
    expect(fs.lstatSync(path.join(agentDir, '.claude', 'skills')).isSymbolicLink()).toBe(false);
  });

  it('is a clean no-op when the shared dir is empty or missing', async () => {
    const { ensureSharedCapabilitySymlinks } = await import('./agent-config.js');
    expect(ensureSharedCapabilitySymlinks(agentDir, '')).toEqual([]);
    expect(ensureSharedCapabilitySymlinks(agentDir, path.join(tmpRoot, 'does-not-exist'))).toEqual([]);
    expect(fs.existsSync(path.join(agentDir, '.claude'))).toBe(false);
  });
});
