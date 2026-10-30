import { useEffect, useState } from 'react';
import type { CustomerProject } from '../types';
import Modal from './Modal';

type ProjectModalProps = {
  open: boolean;
  customerName: string;
  project?: CustomerProject | null;
  onClose: () => void;
  onSave: (data: Partial<CustomerProject>) => Promise<boolean>;
  onDelete?: () => Promise<void>;
};

const stages = ['需求', '报价', '方案', '签约', '交付'];

export default function ProjectModal({ open, customerName, project, onClose, onSave, onDelete }: ProjectModalProps) {
  const [form, setForm] = useState({ name: '', stage: '需求', budget: '', targetLaunchDate: '', owner: '', description: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: project?.name || '',
      stage: project?.stage || '需求',
      budget: project?.budget === '—' ? '' : project?.budget || '',
      targetLaunchDate: project?.targetLaunchDate || '',
      owner: project?.owner || '王总',
      description: project?.description || '',
    });
  }, [open, project?.id]);

  function set(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    const ok = await onSave({
      name: form.name.trim(),
      stage: form.stage,
      budget: form.budget.trim() || '—',
      targetLaunchDate: form.targetLaunchDate,
      owner: form.owner.trim() || '王总',
      description: form.description.trim(),
    });
    setSaving(false);
    if (ok) onClose();
  }

  async function remove() {
    if (!onDelete) return;
    if (!window.confirm(`确定删除项目「${project?.name}」？关联记录会保留在客户时间线，但项目字段会变为“—”。`)) return;
    await onDelete();
    onClose();
  }

  return (
    <Modal open={open} title={project ? '编辑项目' : '新建项目'} subtitle={`客户：${customerName} · 项目用于聚合预算、阶段、时间和关联沟通`} onClose={onClose} className="project-modal">
      <div className="customer-form-body">
        <div className="customer-form-grid">
          <label>项目名称<input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例如：会员小程序商城" /></label>
          <label>当前阶段<select value={form.stage} onChange={(e) => set('stage', e.target.value)}>{stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></label>
          <label>预算<input value={form.budget} onChange={(e) => set('budget', e.target.value)} placeholder="例如：8–10 万" /></label>
          <label>目标上线时间<input type="date" value={form.targetLaunchDate} onChange={(e) => set('targetLaunchDate', e.target.value)} /></label>
          <label>负责人<input value={form.owner} onChange={(e) => set('owner', e.target.value)} placeholder="例如：王总" /></label>
        </div>
        <label className="customer-form-wide">项目说明<textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="项目目标、范围、关键约束……" /></label>
      </div>
      <div className="modal-actions">
        {project && onDelete && <button className="btn danger-btn" style={{ marginRight: 'auto' }} onClick={remove}>删除项目</button>}
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={save} disabled={saving || !form.name.trim()}>{saving ? '保存中…' : '保存项目'}</button>
      </div>
    </Modal>
  );
}
