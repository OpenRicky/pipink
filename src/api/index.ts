const TARGET_URL_KEY = "current_target_url";
const ACCESS_TOKEN_KEY = "current_access_token";
const ADMIN_SESSION_COOKIE = "pipink_admin_session";
const ADMIN_SESSION_TTL_SECONDS = 60 * 30;
const encoder = new TextEncoder();

interface Env {
  LINK_STORE: KVNamespace;
  INITIAL_ACCESS_TOKEN?: string;
  ACCESS_TOKEN?: string;
  ADMIN_KEY?: string;
  ADMIN_TOKEN?: string;
}

interface UpdatePayload {
  targetUrl?: string;
}

interface SettingsPayload {
  targetUrl?: string;
  accessToken?: string;
}

interface LoginPayload {
  token?: string;
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
  const storedAccessToken = await env.LINK_STORE.get(ACCESS_TOKEN_KEY);
  return storedAccessToken ?? env.INITIAL_ACCESS_TOKEN ?? env.ACCESS_TOKEN ?? "";
};

const ensureAccessToken = async (env: Env): Promise<string> => {
  const currentAccessToken = await getCurrentAccessToken(env);
  if (currentAccessToken) {
    return currentAccessToken;
  }

  const generatedAccessToken = generateAccessToken();
  await env.LINK_STORE.put(ACCESS_TOKEN_KEY, generatedAccessToken);
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

  const targetUrl = await env.LINK_STORE.get(TARGET_URL_KEY);
  if (!targetUrl) {
    return json({ error: "Target URL is not configured" }, 503);
  }

  const outboundHeaders = new Headers(request.headers);
  outboundHeaders.delete("host");
  outboundHeaders.delete("cf-connecting-ip");
  outboundHeaders.delete("cf-ipcountry");
  outboundHeaders.delete("cf-ray");
  outboundHeaders.delete("x-forwarded-proto");

  const targetRequest = new Request(buildTargetUrl(targetUrl, request), {
    method: request.method,
    headers: outboundHeaders,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "follow"
  });

  return fetch(targetRequest);
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

  const targetUrl = await env.LINK_STORE.get(TARGET_URL_KEY);
  return json({
    configured: Boolean(targetUrl),
    targetUrl: targetUrl ?? null
  });
};

const getAdminSettings = async (env: Env): Promise<{
  configured: boolean;
  targetUrl: string | null;
  accessToken: string;
}> => {
  const [targetUrl, accessToken] = await Promise.all([
    env.LINK_STORE.get(TARGET_URL_KEY),
    ensureAccessToken(env)
  ]);

  return {
    configured: Boolean(targetUrl),
    targetUrl: targetUrl ?? null,
    accessToken
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

  await env.LINK_STORE.put(TARGET_URL_KEY, payload.targetUrl);

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

  await Promise.all([
    env.LINK_STORE.put(TARGET_URL_KEY, payload.targetUrl),
    env.LINK_STORE.put(ACCESS_TOKEN_KEY, accessToken)
  ]);

  return json({
    ok: true,
    targetUrl: payload.targetUrl,
    accessToken
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
};

export default {
  fetch(request, env): Promise<Response> {
    return handleRequest(request, env);
  }
} satisfies ExportedHandler<Env>;