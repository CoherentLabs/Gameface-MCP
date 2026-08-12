/**
 * Perf Lint Tool
 *
 * Static, deterministic structural check: walks the rendered DOM/CSSOM tree
 * (via CDP Runtime.evaluate against the live connection - see note below) and
 * flags shapes that the Gameface documentation (prompts/rag/) names as
 * expensive. No timing is involved and nothing here measures actual frame
 * cost; that's perf_measure's job.
 *
 * Every rule below is traceable to a specific prompts/rag/*.md entry (cited
 * in the code comments). Deliberately excluded, because they are not
 * statically checkable from a single rendered-tree snapshot even though
 * they're documented Gameface performance guidance:
 *   - Transform vs. layout property choice (needs animation/@keyframes
 *     introspection; Gameface's CSSStyleSheet has no `rules`/`cssRules`
 *     access per the negative-rules doc, so authored keyframes can't be
 *     read back reliably)
 *   - DOM hiding technique choice, <template> lazy loading, node pooling,
 *     mutation throttling (all depend on runtime behavior/frequency, not a
 *     single snapshot)
 *   - CSSTOM vs string style updates, Gameface's leftPX/topPX/etc. numeric
 *     setters, runtime CSS-in-JS injection (these are JS-authoring patterns;
 *     the resulting DOM/CSSOM state is identical either way, so they leave no
 *     structural trace to detect)
 *   - Deep/BEM-vs-nested CSS selector cost (requires reading authored
 *     selector text from stylesheet rules, which Gameface doesn't expose)
 */

import { getConnectionManager } from "./connect-browser.js";
import { PerfLintParams, PerfLintResult } from "../types.js";
import { withTimeout } from "../utils/with-timeout.js";
import { createLogger } from "../logger.js";

const log = createLogger("PerfLint");

const TIMEOUT_MS = 15000;

