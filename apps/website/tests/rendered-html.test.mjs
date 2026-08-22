import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function renderedHtml(pathname) {
  const response = await render(pathname);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  return response.text();
}

test("server-renders Russian as the default language", async () => {
  const html = await renderedHtml("/");

  assert.match(html, /<html lang="ru">/i);
  assert.match(html, /ОТ БРИФА/);
  assert.match(html, /ДО БУКИНГА/);
  assert.match(html, /ОТПРАВИТЬ БРИФ/);
  assert.match(html, /СТАТЬ АРТИСТОМ/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});

test("server-renders every supported language route", async () => {
  const [russian, english, uzbek] = await Promise.all([
    renderedHtml("/ru"),
    renderedHtml("/en"),
    renderedHtml("/uz"),
  ]);

  assert.match(russian, /<html lang="ru">/i);
  assert.match(english, /FROM BRIEF/);
  assert.match(english, /TO BOOKED/);
  assert.match(uzbek, /BRIFDAN/);
  assert.match(uzbek, /TASDIQQACHA/);

  for (const html of [russian, english, uzbek]) {
    assert.match(html, />RU<\/button>/);
    assert.match(html, />EN<\/button>/);
    assert.match(html, />UZ<\/button>/);
  }
});
