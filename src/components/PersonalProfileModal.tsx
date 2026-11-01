import { useEffect, useState } from 'react';
import type { PersonalProfile } from '../types';
import { fetchPersonalProfile, savePersonalProfile } from '../api/client';
import Modal from './Modal';

export const defaultProfile: PersonalProfile = { name: '王总', role: '产品负责人', company: '', phone: '', email: '' };

export default function PersonalProfileModal({ open, profile, onClose, onSaved }: { open: boolean; profile: PersonalProfile; onClose: () => void; onSaved: (profile: PersonalProfile) => void }) {
  const [form, setForm] = useState(profile);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setForm(profile);
    setLoading(true);
    setError('');
    fetchPersonalProfile().then((data) => {
      if (!live) return;
      setLoading(false);
      if (data) setForm(data);
      else setError('个人信息加载失败，请检查本地服务后重试');
    });
    return () => { live = false; };
  }, [open, profile, version]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError('');
    const result = await savePersonalProfile(form);
    setSaving(false);
    if (!result) { setError('保存失败，请检查本地服务连接后重试'); return; }
    onSaved(result);
    onClose();
  }

  return <Modal open={open} title="个人信息" subtitle="保存在本机，姓名首字会显示为头像" onClose={onClose} className="personal-profile-modal">
    <form onSubmit={save}>
      <div className="customer-form-body">
        <div className="profile-preview"><span className="avatar">{form.name.trim().slice(0, 1) || '我'}</span><div><strong>{form.name || '我的信息'}</strong><small>{form.role || '填写职位'}{form.company ? ` · ${form.company}` : ''}</small></div></div>
        {loading && <p role="status">正在加载个人信息…</p>}
        <fieldset disabled={loading || saving} className="profile-fields customer-form-grid">
          {([['name', '姓名'], ['role', '职位'], ['company', '公司'], ['phone', '手机号'], ['email', '邮箱']] as const).map(([key, label]) => <label key={key}>{label}<input type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} required={key === 'name'} maxLength={120} value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
        </fieldset>
        {error && <div className="sales-error" role="alert">{error}<button type="button" className="btn ghost" onClick={() => setVersion((v) => v + 1)}>重新加载</button></div>}
      </div>
      <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={loading || saving || !form.name.trim()}>{saving ? '保存中…' : '保存个人信息'}</button></div>
    </form>
  </Modal>;
}
