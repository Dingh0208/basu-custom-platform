import { useMemo, useState } from 'react';
import type { ImportRecord } from '../types';
import { needsArchive } from './InboxArchive';

type ArchiveFilter = 'all' | 'pending' | 'linked';

function processingLabel(record: ImportRecord) {
  if (record.status === 'processing') return `处理中 ${record.progress}%`;
  if (record.status === 'failed') return '处理失败';
  if (record.status === 'cancelled') return '已取消';
  if ((record.type === '音频' || record.type === '视频') && !record.transcriptId) return '原件已保存';
  return '已解析';
}

export default function MaterialsPage({ imports, onPreview, onNavigate }: {
  imports: ImportRecord[];
  onPreview: (record: ImportRecord) => void;
  onNavigate: (label: string) => void;
}) {
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');

  const types = useMemo(() => [...new Set(imports.map((item) => item.type))].sort(), [imports]);
  const customers = useMemo(() => [...new Set(imports.map((item) => item.customer).filter((name) => name && name !== '待归档' && name !== '待确认'))].sort(), [imports]);
  const projects = useMemo(() => [...new Set(imports.map((item) => item.project).filter((name) => name && name !== '—'))].sort(), [imports]);
  const filtered = useMemo(() => imports.filter((record) => {
    const pending = needsArchive(record);
    if (archiveFilter === 'pending' && !pending) return false;
    if (archiveFilter === 'linked' && pending) return false;
    if (typeFilter && record.type !== typeFilter) return false;
    if (customerFilter && record.customer !== customerFilter) return false;
    if (projectFilter && record.project !== projectFilter) return false;
    return true;
  }), [archiveFilter, customerFilter, imports, projectFilter, typeFilter]);

  return (
    <>
      <header className="topbar">
        <div className="crumbs"><strong>资料</strong><span className="badge">{filtered.length} 条</span></div>
        <div className="top-actions">
          <button className="btn" onClick={() => onNavigate('待归档')}>待归档</button>
          <button className="btn primary" onClick={() => onNavigate('导入中心')}>导入资料</button>
        </div>
      </header>
      <div className="materials-workspace">
        <section className="card materials-list">
          <div className="materials-toolbar">
            <div className="segmented materials-status-filter" role="group" aria-label="资料归档状态">
              {([['all', '全部'], ['pending', '待归档'], ['linked', '已关联']] as const).map(([key, label]) => (
                <button key={key} className={archiveFilter === key ? 'on' : ''} aria-pressed={archiveFilter === key} onClick={() => setArchiveFilter(key)}>{label}</button>
              ))}
            </div>
            <div className="materials-metadata-filters">
              <select aria-label="按资料类型筛选" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="">全部类型</option>
                {types.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <select aria-label="按客户筛选" value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)}>
                <option value="">全部客户</option>
                {customers.map((customer) => <option key={customer} value={customer}>{customer}</option>)}
              </select>
              <select aria-label="按项目筛选" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                <option value="">全部项目</option>
                {projects.map((project) => <option key={project} value={project}>{project}</option>)}
              </select>
            </div>
          </div>
          <div className="materials-table" role="table" aria-label="导入资料">
            <div className="materials-table-head" role="row">
              <span role="columnheader">资料</span><span role="columnheader">状态</span><span role="columnheader">客户 / 项目</span><span role="columnheader">导入时间</span><span role="columnheader">操作</span>
            </div>
            {filtered.map((record) => (
              <div className="materials-table-row" role="row" key={record.id}>
                <div className="materials-name" role="cell"><strong>{record.fileName}</strong><small>{record.type} · {record.size}</small></div>
                <span className={`badge ${record.status === 'failed' ? 'danger' : needsArchive(record) ? 'warn' : record.status === 'processing' ? 'processing' : 'done'}`} role="cell">{processingLabel(record)}</span>
                <div className="materials-association" role="cell"><strong>{record.customer || '待归档'}</strong><small>{record.project || '—'}</small></div>
                <time role="cell">{record.importedAt}</time>
                <div className="materials-actions" role="cell"><button className="btn" disabled={record.status === 'processing'} onClick={() => onPreview(record)}>预览</button></div>
              </div>
            ))}
            {!filtered.length && <div className="materials-empty">{imports.length ? '没有符合筛选条件的资料' : '尚无导入资料'}{!imports.length && <button className="btn" onClick={() => onNavigate('导入中心')}>导入第一份资料</button>}</div>}
          </div>
        </section>
      </div>
    </>
  );
}
