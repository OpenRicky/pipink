const DEFAULT_KV_BINDING_NAME = "pipink";
const TARGET_URL_KEY = "current_target_url";
const ACCESS_TOKEN_KEY = "current_access_token";
const CACHE_SETTINGS_KEY = "cache_settings";
const CACHE_VERSION_KEY = "cache_version";
const CACHE_LAST_UPDATED_AT_KEY = "cache_last_updated_at";
const CACHE_ENTRY_PREFIX = "cache_response:";
const ADMIN_SESSION_COOKIE = "pipink_admin_session";
const ADMIN_SESSION_TTL_SECONDS = 60 * 30;
const DEFAULT_CACHE_TTL_SECONDS = 60 * 60;
const CACHE_STATUS_HEADER = "x-pipink-cache";
const encoder = new TextEncoder();

interface Env {
  pipink?: KVNamespace;
  KV_BINDING_NAME?: string;
  INITIAL_ACCESS_TOKEN?: string;
  ACCESS_TOKEN?: string;
  ADMIN_KEY?: string;
  ADMIN_TOKEN?: string;
  [key: string]: unknown;
}

interface UpdatePayload {
  targetUrl?: string;
}

interface SettingsPayload {
  targetUrl?: string;
  accessToken?: string;
  cacheEnabled?: boolean;
  cacheTtlSeconds?: number;
  cacheValidStatusRules?: string[];
}

interface LoginPayload {
  token?: string;
}

interface CacheSettings {
  enabled: boolean;
  ttlSeconds: number;
  validStatusRules: string[];
}

interface CachedResponseRecord {
  cachedAt: number;
  status: number;
  headers: [string, string][];
  bodyBase64: string;
}

interface PreparedProxyRequest {
  targetRequest: Request;
  cacheKey?: string;
}

class MissingKvBindingError extends Error {
  constructor(bindingName: string) {
    super(`KV binding "${bindingName}" is not configured`);
    this.name = "MissingKvBindingError";
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });

const readAccessToken = (request: Request): string | null => {
  const url = new URL(request.url);
  return url.searchParams.get("token");
};

const readAdminToken = (request: Request): string | null => {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  return request.headers.get("x-admin-key") ?? request.headers.get("x-admin-token");
};

const getAdminKey = (env: Env): string => env.ADMIN_KEY ?? env.ADMIN_TOKEN ?? "";

const getKvBindingNames = (env: Env): string[] => {
  const configuredBindingName = env.KV_BINDING_NAME?.trim();
  if (configuredBindingName) {
    return [configuredBindingName];
  }

  return [DEFAULT_KV_BINDING_NAME];
};

const isKvNamespace = (value: unknown): value is KVNamespace => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { get?: unknown; put?: unknown };
  return typeof candidate.get === "function" && typeof candidate.put === "function";
};

const getLinkStore = (env: Env): KVNamespace => {
  const bindingNames = getKvBindingNames(env);

  for (const bindingName of bindingNames) {
    const linkStore = env[bindingName];
    if (isKvNamespace(linkStore)) {
      return linkStore;
    }
  }

  throw new MissingKvBindingError(bindingNames[0]);
};

const toBase64 = (buffer: ArrayBuffer): string => {
  let binary = "";
  const bytes = new Uint8Array(buffer);

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getDefaultCacheSettings = (): CacheSettings => ({
  enabled: false,
  ttlSeconds: DEFAULT_CACHE_TTL_SECONDS,
  validStatusRules: []
});

const isValidHttpStatusCode = (value: number): boolean =>
  Number.isInteger(value) && value >= 100 && value <= 599;

const normalizeStatusRule = (value: string): string | null => {
  const rule = value.trim();
  if (/^\d{3}$/.test(rule)) {
    return isValidHttpStatusCode(Number(rule)) ? rule : null;
  }

  const rangeMatch = rule.match(/^(\d{3})-(\d{3})$/);
  if (!rangeMatch) {
    return null;
  }

  const start = Number(rangeMatch[1]);
  const end = Number(rangeMatch[2]);
  if (!isValidHttpStatusCode(start) || !isValidHttpStatusCode(end) || start > end) {
    return null;
  }

  return `${start}-${end}`;
};

const normalizeStatusRules = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalizedRules: string[] = [];
  const seenRules = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      return null;
    }

    const normalizedRule = normalizeStatusRule(item);
    if (!normalizedRule || seenRules.has(normalizedRule)) {
      if (!normalizedRule) {
        return null;
      }

      continue;
    }

    seenRules.add(normalizedRule);
    normalizedRules.push(normalizedRule);
  }

  return normalizedRules;
};

