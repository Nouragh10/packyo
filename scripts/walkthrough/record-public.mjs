// Capture the public authentication screens in a separate, signed-out browser.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectBrowser, pause } from "./cdp.mjs";
const output = resolve("generated-artifacts/walkthrough/public");
mkdirSync(output, { recursive: true });
const browser = await connectBrowser(9224);
const frames = [], chapters = [];
let index = 0;
const capture = async (title, caption) => {
  chapters.push({ title, caption });
  for (let i = 0; i < 16; i++) {
    const file = `${output}/${String(index++).padStart(5, "0")}.jpg`;
    await browser.screenshot(file);
    frames.push({ file, chapter: chapters.length - 1, duration: 0.25 });
    await pause(200);
  }
};
try {
  await browser.go(`https://${process.env.REPLIT_EXPO_DEV_DOMAIN}/sign-in`);
  await pause(2400);
  await capture("Welcome to Packyo", "Actual mobile-app screens, recorded in the browser. Demonstration data is isolated from real travellers.");
  await browser.click("Sign in with email");
  await pause(700);
  await capture("Sign in to your account", "Email sign-in is available alongside Google and Apple. No real credentials are shown.");
} finally {
  browser.close();
  writeFileSync(`${output}/recording.json`, JSON.stringify({ frames, chapters }, null, 2));
}
