import { initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import { initLifecycle, shutdownLifecycle } from "./modules/lifecycle";
import {
  registerPrefsPane,
  onPrefsPaneLoad,
} from "./modules/ui/prefsPane";
import { registerMenuItems } from "./modules/ui/menu";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  registerPrefsPane();
  await initLifecycle();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  addon.data.initialized = true;
  ztoolkit.log("Citation Radar startup complete");
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  registerMenuItems();
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

async function onShutdown(): Promise<void> {
  ztoolkit.unregisterAll();
  await shutdownLifecycle();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed on Zotero
  delete Zotero[addon.data.config.addonInstance];
}

async function onPrefsEvent(
  type: string,
  data: { [key: string]: any },
): Promise<void> {
  switch (type) {
    case "load":
      onPrefsPaneLoad(data.window);
      break;
    default:
      return;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
};