const parseCacheSettings = (value: string | null): CacheSettings => {
  const defaultSettings = getDefaultCacheSettings();
  if (!value) {
    return defaultSettings;
  }

  try {
    const parsedValue = JSON.parse(value);
    if (!isPlainObject(parsedValue)) {
      return defaultSettings;
    }

    const enabled = typeof parsedValue.enabled === "boolean" ? parsedValue.enabled : defaultSettings.enabled;
    const ttlSeconds =
      typeof parsedValue.ttlSeconds === "number" &&
      Number.isInteger(parsedValue.ttlSeconds) &&
      parsedValue.ttlSeconds >= 1
        ? parsedValue.ttlSeconds
        : defaultSettings.ttlSeconds;
    const validStatusRules = normalizeStatusRules(parsedValue.validStatusRules) ?? defaultSettings.validStatusRules;

    return {
      enabled,
      ttlSeconds,
      validStatusRules
    };
  } catch {
    return defaultSettings;
  }
};

const serializeCacheSettings = (settings: CacheSettings): string =>
  JSON.stringify({
    enabled: settings.enabled,
    ttlSeconds: settings.ttlSeconds,
    validStatusRules: settings.validStatusRules
  });

const getCacheSettings = async (env: Env): Promise<CacheSettings> =>
  parseCacheSettings(await getLinkStore(env).get(CACHE_SETTINGS_KEY));

const getCacheVersion = async (env: Env): Promise<string> => (await getLinkStore(env).get(CACHE_VERSION_KEY)) ?? "1";

const createCacheVersion = (): string => Date.now().toString(36);

const getCacheLastUpdatedAt = async (env: Env): Promise<string | null> => {
  const value = await getLinkStore(env).get(CACHE_LAST_UPDATED_AT_KEY);
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
};

const matchesStatusRule = (status: number, rule: string): boolean => {
  if (rule.includes("-")) {
    const [start, end] = rule.split("-").map(Number);
    return status >= start && status <= end;
  }

  return status === Number(rule);
};

const matchesStatusRules = (status: number, rules: string[]): boolean =>
  rules.length === 0 || rules.some((rule) => matchesStatusRule(status, rule));

const isCacheableRequest = (request: Request): boolean =>
  request.method === "GET" || request.method === "HEAD";

const buildOutboundHeaders = (request: Request): Headers => {
  const outboundHeaders = new Headers(request.headers);
  outboundHeaders.delete("accept-encoding");
  outboundHeaders.delete("content-length");
  outboundHeaders.delete("host");
  outboundHeaders.delete("cf-connecting-ip");
  outboundHeaders.delete("cf-ipcountry");
  outboundHeaders.delete("cf-ray");
  outboundHeaders.delete("x-forwarded-proto");
  return outboundHeaders;
};

const buildCacheKey = async (
  cacheVersion: string,
  method: string,
  url: string,
  headers: Headers,
  bodyBuffer?: ArrayBuffer
): Promise<string> => {
  const bodyHash = bodyBuffer ? toBase64Url(await crypto.subtle.digest("SHA-256", bodyBuffer)) : "";
  const fingerprint = JSON.stringify({
    method,
    url,
    headers: Array.from(headers.entries()).sort(([left], [right]) => left.localeCompare(right)),
    bodyHash
  });
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(fingerprint));
  return `${CACHE_ENTRY_PREFIX}${cacheVersion}:${toBase64Url(digest)}`;
};

