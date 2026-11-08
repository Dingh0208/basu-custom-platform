import { useEffect, useState } from 'react';
import type { MailConfig, MailMessage } from '../types';
import { discoverMailMessages, fetchMailConfig, fetchMailMessages, fetchTask, fetchTasks } from '../api/client';
import Modal from './Modal';

type MailImportModalProps = {
  open: boolean;
  onClose: () => void;
  onSelected: (email: string, messages: MailMessage[]) => void;
};

export default function MailImportModal({ open, onClose, onSelected }: MailImportModalProps) {
  const [config, setConfig] = useState<MailConfig | null>(null);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [selected, setSelected] = useState<Record<string, MailMessage>>({});
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const selectedMessages = Object.values(selected);
  const keyOf = (item: MailMessage) => `${item.uidValidity}:${item.uid}`;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setSelected({});
    setQuery('');
    setOffset(0);
    setMessage('');
    void Promise.all([fetchMailConfig(), fetchTasks()]).then(([value, tasks]) => {
      if (!active) return;
      setConfig(value);
      const running = tasks?.find((task) => task.kind === 'mail_discover' && (task.status === 'queued' || task.status === 'running'));
      setTaskId(running?.id ?? null);
      setRefresh((current) => current + 1);
    });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const result = await fetchMailMessages(query, offset);
      if (!active) return;
      setLoading(false);
      if (!result) {
        setMessages([]);
        setTotal(0);
        setMessage('邮件列表加载失败，请更新并重启本地服务后重试');
        return;
      }
      setMessages(result.messages);
      setTotal(result.total);
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, query, offset, refresh]);

  useEffect(() => {
    if (!open || !taskId) return;
    let active = true;
    let timer = 0;
    let failures = 0;
    const poll = async () => {
      const task = await fetchTask(taskId);
      if (!active) return;
      if (!task && ++failures >= 5) {
        setTaskId(null);
        setMessage('暂时无法读取进度，请检查本地服务后重新打开邮件列表');
        return;
      }
      if (task) {
        failures = 0;
        setMessage(task.error || task.stage || '正在读取邮件列表…');
        if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled') {
          setTaskId(null);
          setRefresh((current) => current + 1);
          return;
        }
      }
      timer = window.setTimeout(poll, 1000);
    };
    void poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, taskId]);

  async function discover() {
    setStarting(true);
    setMessage('正在连接邮箱，读取邮件列表…');
    const result = await discoverMailMessages();
    setStarting(false);
    if (!result?.taskId) {
      setMessage('无法刷新，请先配置邮箱，或等待其他邮箱任务完成');
      return;
    }
    setTaskId(result.taskId);
  }

  function toggle(item: MailMessage) {
    const key = keyOf(item);
    setSelected((current) => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else if (Object.keys(next).length < 100) next[key] = item;
      return next;
    });
  }

  return (
    <Modal open={open} title="选择邮箱邮件" subtitle="刷新只读取邮件列表；勾选并加入清单后，统一提交才下载正文和附件" onClose={onClose} className="mail-import-modal">
      <div className="modal-body mail-picker-body">
        <div className="mail-picker-toolbar">
          <span>{config?.configured ? config.email : '请先在 设置 → 邮箱 保存账号与授权码'}</span>
          <button className="btn" disabled={!config?.configured || starting || !!taskId} onClick={() => void discover()}>{starting || taskId ? '刷新中…' : '刷新邮件列表'}</button>
        </div>
        <div className="small-note">首次读取近 30 天，之后增量更新，每次最多读取 200 封。未选中的邮件会保留供以后选择；单封邮件上限 25 MB。</div>
        <input className="input" aria-label="搜索邮件" placeholder="搜索主题或发件人" value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} />
        <div className="mail-picker-list" aria-busy={loading}>
          {loading ? <div className="empty-panel">正在读取候选邮件…</div> : messages.map((item) => (
            <label className="mail-picker-row" key={keyOf(item)}>
              <input type="checkbox" checked={!!selected[keyOf(item)]} disabled={item.size > 25 * 1024 * 1024 || (selectedMessages.length >= 100 && !selected[keyOf(item)])} onChange={() => toggle(item)} />
              <span><strong>{item.subject}</strong><small>{item.sender || '未知发件人'} · {item.sentAt || '日期未知'} · {Math.max(1, Math.round(item.size / 1024))} KB</small>{item.size > 25 * 1024 * 1024 && <em>超过 25 MB，请单独导入 EML</em>}{item.error && <em>{item.error}</em>}</span>
            </label>
          ))}
          {!loading && messages.length === 0 && <div className="empty-panel">暂无候选邮件，请点击“刷新邮件列表”或调整搜索条件</div>}
        </div>
        <div className="mail-picker-toolbar">
          <span>共 {total} 封 · 已选 {selectedMessages.length} / 100 封</span>
          <div><button className="btn" disabled={loading || offset === 0} onClick={() => setOffset((current) => Math.max(0, current - 50))}>上一页</button><button className="btn" disabled={loading || offset + 50 >= total} onClick={() => setOffset((current) => current + 50)}>下一页</button></div>
        </div>
        {message && <div className="small-note" role="status">{message}</div>}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!config?.configured || selectedMessages.length === 0 || !!taskId || starting} onClick={() => { if (config) onSelected(config.email, selectedMessages); onClose(); }}>加入待导入清单（{selectedMessages.length}）</button>
      </div>
    </Modal>
  );
}
