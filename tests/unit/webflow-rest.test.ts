/**
 * Webflow Data API client.
 *
 * Three things are worth guarding, and they are the three that actually break:
 *
 *  1. The DXT blank-field trap. A user who leaves an optional `user_config`
 *     field empty still gets the variable injected, as an empty string, and
 *     `Number("")` is 0. Defaults must win. Same failure the Figma config has.
 *  2. Token handling, including an unsubstituted `${user_config.*}` placeholder,
 *     which otherwise reaches Webflow and returns a confusing 401.
 *  3. Retry policy. A 429 must back off and retry; a 401 or 404 must fail at
 *     once rather than burning three attempts on a request that cannot succeed.
 *
 * And one that matters more here than in the Figma client: query strings must
 * drop undefined values rather than sending the literal string "undefined",
 * which Webflow rejects as an invalid parameter.
 */

describe('WEBFLOW_API_CONFIG environment parsing', () => {
  const ORIGINAL_ENV = { ...process.env };

  const load = () => {
    let config: any;
    jest.isolateModules(() => {
      config = require('../../src/talk_to_figma_mcp/config/config').WEBFLOW_API_CONFIG;
    });
    return config;
  };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.WEBFLOW_API_BASE_URL;
    delete process.env.WEBFLOW_API_CONCURRENCY;
    delete process.env.WEBFLOW_API_MAX_RETRIES;
    delete process.env.WEBFLOW_API_TIMEOUT_MS;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses sane defaults when nothing is set', () => {
    const config = load();
    expect(config.baseUrl).toBe('https://api.webflow.com');
    expect(config.concurrency).toBe(4);
    expect(config.maxRetries).toBe(3);
    expect(config.timeoutMs).toBe(30000);
  });

  it('falls back to defaults for empty strings (blank DXT user_config fields)', () => {
    process.env.WEBFLOW_API_CONCURRENCY = '';
    process.env.WEBFLOW_API_MAX_RETRIES = '';
    process.env.WEBFLOW_API_TIMEOUT_MS = '';
    process.env.WEBFLOW_API_BASE_URL = '';

    const config = load();
    expect(config.concurrency).toBe(4);
    expect(config.maxRetries).toBe(3);
    expect(config.timeoutMs).toBe(30000);
    expect(config.baseUrl).toBe('https://api.webflow.com');
  });

  it('honours valid overrides', () => {
    process.env.WEBFLOW_API_CONCURRENCY = '2';
    process.env.WEBFLOW_API_MAX_RETRIES = '5';
    process.env.WEBFLOW_API_TIMEOUT_MS = '60000';
    process.env.WEBFLOW_API_BASE_URL = 'https://proxy.internal';

    const config = load();
    expect(config.concurrency).toBe(2);
    expect(config.maxRetries).toBe(5);
    expect(config.timeoutMs).toBe(60000);
    expect(config.baseUrl).toBe('https://proxy.internal');
  });
});

describe('Webflow token handling', () => {
  const ORIGINAL_ENV = { ...process.env };

  const load = () => {
    let mod: any;
    jest.isolateModules(() => {
      mod = require('../../src/talk_to_figma_mcp/utils/webflow-rest');
    });
    return mod;
  };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.WEBFLOW_TOKEN;
    delete process.env.WEBFLOW_API_TOKEN;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('reads the token lazily, so the environment can change without a reimport', () => {
    const { getWebflowToken } = load();
    process.env.WEBFLOW_TOKEN = 'first';
    expect(getWebflowToken()).toBe('first');
    process.env.WEBFLOW_TOKEN = 'second';
    expect(getWebflowToken()).toBe('second');
  });

  it('trims surrounding whitespace', () => {
    const { getWebflowToken } = load();
    process.env.WEBFLOW_TOKEN = '  padded  ';
    expect(getWebflowToken()).toBe('padded');
  });

  it('accepts WEBFLOW_API_TOKEN as an alias', () => {
    const { getWebflowToken } = load();
    process.env.WEBFLOW_API_TOKEN = 'alias-token';
    expect(getWebflowToken()).toBe('alias-token');
  });

  it('explains an unsubstituted DXT placeholder instead of sending it to Webflow', () => {
    const { getWebflowToken } = load();
    process.env.WEBFLOW_TOKEN = '${user_config.webflow_token}';
    expect(() => getWebflowToken()).toThrow(/not substituted by the host/i);
  });

  it('points at API access when no token is set', () => {
    const { getWebflowToken } = load();
    expect(() => getWebflowToken()).toThrow(/Apps & integrations/);
  });

  it('hasWebflowToken reports capability without throwing', () => {
    const { hasWebflowToken } = load();
    expect(hasWebflowToken()).toBe(false);
    process.env.WEBFLOW_TOKEN = 'present';
    expect(hasWebflowToken()).toBe(true);
    process.env.WEBFLOW_TOKEN = '   ';
    expect(hasWebflowToken()).toBe(false);
  });
});