const prepareProxyRequest = async (
  request: Request,
  targetUrl: string,
  cacheVersion?: string
): Promise<PreparedProxyRequest> => {
  const outboundHeaders = buildOutboundHeaders(request);
  const bodyBuffer = request.method === "GET" || request.method === "HEAD" ? undefined : await request.clone().arrayBuffer();
  const targetRequestUrl = buildTargetUrl(targetUrl, request);

  return {
    targetRequest: new Request(targetRequestUrl, {
      method: request.method,
      headers: outboundHeaders,
      body: bodyBuffer,
      redirect: "follow"
    }),
    cacheKey: cacheVersion ? await buildCacheKey(cacheVersion, request.method, targetRequestUrl, outboundHeaders, bodyBuffer) : undefined
  };
};

const sanitizeCachedResponseHeaders = (headers: Headers): [string, string][] =>
  Array.from(headers.entries()).filter(([name]) => {
    const lowerName = name.toLowerCase();
    return (
      lowerName !== "connection" &&
      lowerName !== "content-length" &&
      lowerName !== "set-cookie" &&
      lowerName !== "set-cookie2" &&
      lowerName !== "transfer-encoding" &&
      !lowerName.startsWith("cf-")
    );
  });

const parseCachedResponseRecord = (value: string | null): CachedResponseRecord | null => {
  if (!value) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(value);
    if (!isPlainObject(parsedValue) || !Array.isArray(parsedValue.headers)) {
      return null;
    }

    const cachedAt = parsedValue.cachedAt;
    const status = parsedValue.status;
    const bodyBase64 = parsedValue.bodyBase64;

    if (
      typeof cachedAt !== "number" ||
      !Number.isFinite(cachedAt) ||
      typeof status !== "number" ||
      !isValidHttpStatusCode(status) ||
      typeof bodyBase64 !== "string"
    ) {
      return null;
    }

    const headers = parsedValue.headers.filter(
      (entry): entry is [string, string] =>
        Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && typeof entry[1] === "string"
    );

    if (headers.length !== parsedValue.headers.length) {
      return null;
    }

    return {
      cachedAt,
      status,
      headers,
      bodyBase64
    };
  } catch {
    return null;
  }
};

const getCachedResponseRecord = async (env: Env, cacheKey: string): Promise<CachedResponseRecord | null> =>
  parseCachedResponseRecord(await getLinkStore(env).get(cacheKey));

const storeCachedResponse = async (env: Env, cacheKey: string, response: Response): Promise<void> => {
  const responseBody = await response.clone().arrayBuffer();
  const cachedAtIso = new Date().toISOString();
  const record: CachedResponseRecord = {
    cachedAt: Date.now(),
    status: response.status,
    headers: sanitizeCachedResponseHeaders(response.headers),
    bodyBase64: toBase64(responseBody)
  };

  const linkStore = getLinkStore(env);
  await Promise.all([
    linkStore.put(cacheKey, JSON.stringify(record)),
    linkStore.put(CACHE_LAST_UPDATED_AT_KEY, cachedAtIso)
  ]);
};

const buildCachedResponse = (record: CachedResponseRecord, cacheStatus: string): Response => {
  const headers = new Headers(record.headers);
  headers.delete("content-length");
  headers.set(CACHE_STATUS_HEADER, cacheStatus);

  return new Response(record.bodyBase64 ? fromBase64(record.bodyBase64) : null, {
    status: record.status,
    headers
  });
};

const withCacheStatus = (response: Response, cacheStatus: string): Response => {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set(CACHE_STATUS_HEADER, cacheStatus);
  return new Response(response.body, {
    status: response.status,
    headers
  });
};

const parseCookies = (request: Request): Map<string, string> => {
  const cookieHeader = request.headers.get("cookie");
  const cookies = new Map<string, string>();

  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (!name || rest.length === 0) {
      continue;
    }

    cookies.set(name, rest.join("="));
  }

  return cookies;
};

const toBase64Url = (buffer: ArrayBuffer): string => {
  let binary = "";
  const bytes = new Uint8Array(buffer);

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const constantTimeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return result === 0;
};

const generateAccessToken = (length = 32): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);

  let token = "";
  for (const byte of randomBytes) {
    token += alphabet[byte % alphabet.length];
  }

  return token;
};

const signAdminSession = async (value: string, env: Env): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getAdminKey(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return toBase64Url(signature);
};

