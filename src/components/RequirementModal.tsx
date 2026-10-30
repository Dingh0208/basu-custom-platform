import { useEffect, useState } from 'react';
import type { CustomerProject, RequirementItemRecord } from '../types';
import Modal from './Modal';

type RequirementModalProps = {
  open: boolean;
  customerName: string;
  projects: CustomerProject[];
  requirement?: RequirementItemRecord | null;
  onClose: () => void;
  onSave: (data: Partial<RequirementItemRecord>) => Promise<boolean>;
  onDelete?: () => Promise<void>;
};

const priorities = ['P0', 'P1', 'P2'];
const statuses = ['待确认', '已确认', '已报价', '已实现'];

export default function RequirementModal({ open, customerName, projects, requirement, onClose, onSave, onDelete }: RequirementModalProps) {
  const [form, setForm] = useState({ title: '', description: '', priority: 'P1', status: '待确认', project: '—' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      title: requirement?.title || '',
      description: requirement?.description || '',
      priority: requirement?.priority || 'P1',
      status: requirement?.status || '待确认',
      project: requirement?.project || '—',
    });
  }, [open, requirement?.id]);

  function set(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    const ok = await onSave({
      title: form.title.trim(),
      description: form.description.trim(),
      priority: form.priority,
      status: form.status,
      project: form.project,
    });
    setSaving(false);
    if (ok) onClose();
  }

  async function remove() {
    if (!onDelete) return;
    if (!window.confirm(`确定删除需求「${requirement?.title}」？`)) return;
    await onDelete();
    onClose();
  }

  return (
    <Modal open={open} title={requirement ? '编辑需求' : '新建需求'} subtitle={`客户：${customerName} · 需求可关联到项目并追踪状态`} onClose={onClose} className="requirement-modal">
      <div className="customer-form-body">
        <div className="customer-form-grid">
          <label>需求标题<input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="例如：会员积分与复购体系" /></label>
          <label>关联项目<select value={form.project} onChange={(e) => set('project', e.target.value)}>
            <option value="—">不指定项目</option>
            {projects.map((project) => <option key={project.id} value={project.name}>{project.name}</option>)}
          </select></label>
          <label>优先级<select value={form.priority} onChange={(e) => set('priority', e.target.value)}>{priorities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>状态<select value={form.status} onChange={(e) => set('status', e.target.value)}>{statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        </div>
        <label className="customer-form-wide">需求描述<textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="需求目标、范围、验收标准……" /></label>
        {requirement && (
          <div className="requirement-source">
            <div><span>来源</span><strong>{requirement.sourceType === 'audio' ? '通话摘要' : requirement.sourceType === 'chat' ? '聊天解析' : requirement.sourceType === 'email' ? '邮件' : '手动录入'}</strong></div>
            {requirement.sourceTime && <div><span>时间</span><strong>{requirement.sourceTime}</strong></div>}
            {requirement.sourceQuote && <div className="requirement-source-quote"><span>原文</span><strong>{requirement.sourceQuote}</strong></div>}
          </div>
        )}
      </div>
      <div className="modal-actions">
        {requirement && onDelete && <button className="btn danger-btn" style={{ marginRight: 'auto' }} onClick={remove}>删除需求</button>}
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={save} disabled={saving || !form.title.trim()}>{saving ? '保存中…' : '保存需求'}</button>
      </div>
    </Modal>
  );
}
