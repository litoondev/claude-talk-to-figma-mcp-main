/**
 * Unit tests for the Figma REST client.
 *
 * The config module is mocked so backoff delays are ~1ms instead of seconds,
 * and so tests never depend on the developer's real environment.
 */

jest.mock('../../../src/talk_to_figma_mcp/config/config', () => ({
  FIGMA_REST_CONFIG: {
    baseUrl: 'https://api.figma.test',
    maxRetries: 2,
    concurrency: 4,
    timeoutMs: 5000,
    // Tiny base keeps real retry sleeps ~1-2ms; the cap stays realistic so the
    // Retry-After seconds→ms conversion is actually observable.
    baseBackoffMs: 1,
    maxBackoffMs: 15000,
  },
}));

jest.mock('../../../src/talk_to_figma_mcp/utils/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() },
}));

import {
  FigmaRestError,
  computeBackoffMs,
  figmaRest,
  getCurrentUser,
  getFigmaToken,
  hasFigmaToken,
  listFileComments,
  mapWithConcurrency,
  postCommentReply,
} from '../../../src/talk_to_figma_mcp/utils/figma-rest';

const ORIGINAL_ENV = { ...process.env };

/** Build a minimal Response-like object for the fetch mock. */
function fakeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  (global as any).fetch = fetchMock;
  process.env = { ...ORIGINAL_ENV };
  process.env.FIGMA_ACCESS_TOKEN = 'figd_test_token';
  delete process.env.FIGMA_PERSONAL_ACCESS_TOKEN;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('getFigmaToken', () => {
  it('reads FIGMA_ACCESS_TOKEN', () => {
    expect(getFigmaToken()).toBe('figd_test_token');
  });

  it('falls back to FIGMA_PERSONAL_ACCESS_TOKEN', () => {
    delete process.env.FIGMA_ACCESS_TOKEN;
    process.env.FIGMA_PERSONAL_ACCESS_TOKEN = 'figd_fallback';
    expect(getFigmaToken()).toBe('figd_fallback');
  });

  it('trims surrounding whitespace', () => {
    process.env.FIGMA_ACCESS_TOKEN = '  figd_padded  ';
    expect(getFigmaToken()).toBe('figd_padded');
  });

  it('throws an actionable error when absent', () => {
    delete process.env.FIGMA_ACCESS_TOKEN;
    expect(() => getFigmaToken()).toThrow(FigmaRestError);
    expect(() => getFigmaToken()).toThrow(/FIGMA_ACCESS_TOKEN/);
  });

  it('treats a whitespace-only token as absent', () => {
    process.env.FIGMA_ACCESS_TOKEN = '   ';
    expect(() => getFigmaToken()).toThrow(FigmaRestError);
  });

  it('detects an unsubstituted DXT placeholder instead of sending it to Figma', () => {
    process.env.FIGMA_ACCESS_TOKEN = '${user_config.figma_access_token}';
    expect(() => getFigmaToken()).toThrow(/not substituted by the host/);
    expect(() => getFigmaToken()).toThrow(/claude_desktop_config\.json/);
  });

  it('hasFigmaToken reports presence without throwing', () => {
    expect(hasFigmaToken()).toBe(true);
    delete process.env.FIGMA_ACCESS_TOKEN;
    expect(hasFigmaToken()).toBe(false);
  });
});

