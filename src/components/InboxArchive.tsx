import { useEffect, useState } from 'react';
import type { CustomerProfile, ImportRecord, ProjectListItem } from '../types';
import { archiveImports, fetchCustomers, fetchProjects } from '../api/client';

export function needsArchive(record: ImportRecord) {
  return record.status === 'inbox' || ['', '待归档', '待确认'].includes(record.customer);
}

export default function InboxArchive({ imports, onArchived, online, initialId, onNavigate, onPreview, onDelete }: { imports: ImportRecord[]; onArchived: () => Promise<void>; online: boolean; initialId: string; onNavigate: (label: string) => void; onPreview: (record: ImportRecord) => void; onDelete: (record: ImportRecord) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [customer, setCustomer] = useState('');
  const [project, setProject] = useState('');
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  const [focusedId, setFocusedId] = useState(initialId);
  const pending = imports.filter(needsArchive);
  const eligible = pending.filter((r) => r.status === 'done' || r.status === 'inbox');
  const chosen = selected.filter((id) => eligible.some((r) => r.id === id));
  const focused = pending.find((r) => r.id === focusedId) ?? pending[0];

  useEffect(() => {
    setFocusedId(initialId);
    setSelected(initialId ? [initialId] : []);
  }, [initialId]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setMessage('');
    Promise.all([fetchCustomers(), fetchProjects()]).then(([cs, ps]) => {
      if (!live) return;
      setLoading(false);
      setCustomers(cs ?? []);
      setProjects(ps ?? []);
      if (!cs || !ps) setMessage('客户或项目加载失败，请刷新候选');
    });
    return () => { live = false; };
  }, [online, version]);

  async function archive() {
    if (!chosen.length || !customer || !project || !owner.trim()) return;
    setBusy(true);
    setMessage('');
    const result = await archiveImports(chosen, customer, project, owner.trim());
    if (!result) { setMessage('归档失败，请刷新数据并确认所有所选记录已处理完成，客户和项目仍然有效'); setBusy(false); return; }
    setSelected([]);
    await onArchived();
    setBusy(false);
    setMessage(`已归档 ${result.updated.length} 条记录，关联需求与待办已同步`);
  }

  return <>
    <header className="topbar"><div className="crumbs"><strong>待归档</strong><span className="badge warn">{pending.length} 条待确认归属</span></div><div className="top-actions"><button className="btn" onClick={() => { setVersion((v) => v + 1); void onArchived(); }}>刷新资料</button><button className="btn" onClick={() => onNavigate('导入中心')}>返回导入中心</button></div></header>
    <div className="inbox-workspace">
      <div className="inbox-intro"><div><h1>为资料确认归属</h1><p>选中资料，确认客户、项目和负责人后，关联内容将进入客户 360。</p></div><div className="inbox-counts"><span><strong>{eligible.length}</strong> 可归档</span><span><strong>{pending.length - eligible.length}</strong> 待处理完成</span></div></div>
      <div className="inbox-columns">
        <section className="card inbox-records">
          <div className="card-head"><div><div className="card-title">待确认资料</div><div className="card-sub">已选择 {chosen.length} 条 · 每批最多 200 条</div></div><label className="inbox-select-all"><input type="checkbox" disabled={busy || !eligible.length} checked={eligible.length > 0 && chosen.length === Math.min(200, eligible.length)} onChange={(e) => setSelected(e.target.checked ? eligible.slice(0, 200).map((r) => r.id) : [])} />全选可归档记录</label></div>
          {!pending.length ? <div className="inbox-empty"><strong>全部资料已确认归属</strong><p>新导入的资料若无法确认客户，会出现在这里。</p><button className="btn" onClick={() => onNavigate('客户')}>查看客户 360</button></div> : pending.map((record) => <div key={record.id} className={`inbox-record ${focused?.id === record.id ? 'focused' : ''}`}>
            <input type="checkbox" aria-label={`选择 ${record.fileName}`} disabled={busy || !eligible.includes(record) || (!chosen.includes(record.id) && chosen.length >= 200)} checked={chosen.includes(record.id)} onChange={(e) => setSelected((current) => e.target.checked ? [...current, record.id] : current.filter((id) => id !== record.id))} />
            <button className="inbox-record-main" disabled={busy} onClick={() => { setFocusedId(record.id); if (eligible.includes(record) && !chosen.includes(record.id) && chosen.length < 200) setSelected((current) => [...current, record.id]); }}><strong>{record.fileName}</strong><small>{record.type} · {record.size} · {record.importedAt}</small><span className={`badge ${eligible.includes(record) ? 'warn' : record.status === 'processing' ? 'processing' : 'warn'}`}>{eligible.includes(record) ? '待确认归属' : record.status === 'processing' ? '解析中' : record.status === 'failed' ? '处理失败' : '已取消'}</span></button>
          </div>)}
        </section>
        <aside className="inbox-details">
          {focused && <section className="card inbox-file-detail"><div className="card-head"><div className="card-title">资料详情</div></div><div className="card-body"><strong>{focused.fileName}</strong><dl className="kv-list"><div className="kv"><dt>文件类型</dt><dd>{focused.type}</dd></div><div className="kv"><dt>文件大小</dt><dd>{focused.size}</dd></div><div className="kv"><dt>导入时间</dt><dd>{focused.importedAt}</dd></div><div className="kv"><dt>当前客户</dt><dd>{focused.customer || '待确认'}</dd></div><div className="kv"><dt>当前项目</dt><dd>{focused.project}</dd></div></dl><div className="sales-row-actions">{focused.transcriptId && focused.status === 'done' && <button className="btn" onClick={() => onPreview(focused)}>查看解析内容</button>}{!eligible.includes(focused) && <button className="btn" onClick={() => onNavigate('导入中心')}>前往处理任务</button>}<button className="btn danger-btn" disabled={focused.status === 'processing'} onClick={() => onDelete(focused)}>删除资料</button></div></div></section>}
          <section className="card inbox-archive">
    <div className="card-head"><div><div className="card-title">确认归属</div><div className="card-sub">将统一应用到选中的 {chosen.length} 条资料</div></div></div>
    <div className="sales-archive-form">
      <label>客户<select aria-label="客户" value={customer} disabled={busy || loading} onChange={(e) => { setCustomer(e.target.value); setProject(''); setOwner(customers.find((c) => c.name === e.target.value)?.owner || ''); }}><option value="">请选择客户</option>{customers.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
      <label>项目<select aria-label="项目" value={project} disabled={busy || !customer} onChange={(e) => { setProject(e.target.value); setOwner(projects.find((p) => p.customer === customer && p.name === e.target.value)?.owner || owner); }}><option value="">请选择项目</option>{projects.filter((p) => p.customer === customer).map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}</select></label>
      <label>负责人<input aria-label="负责人" value={owner} disabled={busy} onChange={(e) => setOwner(e.target.value)} placeholder="确认负责跟进的人" /></label>
      <button className="btn primary" onClick={() => void archive()} disabled={!online || busy || !chosen.length || !customer || !project || !owner.trim()}>{busy ? '归档中…' : `确认归档 ${chosen.length} 条`}</button>
    </div>
    <p className="small-note sales-inset">新客户或新项目请先建立，再刷新资料。处理中、失败或已取消的记录需先完成处理。</p>
    <div className="sales-inset"><button className="btn ghost" onClick={() => onNavigate('客户')}>管理客户与项目</button></div>
    {!online && <p className="sales-error" role="alert">本地服务未连接，暂时无法确认归属。</p>}
    {message && <p className="sales-inset" role="status">{message}</p>}
          </section>
        </aside>
      </div>
    </div>
  </>;
}
