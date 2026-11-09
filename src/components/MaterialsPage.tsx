import { useMemo, useState } from 'react';
import type { CustomerProfile, ImportRecord, ProjectListItem } from '../types';
import { archiveImports, createCustomer, createCustomerProject, deleteImport, fetchCustomers, fetchProjects, getHealth } from '../api/client';
import { customerLabel, needsAssociation } from '../materials';
import CustomerProfileModal from './CustomerProfileModal';
import Modal from './Modal';
import ProjectModal from './ProjectModal';

type ArchiveFilter = 'all' | 'unlinked' | 'linked';

function processingLabel(record: ImportRecord) {
  if (record.status === 'processing') return `处理中 ${record.progress}%`;
  if (record.status === 'failed') return '处理失败';
  if (record.status === 'cancelled') return '已取消';
  if ((record.type === '音频' || record.type === '视频') && !record.transcriptId) return '原件已保存';
  return '已解析';
}

function canSelect(record: ImportRecord) {
  return record.status !== 'processing';
}

function canAssociate(record: ImportRecord) {
  return ['done', 'inbox'].includes(record.status);
}

export default function MaterialsPage({ imports, online, onPreview, onNavigate, onRefresh, onToast }: {
  imports: ImportRecord[];
  online: boolean;
  onPreview: (record: ImportRecord) => void;
  onNavigate: (label: string) => void;
  onRefresh: () => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>(() => new URLSearchParams(window.location.search).get('view') === 'inbox' ? 'unlinked' : 'all');
  const [typeFilter, setTypeFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [associating, setAssociating] = useState<ImportRecord[]>([]);
  const [customerOptions, setCustomerOptions] = useState<CustomerProfile[]>([]);
  const [projectOptions, setProjectOptions] = useState<ProjectListItem[]>([]);
  const [customer, setCustomer] = useState('');
  const [project, setProject] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const types = useMemo(() => [...new Set(imports.map((item) => item.type))].sort(), [imports]);
  const customers = useMemo(() => [...new Set(imports.map((item) => item.customer).filter((name) => name && name !== '待归档' && name !== '待确认'))].sort(), [imports]);
  const projects = useMemo(() => [...new Set(imports.map((item) => item.project).filter((name) => name && name !== '—'))].sort(), [imports]);
  const filtered = useMemo(() => imports.filter((record) => {
    const unlinked = needsAssociation(record);
    if (archiveFilter === 'unlinked' && !unlinked) return false;
    if (archiveFilter === 'linked' && unlinked) return false;
    if (typeFilter && record.type !== typeFilter) return false;
    if (customerFilter && record.customer !== customerFilter) return false;
    if (projectFilter && record.project !== projectFilter) return false;
    return true;
  }), [archiveFilter, customerFilter, imports, projectFilter, typeFilter]);
  const selected = imports.filter((record) => selectedIds.has(record.id) && canSelect(record));
  const selectedAssociable = selected.filter(canAssociate);
  const selectable = filtered.filter(canSelect);
  const allSelected = selectable.length > 0 && selectable.every((record) => selectedIds.has(record.id));

  function toggleSelection(record: ImportRecord) {
    if (selectedIds.has(record.id)) setSelectedIds(new Set([...selectedIds].filter((id) => id !== record.id)));
    else if (selected.length >= 200) onToast('每次最多关联 200 条资料，请分批处理');
    else setSelectedIds(new Set([...selected.map((item) => item.id), record.id]));
  }

  function toggleAll() {
    const next = new Set(selected.map((record) => record.id));
    if (allSelected) selectable.forEach((record) => next.delete(record.id));
    else selectable.forEach((record) => next.add(record.id));
    if (next.size > 200) { onToast('每次最多关联 200 条资料，请缩小筛选范围或逐条选择'); return; }
    setSelectedIds(next);
  }

  async function openAssociation(records: ImportRecord[]) {
    if (!records.length) return;
    if (!online) { onToast('本地服务未连接，暂时无法关联资料'); return; }
    const existingCustomers = new Set(records.map((record) => record.customer).filter((name) => customerLabel(name) !== '未关联'));
    const initialCustomer = existingCustomers.size === 1 ? [...existingCustomers][0] : '';
    const health = await getHealth();
    if (health && (health.apiRevision ?? 0) < 25) { onToast('本地服务版本较旧，请重启服务后关联资料'); return; }
    const [customers, projects] = await Promise.all([fetchCustomers(), fetchProjects()]);
    if (!customers || !projects) { onToast('客户或项目加载失败，请重试'); return; }
    setCustomerOptions(customers);
    setProjectOptions(projects.filter((item) => !item.archived));
    setCustomer(initialCustomer);
    setProject('');
    setAssociating(records);
  }

  async function saveAssociation() {
    if (!associating.length || !customer || busy) return;
    setBusy(true);
    const result = await archiveImports(associating.map((record) => record.id), customer, project);
    if (result) {
      await onRefresh();
      setSelectedIds((current) => new Set([...current].filter((id) => !result.updated.includes(id))));
      setAssociating([]);
      onToast(`${result.updated.length} 条资料已关联到${project ? '客户和项目' : '客户'}`);
    } else onToast('关联失败，请确认资料已处理完成，客户和项目仍然有效');
    setBusy(false);
  }

  async function deleteSelected() {
    if (!selected.length || busy) return;
    setBusy(true);
    const results: Array<{ id: string; deleted: boolean }> = [];
    for (const record of selected) results.push({ id: record.id, deleted: Boolean(await deleteImport(record.id)) });
    const deleted = results.filter((item) => item.deleted).map((item) => item.id);
    setSelectedIds(new Set(results.filter((item) => !item.deleted).map((item) => item.id)));
    setDeleteConfirmOpen(false);
    await onRefresh();
    setBusy(false);
    onToast(deleted.length === results.length ? `已删除 ${deleted.length} 条资料` : `已删除 ${deleted.length} 条，${results.length - deleted.length} 条失败并保留选择`);
  }

  async function saveCustomer(data: Partial<CustomerProfile> & { name: string; tags: string[] }) {
    const created = await createCustomer(data);
    if (!created) { onToast('客户创建失败，请检查名称是否重复'); return false; }
    setCustomerOptions((current) => [...current, created]);
    setCustomer(created.name);
    setProject('');
    onToast('客户已创建');
    return true;
  }

  async function saveProject(data: Partial<ProjectListItem>) {
    const created = await createCustomerProject(customer, data);
    if (!created) { onToast('项目创建失败，请检查名称是否重复'); return false; }
    setProjectOptions((current) => [...current, { ...created, customerCompany: customerOptions.find((item) => item.name === customer)?.company || '', recordCount: 0 }]);
    setProject(created.name);
    onToast('项目已创建');
    return true;
  }

  return (
    <>
      <header className="topbar">
        <div className="crumbs"><strong>资料</strong><span className="badge">{filtered.length} 条</span></div>
        <div className="top-actions">
          <button className="btn primary" onClick={() => onNavigate('导入中心')}>导入资料</button>
        </div>
      </header>
      <div className="materials-workspace">
        <section className="card materials-list">
          <div className="materials-toolbar">
            <div className="segmented materials-status-filter" role="group" aria-label="资料归档状态">
              {([['all', '全部'], ['unlinked', '未关联'], ['linked', '已关联']] as const).map(([key, label]) => (
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
          <div className="materials-batch-actions">
            <label><input type="checkbox" aria-label="全选当前可选资料" checked={allSelected} disabled={!selectable.length || busy} onChange={toggleAll} />全选当前可选资料</label>
            <span>已选 {selected.length} 条 / 最多 200 条</span>
            <button className="btn" disabled={!selected.length || busy} onClick={() => setSelectedIds(new Set())}>清空选择</button>
            <button className="btn primary" disabled={!online || !selectedAssociable.length || busy} onClick={() => void openAssociation(selectedAssociable)}>批量关联{selected.length !== selectedAssociable.length ? `（${selectedAssociable.length}）` : ''}</button>
            <button className="btn danger-text" disabled={!online || !selected.length || busy} onClick={() => setDeleteConfirmOpen(true)}>删除选中</button>
          </div>
          <div className="materials-table" role="table" aria-label="导入资料">
            <div className="materials-table-head" role="row">
              <span role="columnheader">资料</span><span role="columnheader">状态</span><span role="columnheader">客户 / 项目</span><span role="columnheader">导入时间</span><span role="columnheader">操作</span>
            </div>
            {filtered.map((record) => (
              <div className="materials-table-row" role="row" key={record.id}>
                <div className="materials-name-cell" role="cell"><input type="checkbox" aria-label={`选择 ${record.fileName}`} checked={selectedIds.has(record.id) && canSelect(record)} disabled={!online || !canSelect(record) || busy} onChange={() => toggleSelection(record)} /><div className="materials-name"><strong>{record.fileName}</strong><small>{record.type} · {record.size}</small></div></div>
                <span className={`badge ${record.status === 'failed' ? 'danger' : needsAssociation(record) ? 'warn' : record.status === 'processing' ? 'processing' : 'done'}`} role="cell">{processingLabel(record)}</span>
                <div className="materials-association" role="cell"><strong>{customerLabel(record.customer)}</strong><small>{record.project && record.project !== '—' ? record.project : '未关联项目'}</small></div>
                <time role="cell">{record.importedAt}</time>
                <div className="materials-actions" role="cell">{canAssociate(record) && <button className="btn" disabled={!online} onClick={() => void openAssociation([record])}>{needsAssociation(record) ? '关联' : '更改归属'}</button>}<button className="btn" disabled={record.status === 'processing'} onClick={() => onPreview(record)}>预览</button></div>
              </div>
            ))}
            {!filtered.length && <div className="materials-empty">{imports.length ? '没有符合筛选条件的资料' : '尚无导入资料'}{!imports.length && <button className="btn" onClick={() => onNavigate('导入中心')}>导入第一份资料</button>}</div>}
          </div>
        </section>
      </div>
      <Modal open={associating.length > 0 && !customerOpen && !projectOpen} title={associating.length > 1 ? '批量关联资料' : '关联资料'} subtitle={`共 ${associating.length} 条资料，将更新为所选客户和项目归属`} onClose={() => { if (!busy) setAssociating([]); }} className="material-association-modal">
        <div className="material-association-body">
          <div className="material-association-preview"><div><strong>本次关联的资料</strong><span>{associating.length} 条</span></div><ul className="material-association-files">{associating.map((record) => <li key={record.id}>{record.fileName}</li>)}</ul></div>
          <div className="material-association-grid">
            <div className="material-association-field">
              <div className="material-association-label"><label htmlFor="association-customer">客户 <small>必选</small></label><button className="material-association-new" disabled={busy} onClick={() => setCustomerOpen(true)}>＋ 新建客户</button></div>
              <select aria-label="客户" id="association-customer" value={customer} disabled={busy} onChange={(event) => { setCustomer(event.target.value); setProject(''); }}><option value="">请选择客户</option>{customerOptions.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select>
              <p>已关联资料也可更改客户归属。</p>
            </div>
            <div className="material-association-field">
              <div className="material-association-label"><label htmlFor="association-project">项目 <small>选填</small></label><button className="material-association-new" disabled={busy || !customer} onClick={() => setProjectOpen(true)}>＋ 新建项目</button></div>
              <select aria-label="项目" id="association-project" value={project} disabled={busy || !customer} onChange={(event) => setProject(event.target.value)}><option value="">暂不关联项目</option>{projectOptions.filter((item) => item.customer === customer).map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select>
              <p>{!customer ? '先选择客户，再选择该客户下的项目。' : '选择该客户下的项目，或暂不关联项目。'}</p>
            </div>
          </div>
        </div>
        <div className="modal-actions"><button className="btn" onClick={() => setAssociating([])} disabled={busy}>取消</button><button className="btn primary" onClick={() => void saveAssociation()} disabled={busy || !customer}>{busy ? '保存中…' : '确认关联'}</button></div>
      </Modal>
      <Modal open={deleteConfirmOpen} title={`删除 ${selected.length} 条资料？`} subtitle="此操作不可撤销，将删除原始资料以及对应的聊天/转写、需求、待办和附件。" onClose={() => { if (!busy) setDeleteConfirmOpen(false); }}>
        <div className="modal-body"><ul className="material-delete-preview">{selected.slice(0, 8).map((record) => <li key={record.id}>{record.fileName}</li>)}</ul>{selected.length > 8 && <p className="material-delete-more">另有 {selected.length - 8} 条资料</p>}</div>
        <div className="modal-actions"><button className="btn" disabled={busy} onClick={() => setDeleteConfirmOpen(false)}>取消</button><button className="btn danger" disabled={busy} onClick={() => void deleteSelected()}>{busy ? '删除中…' : '永久删除'}</button></div>
      </Modal>
      <CustomerProfileModal open={customerOpen} onClose={() => setCustomerOpen(false)} onSave={saveCustomer} />
      <ProjectModal open={projectOpen} customerName={customer} onClose={() => setProjectOpen(false)} onSave={saveProject} />
    </>
  );
}
