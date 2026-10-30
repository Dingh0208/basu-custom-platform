import { useEffect, useState } from 'react';
import type { CustomerProfile } from '../types';
import Modal from './Modal';

type CustomerProfileModalProps = {
  open: boolean;
  customer?: CustomerProfile | null;
  onClose: () => void;
  onSave: (data: Partial<CustomerProfile> & { name: string; tags: string[] }) => Promise<boolean>;
};

const empty = {
  name: '',
  company: '',
  position: '',
  phone: '',
  wechat: '',
  email: '',
  tagsText: '',
  sourceChannel: '',
  owner: '',
  notes: '',
};

export default function CustomerProfileModal({ open, customer, onClose, onSave }: CustomerProfileModalProps) {
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(customer ? {
      name: customer.name,
      company: customer.company === '—' ? '' : customer.company,
      position: customer.position || '',
      phone: customer.phone || '',
      wechat: customer.wechat || '',
      email: customer.email || '',
      tagsText: (customer.tags || []).join('，'),
      sourceChannel: customer.sourceChannel || '',
      owner: customer.owner || '',
      notes: customer.notes || '',
    } : { ...empty });
  }, [open, customer?.name]);

  function set(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    const tags = form.tagsText.split(/[，,]/).map((item) => item.trim()).filter(Boolean);
    const ok = await onSave({
      name: form.name.trim(),
      company: form.company.trim() || '—',
      position: form.position.trim(),
      phone: form.phone.trim(),
      wechat: form.wechat.trim(),
      email: form.email.trim(),
      tags,
      sourceChannel: form.sourceChannel.trim(),
      owner: form.owner.trim(),
      notes: form.notes.trim(),
    });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal open={open} title={customer ? '编辑客户档案' : '新建客户'} subtitle="这些信息会用于客户匹配、客户 360 和后续沟通归属" onClose={onClose} className="customer-profile-modal">
      <div className="customer-form-body">
        <div className="customer-form-grid">
          <label>客户姓名<input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例如：张三" /></label>
          <label>公司<input value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="例如：某某科技有限公司" /></label>
          <label>职位<input value={form.position} onChange={(e) => set('position', e.target.value)} placeholder="例如：运营负责人" /></label>
          <label>手机号<input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="手机号" /></label>
          <label>微信号<input value={form.wechat} onChange={(e) => set('wechat', e.target.value)} placeholder="微信号" /></label>
          <label>邮箱<input value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="name@company.com" /></label>
          <label>来源渠道<input value={form.sourceChannel} onChange={(e) => set('sourceChannel', e.target.value)} placeholder="电话 / 微信 / 邮件 / 转介绍" /></label>
          <label>负责人<input value={form.owner} onChange={(e) => set('owner', e.target.value)} placeholder="例如：王总" /></label>
        </div>
        <label className="customer-form-wide">客户标签<input value={form.tagsText} onChange={(e) => set('tagsText', e.target.value)} placeholder="用逗号分隔，例如：会员、重点客户、二次复购" /></label>
        <label className="customer-form-wide">客户备注<textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="补充客户背景、偏好、注意事项……" /></label>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={handleSave} disabled={saving || !form.name.trim()}>{saving ? '保存中…' : '保存客户'}</button>
      </div>
    </Modal>
  );
}
