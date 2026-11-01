import { useEffect, useRef, useState } from 'react';
import type { SearchResponse, SearchResult } from '../types';
import { searchAll } from '../api/client';
import Modal from './Modal';

const labels = { customer: '客户', project: '项目', chat: '聊天', transcript: '转写', requirement: '需求' };

export default function GlobalSearch({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (result: SearchResult) => void }) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [kind, setKind] = useState('all');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setData(null);
    setError(false);
    setLoading(!!query.trim());
    if (!query.trim()) return;
    const timer = window.setTimeout(async () => {
      const result = await searchAll(query.trim());
      if (!live) return;
      setData(result);
      setError(!result);
      setLoading(false);
    }, 250);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query, open]);

  const results = data?.results.filter((item) => kind === 'all' || item.kind === kind) ?? [];
  return <Modal open={open} title="搜索整个工作台" subtitle="客户、项目、聊天、转写与需求 · 本地关键词检索" onClose={onClose} className="global-search-modal">
    <div className="modal-body"><input ref={input} className="sales-search-input" aria-label="全局搜索关键词" placeholder="输入客户、项目或沟通中的关键词" maxLength={100} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="sales-filters"><button className={`btn ${kind === 'all' ? 'primary' : 'ghost'}`} onClick={() => setKind('all')}>全部</button>{Object.entries(labels).map(([id, label]) => <button key={id} className={`btn ${kind === id ? 'primary' : 'ghost'}`} onClick={() => setKind(id)}>{label} {data?.counts[id as SearchResult['kind']] ?? ''}</button>)}</div>
      <div className="search-results" aria-live="polite">{loading ? <div className="empty-panel">正在检索…</div> : error ? <div className="sales-error" role="alert">搜索失败，请确认本地服务连接后重试</div> : !query.trim() ? <div className="empty-panel">输入关键词开始搜索</div> : results.length === 0 ? <div className="empty-panel">没有找到相关记录，请尝试其他关键词</div> : results.map((item) => <button className="search-result" key={`${item.kind}-${item.id}`} onClick={() => { onSelect(item); onClose(); }}><span className="pill">{labels[item.kind]}</span><strong>{item.title}</strong><small>{item.customer}{item.project ? ` · ${item.project}` : ''}</small><p>{item.snippet}</p></button>)}</div>
      {!!data?.results.length && <p className="small-note">每类最多展示 20 条；输入更具体的关键词可缩小范围。</p>}
    </div>
  </Modal>;
}
