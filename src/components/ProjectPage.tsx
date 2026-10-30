import { useEffect, useMemo, useState } from 'react';
import type { CustomerProfile, ProjectListItem } from '../types';
import { createCustomerProject, deleteCustomerProject, fetchCustomers, fetchProjects, updateCustomerProject } from '../api/client';
import ProjectModal from './ProjectModal';
import { IconSearch } from './Icons';

type ProjectPageProps = {
  onToast: (message: string) => void;
};

export default function ProjectPage({ onToast }: ProjectPageProps) {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectListItem | null>(null);
  const [newCustomer, setNewCustomer] = useState('');

  async function refresh() {
    const [projectData, customerData] = await Promise.all([fetchProjects(), fetchCustomers()]);
    setProjects(projectData ?? []);
    setCustomers(customerData ?? []);
    if (!newCustomer && customerData?.length) setNewCustomer(customerData[0].name);
  }

  useEffect(() => { refresh(); }, []);

  const filtered = useMemo(
    () => projects.filter((project) => !query.trim() || `${project.name}${project.customer}${project.customerCompany}${project.stage}${project.owner}`.toLowerCase().includes(query.trim().toLowerCase())),
    [projects, query],
  );

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
        <div className="crumbs"><strong>项目</strong><span className="badge done">{projects.length} 个项目</span></div>
        <div className="top-actions">
          <select className="select" value={newCustomer} onChange={(e) => setNewCustomer(e.target.value)} style={{ height: 30, marginRight: 6 }}>
            {customers.map((customer) => <option key={customer.name} value={customer.name}>{customer.name} · {customer.company}</option>)}
          </select>
          <button className="btn primary" onClick={() => { setEditingProject(null); setModalOpen(true); }} disabled={!newCustomer}>+ 新建项目</button>
        </div>
      </header>

      <div className="project-workspace">
        <section className="card project-list-card">
          <div className="card-head">
            <div><div className="card-title">全部项目</div><div className="card-sub">项目与客户档案双向同步；修改项目会更新客户 360</div></div>
            <div className="search-box" style={{ marginLeft: 'auto' }}><IconSearch size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索项目 / 客户 / 阶段 / 负责人" /></div>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table className="table">
              <thead><tr><th>项目</th><th>客户</th><th>阶段</th><th>预算</th><th>目标上线</th><th>负责人</th><th>最近沟通</th><th>沟通/需求</th><th>操作</th></tr></thead>
              <tbody>
                {filtered.map((project) => (
                  <tr key={project.id}>
                    <td><strong>{project.name}</strong></td>
                    <td>{project.customer}<div className="file-cell-sub">{project.customerCompany}</div></td>
                    <td><span className="pill blue">{project.stage}</span></td>
                    <td>{project.budget || '—'}</td>
                    <td>{project.targetLaunchDate || '—'}</td>
                    <td>{project.owner || '—'}</td>
                    <td>{project.lastAt || '—'}</td>
                    <td>{project.recordCount} / {project.requirementCount ?? 0}</td>
                    <td><button className="btn" style={{ height: 24, padding: '0 7px', fontSize: 10 }} onClick={() => { setEditingProject(project); setModalOpen(true); }}>编辑</button></td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={9}><div className="empty-panel">暂无项目；可在客户档案中创建，或点击右上角新建</div></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <ProjectModal
        open={modalOpen}
        customerName={editingProject?.customer || newCustomer}
        project={editingProject}
        onClose={() => setModalOpen(false)}
        onSave={saveProject}
        onDelete={editingProject ? removeProject : undefined}
      />
    </>
  );
}
