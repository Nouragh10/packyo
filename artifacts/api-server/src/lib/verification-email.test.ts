import { test } from "node:test";
import assert from "node:assert/strict";
import { firstNameOf, verificationEmailHtml, verificationEmailText } from "./verification-email";

test("greets by first name, or generically when there is none", () => {
  assert.equal(firstNameOf("Sarah Ahmed"), "Sarah");
  assert.equal(firstNameOf("  "), "");
  assert.equal(firstNameOf(undefined), "");
  assert.match(verificationEmailText("https://x", null), /^Welcome to the pack!/);
});

test("html escapes the name and link and includes the button", () => {
  const html = verificationEmailHtml("https://a.b/?x=1&y=2", "<b>Eve</b>", "https://img/m.png");
  assert.ok(!html.includes("<b>Eve</b>"));
  assert.ok(html.includes("&lt;b&gt;Eve&lt;/b&gt;"));
  assert.ok(html.includes('href="https://a.b/?x=1&amp;y=2"'));
  assert.ok(html.includes("Confirm my email"));
  assert.ok(!/GoPackNow/i.test(html));
});