describe('figmaRest', () => {
  it('sends the X-Figma-Token header and hits the configured base URL', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { id: 'user-1' }));

    await figmaRest('/v1/me');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.figma.test/v1/me');
    expect(init.headers['X-Figma-Token']).toBe('figd_test_token');
    expect(init.method).toBe('GET');
  });

  it('serialises a JSON body on POST', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { id: 'c1' }));

    await figmaRest('/v1/files/ABC/comments', {
      method: 'POST',
      body: { message: 'hi', comment_id: 'root1' },
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ message: 'hi', comment_id: 'root1' });
  });

  it('returns an empty object for an empty body (e.g. DELETE)', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, ''));
    await expect(figmaRest('/v1/files/ABC/comments/c1', { method: 'DELETE' })).resolves.toEqual({});
  });

  it('retries on 429 and then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(429, { err: 'rate limited' }, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(fakeResponse(200, { comments: [] }));

    await expect(figmaRest('/v1/files/ABC/comments')).resolves.toEqual({ comments: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on 5xx', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(503, { err: 'unavailable' }))
      .mockResolvedValueOnce(fakeResponse(200, { ok: true }));

    await expect(figmaRest('/v1/me')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting retries and reports the status', async () => {
    fetchMock.mockResolvedValue(fakeResponse(429, { err: 'rate limited' }, { 'Retry-After': '0' }));

    await expect(figmaRest('/v1/me')).rejects.toThrow(/429/);
    // 1 initial attempt + 2 retries
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a 401 and explains the token problem', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(401, { err: 'Invalid token' }));

    await expect(figmaRest('/v1/me')).rejects.toThrow(/token rejected/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a 404 and explains what to check', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404, { err: 'Not found' }));

    await expect(figmaRest('/v1/files/NOPE/comments')).rejects.toThrow(/not found/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries network errors then surfaces the last one', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    await expect(figmaRest('/v1/me')).rejects.toThrow(/ECONNRESET/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces a non-JSON success payload as an error', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, '<html>maintenance</html>'));
    await expect(figmaRest('/v1/me')).rejects.toThrow(/non-JSON/);
  });

  it('propagates the missing-token error before making a request', async () => {
    delete process.env.FIGMA_ACCESS_TOKEN;
    await expect(figmaRest('/v1/me')).rejects.toThrow(/FIGMA_ACCESS_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts an explicit token override', async () => {
    delete process.env.FIGMA_ACCESS_TOKEN;
    fetchMock.mockResolvedValueOnce(fakeResponse(200, {}));

    await figmaRest('/v1/me', { token: 'figd_override' });
    expect(fetchMock.mock.calls[0][1].headers['X-Figma-Token']).toBe('figd_override');
  });
});

describe('computeBackoffMs', () => {
  it('honours a numeric Retry-After in seconds', () => {
    expect(computeBackoffMs(0, '3')).toBe(3000);
  });

  it('clamps a large Retry-After to the configured maximum', () => {
    expect(computeBackoffMs(0, '9999')).toBe(15000);
  });

  it('grows exponentially without a Retry-After header', () => {
    const first = computeBackoffMs(0, null);
    const later = computeBackoffMs(5, null);
    expect(later).toBeGreaterThan(first);
    expect(later).toBeLessThanOrEqual(15000);
  });

  it('ignores a malformed Retry-After and falls back to exponential backoff', () => {
    expect(computeBackoffMs(0, 'soon-ish')).toBeGreaterThan(0);
  });

  it('never returns a negative delay for a past HTTP-date', () => {
    expect(computeBackoffMs(0, new Date(Date.now() - 60_000).toUTCString())).toBe(0);
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order in the results', async () => {
    const input = [5, 1, 4, 2, 3];
    const result = await mapWithConcurrency(input, 2, async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n * 10;
    });
    expect(result).toEqual([50, 10, 40, 20, 30]);
  });

  it('never exceeds the concurrency ceiling', async () => {
    let active = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return null;
    });

    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty input list', async () => {
    await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
  });
});

describe('endpoint wrappers', () => {
  it('getCurrentUser calls /v1/me', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { id: 'u1', handle: 'me' }));
    await expect(getCurrentUser()).resolves.toEqual({ id: 'u1', handle: 'me' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.figma.test/v1/me');
  });

  it('listFileComments requests markdown and tolerates a missing array', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, {}));
    await expect(listFileComments('ABC')).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.figma.test/v1/files/ABC/comments?as_md=true');
  });

  it('listFileComments URL-encodes the file key', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { comments: [] }));
    await listFileComments('a/b c');
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/files/a%2Fb%20c/comments');
  });

  it('postCommentReply sends comment_id so the reply joins the thread', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { id: 'reply-1' }));

    await postCommentReply('ABC', 'root-1', 'Looks good');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.figma.test/v1/files/ABC/comments');
    expect(JSON.parse(init.body)).toEqual({ message: 'Looks good', comment_id: 'root-1' });
  });
});
