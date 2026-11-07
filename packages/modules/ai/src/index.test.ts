import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { budgetExceeded, buildPromptWindow, createRouter, makeHttpProvider, summarizeConversation, UPSERT_THREAD_SQL } from "./index.js";

describe("prompt window", () => {
  it("takes recent messages within caps, oldest dropped first", () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    const win = buildPromptWindow(msgs, null, 20, 8000);
    assert.equal(win.length, 20);
    assert.equal(win[0]?.content, "m10");
  });

  it("stops at the char budget and prepends summary", () => {
    const msgs = [
      { role: "user" as const, content: "a".repeat(5000) },
      { role: "user" as const, content: "b".repeat(5000) },
    ];
    const win = buildPromptWindow(msgs, "old stuff", 20, 8000);
    assert.equal(win.length, 2); // summary + newest only
    assert.equal(win[0]?.role, "system");
  });
});

describe("provider router", () => {
  const ok = (text: string) => async () => ({ text, tokensIn: 1, tokensOut: 1 });
  const fail = () => async () => {
    throw new Error("provider down");
  };

  it("uses primary, falls back on failure", async () => {
    const r = createRouter({ primary: ok("p"), fallback: ok("f"), deadlineMs: 1000 });
    const first = await r.ask([]);
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.via, "primary");
    const r2 = createRouter({ primary: fail(), fallback: ok("f"), deadlineMs: 1000 });
    const res = await r2.ask([]);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.via, "fallback");
  });

  it("reports all-failed when both providers fail", async () => {
    const r = createRouter({ primary: fail(), fallback: fail(), deadlineMs: 100 });
    assert.deepEqual(await r.ask([]), { ok: false, reason: "all-failed" });
  });

  it("rejects over queue capacity without hanging", async () => {
    const gate = () => new Promise<{ text: string; tokensIn: number; tokensOut: number }>(() => {});
    const r = createRouter({ primary: gate, fallback: gate, deadlineMs: 2 });
    const p1 = r.ask([]);
    const p2 = r.ask([]);
    // Fill the queue (20) — these stay pending behind the 2 active.
    const queued: Array<Promise<unknown>> = [];
    for (let i = 0; i < 20; i++) queued.push(r.ask([]));
    const over = await r.ask([]);
    assert.deepEqual(over, { ok: false, reason: "queue-full" });
    assert.equal(r.inFlight(), 2);
    assert.equal(r.queued(), 20);
    await Promise.all([p1, p2, ...queued]);
  });

  it("aborts slow providers at the deadline", async () => {
    const slow = (_p: unknown, signal: AbortSignal) =>
      new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const r = createRouter({
      primary: slow as never,
      fallback: slow as never,
      deadlineMs: 30,
    });
    assert.deepEqual(await r.ask([]), { ok: false, reason: "all-failed" });
  });

  it("counts queue wait against the caller's deadline", { timeout: 10_000 }, async () => {
    const slow = (_p: unknown, signal: AbortSignal) =>
      new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const r = createRouter({ primary: slow as never, fallback: slow as never, deadlineMs: 50 });
    const actives = [r.ask([]), r.ask([])];
    const queuedStart = Date.now();
    const queued = await r.ask([]);
    const elapsed = Date.now() - queuedStart;
    assert.deepEqual(queued, { ok: false, reason: "all-failed" });
    // Previously a queued caller came off the queue with a fresh
    // primary+fallback window (≈3× the deadline); the shared budget bounds the
    // total (wait + both attempts) to roughly one deadline.
    assert.ok(elapsed < 3 * 50, `queued request took ${elapsed}ms for a 50ms budget`);
    await Promise.all(actives);
  });
});

describe("budgets", () => {
  it("caps usage per day", () => {
    assert.equal(budgetExceeded(999, 1000), false);
    assert.equal(budgetExceeded(1000, 1000), true);
  });
});


describe("provider failure regression", () => {
  it("never simulates success for missing config, HTTP error, network error or malformed JSON", async () => {
    const prompt = [{role:"user" as const,content:"hello"}];
    for (const provider of [
      makeHttpProvider(undefined, undefined),
      makeHttpProvider("https://invalid.test", "key", async () => new Response("down", {status:503})),
      makeHttpProvider("https://invalid.test", "key", async () => { throw new Error("offline"); }),
      makeHttpProvider("https://invalid.test", "key", async () => Response.json({choices:[]})),
    ]) await assert.rejects(provider(prompt,new AbortController().signal));
  });
  it("falls back after a real HTTP failure and bounds noncooperative providers", async () => {
    const primary = makeHttpProvider("https://invalid.test", "key", async () => new Response("down",{status:503}));
    const fallback = async () => ({text:"fallback",tokensIn:1,tokensOut:1});
    const router = createRouter({primary,fallback,deadlineMs:5});
    assert.equal((await router.ask([])).ok,true);
    const stuck = createRouter({primary:()=>new Promise(()=>{}),fallback,deadlineMs:5});
    const result = await stuck.ask([]);
    assert.equal(result.ok && result.via,"fallback");
  });
  it("returns persisted summary and bounds extractive memory", () => {
    assert.match(UPSERT_THREAD_SQL,/RETURNING thread_id, summary/);
    assert.equal(summarizeConversation("old",[{role:"user",content:"new"}]),"old\nuser: new");
    assert.equal(summarizeConversation(null,[{role:"user",content:"x".repeat(5000)}]).length,2000);
  });
});


