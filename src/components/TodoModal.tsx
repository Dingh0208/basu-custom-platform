import { useEffect, useState } from 'react';
import type { CustomerProfile, ProjectListItem, RequirementItemRecord, TodoRecord } from '../types';
import { fetchCustomers, fetchProjects, fetchCustomerRequirements, saveTodo } from '../api/client';
import Modal from './Modal';

type Props = {
  seed: Partial<TodoRecord> | null;
  onClose: () => void;
  onSaved: () => void;
};

export default function TodoModal({ seed, onClose, onSaved }: Props) {
  const [form, setForm] = useState<Partial<TodoRecord>>({});
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [requirements, setRequirements] = useState<RequirementItemRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!seed) return;
    let live = true;
    setForm({ status: 'todo', project: '—', ...seed });
    setError('');
    setLoading(true);
    Promise.all([fetchCustomers(), fetchProjects()]).then(([cs, ps]) => {
      if (!live) return;
      setCustomers(cs ?? []);
      setProjects(ps ?? []);
      setLoading(false);
      if (!cs || !ps) setError('客户与项目加载失败，请关闭后重试');
      else setForm((current) => ({ ...current, owner: current.owner || ps.find((p) => p.customer === current.customer && p.name === current.project)?.owner || cs.find((c) => c.name === current.customer)?.owner || '' }));
    });
    return () => { live = false; };
  }, [seed]);

  useEffect(() => {
    let live = true;
    setRequirements([]);
    if (form.customer) fetchCustomerRequirements(form.customer).then((data) => { if (live) setRequirements(data ?? []); });
    return () => { live = false; };
  }, [form.customer]);

  function set(key: keyof TodoRecord, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await saveTodo(form, seed?.id);
    setBusy(false);
    if (!result) { setError('保存失败，请确认客户、项目、负责人和截止时间有效，且来源记录仍然存在'); return; }
    onSaved();
    onClose();
  }

  return (
    <Modal open={seed !== null} title={seed?.id ? '编辑待办' : '确认下一步动作'} subtitle="确认负责人和日期后保存；完成待办保留来源记录" onClose={onClose} className="sales-todo-modal">
      <form onSubmit={save}>
        <div className="customer-form-body">
          {loading && <div className="empty-panel">正在加载客户与项目…</div>}
          <div className="customer-form-grid">
            <label className="customer-form-wide">待办标题<input required value={form.title || ''} onChange={(e) => set('title', e.target.value)} autoFocus /></label>
            <label>客户<select required value={form.customer || ''} disabled={!!seed?.sourceId || !!seed?.requirementId} onChange={(e) => setForm((current) => ({ ...current, customer: e.target.value, project: '—', requirementId: '', owner: customers.find((c) => c.name === e.target.value)?.owner || '' }))}>
              <option value="">请选择客户</option>{customers.map((c) => <option key={c.name}>{c.name}</option>)}
            </select></label>
            <label>项目<select value={form.project || '—'} disabled={!!form.requirementId} onChange={(e) => set('project', e.target.value)}>
              <option value="—">不指定项目</option>{projects.filter((p) => p.customer === form.customer).map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select></label>
            <label>关联需求<select value={form.requirementId || ''} disabled={!!seed?.requirementId} onChange={(e) => {
              const req = requirements.find((r) => r.id === e.target.value);
              setForm((current) => ({ ...current, requirementId: req?.id || '', project: req?.project || current.project, owner: req?.owner || current.owner, dueDate: req?.dueDate || current.dueDate, sourceId: req?.sourceId || seed?.sourceId || '', sourceType: req?.sourceType || seed?.sourceType || 'manual', sourceQuote: req?.sourceQuote || seed?.sourceQuote || '' }));
            }}><option value="">不关联需求</option>{requirements.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
            <label>负责人<input required value={form.owner || ''} onChange={(e) => set('owner', e.target.value)} /></label>
            <label>截止时间<input required type="date" value={form.dueDate || ''} onChange={(e) => set('dueDate', e.target.value)} /></label>
            <label>状态<select value={form.status || 'todo'} onChange={(e) => set('status', e.target.value)}><option value="todo">待处理</option><option value="doing">进行中</option><option value="done">已完成</option><option value="cancelled">已取消</option></select></label>
          </div>
          {form.sourceId && <div className="requirement-source"><strong>来源：{form.sourceType === 'chat' ? '聊天解析' : form.sourceType === 'audio' ? '通话摘要' : form.sourceType === 'email' ? '邮件' : form.sourceType === 'file' ? '文件' : '沟通记录'}</strong><p>{form.sourceQuote || '已关联原始记录'}</p></div>}
          {error && <p className="sales-error" role="alert">{error}</p>}
        </div>
        <div className="modal-actions"><button className="btn" type="button" onClick={onClose}>取消</button><button className="btn primary" disabled={busy || loading}>{busy ? '保存中…' : '保存待办'}</button></div>
      </form>
    </Modal>
  );
}
