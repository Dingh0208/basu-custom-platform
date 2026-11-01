import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceNotification } from '../types';
import { fetchNotifications, markNotifications } from '../api/client';
import Modal from './Modal';

export default function NotificationCenter({ online, onTodo }: { online: boolean; onTodo: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<WorkspaceNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const shown = useRef(new Set<string>());
  const onTodoRef = useRef(onTodo);
  onTodoRef.current = onTodo;

  const refresh = useCallback(async () => {
    if (!online || inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await fetchNotifications();
      if (!result) { setError('通知加载失败，请检查本地服务后重试'); return; }
      setError('');
      setItems(result.items);
      setUnread(result.unreadCount);
      const pending = result.items.filter((item) => item.deliver && !shown.current.has(item.id));
      if (pending.length && window.clientHub?.showReminder) {
        const delivered = await window.clientHub.showReminder({
          title: pending.length === 1 ? '待办到期提醒' : `${pending.length} 项待办需要跟进`,
          body: pending.slice(0, 3).map((item) => `${item.customer} · ${item.title}（${item.dueDate}）`).join('\n'),
          todoId: pending.length === 1 ? pending[0].todoId : '',
        });
        if (delivered) {
          pending.forEach((item) => shown.current.add(item.id));
          await markNotifications('delivered', pending.map((item) => item.id));
        } else {
          setError('系统通知暂不可用，应用内提醒已保留');
        }
      }
    } catch { setError('系统通知发送失败，仍可在这里查看待办'); }
    finally { inFlight.current = false; }
  }, [online]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    const cleanup = window.clientHub?.onOpenReminder(async (id) => {
      if (!id) { setOpen(true); void refresh(); return; }
      const result = await fetchNotifications();
      const ids = result?.items.filter((item) => item.todoId === id).map((item) => item.id) || [];
      if (ids.length) await markNotifications('read', ids);
      setOpen(false);
      void refresh();
      onTodoRef.current(id);
    });
    return () => { window.clearInterval(timer); window.removeEventListener('focus', focus); cleanup?.(); };
  }, [refresh]);

  async function read(item: WorkspaceNotification) {
    const result = await markNotifications('read', [item.id]);
    if (!result) { setError('通知状态保存失败，请重试'); return; }
    setOpen(false);
    await refresh();
    onTodo(item.todoId);
  }

  return <>
    <button className="nav-item" onClick={() => { setOpen(true); void refresh(); }} aria-label={`通知，${unread} 条未读`}>
      <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      通知{unread > 0 && <span className="notification-count">{unread > 99 ? '99+' : unread}</span>}
    </button>
    <Modal open={open} onClose={() => setOpen(false)} title="通知" subtitle="到期与逾期待办 · 点击查看对应动作" className="notification-modal">
      <div className="modal-body notification-body">
        <div className="notification-toolbar"><span>{unread} 条未读</span><button className="btn ghost" onClick={() => void refresh()}>刷新</button><button className="btn" disabled={!unread} onClick={async () => { if (await markNotifications('read', [], true)) await refresh(); else setError('通知状态保存失败，请重试'); }}>全部已读</button></div>
        {!online && <p className="sales-error">本地服务未连接</p>}
        {error && <p className="sales-error" role="alert">{error}</p>}
        {online && !error && items.length === 0 && <div className="empty-panel">暂无到期提醒</div>}
        {items.map((item) => <button className={`notification-row ${item.read ? '' : 'unread'}`} key={item.id} onClick={() => void read(item)}><span className="notification-dot" /><span><strong>{item.title}</strong><small>{item.customer} · {item.project} · {item.owner || '负责人待确认'}</small><small>截止 {item.dueDate}</small></span><span>查看待办 →</span></button>)}
      </div>
    </Modal>
  </>;
}
