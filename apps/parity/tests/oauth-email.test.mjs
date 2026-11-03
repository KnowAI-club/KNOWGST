import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { credentialStore } from "../integration-vault.mjs";
import { chatgptOAuth, validateIdentity } from "../chatgpt-oauth.mjs";
import { resendEmail } from "../resend-email.mjs";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "test-key",
  use: "sig",
};
const encode = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
const jwt = (claims, header = { alg: "RS256", kid: "test-key" }) => {
  const text = encode(header) + "." + encode(claims);
  return (
    text +
    "." +
    sign("RSA-SHA256", Buffer.from(text), privateKey).toString("base64url")
  );
};
const identity = (nonce, more = {}) => ({
  iss: "https://auth.openai.com",
  sub: "test-subject",
  aud: "oaiapp_test",
  nonce,
  exp: Math.floor(Date.now() / 1000) + 3600,
  email: "demo@example.com",
  ...more,
});
const fixture = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knowgst-integrations-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, store: credentialStore(dir) };
};
const response = (data) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
test("identity rejects forged, expired, wrong audience, nonce and returning identity tokens", () => {
  const claims = identity("nonce");
  assert.equal(
    validateIdentity(jwt(claims), [jwk], {
      clientId: "oaiapp_test",
      nonce: "nonce",
    }).sub,
    "test-subject",
  );
  for (const patch of [
    { iss: "https://evil.test" },
    { aud: "other" },
    { nonce: "wrong" },
    { exp: 0 },
    { sub: "" },
  ])
    assert.throws(() =>
      validateIdentity(jwt({ ...claims, ...patch }), [jwk], {
        clientId: "oaiapp_test",
        nonce: "nonce",
      }),
    );
  assert.throws(() =>
    validateIdentity(jwt(claims), [jwk], {
      clientId: "oaiapp_test",
      nonce: "nonce",
      subject: "different",
    }),
  );
  assert.throws(() =>
    validateIdentity(jwt(claims, { alg: "none", kid: "test-key" }), [jwk], {
      clientId: "oaiapp_test",
      nonce: "nonce",
    }),
  );
  const token = jwt(claims).split(".");
  token[1] = encode({ ...claims, sub: "forged" });
  assert.throws(() =>
    validateIdentity(token.join("."), [jwk], {
      clientId: "oaiapp_test",
      nonce: "nonce",
    }),
  );
});
test("credentials survive restart outside portable data and never appear in status", (t) => {
  const { dir, store } = fixture(t);
  store.update((s) => {
    s.resend = {
      apiKey: "re_test_private_secret",
      from: "billing@example.com",
    };
  });
  assert.equal(
    credentialStore(dir).get().resend.apiKey,
    "re_test_private_secret",
  );
  assert(
    !JSON.stringify(resendEmail(store).status()).includes(
      "re_test_private_secret",
    ),
  );
  assert(!fs.existsSync(path.join(dir, "data", ".credentials")));
  if (process.platform !== "win32")
    assert.equal(
      fs.statSync(path.join(dir, ".credentials/integrations.json")).mode &
        0o777,
      0o600,
    );
});
test("OAuth validates callback, uses issued client and PKCE, preserves host and supports inference and sign-out", async (t) => {
  const { dir, store } = fixture(t);
  let authURL,
    exchanges = 0,
    revocations = 0,
    lastRequest;
  const fetcher = async (url, options = {}) => {
    url = String(url);
    if (url.endsWith("/oauth/token")) {
      exchanges++;
      const p = new URLSearchParams(options.body);
      assert.equal(p.get("client_id"), "oaiapp_test");
      assert.equal(
        p.get("redirect_uri"),
        authURL.searchParams.get("redirect_uri"),
      );
      assert(p.get("code_verifier").length > 40);
      return response({
        id_token: jwt(identity(authURL.searchParams.get("nonce"))),
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        token_type: "Bearer",
        expires_in: 3600,
        scope:
          "openid resource.invoke chatgpt.tokens.use.direct offline_access",
      });
    }
    if (url.endsWith("/jwks.json")) return response({ keys: [jwk] });
    if (url.endsWith("/models"))
      return response({
        models: [
          {
            slug: "available-model",
            display_name: "Available model",
            visibility: "list",
          },
          { slug: "hidden", visibility: "hide" },
        ],
      });
    if (url.endsWith("/responses")) {
      lastRequest = JSON.parse(options.body);
      if (lastRequest.input[0].content === "empty")
        return new Response('data: {"type":"response.completed"}\n\n');
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"Read-only answer"}\n\ndata: {"type":"response.completed"}\n\n',
      );
    }
    if (url.endsWith("openid-configuration"))
      return response({
        revocation_endpoint:
          "https://auth.openai.com/api/accounts/oauth/revoke",
      });
    if (url.endsWith("/revoke")) {
      revocations++;
      return new Response("");
    }
    throw Error("Unexpected endpoint");
  };
  const chat = chatgptOAuth(store, { fetcher });
  t.after(() => chat.cancel());
  authURL = new URL((await chat.start()).url);
  assert.equal(authURL.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(authURL.searchParams.get("agent_name_hint"), "KnowGST");
  const host = authURL.searchParams.get("ext_agent_host_id");
  const callback = new URL(authURL.searchParams.get("redirect_uri"));
  callback.search = new URLSearchParams({
    code: "code",
    state: "wrong",
    client_id: "oaiapp_test",
  });
  assert.equal((await fetch(callback)).status, 400);
  assert.equal(exchanges, 0);
  callback.searchParams.set("state", authURL.searchParams.get("state"));
  assert.equal((await fetch(callback)).status, 200);
  assert.equal(chat.status().active, "oaiapp_test");
  assert(!JSON.stringify(chat.status()).includes("secret"));
  assert.equal((await chat.models()).length, 1);
  assert.deepEqual(
    await chat.ask({ model: "available-model", prompt: "Explain bookkeeping" }),
    { text: "Read-only answer" },
  );
  assert.equal(lastRequest.store, false);
  assert.equal(lastRequest.stream, true);
  assert.equal(lastRequest.input[0].content, "Explain bookkeeping");
  assert.equal(lastRequest.tools, undefined);
  await chat.ask(
    { model: "available-model", prompt: "Read invoice" },
    { image: "data:image/png;base64,test" },
  );
  assert.deepEqual(lastRequest.input[0].content, [
    { type: "input_text", text: "Read invoice" },
    {
      type: "input_image",
      image_url: "data:image/png;base64,test",
      detail: "high",
    },
  ]);
  assert.equal(lastRequest.store, false);
  assert.equal(lastRequest.stream, true);
  await assert.rejects(
    chat.ask({ model: "available-model", prompt: "empty" }),
    /no readable answer/,
  );
  authURL = new URL((await chat.start("oaiapp_test")).url);
  assert.equal(authURL.searchParams.get("ext_agent_host_id"), host);
  assert.equal(authURL.searchParams.get("client_id"), "oaiapp_test");
  assert(!authURL.searchParams.has("agent_name_hint"));
  assert(!authURL.searchParams.has("id_token_hint"));
  chat.cancel();
  assert.deepEqual(await chat.disconnect("oaiapp_test"), { revoked: true });
  assert.equal(revocations, 1);
  assert.equal(credentialStore(dir).get().hostId, host);
  assert.equal(store.get().accounts[0].accessToken, undefined);
  assert.equal(store.get().accounts[0].clientId, "oaiapp_test");
});
test("cancelled consent and wrong issued IDs do not replace an existing account", async (t) => {
  const { store } = fixture(t);
  store.update((s) => {
    s.accounts = [
      { clientId: "oaiapp_saved", subject: "saved", accessToken: "keep" },
    ];
    s.active = "oaiapp_saved";
  });
  let calls = 0;
  const chat = chatgptOAuth(store, {
    fetcher: async () => {
      calls++;
      throw Error("must not exchange");
    },
  });
  t.after(() => chat.cancel());
  for (const variant of ["declined", "wrong-client"]) {
    const auth = new URL((await chat.start("oaiapp_saved")).url);
    const callback = new URL(auth.searchParams.get("redirect_uri"));
    callback.search = new URLSearchParams({
      state: auth.searchParams.get("state"),
      ...(variant === "declined"
        ? { error: "access_denied" }
        : { code: "x", client_id: "oaiapp_other" }),
    });
    assert.equal((await fetch(callback)).status, 400);
    assert.equal(store.get().accounts[0].accessToken, "keep");
  }
  assert.equal(calls, 0);
});
test("refresh serializes rotating credentials and incomplete inference is not success", async (t) => {
  const { store } = fixture(t);
  store.update((s) => {
    s.active = "oaiapp_test";
    s.accounts = [
      {
        clientId: s.active,
        subject: "test",
        accessToken: "old",
        refreshToken: "old-refresh",
        expires: 0,
        scopes: ["resource.invoke", "chatgpt.tokens.use.direct"],
      },
    ];
  });
  let refresh = 0;
  const chat = chatgptOAuth(store, {
    fetcher: async (url, options) => {
      if (String(url).endsWith("/token")) {
        refresh++;
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(
          new URLSearchParams(options.body).get("grant_type"),
          "refresh_token",
        );
        return response({
          access_token: "new",
          refresh_token: "new-refresh",
          expires_in: 3600,
        });
      }
      if (String(url).endsWith("/models"))
        return response({ models: [{ slug: "model", visibility: "list" }] });
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
      );
    },
  });
  await Promise.all([chat.models(), chat.models()]);
  assert.equal(refresh, 1);
  assert.equal(store.get().accounts[0].refreshToken, "new-refresh");
  await assert.rejects(
    chat.ask({ model: "model", prompt: "question" }),
    /interrupted/,
  );
});
const draft = () => ({
  requestId: randomUUID(),
  expectedSender: "billing@example.com",
  to: "client@example.com",
  subject: "Invoice DEMO-1",
  text: "Attached for review.",
  attachment: {
    filename: "DEMO-1.pdf",
    content: Buffer.from("%PDF-1.7\nfictional test").toString("base64"),
  },
});
test("Resend sends PDF and idempotency header, retries uncertain sends without duplicate accepted sends", async (t) => {
  const { store } = fixture(t);
  let calls = 0,
    payload,
    headers;
  const mail = resendEmail(store, {
    fetcher: async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      calls++;
      headers = options.headers;
      payload = JSON.parse(options.body);
      if (calls === 1) throw Error("network interruption");
      return response({ id: "email-demo" });
    },
  });
  mail.configure({
    from: "billing@example.com",
    name: "Demo",
    apiKey: "re_test_private_123",
  });
  const input = draft();
  await assert.rejects(mail.send(input), /unconfirmed/);
  assert.equal(mail.status().recent[0].status, "unconfirmed");
  assert.equal((await mail.send(input)).id, "email-demo");
  assert.equal((await mail.send(input)).replayed, true);
  assert.equal(calls, 2);
  assert.equal(headers["Idempotency-Key"], "knowgst-" + input.requestId);
  assert.equal(payload.attachments[0].content, input.attachment.content);
  assert.deepEqual(payload.to, ["client@example.com"]);
  await assert.rejects(mail.send({ ...input, subject: "Changed" }), /changed/);
  assert(!JSON.stringify(mail.status()).includes("private"));
  mail.disconnect();
  await assert.rejects(mail.send(draft()), /Configure Resend/);
});
test("Resend rejects unsafe drafts before network and handles provider rejection without leaking secrets", async (t) => {
  const { store } = fixture(t);
  let calls = 0;
  const mail = resendEmail(store, {
    fetcher: async () => {
      calls++;
      return new Response('{"message":"secret-provider-body"}', {
        status: 403,
      });
    },
  });
  mail.configure({ from: "billing@example.com", apiKey: "re_example_123456" });
  for (const patch of [
    { to: "a@example.com,b@example.com" },
    { subject: "x\r\nBcc: x" },
    { attachment: { filename: "../x.pdf", content: "evil" } },
    { requestId: "short" },
  ])
    await assert.rejects(mail.send({ ...draft(), ...patch }));
  assert.equal(calls, 0);
  await assert.rejects(
    mail.send(draft()),
    (e) =>
      e.message.includes("credentials") &&
      !e.message.includes("secret-provider"),
  );
  assert.equal(mail.status().recent[0].status, "rejected");
});