describe('Webflow request behaviour', () => {
  const ORIGINAL_ENV = { ...process.env };
  const ORIGINAL_FETCH = global.fetch;

  const load = () => {
    let mod: any;
    jest.isolateModules(() => {
      mod = require('../../src/talk_to_figma_mcp/utils/webflow-rest');
    });
    return mod;
  };

  const response = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.WEBFLOW_TOKEN = 'test-token';
    // Keep the retry tests fast.
    process.env.WEBFLOW_API_MAX_RETRIES = '2';
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('sends a Bearer token against the v2 base URL', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(200, { sites: [] }));
    global.fetch = fetchMock as any;

    const { listSites } = load();
    await listSites();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.webflow.com/v2/sites');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(init.method).toBe('GET');
  });

  it('retries a 429 and succeeds on the next attempt', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response(429, { message: 'rate limited' }, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(response(200, { sites: [{ id: 's1', displayName: 'Site' }] }));
    global.fetch = fetchMock as any;

    const { listSites } = load();
    const sites = await listSites();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sites).toHaveLength(1);
  });

  it('does not retry a 401 — the token will not become valid on attempt two', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(401, { message: 'Unauthorized' }));
    global.fetch = fetchMock as any;

    const { listSites } = load();
    await expect(listSites()).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 404', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(404, { message: 'Not found' }));
    global.fetch = fetchMock as any;

    const { getSite } = load();
    await expect(getSite('missing')).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces field-level validation detail from a rejected CMS write', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response(400, {
        message: 'Validation Error',
        details: [{ param: 'slug', description: 'already in use' }],
      })
    );
    global.fetch = fetchMock as any;

    const { createItems } = load();
    await expect(createItems('c1', [{ fieldData: { name: 'X' } }])).rejects.toThrow(
      /already in use/
    );
  });

  it('explains a 403 as a scope problem, since a minted token cannot be widened', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(403, { message: 'Forbidden' }));
    global.fetch = fetchMock as any;

    const { listSites } = load();
    await expect(listSites()).rejects.toThrow(/generate a new one/i);
  });

  it("passes through the scope Webflow names, which is the only actionable part", async () => {
    // Verified against the live API: a scopeless token returns exactly this.
    // The message must carry the scope name, because "missing a scope" alone
    // leaves the user to guess which of a dozen to tick.
    const fetchMock = jest.fn().mockResolvedValue(
      response(403, { message: "OAuthForbidden: You are missing the following scopes - 'sites:read'" })
    );
    global.fetch = fetchMock as any;

    const { listSites } = load();
    const error = await listSites().catch((e: Error) => e);
    expect(error.message).toContain("sites:read");
    expect(error.message).toContain("the token is valid but is missing a scope");
    // Nothing about Enterprise: this is not a site-creation call.
    expect(error.message).not.toMatch(/Enterprise/);
  });

  it('treats an empty body as success, as DELETE returns one', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(204, ''));
    global.fetch = fetchMock as any;

    const { deleteItems } = load();
    await expect(deleteItems('c1', ['i1'])).resolves.toEqual({});
  });

  it('omits undefined query parameters rather than sending "undefined"', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(200, { pages: [] }));
    global.fetch = fetchMock as any;

    const { listPages } = load();
    await listPages('site-1', { limit: 10, offset: undefined, localeId: undefined });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.webflow.com/v2/sites/site-1/pages?limit=10');
    expect(url).not.toContain('undefined');
  });

  it('encodes ids into the path so an odd id cannot escape it', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(200, {}));
    global.fetch = fetchMock as any;

    const { getPage } = load();
    await getPage('a/b?c');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.webflow.com/v2/pages/a%2Fb%3Fc');
  });

  it('creates a site against the workspace endpoint, not /v2/sites', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(201, { id: 's9', displayName: 'demo 1' }));
    global.fetch = fetchMock as any;

    const { createSite } = load();
    await createSite('ws-1', { name: 'demo 1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.webflow.com/v2/workspaces/ws-1/sites');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'demo 1' });
  });

  it('omits optional site-creation fields rather than sending nulls', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(201, { id: 's9', displayName: 'x' }));
    global.fetch = fetchMock as any;

    const { createSite } = load();
    await createSite('ws-1', { name: 'x', templateName: undefined, parentFolderId: undefined });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'x' });
  });

  it('blames the plan, not the token, when site creation is refused', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(403, { message: 'Forbidden' }));
    global.fetch = fetchMock as any;

    const { createSite } = load();
    // The failure a non-Enterprise user actually hits. Telling them to re-mint a
    // token would send them round a loop that cannot succeed.
    await expect(createSite('ws-1', { name: 'demo 1' })).rejects.toThrow(/Enterprise/);
  });

  it('still explains a non-workspace 403 as a scope problem', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(403, { message: 'Forbidden' }));
    global.fetch = fetchMock as any;

    const { listSites } = load();
    const error = await listSites().catch((e: Error) => e);
    expect(error.message).toMatch(/generate a new one/i);
    expect(error.message).not.toMatch(/Enterprise/);
  });

  it('publishes only to the targets it is given', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(200, {}));
    global.fetch = fetchMock as any;

    const { publishSite } = load();
    await publishSite('site-1', { customDomains: ['d1'], publishToWebflowSubdomain: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.webflow.com/v2/sites/site-1/publish');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      customDomains: ['d1'],
      publishToWebflowSubdomain: true,
    });
  });
});