const buildSessionCookie = (request: Request, value: string, maxAge: number): string => {
  const url = new URL(request.url);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${ADMIN_SESSION_COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
};

const buildAdminSessionValue = async (env: Env): Promise<string> => {
  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SECONDS;
  const payload = String(expiresAt);
  const signature = await signAdminSession(payload, env);
  return `${payload}.${signature}`;
};

const hasValidAdminSession = async (request: Request, env: Env): Promise<boolean> => {
  const sessionValue = parseCookies(request).get(ADMIN_SESSION_COOKIE);
  if (!sessionValue) {
    return false;
  }

  const [expiresAtRaw, signature] = sessionValue.split(".");
  if (!expiresAtRaw || !signature) {
    return false;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expectedSignature = await signAdminSession(expiresAtRaw, env);
  return constantTimeEqual(signature, expectedSignature);
};

const isAllowedUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const getCurrentAccessToken = async (env: Env): Promise<string> => {
  const storedAccessToken = await getLinkStore(env).get(ACCESS_TOKEN_KEY);
  return storedAccessToken ?? env.INITIAL_ACCESS_TOKEN ?? env.ACCESS_TOKEN ?? "";
};

const ensureAccessToken = async (env: Env): Promise<string> => {
  const currentAccessToken = await getCurrentAccessToken(env);
  if (currentAccessToken) {
    return currentAccessToken;
  }

  const generatedAccessToken = generateAccessToken();
  await getLinkStore(env).put(ACCESS_TOKEN_KEY, generatedAccessToken);
  return generatedAccessToken;
};

const buildTargetUrl = (targetUrl: string, request: Request): string => {
  const destination = new URL(targetUrl);
  const incomingUrl = new URL(request.url);

  for (const [key, value] of incomingUrl.searchParams.entries()) {
    if (key === "token") {
      continue;
    }

    destination.searchParams.append(key, value);
  }

  return destination.toString();
};

const proxyRequest = async (request: Request, env: Env): Promise<Response> => {
  const accessToken = readAccessToken(request);
  const currentAccessToken = await getCurrentAccessToken(env);
  if (!currentAccessToken) {
    return json({ error: "Access token is not configured" }, 503);
  }

  if (accessToken !== currentAccessToken) {
    return json({ error: "Unauthorized" }, 401);
  }

  const targetUrl = await getLinkStore(env).get(TARGET_URL_KEY);
  if (!targetUrl) {
    return json({ error: "Target URL is not configured" }, 503);
  }

  const cacheSettings = await getCacheSettings(env);
  if (!cacheSettings.enabled || !isCacheableRequest(request)) {
    const { targetRequest } = await prepareProxyRequest(request, targetUrl);
    return fetch(targetRequest);
  }

  const cacheVersion = await getCacheVersion(env);
  const { targetRequest, cacheKey } = await prepareProxyRequest(request, targetUrl, cacheVersion);
  if (!cacheKey) {
    return fetch(targetRequest);
  }

  const staleCachedResponse = await getCachedResponseRecord(env, cacheKey);
  const cacheAge = staleCachedResponse ? Date.now() - staleCachedResponse.cachedAt : Number.POSITIVE_INFINITY;

  if (staleCachedResponse && cacheAge < cacheSettings.ttlSeconds * 1000) {
    return buildCachedResponse(staleCachedResponse, "HIT");
  }

  try {
    const upstreamResponse = await fetch(targetRequest);
    if (matchesStatusRules(upstreamResponse.status, cacheSettings.validStatusRules)) {
      await storeCachedResponse(env, cacheKey, upstreamResponse);
      return withCacheStatus(upstreamResponse, staleCachedResponse ? "REFRESH" : "MISS");
    }

    if (staleCachedResponse) {
      return buildCachedResponse(staleCachedResponse, "STALE");
    }

    return withCacheStatus(upstreamResponse, "BYPASS");
  } catch (error) {
    if (staleCachedResponse) {
      return buildCachedResponse(staleCachedResponse, "STALE");
    }

    throw error;
  }
};

const ensureAdmin = async (request: Request, env: Env): Promise<Response | null> => {
  const adminToken = readAdminToken(request);
  if (adminToken !== getAdminKey(env)) {
    const validSession = await hasValidAdminSession(request, env);
    if (!validSession) {
      return json({ error: "Unauthorized" }, 401);
    }
  }

  return null;
};

const handleAdminGet = async (request: Request, env: Env): Promise<Response> => {
  const unauthorized = await ensureAdmin(request, env);
  if (unauthorized) {
    return unauthorized;
  }

  const targetUrl = await getLinkStore(env).get(TARGET_URL_KEY);
  return json({
    configured: Boolean(targetUrl),
    targetUrl: targetUrl ?? null
  });
};

const getAdminSettings = async (env: Env): Promise<{
  configured: boolean;
  targetUrl: string | null;
  accessToken: string;
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
  cacheValidStatusRules: string[];
  cacheLastUpdatedAt: string | null;
}> => {
  const linkStore = getLinkStore(env);
  const [targetUrl, accessToken, cacheSettings, cacheLastUpdatedAt] = await Promise.all([
    linkStore.get(TARGET_URL_KEY),
    ensureAccessToken(env),
    getCacheSettings(env),
    getCacheLastUpdatedAt(env)
  ]);

  return {
    configured: Boolean(targetUrl),
    targetUrl: targetUrl ?? null,
    accessToken,
    cacheEnabled: cacheSettings.enabled,
    cacheTtlSeconds: cacheSettings.ttlSeconds,
    cacheValidStatusRules: cacheSettings.validStatusRules,
    cacheLastUpdatedAt
  };
};

const handleAdminSettingsGet = async (request: Request, env: Env): Promise<Response> => {
  const unauthorized = await ensureAdmin(request, env);
  if (unauthorized) {
    return unauthorized;
  }

  return json(await getAdminSettings(env));
};

const handleAdminPut = async (request: Request, env: Env): Promise<Response> => {
  const unauthorized = await ensureAdmin(request, env);
  if (unauthorized) {
    return unauthorized;
  }

  let payload: UpdatePayload;
  try {
    payload = await request.json<UpdatePayload>();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload.targetUrl || !isAllowedUrl(payload.targetUrl)) {
    return json({ error: "targetUrl must be a valid http or https URL" }, 400);
  }

  await getLinkStore(env).put(TARGET_URL_KEY, payload.targetUrl);

  return json({
    ok: true,
    targetUrl: payload.targetUrl
  });
};

const handleAdminSettingsPut = async (request: Request, env: Env): Promise<Response> => {
  const unauthorized = await ensureAdmin(request, env);
  if (unauthorized) {
    return unauthorized;
  }

  let payload: SettingsPayload;
  try {
    payload = await request.json<SettingsPayload>();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload.targetUrl || !isAllowedUrl(payload.targetUrl)) {
    return json({ error: "targetUrl must be a valid http or https URL" }, 400);
  }

  if (!payload.accessToken || !payload.accessToken.trim()) {
    return json({ error: "accessToken must be a non-empty string" }, 400);
  }

  const accessToken = payload.accessToken.trim();
  const currentCacheSettings = await getCacheSettings(env);
  const cacheLastUpdatedAt = await getCacheLastUpdatedAt(env);

  let cacheEnabled = currentCacheSettings.enabled;
  if (payload.cacheEnabled !== undefined) {
    if (typeof payload.cacheEnabled !== "boolean") {
      return json({ error: "cacheEnabled must be a boolean" }, 400);
    }

    cacheEnabled = payload.cacheEnabled;
  }

  let cacheTtlSeconds = currentCacheSettings.ttlSeconds;
  if (payload.cacheTtlSeconds !== undefined) {
    if (
      typeof payload.cacheTtlSeconds !== "number" ||
      !Number.isInteger(payload.cacheTtlSeconds) ||
      payload.cacheTtlSeconds < 1
    ) {
      return json({ error: "cacheTtlSeconds must be an integer greater than or equal to 1" }, 400);
    }

    cacheTtlSeconds = payload.cacheTtlSeconds;
  }

  let cacheValidStatusRules = currentCacheSettings.validStatusRules;
  if (payload.cacheValidStatusRules !== undefined) {
    const normalizedRules = normalizeStatusRules(payload.cacheValidStatusRules);
    if (!normalizedRules) {
      return json({ error: "cacheValidStatusRules must be an array of HTTP status codes or ranges" }, 400);
    }

    cacheValidStatusRules = normalizedRules;
  }

  const nextCacheSettings: CacheSettings = {
    enabled: cacheEnabled,
    ttlSeconds: cacheTtlSeconds,
    validStatusRules: cacheValidStatusRules
  };

  const linkStore = getLinkStore(env);
  await Promise.all([
    linkStore.put(TARGET_URL_KEY, payload.targetUrl),
    linkStore.put(ACCESS_TOKEN_KEY, accessToken),
    linkStore.put(CACHE_SETTINGS_KEY, serializeCacheSettings(nextCacheSettings))
  ]);

  return json({
    ok: true,
    targetUrl: payload.targetUrl,
    accessToken,
    cacheEnabled: nextCacheSettings.enabled,
    cacheTtlSeconds: nextCacheSettings.ttlSeconds,
    cacheValidStatusRules: nextCacheSettings.validStatusRules,
    cacheLastUpdatedAt
  });
};

const handleAdminCacheClear = async (request: Request, env: Env): Promise<Response> => {
  const unauthorized = await ensureAdmin(request, env);
  if (unauthorized) {
    return unauthorized;
  }

  const linkStore = getLinkStore(env);
  await Promise.all([linkStore.put(CACHE_VERSION_KEY, createCacheVersion()), linkStore.delete(CACHE_LAST_UPDATED_AT_KEY)]);

  return json({
    ok: true,
    cacheLastUpdatedAt: null
  });
};

const handleAdminLogin = async (request: Request, env: Env): Promise<Response> => {
  let payload: LoginPayload;
  try {
    payload = await request.json<LoginPayload>();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (payload.token !== getAdminKey(env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const sessionValue = await buildAdminSessionValue(env);
  const settings = await getAdminSettings(env);
  return new Response(JSON.stringify({ ok: true, ...settings }, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": buildSessionCookie(request, sessionValue, ADMIN_SESSION_TTL_SECONDS)
    }
  });
};

const handleAdminLogout = (request: Request): Response =>
  new Response(JSON.stringify({ ok: true }, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": buildSessionCookie(request, "", 0)
    }
  });

const handleAdminBootstrap = async (request: Request, env: Env): Promise<Response> => {
  const authenticated = await hasValidAdminSession(request, env);
  if (!authenticated) {
    return json({ authenticated: false });
  }

  const settings = await getAdminSettings(env);
  return json({ authenticated: true, ...settings });
};

const handleRequest = async (request: Request, env: Env): Promise<Response> => {
  try {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true });
    }

    if (url.pathname === "/admin/login") {
      if (request.method !== "POST") {
        return json({ error: "Method Not Allowed" }, 405);
      }

      return handleAdminLogin(request, env);
    }

    if (url.pathname === "/admin/logout") {
      if (request.method !== "POST") {
        return json({ error: "Method Not Allowed" }, 405);
      }

      return handleAdminLogout(request);
    }

    if (url.pathname === "/admin/bootstrap") {
      if (request.method !== "GET") {
        return json({ error: "Method Not Allowed" }, 405);
      }

      return handleAdminBootstrap(request, env);
    }

    if (url.pathname === "/admin/settings") {
      if (request.method === "GET") {
        return handleAdminSettingsGet(request, env);
      }

      if (request.method === "PUT") {
        return handleAdminSettingsPut(request, env);
      }

      return json({ error: "Method Not Allowed" }, 405);
    }

    if (url.pathname === "/admin/cache/clear") {
      if (request.method !== "POST") {
        return json({ error: "Method Not Allowed" }, 405);
      }

      return handleAdminCacheClear(request, env);
    }

    if (url.pathname === "/admin/target") {
      if (request.method === "GET") {
        return handleAdminGet(request, env);
      }

      if (request.method === "PUT") {
        return handleAdminPut(request, env);
      }

      return json({ error: "Method Not Allowed" }, 405);
    }

    return proxyRequest(request, env);
  } catch (error) {
    if (error instanceof MissingKvBindingError) {
      return json({ error: error.message }, 503);
    }

    throw error;
  }
};

export default {
  fetch(request, env): Promise<Response> {
    return handleRequest(request, env);
  }
} satisfies ExportedHandler<Env>;