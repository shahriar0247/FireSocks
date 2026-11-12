"use strict";

// Tests for dom.speculation_rules.hover_prefetch_all: on documents with no
// speculation-rules candidates, hovering a same-origin link synthesizes a
// moderate-eagerness prefetch (the FireSocks speed-mode fallback).

const BASE = "https://example.com/browser/dom/base/test/";
const OTHER_ORIGIN = "https://test1.example.com/browser/dom/base/test/";
const TARGET = `${BASE}file_pageload_prefetch_target.sjs`;
// Unique per run so repeated runs share neither cache entries nor counters.
const RUN = Date.now();

const MODERATE_DELAY_MS = 60;
const SETTLE_MS = 500;

function targetURL(token) {
  return `${TARGET}?v=${token}-${RUN}`;
}

function otherOriginTargetURL(token) {
  return `${OTHER_ORIGIN}file_pageload_prefetch_target.sjs?v=${token}-${RUN}`;
}

function sourceURL(target, extra = {}) {
  const params = new URLSearchParams({ target, ...extra });
  return `${BASE}file_speculation_rules_fallback_source.html?${params}`;
}

async function hitCount(token) {
  const response = await fetch(`${TARGET}?count=${token}-${RUN}`);
  return Number(await response.text());
}

function settle() {
  // Asserting that a request never happens can only be a timed wait.
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  return new Promise(resolve => setTimeout(resolve, SETTLE_MS));
}

async function openSourceAndHover(source, selector = "#link") {
  const tab = await BrowserTestUtils.openNewForegroundTab({
    gBrowser,
    url: source,
    waitForLoad: true,
  });
  await BrowserTestUtils.synthesizeMouseAtCenter(
    selector,
    { type: "mousemove" },
    tab.linkedBrowser
  );
  return tab;
}

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["dom.speculation_rules.enabled", true],
      ["dom.speculation_rules.hover_prefetch_all", true],
      ["dom.speculation_rules.moderate_hover_delay_ms", MODERATE_DELAY_MS],
      ["dom.performance.deliverytype.enabled", true],
    ],
  });
});

