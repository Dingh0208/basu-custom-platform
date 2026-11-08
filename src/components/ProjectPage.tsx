import { useEffect, useMemo, useRef, useState } from 'react';
import type { CustomerProfile, ProjectListItem } from '../types';
import { createCustomerProject, deleteCustomerProject, fetchCustomers, fetchProjects, updateCustomerProject } from '../api/client';
import ProjectModal from './ProjectModal';
import { IconSearch } from './Icons';

// 过滤掉已归档的项目
function filterActiveProjects<T extends { archived?: boolean }>(projects: T[]): T[] {
  return projects.filter(p => !p.archived);
}

type ProjectPageProps = {
  initialProject?: string;
  onToast: (message: string) => void;
  onCustomer: (customer: string) => void;
  onClarification: (customer: string, project: string) => void;
};

export default function ProjectPage({ initialProject, onToast, onCustomer, onClarification }: ProjectPageProps) {
  const openedInitial = useRef(false);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [query, setQuery] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectListItem | null>(null);
  const [newCustomer, setNewCustomer] = useState('');
  const customerPickerRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    const [projectData, customerData] = await Promise.all([fetchProjects(), fetchCustomers()]);
    // 过滤掉已归档的项目
    setProjects(filterActiveProjects(projectData ?? []));
    const nextCustomers = customerData ?? [];
    setCustomers(nextCustomers);
    setCustomerFilter((current) => current && nextCustomers.some((customer) => customer.name === current) ? current : '');
  }

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!initialProject || openedInitial.current) return;
    const project = projects.find((item) => item.id === initialProject);
    if (project) { openedInitial.current = true; setEditingProject(project); setModalOpen(true); }
  }, [initialProject, projects]);

  useEffect(() => {
    const handleFocus = () => { void refresh(); };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!customerPickerRef.current?.contains(event.target as Node)) setCustomerPickerOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const filtered = useMemo(
    () => projects.filter((project) => !project.archived
      && (!customerFilter || project.customer === customerFilter)
      && (!query.trim() || `${project.name}${project.customer}${project.customerCompany}${project.stage}${project.owner}`.toLowerCase().includes(query.trim().toLowerCase()))),
    [customerFilter, projects, query],
  );

  const visibleCustomers = useMemo(() => {
    const normalized = customerSearch.trim().toLowerCase();
    if (!normalized) return customers;
    return customers.filter((customer) => `${customer.name}${customer.company}`.toLowerCase().includes(normalized));
  }, [customerSearch, customers]);

  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects) counts.set(project.customer, (counts.get(project.customer) ?? 0) + 1);
    return counts;
  }, [projects]);

  function selectCustomer(name: string) {
    setCustomerFilter(name);
    setCustomerPickerOpen(false);
    setCustomerSearch('');
  }

  async function saveProject(data: Partial<ProjectListItem>) {
    const result = editingProject
      ? await updateCustomerProject(editingProject.id, data)
      : await createCustomerProject(newCustomer, data);
    if (!result) {
      onToast('项目保存失败');
      return false;
    }
    await refresh();
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
    await refresh();
    onToast('项目已删除，关联沟通记录保留在客户时间线');
  }

  return (
    <>
      <header className="topbar">
        <div className="crumbs"><strong>项目</strong><span className="badge done">{filtered.length} 个项目</span></div>
        <div className="top-actions">
          <div className="project-customer-picker" ref={customerPickerRef}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setCustomerPickerOpen(false); }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setCustomerPickerOpen(false);
                customerPickerRef.current?.querySelector('button')?.focus();
              }
            }}
          >
            <button
              type="button"
              className="project-customer-trigger"
              aria-haspopup="dialog"
              aria-expanded={customerPickerOpen}
              aria-label={`按客户筛选项目：${customerFilter || '全部项目'}`}
              onClick={() => { setCustomerSearch(''); setCustomerPickerOpen((open) => !open); }}
            >
              <span>{customerFilter || '全部项目'}</span><span className="project-customer-chevron" aria-hidden="true" />
            </button>
            {customerPickerOpen && (
              <div className="project-customer-menu" role="dialog" aria-label="按客户筛选项目">
                <div className="project-customer-search search-box">
                  <IconSearch size={14} />
                  <input autoFocus value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="搜索客户" aria-label="搜索客户" />
                </div>
                <div className="project-customer-options" role="listbox" aria-label="客户">
                  <button type="button" role="option" aria-selected={!customerFilter} className={!customerFilter ? 'selected' : ''} onClick={() => selectCustomer('')}>
                    <span>全部项目</span><small>{projects.length}</small>
                  </button>
                  {visibleCustomers.map((customer) => (
                    <button type="button" role="option" aria-selected={customerFilter === customer.name} className={customerFilter === customer.name ? 'selected' : ''} key={customer.name} onClick={() => selectCustomer(customer.name)}>
                      <span><strong>{customer.name}</strong><small>{customer.company || '—'}</small></span>
                      <small>{projectCounts.get(customer.name) ?? 0}</small>
                    </button>
                  ))}
                  {!visibleCustomers.length && <div className="project-customer-empty">没有匹配的客户</div>}
                </div>
              </div>
            )}
          </div>
          <button className="btn primary" onClick={() => { setEditingProject(null); setNewCustomer(customerFilter); setModalOpen(true); }} disabled={!customers.length}>+ 新建项目</button>
        </div>
      </header>

      <div className="project-workspace">
        <section className="card project-list-card">
          <div className="card-head">
            <div><div className="card-title">{customerFilter ? `${customerFilter}的项目` : '全部项目'}</div><div className="card-sub">项目与客户档案双向同步；修改项目会更新客户 360</div></div>
            <div className="search-box" style={{ marginLeft: 'auto' }}><IconSearch size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索项目 / 客户 / 阶段 / 负责人" /></div>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table className="table">
              <thead><tr><th>项目</th><th>客户</th><th>阶段</th><th>预算</th><th>目标上线</th><th>负责人</th><th>最近沟通</th><th>沟通/需求</th><th>操作</th></tr></thead>
              <tbody>
                {filtered.map((project) => (
                  <tr key={project.id}>
                    <td><strong>{project.name}</strong></td>
                    <td><button className="requirement-title-btn" onClick={() => onCustomer(project.customer)}>{project.customer}</button><div className="file-cell-sub">{project.customerCompany}</div></td>
                    <td><span className="pill blue">{project.stage}</span></td>
                    <td>{project.budget || '—'}</td>
                    <td>{project.targetLaunchDate || '—'}</td>
                    <td>{project.owner || '—'}</td>
                    <td>{project.lastAt || '—'}</td>
                    <td>{project.recordCount} / {project.requirementCount ?? 0}</td>
                    <td><button className="btn" style={{ height: 24, padding: '0 7px', fontSize: 10 }} onClick={() => { setEditingProject(project); setModalOpen(true); }}>编辑</button></td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={9}><div className="empty-panel">{query.trim() ? '没有符合搜索条件的项目' : customerFilter ? `${customerFilter}暂无项目，可点击右上角新建` : '暂无项目；可在客户档案中创建，或点击右上角新建'}</div></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <ProjectModal
        open={modalOpen}
        customerName={editingProject?.customer || newCustomer}
        customerOptions={customers}
        onCustomerChange={editingProject ? undefined : setNewCustomer}
        project={editingProject}
        onClose={() => setModalOpen(false)}
        onSave={saveProject}
        onDelete={editingProject ? removeProject : undefined}
        onClarification={editingProject ? () => onClarification(editingProject.customer, editingProject.name) : undefined}
      />
    </>
  );
}
