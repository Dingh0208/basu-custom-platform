import { useEffect, useState } from 'react';
import type { DashboardSummary, ImportRecord, ProductMetric, TodoRecord } from '../types';
import { fetchDashboard, fetchTodos, salesLoadError } from '../api/client';
import { needsArchive } from './InboxArchive';
import { localDate } from './TodoWorkspace';
import { IconChat, IconFile, IconMic, IconUsers, IconUpload } from './Icons';

type HomePageProps = {
  online: boolean;
  onNavigate: (label: string) => void;
  onOpenRecord: (record: ImportRecord) => void;
  onToast: (message: string) => void;
};

function todayLabel() {
  return new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
}

function recordIcon(type: string) {
  if (type === '音频') return <IconMic size={14} />;
  if (type === '聊天记录') return <IconChat size={14} />;
  return <IconFile size={14} />;
}

function metricDisplay(metric: ProductMetric | undefined) {
  if (!metric || !metric.available || metric.value === null) return '—';
  if (metric.unit === 'ratio') return `${Math.round(metric.value * 100)}%`;
  if (metric.unit === 'seconds') return metric.value < 60 ? `${metric.value.toFixed(1)} 秒` : `${(metric.value / 60).toFixed(1)} 分钟`;
  if (metric.unit === 'minutes') return metric.value < 60 ? `${metric.value.toFixed(1)} 分钟` : `${(metric.value / 60).toFixed(1)} 小时`;
  return `${Math.round(metric.value)}`;
}

function metricSample(metric: ProductMetric | undefined) {
  if (!metric || !metric.available) return metric?.note || '暂无可核对样本';
  return `样本 ${metric.denominator}${metric.unit === 'ratio' ? ` · ${metric.numerator}/${metric.denominator}` : ''}`;
}

