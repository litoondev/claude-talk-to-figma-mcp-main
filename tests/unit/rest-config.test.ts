/**
 * Environment parsing for FIGMA_REST_CONFIG.
 *
 * These guard a specific failure mode introduced by DXT packaging: when a user
 * leaves an optional `user_config` field blank, Claude Desktop still injects the
 * variable — as an empty string. `Number("")` is 0, which would silently set
 * concurrency/timeouts to zero. Defaults must win instead.
 */

describe('FIGMA_REST_CONFIG environment parsing', () => {
  const ORIGINAL_ENV = { ...process.env };

  const load = () => {
    let config: any;
    jest.isolateModules(() => {
      config = require('../../src/talk_to_figma_mcp/config/config').FIGMA_REST_CONFIG;
    });
    return config;
  };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.FIGMA_API_BASE_URL;
    delete process.env.FIGMA_API_CONCURRENCY;
    delete process.env.FIGMA_API_MAX_RETRIES;
    delete process.env.FIGMA_API_TIMEOUT_MS;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses sane defaults when nothing is set', () => {
    const config = load();
    expect(config.baseUrl).toBe('https://api.figma.com');
    expect(config.concurrency).toBe(4);
    expect(config.maxRetries).toBe(3);
    expect(config.timeoutMs).toBe(30000);
  });

  it('falls back to defaults for empty strings (blank DXT user_config fields)', () => {
    process.env.FIGMA_API_CONCURRENCY = '';
    process.env.FIGMA_API_MAX_RETRIES = '';
    process.env.FIGMA_API_TIMEOUT_MS = '';
    process.env.FIGMA_API_BASE_URL = '';

    const config = load();
    expect(config.concurrency).toBe(4);
    expect(config.maxRetries).toBe(3);
    expect(config.timeoutMs).toBe(30000);
    expect(config.baseUrl).toBe('https://api.figma.com');
  });

  it('ignores whitespace-only values', () => {
    process.env.FIGMA_API_CONCURRENCY = '   ';
    expect(load().concurrency).toBe(4);
  });

  it('honours valid overrides', () => {
    process.env.FIGMA_API_CONCURRENCY = '2';
    process.env.FIGMA_API_MAX_RETRIES = '5';
    process.env.FIGMA_API_TIMEOUT_MS = '60000';
    process.env.FIGMA_API_BASE_URL = 'https://proxy.internal';

    const config = load();
    expect(config.concurrency).toBe(2);
    expect(config.maxRetries).toBe(5);
    expect(config.timeoutMs).toBe(60000);
    expect(config.baseUrl).toBe('https://proxy.internal');
  });

  it('rejects zero, negative and non-numeric values', () => {
    for (const bad of ['0', '-3', 'four', 'NaN']) {
      process.env.FIGMA_API_CONCURRENCY = bad;
      expect(load().concurrency).toBe(4);
    }
  });

  it('floors fractional values to a whole number', () => {
    process.env.FIGMA_API_CONCURRENCY = '3.9';
    expect(load().concurrency).toBe(3);
  });

  it('never yields a concurrency below 1', () => {
    for (const value of ['', '0', '-1', 'abc']) {
      process.env.FIGMA_API_CONCURRENCY = value;
      expect(load().concurrency).toBeGreaterThanOrEqual(1);
    }
  });
});