test("corrupt integration storage does not prevent unrelated billing routes from serving", async (t) => {
  const { dir } = fixture(t);
  const file = path.join(dir, ".credentials/integrations.json");
  fs.writeFileSync(file, "broken credential data");
  const express = (await import("express")).default;
  const { integrationRoutes } = await import("../integration-routes.mjs");
  const app = express();
  integrationRoutes(app, dir);
  app.get("/api/billing-probe", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin + "/api/integrations")).status, 503);
  assert.equal((await fetch(origin + "/api/billing-probe")).status, 200);
  assert.equal(fs.readFileSync(file, "utf8"), "broken credential data");
});

test("changing Resend credentials cannot replay an uncertain request into another account", async (t) => {
  const { store } = fixture(t);
  let calls = 0;
  const mail = resendEmail(store, {
    fetcher: async () => {
      calls++;
      throw Error("unconfirmed");
    },
  });
  mail.configure({
    from: "billing@example.com",
    apiKey: "re_first_fictional_key",
  });
  const input = draft();
  await assert.rejects(mail.send(input), /unconfirmed/);
  mail.configure({
    from: "billing@example.com",
    apiKey: "re_second_fictional_key",
  });
  await assert.rejects(mail.send(input), /configuration or draft changed/);
  assert.equal(calls, 1);
});