export default function HomePage({ online, onNavigate, onOpenRecord, onToast }: HomePageProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [todos, setTodos] = useState<TodoRecord[] | null>(null);
  const [todoError, setTodoError] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setTodoError('');
    fetchDashboard().then((data) => {
      if (!mounted) return;
      setSummary(data);
      setLoading(false);
      if (!data) onToast('首页数据加载失败，请确认 Sidecar 已连接');
    });
    fetchTodos().then(async (data) => {
      if (!mounted) return;
      setTodos(data);
      if (!data) { const message = await salesLoadError(); if (mounted) setTodoError(message); }
    });
    return () => { mounted = false; };
  }, [online, version]);

  const stats = summary?.stats;
  const metrics = summary?.metrics;
  const stages = summary?.stageCounts ?? [];
  const maxStage = Math.max(1, ...stages.map((item) => item.count));
  const due = todos?.filter((todo) => (todo.status === 'todo' || todo.status === 'doing') && todo.dueDate <= localDate()) ?? [];

  return (
    <>
      <header className="topbar">
        <div className="crumbs"><strong>首页</strong><span className="badge done">{todayLabel()}</span></div>
        <div className="top-actions"><button className="btn primary" onClick={() => onNavigate('导入中心')}><IconUpload size={15} />导入新资料</button></div>
      </header>

      <div className="home-workspace">
        <section className="home-hero">
          <div>
            <div className="home-hero-kicker">CLIENT INTELLIGENCE WORKBENCH</div>
            <h1>把每一次沟通，变成可跟进的机会。</h1>
            <p>通话、微信、文件与需求统一沉淀到客户 360；今天从最近一条客户动态开始。</p>
            <div className="home-hero-actions">
              <button className="btn primary" onClick={() => onNavigate('导入中心')}>开始导入</button>
              <button className="btn" onClick={() => onNavigate('客户')}>查看客户 360</button>
              <button className="btn ghost" onClick={() => onNavigate('项目')}>项目看板</button>
            </div>
          </div>
          <div className="home-hero-mark"><span>C</span><small>ClientHub</small></div>
        </section>

        <section className="home-stat-grid">
          <button className="home-stat-card" onClick={() => onNavigate('客户')}>
            <span className="home-stat-icon"><IconUsers size={17} /></span>
            <span className="home-stat-label">客户档案</span>
            <strong>{loading ? '—' : stats?.customers ?? 0}</strong>
            <small>位客户正在跟进</small>
          </button>
          <button className="home-stat-card" onClick={() => onNavigate('项目')}>
            <span className="home-stat-icon project"><IconFile size={17} /></span>
            <span className="home-stat-label">项目</span>
            <strong>{loading ? '—' : stats?.projects ?? 0}</strong>
            <small>个进行中的项目</small>
          </button>
          <button className="home-stat-card" onClick={() => onNavigate('客户')}>
            <span className="home-stat-icon need"><IconChat size={17} /></span>
            <span className="home-stat-label">需求清单</span>
            <strong>{loading ? '—' : stats?.requirements ?? 0}</strong>
            <small>条需求待跟进</small>
          </button>
          <button className="home-stat-card" onClick={() => onNavigate('待归档')}>
            <span className="home-stat-icon inbox"><IconUpload size={17} /></span>
            <span className="home-stat-label">待归档</span>
            <strong>{loading ? '—' : stats?.inbox ?? 0}</strong>
            <small>个文件等待处理</small>
          </button>
        </section>

        {metrics && <section className="card home-section home-metrics">
          <div className="card-head"><div><div className="card-title">核心产品指标</div><div className="card-sub">近 {metrics.windowDays} 天 · 从本地任务和销售记录实时计算</div></div><span className="badge done">可追踪</span></div>
          <div className="home-metric-grid" aria-live="polite">
            {[
              ['导入成功率', metrics.importsSuccessRate],
              ['解析完成率', metrics.parseCompletionRate],
              ['解析 P95', metrics.parseP95Seconds],
              ['客户自动匹配准确率', metrics.customerMatchAccuracy],
              ['摘要转需求有效率', metrics.requirementEffectiveness],
              ['沟通到待办平均耗时', metrics.nextActionLatencyMinutes],
              ['周活跃客户', metrics.weeklyActiveCustomers],
              ['周活跃项目', metrics.weeklyActiveProjects],
            ].map(([label, metric]) => <div className="home-metric" key={label as string}>
              <span>{label as string}</span><strong>{metricDisplay(metric as ProductMetric)}</strong><small>{metricSample(metric as ProductMetric)}</small>
            </div>)}
          </div>
        </section>}

        <section className="card home-section home-followup">
          <div className="card-head"><div><div className="card-title">今日跟进提醒</div><div className="card-sub">{todos === null ? '待办数据暂不可用' : `${due.length} 项今日到期或已逾期`}</div></div><button className="btn ghost" onClick={() => onNavigate('待办')}>查看销售待办</button></div>
          {todoError ? <div className="sales-error" role="alert">{todoError}<button className="btn ghost" onClick={() => setVersion((v) => v + 1)}>重试</button></div> : due.length === 0 ? <p className="home-followup-empty">{todos === null ? '正在加载跟进提醒…' : '没有到期事项，可继续推进下一步动作'}</p> : due.slice(0, 5).map((todo) => <button key={todo.id} className="home-import-row" onClick={() => onNavigate('待办')}><span className="home-import-main"><strong>{todo.title}</strong><small>{todo.customer} · {todo.project} · {todo.owner} · 截止 {todo.dueDate}</small></span><span className={`pill ${todo.dueDate < localDate() ? 'red' : 'amber'}`}>{todo.dueDate < localDate() ? '已逾期' : '今日到期'}</span></button>)}
        </section>

        <div className="home-columns">
          <section className="card home-section">
            <div className="card-head">
              <div><div className="card-title">最近导入</div><div className="card-sub">最新进入工作台的资料</div></div>
              <button className="btn ghost" style={{ height: 27, padding: '0 8px', fontSize: 10 }} onClick={() => onNavigate('导入中心')}>查看全部</button>
            </div>
            {loading ? <div className="empty-panel">正在加载…</div> : (summary?.recentImports.length ?? 0) === 0 ? <div className="empty-panel">还没有导入记录</div> : (
              <div className="home-import-list">
                {summary?.recentImports.map((record) => (
                  <button key={record.id} className="home-import-row" onClick={() => onOpenRecord(record)}>
                    <span className="home-import-icon">{recordIcon(record.type)}</span>
                    <span className="home-import-main"><strong>{record.fileName}</strong><small>{record.customer} · {record.project} · {record.importedAt}</small></span>
                    <span className={`badge ${record.status === 'done' && !needsArchive(record) ? 'done' : 'warn'}`}>{record.status === 'processing' ? '处理中' : record.status === 'failed' ? '失败' : record.status === 'cancelled' ? '已取消' : needsArchive(record) ? '待归档' : '已完成'}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="card home-section">
            <div className="card-head"><div><div className="card-title">项目阶段</div><div className="card-sub">当前项目推进分布</div></div><button className="btn ghost" style={{ height: 27, padding: '0 8px', fontSize: 10 }} onClick={() => onNavigate('项目')}>项目看板</button></div>
            <div className="stage-bars">
              {stages.length === 0 ? <div className="empty-panel">还没有项目</div> : stages.map((stage) => (
                <button key={stage.stage} className="stage-bar-row" onClick={() => onNavigate('项目')}>
                  <span className="stage-bar-label">{stage.stage}</span>
                  <span className="stage-bar-track"><span style={{ width: `${Math.max(8, stage.count / maxStage * 100)}%` }} /></span>
                  <strong>{stage.count}</strong>
                </button>
              ))}
            </div>
          </section>
        </div>

        <section className="card home-section home-requirements">
          <div className="card-head"><div><div className="card-title">最新需求</div><div className="card-sub">来自通话、聊天与手工记录</div></div><button className="btn ghost" style={{ height: 27, padding: '0 8px', fontSize: 10 }} onClick={() => onNavigate('客户')}>进入客户 360</button></div>
          {(summary?.recentRequirements.length ?? 0) === 0 ? <div className="empty-panel">还没有需求记录</div> : (
            <div className="home-requirement-grid">
              {summary?.recentRequirements.map((requirement) => (
                <button key={requirement.id} className="home-requirement-card" onClick={() => onNavigate('客户')}>
                  <div className="home-requirement-head"><strong>{requirement.title}</strong><span className={`pill ${requirement.priority === 'P0' ? 'red' : requirement.priority === 'P1' ? 'amber' : 'muted-pill'}`}>{requirement.priority}</span></div>
                  <div className="home-requirement-meta">{requirement.customer} · {requirement.project}</div>
                  <span className={`pill ${requirement.status === '已确认' || requirement.status === '已实现' ? 'green' : requirement.status === '已报价' ? 'blue' : ''}`}>{requirement.status}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="statusbar">
        <div className="status-left"><span><span className="status-dot" />本地数据 · SQLite</span><span>客户数：{stats?.customers ?? 0}</span><span>需求数：{stats?.requirements ?? 0}</span></div>
        <div>客户信息聚合工作台 · 首页</div>
      </footer>
    </>
  );
}