it("sends the explicitly configured model in the OpenAI-compatible request body", async () => {
  let sentBody: any;
  const provider = makeHttpProvider("https://invalid.test", "test-key", async (_url, init) => {
    sentBody = JSON.parse(String(init?.body));
    return Response.json({choices:[{message:{content:"real provider response"}}],usage:{prompt_tokens:4,completion_tokens:3}});
  }, "operator-selected-model");
  const result = await provider([{role:"user",content:"hello"}],new AbortController().signal);
  assert.equal(sentBody.model,"operator-selected-model");
  assert.equal(sentBody.max_tokens,1000);
  assert.equal(result.text,"real provider response");
});

it("supports local compatible endpoints without an API key", async () => {
  let captured: RequestInit | undefined;
  const provider = makeHttpProvider("http://127.0.0.1:11434/v1/chat/completions", undefined, async (_url, init) => {
    captured = init;
    return Response.json({choices:[{message:{content:"local reply"}}],usage:{prompt_tokens:2,completion_tokens:3}});
  }, "local-model");
  const result = await provider([{role:"user",content:"hello"}],new AbortController().signal);
  assert.equal(result.text,"local reply");
  assert.equal(new Headers(captured?.headers).has("authorization"), false);
});

it("gives reasoning models a larger completion ceiling", async () => {
  let sentBody: any;
  const provider = makeHttpProvider("https://api.groq.test/openai/v1/chat/completions", "k", async (_url, init) => {
    sentBody = JSON.parse(String(init?.body));
    return Response.json({choices:[{message:{content:"answer"}}],usage:{prompt_tokens:4,completion_tokens:3}});
  }, "openai/gpt-oss-20b");
  await provider([{role:"user",content:"hello"}],new AbortController().signal);
  assert.equal(sentBody.max_tokens,4096);
});

it("retries once with max_completion_tokens when the host rejects max_tokens", async () => {
  const bodies: any[] = [];
  const provider = makeHttpProvider("https://api.groq.test/openai/v1/chat/completions", "k", async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) {
      return new Response(JSON.stringify({error:{message:"Unsupported parameter: 'max_tokens' is not supported. Use 'max_completion_tokens' instead."}}),{status:400,headers:{"Content-Type":"application/json"}});
    }
    return Response.json({choices:[{message:{content:"reasoned answer"}}],usage:{prompt_tokens:4,completion_tokens:3}});
  }, "openai/gpt-oss-20b");
  const result = await provider([{role:"user",content:"hello"}],new AbortController().signal);
  assert.equal(result.text,"reasoned answer");
  assert.equal(bodies.length,2);
  assert.equal(bodies[0].max_tokens,4096);
  assert.equal(bodies[1].max_completion_tokens,4096);
  assert.equal("max_tokens" in bodies[1],false);
});

it("does not retry a 400 that is not about the token field", async () => {
  let calls = 0;
  const provider = makeHttpProvider("https://api.groq.test/openai/v1/chat/completions", "k", async () => {
    calls += 1;
    return new Response(JSON.stringify({error:{message:"invalid model"}}),{status:400});
  }, "openai/gpt-oss-20b");
  await assert.rejects(provider([{role:"user",content:"hello"}],new AbortController().signal),/provider-http-400/);
  assert.equal(calls,1);
});

it("ignores reasoning content and never returns it as the answer", async () => {
  const provider = makeHttpProvider("https://api.groq.test/openai/v1/chat/completions", "k", async () =>
    Response.json({
      choices:[{message:{role:"assistant",content:"final answer",reasoning_content:"secret chain of thought"}}],
      usage:{prompt_tokens:4,completion_tokens:3},
    }), "openai/gpt-oss-20b");
  const result = await provider([{role:"user",content:"hello"}],new AbortController().signal);
  assert.equal(result.text,"final answer");
  assert.equal(result.text.includes("chain of thought"),false);
});