test("OAuth exchange errors name the failing step without exposing provider messages or credentials", async (t) => {
  const { store } = fixture(t);
  const chat = chatgptOAuth(store, {
    fetcher: async () =>
      new Response(
        JSON.stringify({
          error: "invalid_request",
          error_description: "code=PRIVATE-CODE verifier=PRIVATE-VERIFIER",
        }),
        { status: 400 },
      ),
  });
  t.after(() => chat.cancel());
  const auth = new URL((await chat.start()).url);
  const callback = new URL(auth.searchParams.get("redirect_uri"));
  callback.search = new URLSearchParams({
    code: "unused-code",
    state: auth.searchParams.get("state"),
    client_id: "oaiapp_test",
  });
  const result = await fetch(callback),
    text = await result.text();
  assert.equal(result.status, 400);
  assert.match(text, /sign-in exchange.*invalid_request/);
  assert.doesNotMatch(text, /PRIVATE|unused-code/);
  assert.equal(chat.status().active, null);
  assert.equal(chat.status().accounts.length, 0);
});

test("failed first code exchange retains only its registration and retries with fresh PKCE after restart", async (t) => {
  const { dir, store } = fixture(t);
  let auth,
    first = true;
  const fetcher = async (url, options) => {
    if (String(url).endsWith("/oauth/token")) {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get("client_id"), "oaiapp_test");
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("resource"), "https://api.openai.com/v1");
      assert.equal(
        body.get("redirect_uri"),
        auth.searchParams.get("redirect_uri"),
      );
      assert.equal(body.has("client_secret"), false);
      const { createHash } = await import("node:crypto");
      assert.equal(
        createHash("sha256")
          .update(body.get("code_verifier"))
          .digest("base64url"),
        auth.searchParams.get("code_challenge"),
      );
      if (first) {
        first = false;
        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
        });
      }
      return response({
        id_token: jwt(identity(auth.searchParams.get("nonce"))),
        access_token: "access-private",
        refresh_token: "refresh-private",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid resource.invoke chatgpt.tokens.use.direct",
      });
    }
    return response({ keys: [jwk] });
  };
  let chat = chatgptOAuth(store, { fetcher });
  t.after(() => chat.cancel());
  auth = new URL((await chat.start()).url);
  const oldChallenge = auth.searchParams.get("code_challenge"),
    oldState = auth.searchParams.get("state");
  let callback = new URL(auth.searchParams.get("redirect_uri"));
  callback.search = new URLSearchParams({
    code: "first-private-code",
    state: oldState,
    client_id: "oaiapp_test",
  });
  assert.equal((await fetch(callback, { redirect: "manual" })).status, 303);
  assert.deepEqual(store.get().incompleteChatgptRegistration, {
    clientId: "oaiapp_test",
  });
  assert.equal(chat.status().accounts.length, 0);
  assert.equal(chat.status().active, null);
  chat.cancel();
  chat = chatgptOAuth(credentialStore(dir), { fetcher });
  auth = new URL((await chat.start()).url);
  assert.equal(auth.searchParams.get("client_id"), "oaiapp_test");
  assert.equal(auth.searchParams.has("agent_name_hint"), false);
  assert.notEqual(auth.searchParams.get("code_challenge"), oldChallenge);
  assert.notEqual(auth.searchParams.get("state"), oldState);
  callback = new URL(auth.searchParams.get("redirect_uri"));
  callback.search = new URLSearchParams({
    code: "fresh-private-code",
    state: auth.searchParams.get("state"),
  });
  assert.equal((await fetch(callback)).status, 200);
  assert.equal(chat.status().active, "oaiapp_test");
  assert.equal(
    credentialStore(dir).get().incompleteChatgptRegistration,
    undefined,
  );
  assert.doesNotMatch(JSON.stringify(chat.status()), /private/);
});

