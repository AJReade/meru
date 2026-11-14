import { describe, expect, it } from "vitest";

import { addressShape, scrubHtml } from "./scrub.ts";

// A page holding everything a capture must not let through, as a signed-in Gmail draws it.
const PRIVATE_PAGE = `<!doctype html><html><head><title>Inbox (3) - tim@example.org - Gmail</title>
<style nonce="r4nd0m">.avatar { background: url(https://lh3.googleusercontent.com/a/ACg8ocJ1secretAvatarPath=s40-p) }</style>
<script nonce="r4nd0m">var GM_ID_KEY = "secret"; window.GLOBALS = [1, "AF6bupN"];</script></head><body>
<a aria-label="Google Account: Tim Cheung&#10;(tim@example.org)" href="https://accounts.google.com/SignOutOptions?hl=en&amp;continue=https://mail.google.com/mail/u/0/"><img src="https://lh3.googleusercontent.com/a/ACg8ocJ1secretAvatarPath=s40-p" alt="Tim Cheung"></a>
<div class="aim"><span data-tooltip="Therapy - Dr Smith" class="nU">Therapy - Dr Smith</span></div>
<a href="#label/Therapy+-+Dr+Smith" title="Therapy - Dr Smith">Therapy - Dr Smith</a>
<div class="at" title="Therapy - Dr Smith"><div class="av">Therapy - Dr Smith</div></div>
<div class="ahR"><div class="hN" data-name="Therapy - Dr Smith"></div></div>
<h2 class="hP" data-legacy-thread-id="18c0ffee">Your biopsy results</h2>
<span class="gD" email="doctor@clinic.example" name="Dr Smith" data-hovercard-id="doctor@clinic.example">Dr Smith</span>
<span class="bog"><span>Your biopsy results</span></span><span class="y2"> - Hi Tim, your results</span>
<div class="a3s aiL"><div dir="ltr">Hi Tim, your results are positive. Your account number is 12345678.</div></div>
<span class="aV3">results-2026-11-14.pdf</span>
<a href="https://clinic.example/portal/patient/12345678?token=abc#results">Open the portal</a>
<a href="mailto:doctor@clinic.example">doctor@clinic.example</a>
<a href="/mail/u/0/#inbox/FMfcgzQbXyZ123456789">Older thread</a>
<div data-thread-perm-id="thread-f:1784123456789012345" jslog="20277; u014N:cOuCgd,Kr2w4b; 4:W251bGwsbnVsbCxudWxsLG51bGwsInRocmVhZC1mOjE3ODQxMjM0NTY3ODkwMTIzNDUiXQ.." style="background-image:url(data:image/png;base64,iVBORw0KGgo=)"></div>
<input name="to" value="doctor@clinic.example"><input name="subjectbox" value="Re: Your biopsy results">
<!-- user tim@example.org -->
</body></html>`;

const SECRETS = [
  "tim@example.org",
  "Tim",
  "Cheung",
  "doctor@clinic",
  "Dr Smith",
  "Smith",
  "Therapy",
  "biopsy",
  "positive",
  "12345678",
  "results-2026",
  "ACg8oc",
  "secretAvatarPath",
  "googleusercontent",
  "clinic.example",
  "portal",
  "token=abc",
  "18c0ffee",
  "FMfcgzQbXyZ123456789",
  "thread-f:",
  "1784123456789012345",
  "u014N",
  "W251bGws",
  "jslog",
  "GM_ID_KEY",
  "AF6bupN",
  "r4nd0m",
  "iVBORw0KGgo",
  "Inbox (3)",
  "SignOutOptions",
  "continue=",
];

describe(scrubHtml, () => {
  it("lets no address, name, subject, snippet, body, label, attachment name or id through", () => {
    const scrubbed = scrubHtml(PRIVATE_PAGE);
    expect(SECRETS.filter((secret) => scrubbed.includes(secret))).toStrictEqual(
      []
    );
  });

  it("keeps the markup a fixture's selectors read: tags, roles, ARIA states, Gmail's classes and ids, its controls' names and icon paths", () => {
    const html =
      '<div class="AO" role="main" id=":1a"><table role="grid"><tr class="zA zE" role="row" aria-selected="false"><td><div aria-label="Archive" data-tooltip="Archive" role="button" aria-labelledby=":2b" tabindex="0"><svg viewBox="0 0 24 24"><path d="M6 4h12v2H6z"></path></svg></div></td></tr></table><a href="#inbox" role="link">Inbox</a></div>';
    expect(scrubHtml(html)).toBe(html);
  });

  it("turns every text into a placeholder of its length, whitespace kept, but Gmail's own control words", () => {
    expect(
      scrubHtml(
        '<span class="bog">Lunch on Friday?</span><div role="button">Compose</div>'
      )
    ).toBe(
      '<span class="bog">xxxxx xx xxxxxxx</span><div role="button">Compose</div>'
    );
  });

  it("gives equal ids one counter and unequal ids another, across attributes and fragments", () => {
    expect(
      scrubHtml(
        '<a href="#inbox/FMfcgzQbXyZ123456789"></a><div data-legacy-thread-id="FMfcgzQbXyZ123456789" data-thread-id="thread-f:1790000000000000001"><div data-legacy-message-id="18c1a2b3c4d5e6f7" data-legacy-last-message-id="18c1a2b3c4d5e6f7"></div></div>'
      )
    ).toBe(
      '<a href="#inbox/thread-1"></a><div data-legacy-thread-id="thread-1" data-thread-id="thread-2"><div data-legacy-message-id="message-1" data-legacy-last-message-id="message-1"></div></div>'
    );
  });

  it("numbers the ids of a second call afresh, holding no state between calls", () => {
    const html = '<div data-thread-id="thread-f:1790000000000000009"></div>';
    expect(scrubHtml(html)).toBe(scrubHtml(html));
    expect(scrubHtml(html)).toBe('<div data-thread-id="thread-1"></div>');
  });

  it("drops comments and the contents of every script and style, keeping their tags", () => {
    expect(
      scrubHtml(
        '<!-- me@example.org --><script nonce="a">var x = 1;</script><style>.a { color: red }</style>'
      )
    ).toBe("<script></script><style></style>");
  });

  it("keeps the doctype", () => {
    expect(scrubHtml("<!doctype html><p>Hi</p>")).toBe(
      "<!doctype html>\n<p>xx</p>"
    );
  });
});

describe(addressShape, () => {
  it("keeps Google's origin and the plain words of the path, and drops the query", () => {
    expect(
      addressShape("https://mail.google.com/mail/u/0/?ik=abc&at=AF6bupN#inbox")
    ).toBe("https://mail.google.com/mail/u/0/#inbox");
  });

  it("makes another origin a placeholder and every segment of its path an x", () => {
    expect(
      addressShape("https://clinic.example/portal/Patient-12345678/a.pdf")
    ).toBe("https://example.com/x/x/x");
  });

  it("numbers a label's name and a thread's id in a fragment, relative or bare", () => {
    expect(addressShape("/mail/u/0/#label/Work/FMfcgzQbXyZ123456789")).toBe(
      "/mail/u/0/#label/label-1/thread-1"
    );
    expect(addressShape("#search/biopsy")).toBe("#search/search-1");
    expect(addressShape("#secret-place")).toBe("#x");
  });

  it("makes a mailto link the placeholder address", () => {
    expect(addressShape("mailto:tim@example.org?subject=Hi")).toBe(
      "mailto:person@example.com"
    );
  });
});
