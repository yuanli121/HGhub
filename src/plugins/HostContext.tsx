import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onPluginAuthFailure, onPluginAuthSuccess, pluginCommand, pluginError, type InstalledPlugin } from "./client";
import { installBundledPlugins } from "../bundled-plugins";
import type { MediaItem } from "./protocol";
import { clearMetadataCache } from './metadataCache';
import { emptyUpdateState, pendingUpdates, tickPluginUpdates, type UpdateState } from "./updateClient";

export interface LocalProgress { pluginId: string; mediaId: string; playlistId?: string; episodeId: string; positionSec: number; durationSec?: number; at: number }
export interface LibraryEntry { pluginId: string; mediaId: string; item: MediaItem; favorite: boolean; tracking: boolean; updatedAt: number; lastProgress?: LocalProgress; latestLabel?: string }
export interface Preferences { homeMode: "all" | "single" | "multiple"; homeIds: string[]; order: string[]; hiddenHomeIds: string[]; hiddenSections: string[]; sectionOrder: Record<string, string[]>; searchMode: "all" | "single" | "multiple"; searchIds: string[]; mature: boolean; playbackFallback: boolean; autoNext: boolean }
const defaults: Preferences = { homeMode: "all", homeIds: [], order: [], hiddenHomeIds: [], hiddenSections: [], sectionOrder: {}, searchMode: "all", searchIds: [], mature: false, playbackFallback: true, autoNext: true };
function readPreferences(): Preferences {
  try {
    const raw = JSON.parse(localStorage.getItem("hpp.preferences") || "{}"), p = { ...defaults };
    for (const key of ["homeMode", "searchMode"] as const) if (["all", "single", "multiple"].includes(raw[key])) p[key] = raw[key];
    for (const key of ["homeIds", "searchIds", "order", "hiddenHomeIds", "hiddenSections"] as const) if (Array.isArray(raw[key])) p[key] = [...new Set<string>(raw[key].filter((v: unknown) => typeof v === "string"))];
    if (raw.sectionOrder && typeof raw.sectionOrder === "object" && !Array.isArray(raw.sectionOrder)) p.sectionOrder = Object.fromEntries(Object.entries(raw.sectionOrder).filter(([,v]) => Array.isArray(v)).map(([id,v]) => [id, [...new Set((v as unknown[]).filter((id): id is string => typeof id === "string"))]]));
    p.mature = raw.mature === true; p.playbackFallback = raw.playbackFallback !== false; p.autoNext = raw.autoNext !== false; return p;
  } catch { return defaults; }
}
const Ctx = createContext<{
  plugins: InstalledPlugin[]; sources: InstalledPlugin[]; library: LibraryEntry[]; error: string; ready: boolean;
  reload: () => Promise<void>; refreshLibrary: () => Promise<void>; prefs: Preferences; setPrefs: (p: Partial<Preferences>) => void;
  put: (pluginId: string, item: MediaItem, changes?: { favorite?: boolean; tracking?: boolean; latestLabel?: string }) => Promise<void>;
  authPrompt: { id: string; message: string } | null; clearAuth: () => void;
  updates: UpdateState; refreshUpdates: () => Promise<void>;
}>(null!);
export const useHost = () => useContext(Ctx);
export const libraryKey = (pluginId: string, mediaId: string) => JSON.stringify([pluginId, mediaId]);
export function HostProvider({ children }: { children: React.ReactNode }) {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]), [library, setLibrary] = useState<LibraryEntry[]>([]), [error, setError] = useState(""), [ready, setReady] = useState(false);
  const [authPrompt, setAuthPrompt] = useState<{ id: string; message: string } | null>(null);
  const [updates, setUpdates] = useState(emptyUpdateState), startup = useRef<Promise<UpdateState> | null>(null), updateBusy = useRef(false);
  const refreshUpdates = useCallback(async () => { setUpdates(await pluginCommand<UpdateState>("updates.state")); }, []);
  // 首启自动导入预置插件（整合版）：逐源导入，已导入的跳过，失败的下次启动重试
  useEffect(() => { void installBundledPlugins(); }, []);
  useEffect(() => {
    let live = true;
    // StrictMode can subscribe twice; one host startup operation belongs to this app lifetime.
    if (!startup.current) startup.current = pluginCommand<UpdateState>("updates.startup", { requestId: crypto.randomUUID() });
    void startup.current.then(state => { if (live) setUpdates(state); }).catch(e => { if (live) setError(pluginError(e)); });
    const changed = () => { void refreshUpdates().catch(e => setError(pluginError(e))); };
    window.addEventListener("hpp.updates.changed", changed);
    return () => { live = false; window.removeEventListener("hpp.updates.changed", changed); };
  }, [refreshUpdates]);
  useEffect(() => {
    if (!updates.policy.autoInstall || !pendingUpdates(updates).length) return;
    let live = true;
    const tick = async () => {
      if (updateBusy.current) return; updateBusy.current = true;
      try { const state = await tickPluginUpdates(); if (live) setUpdates(state); }
      catch (e) { if (live) setError(pluginError(e)); } finally { updateBusy.current = false; }
    };
    const timer = window.setInterval(() => void tick(), 5000);
    const idle = () => { void tick(); };
    window.addEventListener("hpp.playback.idle", idle);
    return () => { live = false; clearInterval(timer); window.removeEventListener("hpp.playback.idle", idle); };
  }, [updates.policy.autoInstall, updates.items.map(i => `${i.id}:${i.status}:${i.version}`).join("|")]);
  const [prefs, setPreferences] = useState<Preferences>(readPreferences);
  const setPrefs = useCallback((p: Partial<Preferences>) => setPreferences(old => ({ ...old, ...p })), []);
  useEffect(() => { try { localStorage.setItem("hpp.preferences", JSON.stringify(prefs)); } catch { setError("无法保存显示偏好"); } }, [prefs]);
  const refreshLibrary = useCallback(async () => { setLibrary(await pluginCommand<LibraryEntry[]>("library.list")); }, []);
  const reload = useCallback(async () => {
    try { setPlugins(await pluginCommand<InstalledPlugin[]>("list")); setError(""); }
    catch (e) { setError(pluginError(e)); } finally { setReady(true); }
  }, []);
  useEffect(() => {
    void reload(); void refreshLibrary().catch(e => setError(pluginError(e)));
    const changed = () => { clearMetadataCache(); void reload(); void refreshLibrary().catch(e => setError(pluginError(e))); };
    window.addEventListener("hpp.changed", changed); return () => window.removeEventListener("hpp.changed", changed);
  }, [reload, refreshLibrary]);
  useEffect(() => onPluginAuthFailure(f => { clearMetadataCache(); if (!f.silent) setAuthPrompt(f); }), []);
  useEffect(() => onPluginAuthSuccess(id => { clearMetadataCache(); setAuthPrompt(old => old?.id === id ? null : old); }), []);
  const sources = useMemo(() => plugins.filter(p => p.enabled && p.meta.kind !== "resolver" && ["ready", "unloaded"].includes(p.status) && (prefs.mature || !p.meta.mature)).sort((a,b) => {
    const index = (id: string) => { const n=prefs.order.indexOf(id);return n<0?10000:n; }; return index(a.meta.id)-index(b.meta.id);
  }), [plugins, prefs]);
  const put = useCallback(async (pluginId: string, item: MediaItem, changes = {}) => { await pluginCommand("library.put", { pluginId, item, ...changes }); await refreshLibrary(); }, [refreshLibrary]);
  return <Ctx.Provider value={{ plugins, sources, library, error, ready, reload, refreshLibrary, prefs, setPrefs, put, authPrompt, clearAuth: () => setAuthPrompt(null), updates, refreshUpdates }}>{children}</Ctx.Provider>;
}