test("OAuth non-JSON, unknown and oversized error bodies stay bounded and private", async (t) => {
  const { store } = fixture(t);
  const bodies = [
    "not-json PRIVATE-CODE",
    JSON.stringify({ error: "PRIVATE-CODE" }),
    JSON.stringify({
      error: "invalid_grant",
      description: "PRIVATE-CODE".repeat(2000),
    }),
  ];
  for (const body of bodies) {
    const chat = chatgptOAuth(store, {
      fetcher: async () => new Response(body, { status: 400 }),
    });
    t.after(() => chat.cancel());
    const auth = new URL((await chat.start()).url),
      callback = new URL(auth.searchParams.get("redirect_uri"));
    callback.search = new URLSearchParams({
      code: "test",
      state: auth.searchParams.get("state"),
      client_id: "oaiapp_test",
    });
    const result = await fetch(callback),
      text = await result.text();
    assert.equal(result.status, 400);
    assert.match(text, /sign-in exchange failed \(400\)/);
    assert.doesNotMatch(text, /PRIVATE|invalid_grant/);
    assert.equal(chat.status().active, null);
  }
});

test("failed new registration leaves a different connected account and its tokens untouched", async (t) => {
  const { store } = fixture(t);
  const existing = {
    clientId: "oaiapp_existing",
    subject: "existing-subject",
    accessToken: "keep-private-access",
    refreshToken: "keep-private-refresh",
  };
  store.update((s) => {
    s.accounts = [existing];
    s.active = existing.clientId;
  });
  const chat = chatgptOAuth(store, {
    fetcher: async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
  });
  t.after(() => chat.cancel());
  const auth = new URL((await chat.start()).url),
    callback = new URL(auth.searchParams.get("redirect_uri"));
  callback.search = new URLSearchParams({
    code: "test",
    state: auth.searchParams.get("state"),
    client_id: "oaiapp_new",
  });
  assert.equal((await fetch(callback, { redirect: "manual" })).status, 303);
  assert.deepEqual(store.get().accounts, [existing]);
  assert.equal(chat.status().active, existing.clientId);
  assert.deepEqual(store.get().incompleteChatgptRegistration, {
    clientId: "oaiapp_new",
  });
  assert.doesNotMatch(JSON.stringify(chat.status()), /private/);
});

