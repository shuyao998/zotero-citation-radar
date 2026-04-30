/**
 * Helper for hosting plugin-generated HTML inside a Zotero chrome window.
 *
 * The actual viewer is `addon/content/graphWindow.xhtml` — a chrome XHTML
 * page that fetches each pane's temp HTML (privileged file:// fetch) and
 * inlines it into an iframe via `srcdoc`. This sidesteps the
 * chrome:// → file:// iframe loading restriction in modern Mozilla.
 *
 * Supports 1 or 2 tabs (graph alone, or graph + influence report).
 */

import { config } from "../../../package.json";

declare const Zotero: any;
declare const IOUtils: any;
declare const PathUtils: any;

export interface TabSpec {
  /** Visible label on the tab button. */
  label: string;
  /** Absolute path to the temp HTML file for this pane. */
  filePath: string;
}

export interface OpenWindowOptions {
  /** Window title (no prefix added). */
  title: string;
  /** 1 or 2 tabs. With 1 the tab bar is hidden. */
  tabs: TabSpec[];
  width?: number;
  height?: number;
}

export function openInZoteroWindow(opts: OpenWindowOptions): void {
  if (opts.tabs.length === 0) {
    throw new Error("openInZoteroWindow: tabs must not be empty");
  }
  const w = opts.width ?? 1400;
  const h = opts.height ?? 900;
  const tabArgs = opts.tabs.map((t) => ({
    label: t.label,
    url: pathToFileUrl(t.filePath),
  }));
  const features = `chrome,resizable,centerscreen,dialog=no,scrollbars=yes,width=${w},height=${h}`;
  const mainWin = Zotero.getMainWindow();
  mainWin.openDialog(
    `chrome://${config.addonRef}/content/graphWindow.xhtml`,
    "_blank",
    features,
    { title: opts.title, tabs: tabArgs },
  );
}

export function pathToFileUrl(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  return normalized.startsWith("/")
    ? `file://${normalized}`
    : `file:///${normalized}`;
}

/** Write an HTML string to the citation-radar temp dir; return the absolute path. */
export async function writeTempHtml(
  filename: string,
  html: string,
): Promise<string> {
  const tempDir = PathUtils.join(
    Zotero.getTempDirectory().path,
    "citation-radar",
  );
  await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });
  const outFile = PathUtils.join(tempDir, filename);
  await IOUtils.writeUTF8(outFile, html);
  return outFile;
}
