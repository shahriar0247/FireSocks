/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";

Preferences.addAll([
  { id: "browser.urlbar.speculativeConnect.select", type: "bool" },
  { id: "browser.urlbar.speculativeConnect.enabled", type: "bool" },
  { id: "dom.speculation_rules.hover_prefetch_all", type: "bool" },
  { id: "dom.speculation_rules.enabled", type: "bool" },
  { id: "network.predictor.enable-hover-on-ssl", type: "bool" },
  { id: "dom.prefetch_dns_for_anchor_https_document", type: "bool" },
  { id: "network.predictor.enabled", type: "bool" },
  { id: "browser.speed.show_speculative_activity", type: "bool" },
]);

const MOD_TOGGLES = [
  ["urlbarSpecConnect", "browser.urlbar.speculativeConnect.enabled"],
  ["urlbarSelectConnect", "browser.urlbar.speculativeConnect.select"],
  ["hoverPrefetchAll", "dom.speculation_rules.hover_prefetch_all"],
  ["speculationRules", "dom.speculation_rules.enabled"],
  ["hoverOnSslConnect", "network.predictor.enable-hover-on-ssl"],
  ["anchorHttpsDnsPrefetch", "dom.prefetch_dns_for_anchor_https_document"],
  ["networkPredictor", "network.predictor.enabled"],
  ["specActivityIndicator", "browser.speed.show_speculative_activity"],
];

for (const [id, pref] of MOD_TOGGLES) {
  Preferences.addSetting({ id, pref });
}

SettingGroupManager.registerGroups({
  firesocksSpeculation: {
    l10nId: "firesocks-mods-speculation-group",
    headingLevel: 2,
    items: [
      {
        id: "hoverPrefetchAll",
        l10nId: "firesocks-mods-hover-prefetch",
        control: "moz-checkbox",
      },
      {
        id: "speculationRules",
        l10nId: "firesocks-mods-speculation-rules",
        control: "moz-checkbox",
      },
      {
        id: "networkPredictor",
        l10nId: "firesocks-mods-network-predictor",
        control: "moz-checkbox",
      },
      {
        id: "hoverOnSslConnect",
        l10nId: "firesocks-mods-hover-ssl-connect",
        control: "moz-checkbox",
      },
      {
        id: "anchorHttpsDnsPrefetch",
        l10nId: "firesocks-mods-anchor-dns-prefetch",
        control: "moz-checkbox",
      },
    ],
  },
  firesocksUrlbar: {
    l10nId: "firesocks-mods-urlbar-group",
    headingLevel: 2,
    items: [
      {
        id: "urlbarSpecConnect",
        l10nId: "firesocks-mods-urlbar-connect",
        control: "moz-checkbox",
      },
      {
        id: "urlbarSelectConnect",
        l10nId: "firesocks-mods-urlbar-select-connect",
        control: "moz-checkbox",
      },
    ],
  },
  firesocksIndicators: {
    l10nId: "firesocks-mods-indicators-group",
    headingLevel: 2,
    items: [
      {
        id: "specActivityIndicator",
        l10nId: "firesocks-mods-spec-activity",
        control: "moz-checkbox",
      },
    ],
  },
});
