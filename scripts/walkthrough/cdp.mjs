// Small Chrome DevTools client; no browser automation dependency required.
import { mkdirSync, writeFileSync } from "node:fs";

export async function connectBrowser(port = 9223) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find((t) => t.type === "page");
  if (!target) throw new Error("No Chromium page is available.");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
      }
    } else {
      for (const listener of listeners.get(message.method) ?? []) listener(message.params);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 120_000);
    pending.set(requestId, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (err) => { clearTimeout(timer); reject(err); } });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 430, height: 860, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ": " + result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  return {
    send, evaluate,
    on(method, listener) { listeners.set(method, [...(listeners.get(method) ?? []), listener]); },
    async go(url) { await send("Page.navigate", { url }); },
    async text() { return evaluate("document.body.innerText"); },
    async screenshot(path) {
      mkdirSync(new URL(".", `file://${path}`).pathname, { recursive: true });
      const result = await send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
      writeFileSync(path, Buffer.from(result.data, "base64"));
    },
    async click(text, exact = true) {
      let point = null;
      for (let attempt = 0; attempt < 16 && !point; attempt++) {
        point = await evaluate(`(() => {
        const items = [...document.querySelectorAll('button,[role="button"],a,[tabindex],div,span')];
        const matches = items.filter(e => ${exact ? "e.innerText.trim() ===" : "e.innerText.includes("} ${JSON.stringify(text)} ${exact ? "" : ")"} && e.getBoundingClientRect().width && e.getBoundingClientRect().height);
        const el = matches.sort((a,b) => a.innerText.length - b.innerText.length || a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];
        if (!el) return null; el.scrollIntoView({block:'center'});
        const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
      })()`);
        if (!point) await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!point) throw new Error(`No visible button: ${text}`);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    },
    async scroll(y = 480) {
      await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 330, y: 600, deltaX: 0, deltaY: y });
    },
    close() { socket.close(); },
  };
}

export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