test("explicit new-account sign-in preserves and can resume unfinished workspace registrations", async (t) => {
  const { dir, store } = fixture(t);
  const existing = {
    clientId: "oaiapp_connected",
    subject: "existing-subject",
    accessToken: "keep-private-access",
    refreshToken: "keep-private-refresh",
  };
  store.update((s) => {
    s.accounts = [existing];
    s.active = existing.clientId;
    s.incompleteChatgptRegistration = { clientId: "oaiapp_workspace" };
  });
  const hostId = store.get().hostId;
  let auth;
  const chat = chatgptOAuth(store, {
    fetcher: async (url) =>
      String(url).endsWith("/oauth/token")
        ? new Response(JSON.stringify({ error: "invalid_request" }), {
            status: 400,
          })
        : response({ keys: [jwk] }),
  });
  t.after(() => chat.cancel());
  auth = new URL((await chat.start()).url);
  assert.equal(auth.searchParams.get("client_id"), "oaiapp_workspace");
  auth = new URL((await chat.start(undefined, { newAccount: true })).url);
  assert.equal(auth.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(auth.searchParams.get("ext_agent_host_id"), hostId);
  assert.equal(auth.searchParams.get("agent_name_hint"), "KnowGST");
  const callback = new URL(auth.searchParams.get("redirect_uri"));
  callback.search = new URLSearchParams({
    code: "private-new-code",
    state: auth.searchParams.get("state"),
    client_id: "oaiapp_personal",
  });
  assert.equal((await fetch(callback)).status, 400);
  assert.deepEqual(chat.status().unfinishedRegistrations, [
    { clientId: "oaiapp_workspace" },
    { clientId: "oaiapp_personal" },
  ]);
  assert.deepEqual(store.get().accounts, [existing]);
  assert.equal(store.get().active, existing.clientId);
  assert.equal(store.get().hostId, hostId);
  assert.doesNotMatch(JSON.stringify(chat.status()), /private/);

  const resumed = chatgptOAuth(credentialStore(dir), {
    fetcher: async (url) =>
      String(url).endsWith("/oauth/token")
        ? response({
            id_token: jwt(
              identity(auth.searchParams.get("nonce"), {
                aud: "oaiapp_personal",
              }),
            ),
            access_token: "new-private-access",
            refresh_token: "new-private-refresh",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "openid resource.invoke chatgpt.tokens.use.direct",
          })
        : response({ keys: [jwk] }),
  });
  t.after(() => resumed.cancel());
  auth = new URL((await resumed.start()).url);
  assert.equal(auth.searchParams.get("client_id"), "oaiapp_personal");
  auth = new URL((await resumed.start("oaiapp_workspace")).url);
  assert.equal(auth.searchParams.get("client_id"), "oaiapp_workspace");
  assert.equal(auth.searchParams.has("agent_name_hint"), false);
  auth = new URL((await resumed.start("oaiapp_personal")).url);
  const personalCallback = new URL(auth.searchParams.get("redirect_uri"));
  personalCallback.search = new URLSearchParams({
    code: "private-personal-code",
    state: auth.searchParams.get("state"),
  });
  assert.equal((await fetch(personalCallback)).status, 200);
  assert.deepEqual(resumed.status().unfinishedRegistrations, [
    { clientId: "oaiapp_workspace" },
  ]);
  const saved = credentialStore(dir).get();
  assert.deepEqual(
    saved.accounts.find((a) => a.clientId === existing.clientId),
    existing,
  );
  assert.equal(saved.active, "oaiapp_personal");
  assert.equal(saved.hostId, hostId);
  assert.equal(
    saved.incompleteChatgptRegistration.clientId,
    "oaiapp_workspace",
  );
  assert.doesNotMatch(JSON.stringify(resumed.status()), /private/);
});

test("invalid account selection and new-account options do not cancel an active sign-in", async (t) => {
  const { store } = fixture(t);
  store.update((s) => {
    s.incompleteChatgptRegistration = { clientId: "oaiapp_workspace" };
  });
  const chat = chatgptOAuth(store);
  t.after(() => chat.cancel());
  const { url } = await chat.start();
  for (const [clientId, options] of [
    [undefined, null],
    [undefined, []],
    [undefined, true],
    [undefined, { newAccount: "true" }],
    [undefined, { newAccount: 1 }],
    [undefined, { newAccount: null }],
    ["oaiapp_workspace", { newAccount: true }],
    ["oaiapp_arbitrary", {}],
    [123, {}],
  ]) {
    await assert.rejects(
      chat.start(clientId, options),
      (e) => e.status === 400,
    );
    assert.equal(chat.status().authorizationUrl, url);
    assert.equal(chat.status().pending, true);
  }
  assert.equal(
    store.get().incompleteChatgptRegistration.clientId,
    "oaiapp_workspace",
  );
});

test("a rejected new client only removes its own unfinished registration", async (t) => {
  const { store } = fixture(t);
  store.update((s) => {
    s.incompleteChatgptRegistration = { clientId: "oaiapp_workspace" };
    s.incompleteChatgptRegistrations = [
      { clientId: "oaiapp_workspace", untrusted: "private-ignored-field" },
      { clientId: "dynamic_agent_client" },
      { clientId: "invalid/client" },
    ];
  });
  const chat = chatgptOAuth(store, {
    fetcher: async () =>
      new Response(JSON.stringify({ error: "invalid_client" }), {
        status: 400,
      }),
  });
  t.after(() => chat.cancel());
  assert.deepEqual(chat.status().unfinishedRegistrations, [
    { clientId: "oaiapp_workspace" },
  ]);
  const auth = new URL((await chat.start(undefined, { newAccount: true })).url);
  const callback = new URL(auth.searchParams.get("redirect_uri"));
  callback.search = new URLSearchParams({
    code: "private-code",
    state: auth.searchParams.get("state"),
    client_id: "oaiapp_rejected",
  });
  assert.equal((await fetch(callback)).status, 400);
  assert.deepEqual(chat.status().unfinishedRegistrations, [
    { clientId: "oaiapp_workspace" },
  ]);
  assert.equal(
    store.get().incompleteChatgptRegistration.clientId,
    "oaiapp_workspace",
  );
  assert.doesNotMatch(JSON.stringify(chat.status()), /private/);
  const resumed = new URL((await chat.start()).url);
  assert.equal(resumed.searchParams.get("client_id"), "oaiapp_workspace");
});

test("callback denials expose only recognized codes and never retry or discard registrations", async (t) => {
  const { store } = fixture(t);
  store.update((s) => {
    s.incompleteChatgptRegistration = { clientId: "oaiapp_workspace" };
  });
  let calls = 0;
  const chat = chatgptOAuth(store, {
    fetcher: async () => {
      calls++;
      throw new Error("No token exchange is allowed after denial");
    },
  });
  t.after(() => chat.cancel());
  for (const code of [
    "access_denied",
    "3p_login_workspace_scope_denied",
    "workspace_scope_denied",
    "PRIVATE-CODE",
  ]) {
    const auth = new URL((await chat.start()).url);
    const callback = new URL(auth.searchParams.get("redirect_uri"));
    callback.search = new URLSearchParams({
      error: code,
      error_description: "PRIVATE-DESCRIPTION with private-token",
      state: auth.searchParams.get("state"),
      code: "private-auth-code",
    });
    const result = await fetch(callback, { redirect: "manual" });
    const text = await result.text();
    assert.equal(result.status, 400);
    assert.equal(result.headers.get("location"), null);
    assert.equal(calls, 0);
    assert.equal(chat.status().pending, false);
    assert.equal(chat.status().error, text);
    assert.doesNotMatch(
      text,
      /PRIVATE|private-token|private-auth-code|you (declined|denied)/i,
    );
    if (code !== "PRIVATE-CODE") assert(text.includes(code));
    if (code.includes("workspace_scope_denied"))
      assert.match(text, /original.*workspace/i);
    assert.deepEqual(chat.status().unfinishedRegistrations, [
      { clientId: "oaiapp_workspace" },
    ]);
  }
});

test("OAuth invalid_grant redirects once with fresh PKCE and never replays the rejected code", async (t) => {
  const { store } = fixture(t);
  let auth;
  const exchanges = [];
  const chat = chatgptOAuth(store, {
    fetcher: async (url, options) => {
      if (String(url).endsWith("/oauth/token")) {
        const body = new URLSearchParams(options.body);
        exchanges.push(body.get("code"));
        assert.equal(body.get("client_id"), "oaiapp_test");
        assert.equal(
          body.get("redirect_uri"),
          auth.searchParams.get("redirect_uri"),
        );
        const { createHash } = await import("node:crypto");
        assert.equal(
          createHash("sha256")
            .update(body.get("code_verifier"))
            .digest("base64url"),
          auth.searchParams.get("code_challenge"),
        );
        if (exchanges.length === 1)
          return new Response(
            JSON.stringify({
              error: "invalid_grant",
              error_description: "PRIVATE-CODE",
            }),
            { status: 400 },
          );
        return response({
          id_token: jwt(identity(auth.searchParams.get("nonce"))),
          access_token: "private-access",
          refresh_token: "private-refresh",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid resource.invoke chatgpt.tokens.use.direct",
        });
      }
      return response({ keys: [jwk] });
    },
  });
  t.after(() => chat.cancel());
  const first = (auth = new URL((await chat.start()).url));
  const callback = new URL(first.searchParams.get("redirect_uri"));
  callback.search = new URLSearchParams({
    code: "rejected-code",
    state: first.searchParams.get("state"),
    client_id: "oaiapp_test",
  });
  const recovery = await fetch(callback, { redirect: "manual" });
  assert.equal(recovery.status, 303);
  assert.equal(recovery.headers.get("referrer-policy"), "no-referrer");
  assert.doesNotMatch(await recovery.text(), /PRIVATE|rejected-code/);
  auth = new URL(recovery.headers.get("location"));
  assert.equal(auth.origin, "https://auth.openai.com");
  assert.equal(auth.pathname, "/api/accounts/authorize");
  assert.equal(auth.searchParams.get("client_id"), "oaiapp_test");
  assert.equal(
    auth.searchParams.get("ext_agent_host_id"),
    first.searchParams.get("ext_agent_host_id"),
  );
  assert.equal(auth.searchParams.has("agent_name_hint"), false);
  for (const field of ["state", "nonce", "code_challenge"])
    assert.notEqual(
      auth.searchParams.get(field),
      first.searchParams.get(field),
    );
  assert.equal(chat.status().authorizationUrl, auth.href);
  assert.equal(chat.status().pending, true);
  assert.equal(chat.status().error, "");
  assert.equal((await fetch(callback, { redirect: "manual" })).status, 400);
  assert.deepEqual(exchanges, ["rejected-code"]);
  const fresh = new URL(auth.searchParams.get("redirect_uri"));
  fresh.search = new URLSearchParams({
    code: "fresh-code",
    state: auth.searchParams.get("state"),
  });
  assert.equal((await fetch(fresh, { redirect: "manual" })).status, 200);
  assert.deepEqual(exchanges, ["rejected-code", "fresh-code"]);
  assert.equal(chat.status().active, "oaiapp_test");
  assert.equal(chat.status().authorizationUrl, null);
  assert.equal(chat.status().pending, false);
  assert.equal(store.get().incompleteChatgptRegistration, undefined);
});

test("OAuth fresh authorization is bounded and does not loop after another invalid_grant", async (t) => {
  const { store } = fixture(t);
  let calls = 0;
  const chat = chatgptOAuth(store, {
    fetcher: async () => {
      calls++;
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
      });
    },
  });
  t.after(() => chat.cancel());
  let auth = new URL((await chat.start()).url);
  for (const expected of [303, 400]) {
    const callback = new URL(auth.searchParams.get("redirect_uri"));
    callback.search = new URLSearchParams({
      code: "fictional-" + calls,
      state: auth.searchParams.get("state"),
      client_id: "oaiapp_test",
    });
    const result = await fetch(callback, { redirect: "manual" });
    assert.equal(result.status, expected);
    if (expected === 303) auth = new URL(result.headers.get("location"));
    else {
      assert.equal(result.headers.get("location"), null);
      assert.match(await result.text(), /invalid_grant/);
    }
  }
  assert.equal(calls, 2);
  assert.equal(chat.status().pending, false);
  assert.equal(chat.status().authorizationUrl, null);
  assert.match(chat.status().error, /invalid_grant/);
  assert.deepEqual(store.get().incompleteChatgptRegistration, {
    clientId: "oaiapp_test",
  });
});

