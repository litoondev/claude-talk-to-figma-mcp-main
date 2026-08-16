/**
 * End-to-end integration test for the REST-based comment tools.
 *
 * Spins up a local HTTP server that mimics the parts of api.figma.com we use,
 * points the client at it, and drives the real MCP tool handlers. This covers
 * the whole path: scope resolution → per-file sweep → threading → filtering →
 * reply posting, including partial-failure behaviour.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

// baseUrl is read through a getter so the dynamically-allocated port can be
// injected after this module is hoisted and evaluated.
jest.mock('../../src/talk_to_figma_mcp/config/config', () => ({
  get FIGMA_REST_CONFIG() {
    return {
      baseUrl: process.env.__TEST_FIGMA_BASE__ || 'https://api.figma.com',
      maxRetries: 1,
      concurrency: 4,
      timeoutMs: 5000,
      baseBackoffMs: 1,
      maxBackoffMs: 20,
    };
  },
}));

jest.mock('../../src/talk_to_figma_mcp/utils/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() },
}));

// Stand in for the WebSocket bridge to the Figma plugin, which is what reports
// the currently open file key.
const mockSendCommand = jest.fn();
jest.mock('../../src/talk_to_figma_mcp/utils/websocket', () => ({
  sendCommandToFigma: (...args: any[]) => mockSendCommand(...args),
}));

import { registerCommentTools } from '../../src/talk_to_figma_mcp/tools/comment-tools';

// ---------------------------------------------------------------------------
// Minimal MCP server double that captures registered tool handlers
// ---------------------------------------------------------------------------

type ToolHandler = (args: any) => Promise<{ content: { text: string }[]; isError?: boolean }>;

const handlers = new Map<string, ToolHandler>();

const fakeServer = {
  tool: (name: string, _description: string, _schema: unknown, handler: ToolHandler) => {
    handlers.set(name, handler);
  },
} as any;

const invoke = (name: string, args: any = {}) => {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`Tool "${name}" was never registered`);
  return handler(args);
};

const textOf = (result: { content: { text: string }[] }) => result.content[0].text;

// ---------------------------------------------------------------------------
// Fake Figma REST API
// ---------------------------------------------------------------------------

const ME = { id: 'user-me', handle: 'design-orangetoolz', email: 'design@orangetoolz.com' };
const OTHER = { id: 'user-other', handle: 'teammate' };

const postedReplies: { fileKey: string; commentId: string; message: string }[] = [];

function commentsFor(fileKey: string) {
  if (fileKey === 'FILE_A') {
    return [
      {
        id: 'a-root',
        file_key: 'FILE_A',
        parent_id: '',
        user: ME,
        created_at: '2026-08-10T10:00:00Z',
        resolved_at: null,
        message: 'Button contrast fails AA here',
        order_id: '1',
        client_meta: { node_id: '12:34', node_offset: { x: 8, y: 12 } },
      },
      {
        id: 'a-reply',
        file_key: 'FILE_A',
        parent_id: 'a-root',
        user: OTHER,
        created_at: '2026-08-11T09:00:00Z',
        resolved_at: null,
        message: 'Which token should we use?',
        order_id: null,
        client_meta: null,
      },
      {
        id: 'a-theirs',
        file_key: 'FILE_A',
        parent_id: '',
        user: OTHER,
        created_at: '2026-08-09T10:00:00Z',
        resolved_at: null,
        message: 'Unrelated thread by someone else',
        order_id: '2',
        client_meta: null,
      },
      {
        id: 'a-resolved',
        file_key: 'FILE_A',
        parent_id: '',
        user: ME,
        created_at: '2026-08-01T10:00:00Z',
        resolved_at: '2026-08-02T10:00:00Z',
        message: 'Already handled',
        order_id: '3',
        client_meta: null,
      },
    ];
  }

  if (fileKey === 'FILE_B') {
    return [
      {
        id: 'b-root',
        file_key: 'FILE_B',
        parent_id: '',
        user: ME,
        created_at: '2026-08-12T10:00:00Z',
        resolved_at: null,
        message: 'Spacing scale drifts from the design system',
        order_id: '1',
        client_meta: { x: 400, y: 220 },
      },
    ];
  }

  return [];
}

let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    // Every request must carry the token.
    if (req.headers['x-figma-token'] !== 'figd_integration_token') {
      return send(403, { err: 'Invalid token' });
    }

    if (url.pathname === '/v1/me') return send(200, ME);

    if (url.pathname === '/v1/teams/team-1/projects') {
      return send(200, { name: 'Orangetoolz', projects: [{ id: 'proj-1', name: 'Product Design System' }] });
    }

    if (url.pathname === '/v1/projects/proj-1/files') {
      return send(200, {
        name: 'Product Design System',
        files: [
          { key: 'FILE_A', name: 'Components' },
          { key: 'FILE_B', name: 'Foundations' },
          { key: 'FILE_FORBIDDEN', name: 'Private Explorations' },
        ],
      });
    }

    const commentsMatch = url.pathname.match(/^\/v1\/files\/([^/]+)\/comments$/);
    if (commentsMatch) {
      const fileKey = decodeURIComponent(commentsMatch[1]);

      // Simulate a file in the project the token cannot open.
      if (fileKey === 'FILE_FORBIDDEN') return send(403, { err: 'Not allowed' });

      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          if (parsed.comment_id === 'bad-thread') return send(404, { err: 'Comment not found' });
          postedReplies.push({ fileKey, commentId: parsed.comment_id, message: parsed.message });
          send(200, {
            id: `reply-${postedReplies.length}`,
            file_key: fileKey,
            parent_id: parsed.comment_id,
            user: ME,
            created_at: '2026-08-16T12:00:00Z',
            resolved_at: null,
            message: parsed.message,
            order_id: null,
            client_meta: null,
          });
        });
        return;
      }

      return send(200, { comments: commentsFor(fileKey) });
    }

    send(404, { err: 'Unhandled path' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  process.env.__TEST_FIGMA_BASE__ = `http://127.0.0.1:${port}`;
  process.env.FIGMA_ACCESS_TOKEN = 'figd_integration_token';

  registerCommentTools(fakeServer);
});

afterAll(async () => {
  delete process.env.__TEST_FIGMA_BASE__;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  postedReplies.length = 0;
  process.env.FIGMA_ACCESS_TOKEN = 'figd_integration_token';
  mockSendCommand.mockReset();
  // Default: the plugin is connected and reports FILE_A as the open file.
  mockSendCommand.mockResolvedValue({
    fileKey: 'FILE_A',
    fileName: 'Components',
    pageName: 'New Landing Pages',
    available: true,
  });
});

// ---------------------------------------------------------------------------

describe('comment tools registration', () => {
  it('registers the full comment toolset', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'delete_comment',
      'get_current_file',
      'get_figma_account',
      'get_file_comments',
      'get_my_comments',
      'list_figma_files',
      'reply_to_comment',
      'reply_to_comments',
    ]);
  });
});

describe('automatic file-key resolution (no file URL required)', () => {
  it('get_current_file reports the open file from the plugin', async () => {
    const text = textOf(await invoke('get_current_file'));
    expect(text).toContain('FILE_A');
    expect(text).toContain('Components');
    expect(mockSendCommand).toHaveBeenCalledWith('get_file_key');
  });

  it('get_file_comments works with no fileKey at all', async () => {
    const text = textOf(await invoke('get_file_comments', {}));
    expect(text).toContain('Button contrast fails AA here');
    expect(text).toContain('resolved from the file open in Figma');
  });

  it('does not consult the plugin when fileKey is supplied', async () => {
    await invoke('get_file_comments', { fileKey: 'FILE_B' });
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it('get_my_comments defaults to the open file when given no scope', async () => {
    const text = textOf(await invoke('get_my_comments', {}));
    expect(text).toContain('Button contrast fails AA here');
    expect(text).toContain('Scope defaulted to the file currently open in Figma');
  });

  it('reply_to_comment posts to the open file with no fileKey', async () => {
    await invoke('reply_to_comment', { commentId: 'a-root', message: 'ack' });
    expect(postedReplies).toEqual([
      { fileKey: 'FILE_A', commentId: 'a-root', message: 'ack' },
    ]);
  });

  it('reply_to_comments fills in the open file for entries that omit it', async () => {
    await invoke('reply_to_comments', {
      replies: [
        { commentId: 'a-root', message: 'from open file' },
        { fileKey: 'FILE_B', commentId: 'b-root', message: 'explicit' },
      ],
    });

    expect(postedReplies).toEqual([
      { fileKey: 'FILE_A', commentId: 'a-root', message: 'from open file' },
      { fileKey: 'FILE_B', commentId: 'b-root', message: 'explicit' },
    ]);
    // Resolved once for the whole batch, not per entry.
    expect(mockSendCommand).toHaveBeenCalledTimes(1);
  });

  it('explains the private-plugin-API limitation when fileKey is unavailable', async () => {
    mockSendCommand.mockResolvedValue({ fileKey: null, fileName: 'X', available: false });

    const result = await invoke('get_file_comments', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/private plugin API/);
  });

  it('explains how to recover when the plugin is not connected', async () => {
    mockSendCommand.mockRejectedValue(new Error('not connected to Figma'));

    const result = await invoke('get_my_comments', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/join_channel|pass fileKey explicitly/);
  });
});

describe('get_figma_account', () => {
  it('resolves the token owner', async () => {
    const text = textOf(await invoke('get_figma_account'));
    expect(text).toContain('✅');
    expect(text).toContain('user-me');
    expect(text).toContain('design-orangetoolz');
  });

  it('reports a rejected token without throwing', async () => {
    process.env.FIGMA_ACCESS_TOKEN = 'wrong_token';
    const result = await invoke('get_figma_account');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/token rejected/i);
  });

  it('reports a missing token with setup guidance', async () => {
    delete process.env.FIGMA_ACCESS_TOKEN;
    const result = await invoke('get_figma_account');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('FIGMA_ACCESS_TOKEN');
  });
});

describe('list_figma_files', () => {
  it('expands a team into its project files', async () => {
    const text = textOf(await invoke('list_figma_files', { teamId: 'team-1' }));
    expect(text).toContain('FILE_A');
    expect(text).toContain('FILE_B');
    expect(text).toContain('Product Design System');
  });

  it('rejects an empty scope', async () => {
    const result = await invoke('list_figma_files', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/teamId and\/or projectIds/);
  });
});

describe('get_file_comments', () => {
  it('threads replies under their root', async () => {
    const text = textOf(await invoke('get_file_comments', { fileKey: 'FILE_A' }));
    expect(text).toContain('Button contrast fails AA here');
    expect(text).toContain('↳ teammate: "Which token should we use?"');
    expect(text).toContain('node 12:34');
  });

  it('hides resolved threads by default and shows them on request', async () => {
    const without = textOf(await invoke('get_file_comments', { fileKey: 'FILE_A' }));
    expect(without).not.toContain('Already handled');

    const with_ = textOf(await invoke('get_file_comments', { fileKey: 'FILE_A', includeResolved: true }));
    expect(with_).toContain('Already handled');
  });

  it('filters to a single author', async () => {
    const text = textOf(
      await invoke('get_file_comments', { fileKey: 'FILE_A', authorId: 'user-me', authorScope: 'root' })
    );
    expect(text).toContain('Button contrast fails AA here');
    expect(text).not.toContain('Unrelated thread by someone else');
  });

  it('emits valid JSON when asked', async () => {
    const text = textOf(await invoke('get_file_comments', { fileKey: 'FILE_A', format: 'json' }));
    const parsed = JSON.parse(text.slice(text.indexOf('[')));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty('commentId');
  });
});

describe('get_my_comments', () => {
  it('sweeps a whole team and returns only my threads', async () => {
    const text = textOf(await invoke('get_my_comments', { teamId: 'team-1' }));

    expect(text).toContain('Button contrast fails AA here');
    expect(text).toContain('Spacing scale drifts from the design system');
    expect(text).not.toContain('Unrelated thread by someone else');
    expect(text).not.toContain('Already handled'); // resolved
  });

  it('reports unreadable files instead of failing the whole sweep', async () => {
    const text = textOf(await invoke('get_my_comments', { teamId: 'team-1' }));
    expect(text).toContain('could not be read');
    expect(text).toContain('FILE_FORBIDDEN');
  });

  it('supports onlyAwaitingReply to find threads waiting on me', async () => {
    const text = textOf(await invoke('get_my_comments', { teamId: 'team-1', onlyAwaitingReply: true }));
    // FILE_A's thread ends with a teammate's question; FILE_B's ends with mine.
    expect(text).toContain('Button contrast fails AA here');
    expect(text).not.toContain('Spacing scale drifts');
  });

  it('honours an explicit file list without any team lookup', async () => {
    const text = textOf(await invoke('get_my_comments', { fileKeys: ['FILE_B'] }));
    expect(text).toContain('Spacing scale drifts');
    expect(text).not.toContain('Button contrast');
  });

  it('caps the number of files swept', async () => {
    const text = textOf(await invoke('get_my_comments', { teamId: 'team-1', maxFiles: 1 }));
    expect(text).toContain('capped from 3');
  });

  it('no longer rejects an empty scope — it falls back to the open file', async () => {
    const result = await invoke('get_my_comments', {});
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('Scope defaulted to the file currently open in Figma');
  });
});

describe('reply_to_comment', () => {
  it('posts a reply into the thread', async () => {
    const text = textOf(
      await invoke('reply_to_comment', {
        fileKey: 'FILE_A',
        commentId: 'a-root',
        message: 'Use color/text/on-primary — it clears 4.5:1.',
      })
    );

    expect(text).toContain('✅');
    expect(postedReplies).toEqual([
      {
        fileKey: 'FILE_A',
        commentId: 'a-root',
        message: 'Use color/text/on-primary — it clears 4.5:1.',
      },
    ]);
  });

  it('surfaces a bad thread id as an error', async () => {
    const result = await invoke('reply_to_comment', {
      fileKey: 'FILE_A',
      commentId: 'bad-thread',
      message: 'nope',
    });
    expect(result.isError).toBe(true);
  });
});

describe('reply_to_comments', () => {
  it('posts a batch and reports per-item results', async () => {
    const text = textOf(
      await invoke('reply_to_comments', {
        replies: [
          { fileKey: 'FILE_A', commentId: 'a-root', message: 'Fixed in the token set.' },
          { fileKey: 'FILE_B', commentId: 'b-root', message: 'Aligned to the 4pt scale.' },
        ],
      })
    );

    expect(text).toContain('Posted 2/2');
    expect(postedReplies).toHaveLength(2);
  });

  it('keeps going when one entry fails', async () => {
    const result = await invoke('reply_to_comments', {
      replies: [
        { fileKey: 'FILE_A', commentId: 'a-root', message: 'good' },
        { fileKey: 'FILE_A', commentId: 'bad-thread', message: 'bad' },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('Posted 1/2');
    expect(postedReplies).toHaveLength(1);
  });

  it('flags the batch as an error when everything fails', async () => {
    const result = await invoke('reply_to_comments', {
      replies: [{ fileKey: 'FILE_A', commentId: 'bad-thread', message: 'bad' }],
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('All replies failed');
  });

  it('writes nothing on a dry run', async () => {
    const text = textOf(
      await invoke('reply_to_comments', {
        replies: [{ fileKey: 'FILE_A', commentId: 'a-root', message: 'preview only' }],
        dryRun: true,
      })
    );

    expect(text).toContain('Dry run');
    expect(postedReplies).toHaveLength(0);
  });
});
