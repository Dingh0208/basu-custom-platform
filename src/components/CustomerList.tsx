import { useEffect, useMemo, useState } from 'react';
import type { CustomerTimelineEntry, ImportRecord } from '../types';
import { fetchCustomerTimeline } from '../api/client';
import { IconChat, IconFile, IconMic, IconSearch, IconUsers } from './Icons';

type CustomerListProps = {
  imports: ImportRecord[];
  onOpenRecord: (record: ImportRecord) => void;
  onToast: (message: string) => void;
};

type CustomerView = {
  name: string;
  company: string;
  project: string;
  lastAt: string;
  records: ImportRecord[];
};

function recordIcon(type: string) {
  if (type === '音频') return <IconMic size={14} />;
  if (type === '聊天记录') return <IconChat size={14} />;
  return <IconFile size={14} />;
}

export default function CustomerList({ imports, onOpenRecord, onToast }: CustomerListProps) {
  const [query, setQuery] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(() => new URLSearchParams(window.location.search).get('customer'));
  const [timeline, setTimeline] = useState<CustomerTimelineEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const customers = useMemo<CustomerView[]>(() => {
    const map = new Map<string, CustomerView>();
    for (const record of imports) {
      if (record.customer === '待归档' || record.status === 'failed') continue;
      const existing = map.get(record.customer);
      if (!existing) {
        map.set(record.customer, {
          name: record.customer,
          company: record.customer === '张三' ? '某某科技有限公司' : '—',
          project: record.project,
          lastAt: record.importedAt,
          records: [record],
        });
      } else {
        existing.records.push(record);
        if (record.importedAt > existing.lastAt) existing.lastAt = record.importedAt;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.records.length - a.records.length);
  }, [imports]);

  const filtered = customers.filter((c) => !query.trim() || `${c.name}${c.company}${c.project}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = customers.find((c) => c.name === selectedName) ?? filtered[0] ?? null;

  useEffect(() => {
    if (!selected) {
      setTimeline([]);
      return;
    }
    let mounted = true;
    setTimelineLoading(true);
    fetchCustomerTimeline(selected.name).then((data) => {
      if (!mounted) return;
      if (data) {
        setTimeline(data.records);
      } else {
        setTimeline(selected.records.map((record) => ({
          id: record.id,
          fileName: record.fileName,
          type: record.type,
          project: record.project,
          importedAt: record.importedAt,
          status: record.status,
          transcriptId: record.transcriptId,
          kind: record.type === '聊天记录' ? 'chat' : record.type === '音频' ? 'audio' : 'file',
          title: record.fileName,
          summary: '',
          messageCount: 0,
          duration: 0,
        })));
      }
      setTimelineLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [selected?.name]);

  function openTimelineEntry(entry: CustomerTimelineEntry) {
    const record = imports.find((item) => item.id === entry.id);
    if (record) onOpenRecord(record);
    else onToast('对应记录暂时不可打开');
  }

  const callCount = timeline.filter((entry) => entry.kind === 'audio').length;
  const chatCount = timeline.filter((entry) => entry.kind === 'chat').length;
  const fileCount = timeline.filter((entry) => entry.kind === 'file').length;

  return (
    <>
      <header className="topbar">
        <div className="crumbs">
          <strong>客户</strong>
          <span className="badge done">{customers.length} 位客户</span>
        </div>
        <div className="top-actions">
          <button className="btn" onClick={() => onToast('新建客户表单将在下一版提供')}>新建客户</button>
        </div>
      </header>

      <div className="customer-workspace">
        <section className="card customer-list-card">
          <div className="card-head">
            <div><div className="card-title">客户列表</div><div className="card-sub">按最近沟通与记录数量排序</div></div>
            <div className="search-box" style={{ marginLeft: 'auto' }}>
              <IconSearch size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索客户 / 公司 / 项目" />
            </div>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table className="table">
              <thead><tr><th>客户</th><th>公司</th><th>当前项目</th><th>最近沟通</th><th>记录数</th><th>状态</th></tr></thead>
              <tbody>
                {filtered.map((customer) => (
                  <tr
                    key={customer.name}
                    onClick={() => setSelectedName(customer.name)}
                    style={{ cursor: 'pointer', background: selected?.name === customer.name ? '#f8fbfa' : undefined }}
                  >
                    <td>
                      <div className="customer-name-cell">
                        <span className="customer-avatar">{customer.name.slice(0, 1)}</span>
                        <span>{customer.name}</span>
                      </div>
                    </td>
                    <td>{customer.company}</td>
                    <td>{customer.project}</td>
                    <td>{customer.lastAt}</td>
                    <td>{customer.records.length}</td>
                    <td><span className="badge done">跟进中</span></td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={6}><div className="empty-panel">没有找到匹配的客户</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="card customer-side-card">
          {selected ? (
            <>
              <div className="customer-side-head">
                <div className="customer-avatar large">{selected.name.slice(0, 1)}</div>
                <div>
                  <div className="customer-side-name">{selected.name}</div>
                  <div className="customer-side-company">{selected.company}</div>
                </div>
              </div>
              <div className="customer-side-tags">
                <span className="pill blue">客户档案</span>
                <span className="pill">最近 {selected.lastAt}</span>
                <span className="pill">{timeline.length} 条沟通</span>
                {callCount > 0 && <span className="pill">通话 {callCount}</span>}
                {chatCount > 0 && <span className="pill">聊天 {chatCount}</span>}
                {fileCount > 0 && <span className="pill">文件 {fileCount}</span>}
              </div>
              <div className="customer-side-section">
                <div className="customer-side-label">客户 360 · 统一时间线</div>
                {timelineLoading ? (
                  <div className="empty-panel">正在加载时间线…</div>
                ) : timeline.length === 0 ? (
                  <div className="empty-panel">暂无沟通记录</div>
                ) : (
                  <div className="customer-timeline">
                    {timeline.map((entry) => (
                      <button key={entry.id} className={`timeline-entry ${entry.kind}`} onClick={() => openTimelineEntry(entry)}>
                        <span className="timeline-icon">{entry.kind === 'chat' ? <IconChat size={14} /> : entry.kind === 'audio' ? <IconMic size={14} /> : <IconFile size={14} />}</span>
                        <span className="timeline-main">
                          <span className="timeline-head">
                            <span className="timeline-kind">{entry.kind === 'chat' ? '聊天' : entry.kind === 'audio' ? '通话' : '文件'}</span>
                            <span className="timeline-time">{entry.importedAt}</span>
                          </span>
                          <span className="timeline-title">{entry.title}</span>
                          {entry.summary && <span className="timeline-summary">{entry.summary}</span>}
                          <span className="timeline-meta">{entry.project}{entry.kind === 'chat' && entry.messageCount ? ` · ${entry.messageCount} 条消息` : ''}{entry.kind === 'audio' && entry.duration ? ` · ${Math.max(1, Math.round(entry.duration / 60))} 分钟` : ''}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="customer-side-section">
                <div className="customer-side-label">客户 360 提示</div>
                <div className="customer-side-note">
                  <IconUsers size={15} />
                  统一时间线已聚合通话、聊天与文件记录。点击任意记录可打开对应转写或聊天详情。
                </div>
              </div>
            </>
          ) : (
            <div className="empty-panel">选择左侧客户查看档案</div>
          )}
        </aside>
      </div>

      <footer className="statusbar">
        <div className="status-left"><span><span className="status-dot" />本地数据 · SQLite</span><span>客户数：{customers.length}</span></div>
        <div>客户信息聚合工作台 · Sprint 2</div>
      </footer>
    </>
  );
}