test("OAuth cancellation during listener startup cannot resurrect an attempt", async (t) => {
  const { store } = fixture(t);
  const chat = chatgptOAuth(store, {
    fetcher: async () => {
      throw Error("No provider call expected");
    },
  });
  t.after(() => chat.cancel());
  const starting = chat.start();
  chat.cancel();
  await assert.rejects(starting, /cancelled|superseded/i);
  assert.equal(chat.status().pending, false);
  assert.equal(chat.status().authorizationUrl, null);
});

for (const errorCode of ["invalid_grant", "invalid_client"])
  test(`superseded OAuth callback ${errorCode} cannot change a newer attempt`, async (t) => {
    const { store } = fixture(t);
    let entered, release;
    const waiting = new Promise((resolve) => (entered = resolve)),
      gate = new Promise((resolve) => (release = resolve));
    const chat = chatgptOAuth(store, {
      fetcher: async () => {
        entered();
        await gate;
        return new Response(JSON.stringify({ error: errorCode }), {
          status: 400,
        });
      },
    });
    t.after(() => chat.cancel());
    const first = new URL((await chat.start()).url),
      callback = new URL(first.searchParams.get("redirect_uri"));
    callback.search = new URLSearchParams({
      code: "old-code",
      state: first.searchParams.get("state"),
      client_id: "oaiapp_test",
    });
    const oldRequest = fetch(callback, { redirect: "manual" });
    await waiting;
    const latest = await chat.start();
    release();
    assert.equal((await oldRequest).status, 400);
    assert.equal(chat.status().error, "");
    assert.equal(chat.status().pending, true);
    assert.equal(chat.status().authorizationUrl, latest.url);
    assert.deepEqual(store.get().incompleteChatgptRegistration, {
      clientId: "oaiapp_test",
    });
  });

test("concurrent OAuth starts leave only the latest callback listener active", async (t) => {
  const { store } = fixture(t);
  const chat = chatgptOAuth(store, {
    fetcher: async () => {
      throw Error("No provider call expected");
    },
  });
  t.after(() => chat.cancel());
  const [first, latest] = await Promise.allSettled([
    chat.start(),
    chat.start(),
  ]);
  assert.equal(first.status, "rejected");
  assert.match(first.reason.message, /cancelled|superseded/);
  assert.equal(latest.status, "fulfilled");
  assert.equal(chat.status().authorizationUrl, latest.value.url);
  assert.equal(chat.status().pending, true);
  chat.cancel();
  assert.equal(chat.status().pending, false);
  assert.equal(chat.status().authorizationUrl, null);
});
