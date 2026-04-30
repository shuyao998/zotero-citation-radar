/**
 * Preferences pane: registration + onLoad event binding for our custom
 * fields (API keys, LLM provider/model). Bindings to prefs are declared in
 * `addon/content/preferences.xhtml` via `preference="..."`; only side-effect
 * logic (e.g. test-connection buttons) lives here.
 */

import { config } from "../../../package.json";

declare const Zotero: any;

export function registerPrefsPane(): void {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: "Citation Radar",
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
  });
}

export function onPrefsPaneLoad(window: Window): void {
  // Hook for future interactive elements (test-connection button, model picker, etc.)
  ztoolkit.log("Prefs pane loaded", window?.document?.title);
}
