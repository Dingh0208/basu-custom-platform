import { useEffect, useMemo, useState } from 'react';
import type { CustomerProfile, CustomerProject, CustomerTimelineEntry, ImportRecord } from '../types';
import {
  createCustomer,
  createCustomerProject,
  deleteCustomer,
  deleteCustomerProject,
  fetchCustomerProjects,
  fetchCustomerTimeline,
  fetchCustomers,
  mergeCustomers,
  updateCustomer,
  updateCustomerProject,
} from '../api/client';
import { IconChat, IconFile, IconMic, IconSearch, IconUsers } from './Icons';
import CustomerProfileModal from './CustomerProfileModal';
import ProjectModal from './ProjectModal';
import Modal from './Modal';

type CustomerListProps = {
  imports: ImportRecord[];
  onOpenRecord: (record: ImportRecord) => void;
  onToast: (message: string) => void;
  onRefreshImports: () => Promise<void>;
};

function fallbackProfiles(imports: ImportRecord[]): CustomerProfile[] {
  const map = new Map<string, CustomerProfile>();
  for (const record of imports) {
    if (record.customer === '待归档' || record.status === 'failed') continue;
    const existing = map.get(record.customer);
    if (!existing) {
      map.set(record.customer, {
        name: record.customer,
        company: record.customer === '张三' ? '某某科技有限公司' : '—',
        position: '',
        phone: '',
        wechat: '',
        email: '',
        tags: [],
        sourceChannel: '',
        owner: '王总',
        notes: '',
        recordCount: 1,
        lastAt: record.importedAt,
        project: record.project,
      });
    } else {
      existing.recordCount += 1;
      if (record.importedAt > existing.lastAt) existing.lastAt = record.importedAt;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.recordCount - a.recordCount);
}

export default function CustomerList({ imports, onOpenRecord, onToast, onRefreshImports }: CustomerListProps) {
  const [query, setQuery] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(() => new URLSearchParams(window.location.search).get('customer'));
  const [customers, setCustomers] = useState<CustomerProfile[]>(() => fallbackProfiles(imports));
  const [timeline, setTimeline] = useState<CustomerTimelineEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [projects, setProjects] = useState<CustomerProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<CustomerProject | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerProfile | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const fallback = useMemo(() => fallbackProfiles(imports), [imports]);

  async function refreshCustomers(preferredName?: string) {
    const data = await fetchCustomers();
    if (data) {
      setCustomers(data);
      if (preferredName) setSelectedName(preferredName);
    } else {
      setCustomers(fallback);
    }
  }

  useEffect(() => {
    let mounted = true;
    fetchCustomers().then((data) => {
      if (mounted && data) setCustomers(data);
    });
    return () => { mounted = false; };
  }, [imports.length]);

  const filtered = customers.filter((c) => !query.trim() || `${c.name}${c.company}${c.position}${c.project}${c.tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = customers.find((c) => c.name === selectedName) ?? filtered[0] ?? null;
  const selectedRecords = selected ? imports.filter((record) => record.customer === selected.name) : [];

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
        setTimeline(selectedRecords.map((record) => ({
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
    return () => { mounted = false; };
  }, [selected?.name]);

  useEffect(() => {
    if (!selected) {
      setProjects([]);
      return;
    }
    let mounted = true;
    setProjectsLoading(true);
    fetchCustomerProjects(selected.name).then((data) => {
      if (!mounted) return;
      setProjects(data ?? []);
      setProjectsLoading(false);
    });
    return () => { mounted = false; };
  }, [selected?.name]);

  function openTimelineEntry(entry: CustomerTimelineEntry) {
    const record = imports.find((item) => item.id === entry.id);
    if (record) onOpenRecord(record);
    else onToast('对应记录暂时不可打开');
  }

  function openProjectRecord(projectId: string, recordId: string) {
    const record = imports.find((item) => item.id === recordId);
    if (record) onOpenRecord(record);
    else onToast(`项目 ${projectId} 的记录暂时不可打开`);
  }

  async function refreshProjects() {
    if (!selected) return;
    const data = await fetchCustomerProjects(selected.name);
    setProjects(data ?? []);
  }

  async function saveProject(data: Partial<CustomerProject>) {
    if (!selected) return false;
    const result = editingProject
      ? await updateCustomerProject(editingProject.id, data)
      : await createCustomerProject(selected.name, data);
    if (!result) {
      onToast('项目保存失败');
      return false;
    }
    await refreshProjects();
    onToast(editingProject ? '项目已更新' : '项目已创建');
    return true;
  }

  async function removeProject() {
    if (!editingProject) return;
    const result = await deleteCustomerProject(editingProject.id);
    if (!result) {
      onToast('项目删除失败');
      return;
    }
    await refreshProjects();
    onToast('项目已删除，关联记录保留在客户时间线');
  }

  async function saveProfile(data: Partial<CustomerProfile> & { name: string; tags: string[] }) {
    const result = editingCustomer
      ? await updateCustomer(editingCustomer.name, data)
      : await createCustomer(data);
    if (!result) {
      onToast('客户档案保存失败');
      return false;
    }
    await refreshCustomers(result.name);
    await onRefreshImports();
    onToast(editingCustomer ? '客户档案已更新' : '客户已创建');
    return true;
  }

  async function handleMerge() {
    if (!selected || !mergeTarget || mergeTarget === selected.name) {
      onToast('请选择不同的目标客户');
      return;
    }
    setBusy(true);
    const result = await mergeCustomers(selected.name, mergeTarget);
    setBusy(false);
    if (!result) {
      onToast('客户合并失败');
      return;
    }
    await refreshCustomers(result.name);
    await onRefreshImports();
    setMergeOpen(false);
    setMergeTarget('');
    onToast(`已合并到「${result.name}」`);
  }

  async function handleDelete() {
    if (!selected) return;
    setBusy(true);
    const result = await deleteCustomer(selected.name);
    setBusy(false);
    if (!result) {
      onToast('客户删除失败');
      return;
    }
    setDeleteOpen(false);
    setSelectedName(null);
    await refreshCustomers();
    await onRefreshImports();
    onToast(`已删除「${selected.name}」及 ${result.records} 条记录`);
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
          <button className="btn primary" onClick={() => { setEditingCustomer(null); setProfileOpen(true); }}>+ 新建客户</button>
        </div>
      </header>

      <div className="customer-workspace">
        <section className="card customer-list-card">
          <div className="card-head">
            <div><div className="card-title">客户列表</div><div className="card-sub">按记录数量排序 · 支持客户档案管理</div></div>
            <div className="search-box" style={{ marginLeft: 'auto' }}>
              <IconSearch size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索客户 / 公司 / 职位 / 标签" />
            </div>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table className="table">
              <thead><tr><th>客户</th><th>公司</th><th>职位</th><th>当前项目</th><th>最近沟通</th><th>记录数</th><th>状态</th></tr></thead>
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
                    <td>{customer.company || '—'}</td>
                    <td>{customer.position || '—'}</td>
                    <td>{customer.project || '—'}</td>
                    <td>{customer.lastAt || '—'}</td>
                    <td>{customer.recordCount}</td>
                    <td><span className={`badge ${customer.recordCount > 0 ? 'done' : 'warn'}`}>{customer.recordCount > 0 ? '跟进中' : '新客户'}</span></td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7}><div className="empty-panel">没有找到匹配的客户</div></td></tr>
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
                  <div className="customer-side-company">{selected.company || '—'}{selected.position ? ` · ${selected.position}` : ''}</div>
                </div>
              </div>
              <div className="customer-side-actions">
                <button className="btn" onClick={() => { setEditingCustomer(selected); setProfileOpen(true); }}>编辑档案</button>
                <button className="btn" onClick={() => { setMergeTarget(''); setMergeOpen(true); }}>合并客户</button>
                <button className="btn danger-btn" onClick={() => setDeleteOpen(true)}>删除客户</button>
              </div>
              <div className="customer-side-tags">
                <span className="pill blue">客户档案</span>
                <span className="pill">最近 {selected.lastAt || '—'}</span>
                <span className="pill">{timeline.length} 条沟通</span>
                {callCount > 0 && <span className="pill">通话 {callCount}</span>}
                {chatCount > 0 && <span className="pill">聊天 {chatCount}</span>}
                {fileCount > 0 && <span className="pill">文件 {fileCount}</span>}
                {selected.tags.map((tag) => <span className="pill" key={tag}>{tag}</span>)}
              </div>
              <div className="customer-profile-lines">
                <div><span>职位</span><strong>{selected.position || '—'}</strong></div>
                <div><span>手机号</span><strong>{selected.phone || '—'}</strong></div>
                <div><span>微信号</span><strong>{selected.wechat || '—'}</strong></div>
                <div><span>邮箱</span><strong>{selected.email || '—'}</strong></div>
                <div><span>来源</span><strong>{selected.sourceChannel || '—'}</strong></div>
                <div><span>负责人</span><strong>{selected.owner || '—'}</strong></div>
                {selected.notes && <div className="customer-notes"><span>备注</span><strong>{selected.notes}</strong></div>}
              </div>
              <div className="customer-side-section">
                <div className="customer-side-label project-section-label">
                  <span>项目</span>
                  <button className="btn ghost project-add-btn" onClick={() => { setEditingProject(null); setProjectOpen(true); }}>+ 新建项目</button>
                </div>
                {projectsLoading ? (
                  <div className="empty-panel">正在加载项目…</div>
                ) : projects.length === 0 ? (
                  <div className="empty-panel">还没有项目，点击“新建项目”建立项目卡</div>
                ) : (
                  <div className="project-list">
                    {projects.map((project) => (
                      <div className="project-card" key={project.id}>
                        <div className="project-card-head">
                          <div className="project-card-name">{project.name}</div>
                          <button className="icon-btn" title="编辑项目" onClick={() => { setEditingProject(project); setProjectOpen(true); }}>✎</button>
                        </div>
                        <div className="project-card-meta">
                          <span className="pill blue">{project.stage || '需求'}</span>
                          <span className="project-last">最近 {project.lastAt || '—'}</span>
                        </div>
                        <div className="project-fields">
                          <div><span>预算</span><strong>{project.budget || '—'}</strong></div>
                          <div><span>目标上线</span><strong>{project.targetLaunchDate || '—'}</strong></div>
                          <div><span>负责人</span><strong>{project.owner || '—'}</strong></div>
                        </div>
                        <div className="project-counts">
                          <span>通话 {project.counts.calls}</span>
                          <span>聊天 {project.counts.chats}</span>
                          <span>文件 {project.counts.files}</span>
                        </div>
                        {project.records.length > 0 && (
                          <div className="project-records">
                            {project.records.slice(0, 4).map((record) => (
                              <button key={record.id} className="project-record-chip" onClick={() => openProjectRecord(project.id, record.id)}>
                                {record.kind === 'audio' ? <IconMic size={10} /> : record.kind === 'chat' ? <IconChat size={10} /> : <IconFile size={10} />}
                                {record.type === '音频' ? '通话' : record.type === '聊天记录' ? '聊天' : '文件'} · {record.importedAt}
                              </button>
                            ))}
                            {project.records.length > 4 && <span className="project-more">+{project.records.length - 4} 条</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
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

      <CustomerProfileModal
        open={profileOpen}
        customer={editingCustomer}
        onClose={() => setProfileOpen(false)}
        onSave={saveProfile}
      />

      <ProjectModal
        open={projectOpen}
        customerName={selected?.name || ''}
        project={editingProject}
        onClose={() => setProjectOpen(false)}
        onSave={saveProject}
        onDelete={editingProject ? removeProject : undefined}
      />

      <Modal open={mergeOpen} title="合并客户" subtitle="合并后源客户的所有沟通记录会迁移到目标客户" onClose={() => setMergeOpen(false)}>
        <div className="modal-body">
          <div className="customer-merge-source">当前客户：<strong>{selected?.name}</strong></div>
          <label className="customer-form-wide">合并到
            <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
              <option value="">请选择目标客户</option>
              {customers.filter((customer) => customer.name !== selected?.name).map((customer) => (
                <option key={customer.name} value={customer.name}>{customer.name} · {customer.company}</option>
              ))}
            </select>
          </label>
          <div className="small-note" style={{ marginTop: 10 }}>源客户档案会被删除，所有导入记录、聊天、转写稿会迁移到目标客户；空字段会用源客户资料补齐。</div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => setMergeOpen(false)}>取消</button>
          <button className="btn primary" onClick={handleMerge} disabled={busy || !mergeTarget}>{busy ? '合并中…' : '确认合并'}</button>
        </div>
      </Modal>

      <Modal open={deleteOpen} title="删除客户" subtitle="此操作不可撤销" onClose={() => setDeleteOpen(false)}>
        <div className="modal-body">
          <div className="customer-merge-source">确定删除客户：<strong>{selected?.name}</strong>？</div>
          <div className="small-note" style={{ marginTop: 10 }}>会同时删除该客户名下的所有导入记录、聊天记录和转写稿。若只是重复客户，请优先使用“合并客户”。</div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => setDeleteOpen(false)}>取消</button>
          <button className="btn danger-btn" onClick={handleDelete} disabled={busy}>{busy ? '删除中…' : '确认删除'}</button>
        </div>
      </Modal>
    </>
  );
}