add_task(async function test_hover_prefetches_same_origin_link() {
  const target = targetURL("basic");
  // stop-request, not modify-request: modify fires before the request reaches
  // the server, so the SJS counter can still read 0.
  const fetched = TestUtils.topicObserved("http-on-stop-request", subject => {
    const channel = subject.QueryInterface(Ci.nsIHttpChannel);
    let purpose = "";
    try {
      purpose = channel.getRequestHeader("Sec-Purpose");
    } catch {}
    return channel.URI.spec === target && purpose === "prefetch";
  });
  const tab = await openSourceAndHover(sourceURL(target));
  await fetched;
  Assert.greaterOrEqual(
    await hitCount("basic"),
    1,
    "The hovered same-origin link was prefetched."
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_prefetched_navigation_reports_delivery_type() {
  const target = targetURL("activate");
  const prefetched = TestUtils.topicObserved(
    "http-on-stop-request",
    subject => subject.QueryInterface(Ci.nsIHttpChannel).URI.spec === target
  );
  const tab = await openSourceAndHover(sourceURL(target));
  await prefetched;

  const loaded = BrowserTestUtils.browserLoaded(
    tab.linkedBrowser,
    false,
    target
  );
  BrowserTestUtils.startLoadingURIString(tab.linkedBrowser, target);
  await loaded;

  const deliveryType = await SpecialPowers.spawn(
    tab.linkedBrowser,
    [],
    () => content.performance.getEntriesByType("navigation")[0].deliveryType
  );
  Assert.equal(
    deliveryType,
    "navigational-prefetch",
    "The navigation was served from the hover prefetch record."
  );
  Assert.equal(
    await hitCount("activate"),
    1,
    "The target was only fetched by the prefetch, not the navigation."
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_no_prefetch_when_pref_disabled() {
  await SpecialPowers.pushPrefEnv({
    set: [["dom.speculation_rules.hover_prefetch_all", false]],
  });
  const tab = await openSourceAndHover(sourceURL(targetURL("off")));
  await settle();
  Assert.equal(
    await hitCount("off"),
    0,
    "No prefetch is issued while hover_prefetch_all is off."
  );
  BrowserTestUtils.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_no_prefetch_for_cross_origin_link() {
  // Same-site but cross-origin (test1.example.com): the fallback only
  // synthesizes candidates a navigation could activate, which today means
  // same-origin (M1).
  const token = "crossorigin";
  const target = otherOriginTargetURL(token);
  const tab = await openSourceAndHover(sourceURL(target));
  await settle();
  Assert.equal(
    await hitCount(token),
    0,
    "A cross-origin hovered link is not prefetched by the fallback."
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_mouseout_cancels_pending_prefetch() {
  const token = "cancel";
  const tab = await BrowserTestUtils.openNewForegroundTab({
    gBrowser,
    url: sourceURL(targetURL(token)),
    waitForLoad: true,
  });
  const browser = tab.linkedBrowser;
  await BrowserTestUtils.synthesizeMouseAtCenter(
    "#link",
    { type: "mousemove" },
    browser
  );
  // Move off the link well inside the 60ms hover delay; this must cancel the
  // armed timer before it can enact the candidate.
  await BrowserTestUtils.synthesizeMouseAtCenter(
    "#away",
    { type: "mousemove" },
    browser
  );
  await settle();
  Assert.equal(
    await hitCount(token),
    0,
    "Moving off the link before the delay cancels the prefetch."
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_no_prefetch_in_private_window() {
  const token = "private";
  const privateWin = await BrowserTestUtils.openNewBrowserWindow({
    private: true,
  });
  const tab = await BrowserTestUtils.openNewForegroundTab({
    gBrowser: privateWin.gBrowser,
    url: sourceURL(targetURL(token)),
    waitForLoad: true,
  });
  await BrowserTestUtils.synthesizeMouseAtCenter(
    "#link",
    { type: "mousemove" },
    tab.linkedBrowser
  );
  await settle();
  Assert.equal(
    await hitCount(token),
    0,
    "No prefetch is issued from a private window."
  );
  await BrowserTestUtils.closeWindow(privateWin);
});

add_task(async function test_fallback_skipped_when_rulesets_present() {
  // A document that declares any candidate takes the rules path, not the
  // fallback: hovering a link that no rule covers must fetch nothing.
  const declared = targetURL("declared");
  const undeclared = targetURL("undeclared");
  const tab = await BrowserTestUtils.openNewForegroundTab({
    gBrowser,
    url: sourceURL(undeclared, {
      rule_target: declared,
      target2: declared,
    }),
    waitForLoad: true,
  });
  const browser = tab.linkedBrowser;
  // #link points at `undeclared`, #link2 at the rule-declared target.
  await BrowserTestUtils.synthesizeMouseAtCenter(
    "#link",
    { type: "mousemove" },
    browser
  );
  await settle();
  Assert.equal(
    await hitCount("undeclared"),
    0,
    "Hovering an undeclared link on a rules page prefetches nothing."
  );
  Assert.equal(
    await hitCount("declared"),
    0,
    "The rule target is not fetched without hovering its link."
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_record_cap_limits_fallback_prefetches() {
  await SpecialPowers.pushPrefEnv({
    set: [["dom.speculation_rules.max_records_per_document", 1]],
  });
  const first = targetURL("cap-first");
  const second = targetURL("cap-second");
  const tab = await BrowserTestUtils.openNewForegroundTab({
    gBrowser,
    url: sourceURL(first, { target2: second }),
    waitForLoad: true,
  });
  const browser = tab.linkedBrowser;
  const firstFetched = TestUtils.topicObserved(
    "http-on-modify-request",
    subject => subject.QueryInterface(Ci.nsIHttpChannel).URI.spec === first
  );
  await BrowserTestUtils.synthesizeMouseAtCenter(
    "#link",
    { type: "mousemove" },
    browser
  );
  await firstFetched;
  await BrowserTestUtils.synthesizeMouseAtCenter(
    "#link2",
    { type: "mousemove" },
    browser
  );
  await settle();
  Assert.equal(
    await hitCount("cap-second"),
    0,
    "A second concurrent prefetch record is dropped at the cap."
  );
  BrowserTestUtils.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});
