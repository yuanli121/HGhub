import { useRef, type ReactNode } from "react";
import { useHost } from "./HostContext";
import type { InstalledPlugin } from "./client";

export function movedBefore(ids: string[], id: string, target: string) {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return ids;
  const result = ids.filter(value => value !== id); result.splice(result.indexOf(target), 0, id); return result;
}
export function ReorderList({ ids, label, name, render, change }: {
  ids: string[]; label: string; name: (id: string) => string; render?: (id: string) => ReactNode; change: (ids: string[]) => void;
}) {
  const dragged = useRef<string | null>(null);
  const move = (id: string, step: number) => {
    const n = ids.indexOf(id), target = n + step;
    if (target < 0 || target >= ids.length) return;
    const result = [...ids]; [result[n], result[target]] = [result[target], result[n]]; change(result);
  };
  return <div role="list" aria-label={label} className="hpp-reorder-list">{ids.map((id, i) => <div role="listitem" key={id} aria-label={name(id)}
    onDragOver={e => { if (dragged.current) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
    onDrop={e => { e.preventDefault(); if (dragged.current) change(movedBefore(ids, dragged.current, id)); dragged.current = null; }}>
    <span draggable className="hpp-drag-handle" aria-label={`拖动 ${name(id)}`} title="拖动调整顺序，或使用上移/下移按钮"
      onDragStart={e => { dragged.current = id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); }} onDragEnd={() => { dragged.current = null; }}>⠿</span>
    <div className="hpp-reorder-label">{render ? render(id) : name(id)}</div>
    <button aria-label={`置顶 ${name(id)}`} disabled={i === 0} onClick={() => change([id, ...ids.filter(v => v !== id)])}>置顶</button><button aria-label={`上移 ${name(id)}`} disabled={i === 0} onClick={() => move(id, -1)}>上移</button><button aria-label={`下移 ${name(id)}`} disabled={i === ids.length - 1} onClick={() => move(id, 1)}>下移</button>
  </div>)}</div>;
}
export default function HomeArrangement({ sources }: { sources: InstalledPlugin[] }) {
  const { prefs, setPrefs } = useHost();
  return <section className="hpp-arrange"><h3>来源与分区顺序</h3><ReorderList label="首页来源顺序" ids={sources.map(p => p.meta.id)} name={id => sources.find(p => p.meta.id === id)!.meta.name}
    render={id => <label className="hpp-check"><input type="checkbox" checked={!prefs.hiddenHomeIds.includes(id)} onChange={e => setPrefs({ hiddenHomeIds: e.target.checked ? prefs.hiddenHomeIds.filter(v => v !== id) : [...prefs.hiddenHomeIds, id] })}/>{sources.find(p => p.meta.id === id)!.meta.name}</label>}
    change={ids => setPrefs({ order: [...ids, ...prefs.order.filter(id => !ids.includes(id))], ...(prefs.homeMode === "multiple" ? { homeIds: ids.filter(id => prefs.homeIds.includes(id)) } : {}) })}/>
    <p className="hpp-muted">拖动把手或使用按钮调整顺序。来源顺序同时用于分类；关闭首页来源不会停用插件，也不改变搜索范围。</p>
  </section>;
}
