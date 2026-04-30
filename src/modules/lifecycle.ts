/**
 * Plugin-wide lifecycle: open shared services on startup, close on shutdown.
 * Stored on `addon.api` so other modules can grab them via `addon.api.db` etc.
 */

import { CitationRadarDB } from "./storage/db";

declare const Zotero: any;

export interface CitationRadarServices {
  db: CitationRadarDB;
}

export async function initLifecycle(): Promise<void> {
  const db = new CitationRadarDB();
  await db.open();

  const paperCount = await db.countRows("paper");
  Zotero.debug(
    `[Citation Radar] DB opened. paper rows: ${paperCount}`,
  );

  addon.api = { db } as CitationRadarServices;
}

export async function shutdownLifecycle(): Promise<void> {
  const services = addon.api as CitationRadarServices | undefined;
  await services?.db?.close();
}

export function getServices(): CitationRadarServices {
  const services = addon.api as CitationRadarServices | undefined;
  if (!services?.db) {
    throw new Error("Citation Radar services not initialized yet");
  }
  return services;
}
