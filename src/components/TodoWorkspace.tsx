import { useEffect, useState } from 'react';
import type { FollowupData, TodoRecord } from '../types';
import { fetchFollowup, fetchTodos, salesLoadError, saveTodo } from '../api/client';
import TodoModal from './TodoModal';

export function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

type Props = { online: boolean; customer?: string; revision?: number; onSource: (id: string) => void; onRequirement: (customer: string, id: string) => void };

export default function TodoWorkspace({ online, customer, revision, onSource, onRequirement }: Props) {
  const [todos, setTodos] = useState<TodoRecord[]>([]);
  const [followup, setFollowup] = useState<FollowupData | null>(null);
  const [seed, setSeed] = useState<Partial<TodoRecord> | null>(null);
  const [filter, setFilter] = useState('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState('');
  const today = localDate();

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    setFollowup(null);
    setTodos([]);
    const load = customer ? fetchFollowup(customer) : fetchTodos();
    load.then(async (data) => {
      if (!live) return;
      setLoading(false);
      if (!data) { const message = await salesLoadError(); if (live) setError(message); return; }
      if (Array.isArray(data)) setTodos(data);
      else { setFollowup(data); setTodos(data.todos); }
    });
    return () => { live = false; };
  }, [customer, version, revision, online]);

  async function complete(todo: TodoRecord) {
    setBusyId(todo.id);
    const result = await saveTodo({ status: 'done' }, todo.id);
    setBusyId('');
    if (!result) { setError('状态保存失败，请重试'); return; }
    setVersion((v) => v + 1);
  }

  const active = todos.filter((todo) => todo.status === 'todo' || todo.status === 'doing');
  const visible = todos.filter((todo) => filter === 'all' || (filter === 'overdue' ? active.includes(todo) && todo.dueDate < today : filter === 'active' ? active.includes(todo) : todo.status === 'done'));
  const overdue = active.filter((todo) => todo.dueDate < today).length;

  return (
    <>
      {!customer && <header className="topbar"><div className="crumbs"><strong>销售待办</strong><span className="badge done">{active.length} 项待跟进</span></div><button className="btn primary" onClick={() => setSeed({})}>+ 新建待办</button></header>}
      <section className={customer ? 'customer-side-section sales-followup' : 'sales-workspace'}>
        <div className="card sales-panel">
          <div className="card-head"><div><div className="card-title">{customer ? '下一步与跟进提醒' : '让每个动作有着落'}</div><div className="card-sub">{customer ? `最近沟通：${followup?.lastContactAt || '历史记录无完整日期'}` : '关联需求、负责人和截止时间，保留完成记录'}</div></div>{customer && <button className="btn ghost" onClick={() => setSeed({ customer })}>+ 待办</button>}</div>
          <div className="sales-metrics" aria-live="polite"><span className={overdue ? 'danger-text' : ''}>逾期 <strong>{overdue}</strong></span><span>今日到期 <strong>{active.filter((t) => t.dueDate === today).length}</strong></span>{customer && followup?.daysSinceContact !== null && followup?.daysSinceContact !== undefined && <span>{followup.daysSinceContact >= 7 ? '建议跟进 · ' : ''}{followup.daysSinceContact} 天未沟通</span>}</div>
          <div className="sales-filters" aria-label="待办筛选">{[['active', '待跟进'], ['overdue', '逾期'], ['done', '已完成'], ['all', '全部']].map(([id, label]) => <button key={id} className={`btn ${filter === id ? 'primary' : 'ghost'}`} onClick={() => setFilter(id)}>{label}</button>)}</div>
          {error && <div className="sales-error" role="alert">{error}<button className="btn ghost" onClick={() => setVersion((v) => v + 1)}>重试</button></div>}
          {loading ? <div className="empty-panel">正在加载待办…</div> : !error && visible.length === 0 ? <div className="empty-panel">当前筛选下没有待办</div> : visible.map((todo) => (
            <article className="sales-todo" key={todo.id}>
              <div className="sales-todo-head"><button className="requirement-title-btn" onClick={() => setSeed(todo)}>{todo.title}</button><span className={`pill ${todo.status === 'done' ? 'green' : todo.dueDate < today && active.includes(todo) ? 'red' : ''}`}>{todo.status === 'done' ? '已完成' : todo.status === 'cancelled' ? '已取消' : todo.status === 'doing' ? '进行中' : '待处理'}</span></div>
              <div className="requirement-meta"><span>{todo.customer} · {todo.project}</span><span>{todo.owner}</span><span>截止 {todo.dueDate}</span></div>
              {todo.sourceQuote && <div className="requirement-quote">{todo.sourceQuote}</div>}
              <div className="sales-row-actions">{todo.sourceId && <button className="btn ghost" onClick={() => onSource(todo.sourceId)}>查看来源</button>}{todo.requirementId && <button className="btn ghost" onClick={() => onRequirement(todo.customer, todo.requirementId)}>关联需求</button>}{active.includes(todo) && <button className="btn" disabled={busyId === todo.id} onClick={() => void complete(todo)}>标记完成</button>}<button className="btn ghost" onClick={() => setSeed(todo)}>编辑</button></div>
            </article>
          ))}
          {followup && followup.suggestions.length > 0 && <div className="sales-suggestions"><h3>摘要中的下一步 · 待确认</h3>{followup.suggestions.map((suggestion, index) => <div className="sales-suggestion" key={`${suggestion.sourceId}-${index}`}><div><strong>{suggestion.title}</strong><small>{suggestion.owner || '负责人待确认'} · {suggestion.dueText || '日期待确认'}</small></div><button className="btn" onClick={() => setSeed({ ...suggestion, customer })}>确认待办</button></div>)}</div>}
          {customer && <div className="sales-suggestions"><h3>沟通风险 · 保留原文</h3>{followup?.risks.length ? followup.risks.map((risk, index) => <div className="sales-risk" key={index}><p>{risk.text}</p><button className="btn ghost" onClick={() => onSource(risk.sourceId)}>核对来源 · {risk.project}</button></div>) : !loading && <p className="small-note">暂无通话摘要中明确提到的异议与风险</p>}</div>}
        </div>
      </section>
      <TodoModal seed={seed} onClose={() => setSeed(null)} onSaved={() => setVersion((v) => v + 1)} />
    </>
  );
}