describe('Webflow tool profile gating', () => {
  const ORIGINAL_ENV = { ...process.env };

  const load = () => {
    let mod: any;
    jest.isolateModules(() => {
      mod = require('../../src/talk_to_figma_mcp/config/profiles');
    });
    return mod;
  };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.WEBFLOW_TOKEN;
    delete process.env.WEBFLOW_API_TOKEN;
    delete process.env.FIGMA_ACCESS_TOKEN;
    delete process.env.FIGMA_PERSONAL_ACCESS_TOKEN;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('hides the Webflow tools from standard when no token is configured', () => {
    const { makeToolFilter } = load();
    const allow = makeToolFilter('standard');
    expect(allow('webflow_list_sites')).toBe(false);
    expect(allow('webflow_publish_site')).toBe(false);
  });

  it('advertises them once a token is configured', () => {
    process.env.WEBFLOW_TOKEN = 'configured';
    const { makeToolFilter, WEBFLOW_TOOLS } = load();
    const allow = makeToolFilter('standard');
    for (const name of WEBFLOW_TOOLS) {
      expect(allow(name)).toBe(true);
    }
  });

  it('keeps them out of core even with a token — core is the Figma design loop', () => {
    process.env.WEBFLOW_TOKEN = 'configured';
    const { makeToolFilter, WEBFLOW_TOOLS } = load();
    const allow = makeToolFilter('core');
    for (const name of WEBFLOW_TOOLS) {
      expect(allow(name)).toBe(false);
    }
  });

  it('includes them in full regardless of the token', () => {
    const { makeToolFilter, WEBFLOW_TOOLS } = load();
    const allow = makeToolFilter('full');
    for (const name of WEBFLOW_TOOLS) {
      expect(allow(name)).toBe(true);
    }
  });

  it('gates Webflow and Figma comments independently', () => {
    process.env.WEBFLOW_TOKEN = 'configured';
    const { makeToolFilter } = load();
    const allow = makeToolFilter('standard');
    expect(allow('webflow_list_sites')).toBe(true);
    // No Figma token, so the comment tools stay hidden.
    expect(allow('get_file_comments')).toBe(false);
  });
});

describe('Webflow tool registration', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('registers all 16 tools under unique names', () => {
    process.env.WEBFLOW_TOKEN = 'configured';
    const names: string[] = [];
    const fake: any = {
      tool: (...args: any[]) => {
        if (typeof args[0] === 'string') names.push(args[0]);
      },
    };

    let mod: any;
    jest.isolateModules(() => {
      mod = require('../../src/talk_to_figma_mcp/tools/webflow-tools');
    });
    mod.registerWebflowTools(fake);

    expect(names).toHaveLength(16);
    expect(new Set(names).size).toBe(16);
    expect(names).toContain('webflow_list_sites');
    expect(names).toContain('webflow_publish_site');
    expect(names).toContain('webflow_create_site');
  });

  it('the registered names are exactly the names the profile gate knows about', () => {
    const names: string[] = [];
    const fake: any = {
      tool: (...args: any[]) => {
        if (typeof args[0] === 'string') names.push(args[0]);
      },
    };

    let tools: any;
    let profiles: any;
    jest.isolateModules(() => {
      tools = require('../../src/talk_to_figma_mcp/tools/webflow-tools');
      profiles = require('../../src/talk_to_figma_mcp/config/profiles');
    });
    tools.registerWebflowTools(fake);

    // A name in one list and not the other is how a tool silently becomes
    // unreachable, or stays advertised after being removed.
    expect(names.sort()).toEqual([...profiles.WEBFLOW_TOOLS].sort());
  });
});