// Injected as a single Runtime.evaluate expression. There is no `gf.executeScript`
// bridge in this codebase or documented in prompts/rag/ - every other tool here
// (eval_js, assertions.ts) walks the page via plain CDP Runtime.evaluate against
// the existing connection, so this follows the same established pattern.
const LINT_EXPRESSION = `(function (rootSelector) {
  function describeSelector(el) {
    if (el.id) return "#" + el.id;
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      var part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift("#" + node.id); break; }
      if (typeof node.className === "string" && node.className.trim()) {
        part += "." + node.className.trim().split(/\\s+/).join(".");
      }
      var parent = node.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        if (siblings.length > 1) {
          var idx = Array.prototype.indexOf.call(siblings, node) + 1;
          part += ":nth-of-type(" + idx + ")";
        }
      }
      parts.unshift(part);
      node = parent;
      depth++;
    }
    return parts.join(" > ");
  }

  var root = document;
  if (rootSelector) {
    root = document.querySelector(rootSelector);
    if (!root) {
      return { ok: false, error: "selector matched no element: " + rootSelector };
    }
  }

  var elements = rootSelector
    ? [root].concat(Array.prototype.slice.call(root.querySelectorAll("*")))
    : Array.prototype.slice.call(document.querySelectorAll("*"));

  var violations = [];

  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var cs = window.getComputedStyle(el);

    // RAG: 07-performance.md "Yoga Layout Complexity: The O(4^Depth) Cliff" /
    // 02-layout.md "Avoid align-items: stretch (the CSS Default)" (critical).
    // align-items:stretch is the CSS default, so an unset value already
    // resolves to "stretch" here - no special-casing needed.
    if (cs.display === "flex" && cs.alignItems === "stretch") {
      violations.push({
        rule: "yoga-align-items-stretch",
        selector: describeSelector(el),
        detail: "display:flex with align-items:stretch (default or explicit) forces Yoga to measure-then-regrow every child; set align-items to flex-start, center, or flex-end.",
      });
    }

    // RAG: 07-performance.md / 02-layout.md "Define Explicit flex-basis on
    // Every Flex Item" (critical): "Apply at every level of the tree, not
    // only on leaf nodes." Only flex-basis is checked: computed width/height
    // always resolve to a used pixel value regardless of whether they were
    // explicitly authored (both a content-sized and an explicitly-sized
    // element report the same resolved px), so they can't distinguish
    // "explicit" from "auto-sized" here even in principle - flex-basis is
    // the one property whose computed value stays the literal keyword "auto"
    // when unset, which is exactly why the doc singles it out as the fix to
    // apply everywhere rather than relying on width/height.
    var parent = el.parentElement;
    if (parent) {
      var parentCs = window.getComputedStyle(parent);
      if (parentCs.display === "flex" && cs.flexBasis === "auto") {
        violations.push({
          rule: "yoga-unsized-flex-item",
          selector: describeSelector(el),
          detail: "Flex item with no explicit flex-basis forces Yoga to recursively measure its subtree; set flex-basis explicitly at every level, not just leaves.",
        });
      }
    }

    // RAG: 02-layout.md "display: simple - Bypass Yoga for Pure Absolute
    // Layouts" (high). Direct children of a display:simple container that
    // aren't position:absolute/fixed render at the origin with no layout.
    if (cs.display === "simple") {
      for (var c = 0; c < el.children.length; c++) {
        var child = el.children[c];
        var childCs = window.getComputedStyle(child);
        if (childCs.position !== "absolute" && childCs.position !== "fixed") {
          violations.push({
            rule: "simple-display-child-not-absolute",
            selector: describeSelector(child),
            detail: "Direct child of a display:simple container must be position:absolute or position:fixed; otherwise it renders at (0,0) with no layout algorithm placing it.",
          });
        }
      }
    }

    // RAG: 07-performance.md "Instaload: Single-Frame Asset Loading" (high).
    // Instaload only covers external files referenced by URL; inline assets
    // (base64, inline SVG) are excluded and reintroduce mid-session pops.
    var tag = el.tagName;
    if (tag === "IMG") {
      var src = el.getAttribute("src") || "";
      if (src.indexOf("data:") === 0) {
        violations.push({
          rule: "inline-asset-breaks-instaload",
          selector: describeSelector(el),
          detail: "<img src> uses an inline data: URI; Instaload only preloads external files referenced by URL, so this reintroduces a mid-session texture pop.",
        });
      }
    }
    if (tag === "SVG") {
      violations.push({
        rule: "inline-asset-breaks-instaload",
        selector: describeSelector(el),
        detail: "Inline <svg> markup is excluded from Instaload (external-file-only); reference it via <img src=\\"...svg\\"> instead if it should be preloaded.",
      });
    }
    var bgImage = cs.backgroundImage || "";
    if (bgImage.indexOf("data:") !== -1) {
      violations.push({
        rule: "inline-asset-breaks-instaload",
        selector: describeSelector(el),
        detail: "background-image uses an inline data: URI; Instaload only preloads external files referenced by URL.",
      });
    }

    // RAG: 07-performance.md "coh-simple-opacity: Opacity Without GPU Layer
    // Promotion" (high). Standard opacity on an element with children
    // promotes an intermediate compositing layer; coh-simple-opacity avoids
    // it when the subtree is fully opaque.
    var opacity = parseFloat(cs.opacity);
    if (!isNaN(opacity) && opacity < 0.999 && el.children.length > 0) {
      violations.push({
        rule: "opacity-with-children",
        selector: describeSelector(el),
        detail: "opacity:" + cs.opacity + " on an element with children promotes an intermediate GPU compositing layer for the whole subtree; if the subtree is fully opaque, use coh-simple-opacity instead.",
      });
    }
  }

  // RAG: 07-performance.md "SCSS Variables vs. CSS Custom Properties" (medium).
  // Custom properties declared on :root trigger a global style recalculation
  // on every change; this is a page-global concern independent of rootSelector.
  // CSSStyleDeclaration.length/indexed access is not implemented in Gameface
  // (confirmed empirically: returns undefined), so parse cssText instead -
  // both cssText and getPropertyValue() do work.
  var rootCssText = document.documentElement.style.cssText || "";
  var customPropRe = /(--[\\w-]+)\\s*:/g;
  var propMatch;
  while ((propMatch = customPropRe.exec(rootCssText)) !== null) {
    violations.push({
      rule: "root-scoped-custom-property",
      selector: ":root",
      detail: "Custom property " + propMatch[1] + " is declared on :root/<html>, triggering a global style recalculation on every change; scope it to the narrowest containing element instead.",
    });
  }

  return { ok: true, violations: violations, elementsScanned: elements.length };
})(SELECTOR_PLACEHOLDER)`;

/**
 * Static structural performance check. Returns [] on a clean view.
 */
export async function perfLint(params: PerfLintParams): Promise<PerfLintResult> {
  const manager = getConnectionManager();

  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }

  const { selector } = params;
  const expression = LINT_EXPRESSION.replace(
    "SELECTOR_PLACEHOLDER",
    selector ? JSON.stringify(selector) : "null"
  );

  log.info(`Running perf lint${selector ? ` (selector: ${selector})` : ""}`);

  try {
    const result = await withTimeout(
      manager.sendCommand("Runtime", "evaluate", { expression, returnByValue: true }),
      TIMEOUT_MS,
      `perf_lint timed out after ${TIMEOUT_MS}ms - the page's JS thread may be blocked`
    );

    if (result.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Unknown exception";
      return { success: false, violations: [], elementsScanned: 0, error: text };
    }

    const value = result.result?.value;
    if (!value || value.ok !== true) {
      return { success: false, violations: [], elementsScanned: 0, error: value?.error || "No result returned" };
    }

    log.info(`Scanned ${value.elementsScanned} elements, found ${value.violations.length} violation(s)`);

    return { success: true, violations: value.violations, elementsScanned: value.elementsScanned };
  } catch (error: any) {
    log.error(`perf_lint failed: ${error.message}`);
    return { success: false, violations: [], elementsScanned: 0, error: error.message };
  }
}
