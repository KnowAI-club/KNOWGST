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
      if(lastRequest.input[0].content==="empty")return new Response('data: {"type":"response.completed"}\n\n');
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
  assert.equal(authURL.searchParams.get("agent_name_hint"), "KNOWGST");
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
  await chat.ask({model:"available-model",prompt:"Read invoice"},{image:"data:image/png;base64,test"});
  assert.deepEqual(lastRequest.input[0].content,[{type:"input_text",text:"Read invoice"},{type:"input_image",image_url:"data:image/png;base64,test",detail:"high"}]);
  assert.equal(lastRequest.store,false);
  assert.equal(lastRequest.stream,true);
  await assert.rejects(chat.ask({model:"available-model",prompt:"empty"}),/no readable answer/);
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
