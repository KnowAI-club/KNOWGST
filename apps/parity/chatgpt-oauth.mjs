import OpenAI from "openai";
import {
  AI_INSTRUCTIONS,
  AI_MAX_OUTPUT,
  createAiRequestLimiter,
  redactSensitiveText,
  validatedAiText,
} from "./ai-guardrails.mjs";
import http from "node:http";
import {
  randomBytes,
  createHash,
  createPublicKey,
  verify,
  timingSafeEqual,
} from "node:crypto";
const AUTH = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (message) => Object.assign(new Error(message), { status: 400 });
const isIssuedClientId = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9_-]{1,250}$/.test(value) &&
  value !== "dynamic_agent_client";
function unfinishedRegistrations(s) {
  const registrations = new Map();
  const completed = new Set(s.accounts.map((a) => a.clientId));
  for (const registration of [
    ...(Array.isArray(s.incompleteChatgptRegistrations)
      ? s.incompleteChatgptRegistrations
      : []),
    s.incompleteChatgptRegistration,
  ]) {
    const clientId = registration?.clientId;
    if (isIssuedClientId(clientId) && !completed.has(clientId)) {
      registrations.delete(clientId);
      registrations.set(clientId, { clientId });
    }
  }
  return [...registrations.values()];
}
function retainRegistration(s, clientId) {
  s.incompleteChatgptRegistrations = [
    ...unfinishedRegistrations(s).filter((a) => a.clientId !== clientId),
    { clientId },
  ];
  // Keep the legacy pointer for normal retries and older credential files.
  s.incompleteChatgptRegistration = { clientId };
}
function removeRegistration(s, clientId) {
  const remaining = unfinishedRegistrations(s).filter(
    (a) => a.clientId !== clientId,
  );
  if (remaining.length) {
    s.incompleteChatgptRegistrations = remaining;
    s.incompleteChatgptRegistration = remaining.at(-1);
  } else {
    delete s.incompleteChatgptRegistrations;
    delete s.incompleteChatgptRegistration;
  }
}
function callbackError(supplied) {
  const workspaceMessage =
    "This registration is restricted to its original ChatGPT workspace. Choose the original account and workspace, or use another account or workspace.";
  const recovery = {
    access_denied:
      "OpenAI did not authorize this connection. Check the selected account, workspace access and requested permissions.",
    "3p_login_workspace_scope_denied": workspaceMessage,
    workspace_scope_denied: workspaceMessage,
    temporarily_unavailable:
      "ChatGPT is temporarily unavailable. Try again shortly.",
    server_error: "ChatGPT is temporarily unavailable. Try again shortly.",
    invalid_request:
      "OpenAI rejected the sign-in parameters. Update KnowGST and retry sign-in.",
    invalid_scope:
      "The requested ChatGPT permission was rejected. Review the sign-in permissions.",
    unauthorized_client:
      "This app registration is not authorized for this connection.",
    invalid_client: "OpenAI rejected this app registration.",
  };
  // Callback descriptions and unknown codes may contain credentials or URLs.
  // Keep provider denial separate from token-exchange recovery: never retry it.
  return fail(
    Object.hasOwn(recovery, supplied)
      ? `ChatGPT sign-in was not completed (${supplied}). ${recovery[supplied]}`
      : "ChatGPT sign-in was not completed. Check the OpenAI sign-in page for details.",
  );
}
async function readOAuthError(response) {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        return {};
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  } finally {
    reader.releaseLock();
  }
}
export function validateIdentity(
  jwt,
  keys,
  { clientId, nonce, subject, now = Date.now() },
) {
  if (typeof jwt !== "string") throw fail("Missing ChatGPT identity token.");
  const parts = jwt.split(".");
  if (parts.length !== 3) throw fail("Invalid ChatGPT identity token.");
  const header = JSON.parse(Buffer.from(parts[0], "base64url"));
  const claims = JSON.parse(Buffer.from(parts[1], "base64url"));
  const jwk = keys.find(
    (k) =>
      k.kid === header.kid && k.kty === "RSA" && (!k.use || k.use === "sig"),
  );
  if (
    header.alg !== "RS256" ||
    !jwk ||
    !verify(
      "RSA-SHA256",
      Buffer.from(parts.slice(0, 2).join(".")),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(parts[2], "base64url"),
    )
  )
    throw fail("ChatGPT identity signature could not be verified.");
  if (
    claims.iss !== AUTH ||
    !(Array.isArray(claims.aud)
      ? claims.aud.includes(clientId)
      : claims.aud === clientId) ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= now / 1000 ||
    claims.nbf > now / 1000 + 30 ||
    !same(claims.nonce, nonce) ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    (subject && claims.sub !== subject) ||
    (claims.azp && claims.azp !== clientId) ||
    (Array.isArray(claims.aud) &&
      claims.aud.length > 1 &&
      claims.azp !== clientId)
  )
    throw fail("ChatGPT identity did not match this sign-in.");
  return claims;
}
export function chatgptOAuth(store, { fetcher = fetch } = {}) {
  let attempt = null,
    lastError = "",
    generation = 0,
    authorizationGeneration = 0;
  const refreshes = new Map();
  const requests = new Set();
  const requestLimiter = createAiRequestLimiter();
  const current = () => {
    const s = store.get();
    return s.accounts.find((a) => a.clientId === s.active);
  };
  async function json(url, options = {}) {
    const r = await fetcher(url, {
      ...options,
      signal: options.signal || AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (!r.ok) {
      // Provider descriptions can echo codes/tokens. Show only known error codes.
      const payload = await readOAuthError(r);
      const supplied =
        typeof payload?.error === "string"
          ? payload.error
          : payload?.error?.code;
      const recovery = {
        invalid_grant:
          "The sign-in code was rejected. Start a fresh sign-in from Settings.",
        invalid_client:
          "The app registration was rejected. Start a new ChatGPT connection.",
        invalid_request:
          "OpenAI rejected the sign-in parameters. Update KnowGST and retry sign-in.",
        unauthorized_client:
          "This app registration is not authorized for this connection.",
        invalid_scope:
          "The requested ChatGPT permission was rejected. Review the sign-in permissions.",
        invalid_resource:
          "OpenAI rejected the requested service. Update KnowGST and retry sign-in.",
        unsupported_grant_type:
          "OpenAI rejected the authorization method. Update KnowGST and retry sign-in.",
        access_denied:
          "ChatGPT access was not approved. Start sign-in and review the requested permissions.",
        temporarily_unavailable:
          "ChatGPT is temporarily unavailable. Try again shortly.",
        server_error: "ChatGPT is temporarily unavailable. Try again shortly.",
      };
      const code =
        typeof supplied === "string" && Object.hasOwn(recovery, supplied)
          ? supplied
          : "";
      const endpoint = new URL(url).pathname;
      const step = endpoint.endsWith("/oauth/token")
        ? new URLSearchParams(options.body).get("grant_type") ===
          "refresh_token"
          ? "session renewal"
          : "sign-in exchange"
        : endpoint.endsWith("/models")
          ? "model list"
          : "identity verification";
      const error = fail(
        `ChatGPT ${step} failed (${r.status}${code ? " · " + code : ""}). ${code ? recovery[code] : "Check your connection and retry sign-in from Settings."}`,
      );
      error.oauthCode = code;
      throw error;
    }
    return r.json();
  }
  function stopRequests() {
    generation++;
    for (const r of requests) r.abort();
    requests.clear();
  }
  function cancel() {
    authorizationGeneration++;
    if (attempt) {
      attempt.controller.abort();
      clearTimeout(attempt.timer);
      attempt.server.close();
      attempt = null;
    }
  }
  function status() {
    const s = store.get();
    return {
      active: s.active,
      accounts: s.accounts.map((a) => ({
        clientId: a.clientId,
        email: a.email,
        connected: !!a.accessToken,
        planEnabled: !!a.scopes?.includes("chatgpt.tokens.use.direct"),
      })),
      unfinishedRegistrations: unfinishedRegistrations(s),
      pending: !!attempt,
      authorizationUrl: attempt?.authorizationUrl || null,
      notice: attempt?.recoveries
        ? "Finishing ChatGPT sign-in with a fresh authorization."
        : "",
      error: lastError,
    };
  }
  async function start(clientId, options = {}) {
    if (
      !options ||
      typeof options !== "object" ||
      Array.isArray(options) ||
      (options.newAccount !== undefined &&
        typeof options.newAccount !== "boolean")
    )
      throw fail("Choose whether to add a new ChatGPT account.");
    const { newAccount = false } = options;
    if (
      (clientId !== undefined && !isIssuedClientId(clientId)) ||
      (newAccount && clientId !== undefined)
    )
      throw fail("Choose a saved connection or add a new account, not both.");
    const saved = store.get();
    const old = saved.accounts.find((a) => a.clientId === clientId);
    const unfinished = unfinishedRegistrations(saved);
    const selected = unfinished.find((a) => a.clientId === clientId);
    if (clientId && !old && !selected)
      throw fail("Choose a saved account or add a new account.");
    cancel();
    const startedGeneration = authorizationGeneration;
    lastError = "";
    let expectedClientId =
      old?.clientId ||
      selected?.clientId ||
      (!newAccount ? unfinished.at(-1)?.clientId : null);
    const a = {
      state: randomBytes(32).toString("base64url"),
      nonce: randomBytes(32).toString("base64url"),
      verifier: randomBytes(48).toString("base64url"),
      old,
      claimed: false,
      recoveries: 0,
      controller: new AbortController(),
    };
    function authorizationUrl() {
      const url = new URL(AUTH + "/api/accounts/authorize");
      url.search = new URLSearchParams({
        client_id: expectedClientId || "dynamic_agent_client",
        ext_agent_host_id: store.get().hostId,
        response_type: "code",
        redirect_uri: a.redirect,
        scope: SCOPES,
        resource: RESOURCE,
        state: a.state,
        nonce: a.nonce,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(a.verifier)
          .digest("base64url"),
        ...(!expectedClientId ? { agent_name_hint: "KnowGST" } : {}),
        ...(old?.email ? { login_hint: old.email } : {}),
      }).toString();
      return url.href;
    }
    function armTimeout() {
      clearTimeout(a.timer);
      a.timer = setTimeout(
        () => {
          if (attempt === a) {
            lastError = "Sign-in expired. Please try again.";
            cancel();
          }
        },
        5 * 60 * 1000,
      );
      a.timer.unref();
    }
    const server = http.createServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'",
      );
      const u = new URL(req.url, "http://127.0.0.1");
      if (
        req.method !== "GET" ||
        u.pathname !== "/auth/callback" ||
        req.headers.host !== `127.0.0.1:${server.address()?.port}` ||
        !same(u.searchParams.get("state"), a.state) ||
        a.claimed ||
        attempt !== a
      ) {
        res.writeHead(400);
        res.end("Invalid or expired sign-in. Return to KnowGST.");
        return;
      }
      a.claimed = true;
      const acceptedState = a.state;
      try {
        if (u.searchParams.has("error"))
          throw callbackError(u.searchParams.get("error"));
        const issued = u.searchParams.get("client_id") || expectedClientId;
        if (
          !isIssuedClientId(issued) ||
          (expectedClientId && issued !== expectedClientId)
        )
          throw fail(
            "ChatGPT registration did not return the expected client ID.",
          );
        const code = u.searchParams.get("code");
        if (!code || code.length > 4096)
          throw fail("Missing authorization code.");
        // A registration is not a connected identity. Retain only its public ID
        // so failed exchanges retry authorization instead of registering duplicates.
        a.issuedClientId = issued;
        if (!old)
          store.update((s) => {
            retainRegistration(s, issued);
          });
        const tokens = await json(AUTH + "/api/accounts/oauth/token", {
          signal: AbortSignal.any([
            a.controller.signal,
            AbortSignal.timeout(20000),
          ]),
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: issued,
            code,
            code_verifier: a.verifier,
            redirect_uri: a.redirect,
            resource: RESOURCE,
          }),
        });
        const jwks = await json(AUTH + "/.well-known/jwks.json", {
          signal: AbortSignal.any([
            a.controller.signal,
            AbortSignal.timeout(20000),
          ]),
        });
        const identity = validateIdentity(tokens.id_token, jwks.keys, {
          clientId: issued,
          nonce: a.nonce,
          subject: old?.subject,
        });
        if (
          !tokens.access_token ||
          tokens.token_type?.toLowerCase() !== "bearer" ||
          !(Number(tokens.expires_in) > 0)
        )
          throw fail("ChatGPT returned incomplete credentials.");
        if (attempt !== a) throw fail("This sign-in was cancelled.");
        stopRequests();
        store.update((s) => {
          const existing = s.accounts.find((x) => x.clientId === issued);
          if (existing && existing.subject !== identity.sub)
            throw fail("The account identity changed.");
          s.accounts = s.accounts.filter((x) => x.clientId !== issued);
          s.accounts.push({
            clientId: issued,
            subject: identity.sub,
            email: identity.email || "ChatGPT account",
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            idToken: tokens.id_token,
            scopes: String(tokens.scope || "").split(" "),
            expires: Date.now() + Number(tokens.expires_in) * 1000,
          });
          s.active = issued;
          removeRegistration(s, issued);
        });
        res.end(
          "ChatGPT connected. You can close this tab and return to KnowGST.",
        );
      } catch (e) {
        // A cancelled exchange must never report an error into a newer sign-in
        // or remove its retained registration.
        if (attempt !== a) {
          res.writeHead(400);
          res.end("This sign-in was cancelled. Return to KnowGST.");
          return;
        }
        if (
          e.oauthCode === "invalid_grant" &&
          a.recoveries === 0 &&
          a.issuedClientId
        ) {
          // Discard the rejected code. Continue through authorization once with
          // the issued registration and completely new PKCE, state and nonce.
          // A second rejection is surfaced; this never retries a token exchange.
          expectedClientId = a.issuedClientId;
          a.recoveries++;
          a.state = randomBytes(32).toString("base64url");
          a.nonce = randomBytes(32).toString("base64url");
          a.verifier = randomBytes(48).toString("base64url");
          a.claimed = false;
          a.authorizationUrl = authorizationUrl();
          armTimeout();
          lastError = "";
          res.writeHead(303, { Location: a.authorizationUrl });
          res.end("Continuing ChatGPT sign-in with a fresh authorization.");
          return;
        }
        if (
          ["invalid_client", "unauthorized_client"].includes(e.oauthCode) &&
          a.issuedClientId
        ) {
          try {
            store.update((s) => {
              removeRegistration(s, a.issuedClientId);
            });
          } catch {
            /* Preserve the original provider error if local recovery metadata cannot be saved. */
          }
        }
        lastError = e.status
          ? e.message
          : "ChatGPT sign-in could not be verified. Please try again.";
        res.writeHead(400);
        res.end(lastError);
      } finally {
        if (attempt === a && a.state === acceptedState) cancel();
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    if (authorizationGeneration !== startedGeneration) {
      server.close();
      throw fail("This sign-in was cancelled or superseded.");
    }
    a.server = server;
    a.redirect = `http://127.0.0.1:${server.address().port}/auth/callback`;
    attempt = a;
    a.authorizationUrl = authorizationUrl();
    armTimeout();
    return { url: a.authorizationUrl };
  }
  async function token() {
    const a = current();
    if (!a?.accessToken) throw fail("Connect your ChatGPT account first.");
    if (
      !a.scopes.includes("chatgpt.tokens.use.direct") ||
      !a.scopes.includes("resource.invoke")
    )
      throw fail("Authorize ChatGPT plan usage before making AI requests.");
    if (a.expires > Date.now() + 60000) return a.accessToken;
    if (!a.refreshToken) throw fail("Sign in to ChatGPT again.");
    if (!refreshes.has(a.clientId)) {
      const g = generation;
      const promise = (async () => {
        const t = await json(AUTH + "/api/accounts/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: a.clientId,
            refresh_token: a.refreshToken,
            resource: RESOURCE,
          }),
        });
        if (g !== generation) throw fail("ChatGPT account changed.");
        if (!t.access_token || !t.refresh_token || !(Number(t.expires_in) > 0))
          throw fail("Sign in to ChatGPT again.");
        store.update((s) => {
          const x = s.accounts.find((x) => x.clientId === a.clientId);
          Object.assign(x, {
            accessToken: t.access_token,
            refreshToken: t.refresh_token,
            expires: Date.now() + Number(t.expires_in) * 1000,
            scopes: t.scope ? String(t.scope).split(" ") : x.scopes,
          });
        });
        return t.access_token;
      })();
      refreshes.set(a.clientId, promise);
      promise.finally(() => refreshes.delete(a.clientId)).catch(() => {});
    }
    return refreshes.get(a.clientId);
  }
  async function models() {
    const g = generation;
    const t = await token();
    const d = await json(RESOURCE + "/models", {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (g !== generation) throw fail("ChatGPT account changed.");
    return (d.models || [])
      .filter((m) => m.visibility === "list")
      .map((m) => ({ id: m.slug, name: m.display_name || m.slug }));
  }
  async function ask(input, options = {}) {
    const release = requestLimiter.enter();
    try {
      return await performAsk(input || {}, options);
    } finally {
      release();
    }
  }
  async function performAsk({ model, prompt }, { image, beforeSend } = {}) {
    if (
      typeof model !== "string" ||
      !model.trim() ||
      model.length > 200 ||
      typeof prompt !== "string" ||
      !prompt.trim() ||
      prompt.length > 12000
    )
      throw fail(
        "Enter a question up to 12,000 characters and choose a model.",
      );
    const g = generation;
    const available = await models();
    if (!available.some((m) => m.id === model))
      throw fail("Choose an available model.");
    const t = await token();
    if (g !== generation) throw fail("ChatGPT account changed.");
    // Scope can change while model discovery or token refresh is pending.
    // This synchronous guard must run at the last point before data leaves.
    beforeSend?.();
    prompt = redactSensitiveText(prompt);
    const controller = new AbortController();
    requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const client = new OpenAI({
        apiKey: t,
        baseURL: RESOURCE,
        maxRetries: 0,
        timeout: 90000,
        fetch: (url, options) => {
          // The SDK can await internally between create() and fetch().
          if (g !== generation) throw fail("ChatGPT account changed.");
          beforeSend?.();
          return fetcher(url, { ...options, redirect: "error" });
        },
      });
      const stream = await client.responses.create(
        {
          model,
          input: [
            {
              role: "user",
              content: image
                ? [
                    { type: "input_text", text: prompt },
                    { type: "input_image", image_url: image, detail: "high" },
                  ]
                : prompt,
            },
          ],
          instructions: AI_INSTRUCTIONS,
          store: false,
          stream: true,
        },
        { signal: controller.signal },
      );
      let text = "",
        completed = false,
        bytes = 0;
      for await (const event of stream) {
        bytes += Buffer.byteLength(JSON.stringify(event));
        if (bytes > 4000000)
          throw fail(
            "ChatGPT response exceeded the limit. Ask a shorter question.",
          );
        if (event.type === "response.output_text.delta") {
          if (typeof event.delta !== "string")
            throw fail("ChatGPT returned invalid text. Try again.");
          text += event.delta;
          if (text.length > AI_MAX_OUTPUT) {
            controller.abort();
            throw fail(
              "ChatGPT response exceeded the limit. Ask a shorter question.",
            );
          }
        }
        if (
          event.type === "response.refusal.delta" ||
          event.type === "response.refusal.done" ||
          event.response?.output?.some((item) =>
            item.content?.some((part) => part.type === "refusal"),
          )
        )
          throw fail(
            "ChatGPT could not help with this request. Revise it or continue manually.",
          );
        if (
          ["response.failed", "response.incomplete", "error"].includes(
            event.type,
          )
        )
          throw fail(
            "ChatGPT could not complete the request. Check your plan usage and try again.",
          );
        if (event.type === "response.completed") completed = true;
      }
      if (!completed || g !== generation)
        throw fail(
          "ChatGPT response was interrupted. No records were changed.",
        );
      beforeSend?.();
      return { text: validatedAiText({ text }) };
    } catch (error) {
      if (error.status && !(error instanceof OpenAI.APIError)) throw error;
      if (controller.signal.aborted)
        throw fail(
          "ChatGPT request was cancelled or timed out. Try again when ready; no records were changed.",
        );
      if (error.status === 429)
        throw fail(
          "ChatGPT usage limit reached. Check your plan usage and try again later.",
        );
      if (error.status === 401 || error.status === 403)
        throw fail(
          "ChatGPT access is unavailable. Reconnect your eligible account in Settings.",
        );
      if (error.status === 400)
        throw fail(
          "ChatGPT rejected this request. Choose a compatible model and check the input.",
        );
      throw fail(
        "Could not reach ChatGPT or read its response. Check your connection and try again; no records were changed.",
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
      requests.delete(controller);
    }
  }
  async function disconnect(clientId) {
    cancel();
    stopRequests();
    const a = store.get().accounts.find((a) => a.clientId === clientId);
    if (!a) throw fail("Account not found.");
    let revoked = !a.refreshToken;
    try {
      if (a.refreshToken) {
        const config = await json(AUTH + "/.well-known/openid-configuration");
        const endpoint = new URL(config.revocation_endpoint);
        if (endpoint.origin !== AUTH)
          throw fail("Unexpected revocation endpoint.");
        await fetcher(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: a.refreshToken,
            token_type_hint: "refresh_token",
            client_id: a.clientId,
          }),
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        }).then((r) => {
          revoked = r.status === 200;
        });
      }
    } catch {}
    store.update((s) => {
      const x = s.accounts.find((a) => a.clientId === clientId);
      delete x.accessToken;
      delete x.refreshToken;
      delete x.idToken;
      if (s.active === clientId) s.active = null;
    });
    return { revoked };
  }
  function select(clientId) {
    if (
      !store
        .get()
        .accounts.some((a) => a.clientId === clientId && a.accessToken)
    )
      throw fail("Sign in to this account first.");
    cancel();
    stopRequests();
    store.update((s) => {
      s.active = clientId;
    });
  }
  return { status, start, cancel, models, ask, disconnect, select };
}
