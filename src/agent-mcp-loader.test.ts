import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Mock the SDK + heavy deps so importing agent.js is side-effect free.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
vi.mock('./env.js', () => ({ readEnvFile: vi.fn(() => ({})) }));
vi.mock('./config.js', () => ({
  AGENT_MAX_TURNS: 30,
  PROJECT_ROOT: '/tmp/test',
  agentCwd: undefined,
  ENABLE_ACP: true,
}));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { loadMcpServers } from './agent.js';

let tmpHome: string;
let projectCwd: string;
let origHome: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-home-'));
  projectCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-proj-'));
  origHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(projectCwd, { recursive: true, force: true });
  delete process.env.KARAKEEP_API_KEY;
  delete process.env.TRANSCRIPTAPI_API_KEY;
});

function writeUserMcpJson(servers: Record<string, unknown>) {
  fs.writeFileSync(path.join(tmpHome, '.mcp.json'), JSON.stringify({ mcpServers: servers }));
}

describe('loadMcpServers', () => {
  it('loads remote http servers from ~/.mcp.json (the SDK loader used to drop these)', () => {
    writeUserMcpJson({
      cloudflare: { type: 'http', url: 'https://mcp.cloudflare.com/mcp' },
    });
    const servers = loadMcpServers(undefined, projectCwd);
    expect(servers.cloudflare).toEqual({ type: 'http', url: 'https://mcp.cloudflare.com/mcp' });
  });

  it('expands ${VAR} references in http headers and stdio env against process.env', () => {
    process.env.KARAKEEP_API_KEY = 'kk-secret';
    process.env.TRANSCRIPTAPI_API_KEY = 'ts-secret';
    writeUserMcpJson({
      transcriptapi: {
        type: 'http',
        url: 'https://transcriptapi.com/mcp',
        headers: { Authorization: 'Bearer ${TRANSCRIPTAPI_API_KEY}' },
      },
      karakeep: {
        command: 'npx',
        args: ['-y', '@karakeep/mcp'],
        env: { KARAKEEP_API_ADDR: 'http://localhost:3002', KARAKEEP_API_KEY: '${KARAKEEP_API_KEY}' },
      },
    });
    const servers = loadMcpServers(undefined, projectCwd);
    expect(servers.transcriptapi).toMatchObject({
      type: 'http',
      headers: { Authorization: 'Bearer ts-secret' },
    });
    expect(servers.karakeep).toMatchObject({
      command: 'npx',
      env: { KARAKEEP_API_ADDR: 'http://localhost:3002', KARAKEEP_API_KEY: 'kk-secret' },
    });
  });

  it('honors an allowlist, dropping servers not listed', () => {
    writeUserMcpJson({
      cloudflare: { type: 'http', url: 'https://mcp.cloudflare.com/mcp' },
      higgsfield: { type: 'http', url: 'https://mcp.higgsfield.ai/mcp' },
    });
    const servers = loadMcpServers(['cloudflare'], projectCwd);
    expect(Object.keys(servers)).toEqual(['cloudflare']);
  });

  it('lets the project .mcp.json override a same-named user server', () => {
    writeUserMcpJson({ karakeep: { command: 'npx', args: ['user'] } });
    fs.writeFileSync(
      path.join(projectCwd, '.mcp.json'),
      JSON.stringify({ mcpServers: { karakeep: { command: 'npx', args: ['project'] } } }),
    );
    const servers = loadMcpServers(undefined, projectCwd);
    expect(servers.karakeep).toMatchObject({ command: 'npx', args: ['project'] });
  });
});
