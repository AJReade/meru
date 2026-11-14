import { describe, expect, it } from "vitest";

import { parseHtml } from "./html.ts";
import { sanitise } from "./sanitise.ts";

const BASE = "https://mail.google.com/mail/u/0/?ui=2&view=lg&permmsgid=msg-f:1";

const sanitised = (html: string): Element => {
  const root = parseHtml(`<font size="-1">${html}</font>`).body
    .firstElementChild;
  if (root === null) {
    throw new Error("The markup holds no root");
  }
  sanitise(root, BASE);
  return root;
};

// What review 21 sent through the print view: each restyled Gmail, ran script or left Gmail through the old denylist.
const HOSTILE = `<p id="body">whole</p>
<script>document.title="script ran"</script>
<iframe srcdoc="<script>parent.document.title='srcdoc ran'</script>"></iframe>
<a id="js" href="javascript:document.title='js link ran'">js</a>
<img id="img" src="x" onerror="document.title='onerror ran'">
<style>[gh="cm"] { color: rgb(1, 2, 3) !important; } body { background: rgb(4, 5, 6) !important; }</style>
<svg id="svg"><a id="svga"><animate attributeName="href" values="javascript:document.title='svg ran'" begin="0s" dur="1s" fill="freeze"/><text y="20">click</text></a></svg>
<math><mi xlink:href="javascript:document.title='math ran'">m</mi></math>
<a id="ext" href="http://localhost:1/elsewhere">ext</a>`;

describe(sanitise, () => {
  it("keeps the text of review 21's payloads and nothing that restyles Gmail, runs script or leaves the page", () => {
    const root = sanitised(HOSTILE);
    expect(
      root.querySelectorAll(
        "script, style, iframe, svg, animate, math, [onerror], [id], [srcdoc]"
      )
    ).toHaveLength(0);
    expect(
      [...root.querySelectorAll("a")].map((link) => [
        link.textContent,
        link.getAttribute("href"),
        link.getAttribute("target"),
        link.getAttribute("rel"),
      ])
    ).toStrictEqual([
      ["js", null, null, null],
      ["ext", "http://localhost:1/elsewhere", "_blank", "noopener noreferrer"],
    ]);
    expect(root.querySelector("img")?.outerHTML).toBe('<img src="x">');
    expect(root.textContent?.includes("whole")).toBeTruthy();
  });

  it("keeps an address only when it is http, https, mailto or cid", () => {
    const root = sanitised(
      [
        '<a href="mailto:ada@example.com">m</a>',
        '<a href="//example.com/x">p</a>',
        '<a href="data:text/html,<script>1</script>">d</a>',
        '<a href="vbscript:x">v</a>',
        '<a href=" JaVaScRiPt:x">j</a>',
        '<img src="cid:logo@example.com">',
        '<img src="data:image/png;base64,AA==">',
        '<table background="javascript:x"><tr><td background="https://example.com/b.png">t</td></tr></table>',
        '<blockquote cite="file:///etc/passwd">q</blockquote>',
      ].join("")
    );
    expect(
      [...root.querySelectorAll("[href], [src], [background], [cite]")].map(
        (element) =>
          element.getAttribute("href") ??
          element.getAttribute("src") ??
          element.getAttribute("background") ??
          element.getAttribute("cite")
      )
    ).toStrictEqual([
      "mailto:ada@example.com",
      "//example.com/x",
      "cid:logo@example.com",
      "https://example.com/b.png",
    ]);
  });

  it("drops a style attribute that loads or runs something, plainly or behind an escape, and keeps one that does not", () => {
    const root = sanitised(
      [
        '<p style="color: red; font-weight: bold">kept</p>',
        '<p style="background: url(https://tracker.example/p.gif)">url</p>',
        '<p style="background: URL(x)">upper</p>',
        '<p style="background: u\\72l(x)">escaped</p>',
        '<p style="width: expression(alert(1))">expression</p>',
        "<p style=\"background-image: image-set('x.png' 1x)\">image-set</p>",
        '<p style="-moz-binding: x">binding</p>',
      ].join("")
    );
    expect(
      [...root.querySelectorAll("p")].map((paragraph) =>
        paragraph.getAttribute("style")
      )
    ).toStrictEqual([
      "color: red; font-weight: bold",
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("drops what lifts an element out of its place from a style attribute, keeping the rest, and the attribute once nothing is left", () => {
    const root = sanitised(
      [
        '<p style="position: fixed; top: 0; left: 0; width: 100vw; z-index: 2147483647; color: red">overlay</p>',
        '<p style="inset: 0; transform: translate(10px); pointer-events: none; clip-path: inset(0); right: 1px; bottom: 1px">moved</p>',
        '<p style="-webkit-transform: scale(2); translate: 10px; rotate: 1deg; scale: 2">prefixed</p>',
        '<p style="font-weight: bold">kept</p>',
      ].join("")
    );
    expect(
      [...root.querySelectorAll("p")].map((paragraph) =>
        paragraph.getAttribute("style")
      )
    ).toStrictEqual([
      "width: 100vw; color: red;",
      null,
      null,
      "font-weight: bold",
    ]);
  });

  it("unwraps an element off the list, keeping its cleaned text, and drops the attributes off it, ids and classes among them", () => {
    const root = sanitised(
      '<custom-tag><o:p>Outlook</o:p><b class="gmail_quote" id="link_undo" title="t" data-x="1" onclick="x()">bold</b></custom-tag><!-- a comment -->'
    );
    expect(root.innerHTML).toBe('Outlook<b title="t">bold</b>');
  });
});
