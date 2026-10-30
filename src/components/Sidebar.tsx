import { useEffect, useState } from 'react';
import {
  IconHome,
  IconUsers,
  IconFolder,
  IconUpload,
  IconInbox,
  IconCheckSquare,
  IconSparkles,
  IconSettings,
} from './Icons';

type SidebarProps = {
  active: 'home' | 'import' | 'customers' | 'projects' | 'settings' | 'other';
  inboxCount: number;
  onNavigate: (label: string) => void;
};

const mainItems = [
  { key: 'home', label: '首页', icon: IconHome },
  { key: 'customers', label: '客户', icon: IconUsers },
  { key: 'projects', label: '项目', icon: IconFolder },
  { key: 'import', label: '导入中心', icon: IconUpload },
  { key: 'inbox', label: '待归档', icon: IconInbox, badge: true },
];

const workItems = [
  { key: 'tasks', label: '待办', icon: IconCheckSquare },
  { key: 'qa', label: 'AI 问答', icon: IconSparkles },
];

export default function Sidebar({ active, inboxCount, onNavigate }: SidebarProps) {
  const [update, setUpdate] = useState<{ status: string; version?: string; percent?: number; transferred?: number; total?: number } | null>(null);

  useEffect(() => {
    const bridge = (window as unknown as { clientHub?: { onUpdateStatus?: (cb: (payload: { status: string; version?: string; percent?: number; transferred?: number; total?: number }) => void) => void } }).clientHub;
    if (!bridge?.onUpdateStatus) return;
    return bridge.onUpdateStatus((payload) => setUpdate(payload));
  }, []);

  function mb(value?: number) {
    return value ? `${(value / 1024 / 1024).toFixed(1)} MB` : '';
  }

  async function installUpdate() {
    const bridge = (window as unknown as { clientHub?: { installUpdate?: () => Promise<boolean> } }).clientHub;
    await bridge?.installUpdate?.();
  }

  const isActive = (key: string) =>
    (active === 'home' && key === 'home') || (active === 'import' && key === 'import') || (active === 'customers' && key === 'customers') || (active === 'projects' && key === 'projects');

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">C</div>
        <div>
          <div className="brand-name">ClientHub</div>
          <div className="brand-sub">客户情报工作台</div>
        </div>
      </div>
      <div className="nav">
        {mainItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={`nav-item ${isActive(item.key) ? 'active' : ''}`}
              onClick={() => onNavigate(item.label)}
            >
              <Icon className="icon" />
              {item.label}
              {item.badge && inboxCount > 0 && (
                <span style={{ marginLeft: 'auto', background: '#fef3f2', color: '#b42318', borderRadius: 999, fontSize: 10, padding: '1px 6px' }}>
                  {inboxCount}
                </span>
              )}
            </button>
          );
        })}
        <div className="nav-label">工作</div>
        {workItems.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.key} className="nav-item" onClick={() => onNavigate(item.label)}>
              <Icon className="icon" />
              {item.label}
            </button>
          );
        })}
        <div className="nav-spacer" />
        <button className={`nav-item ${active === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('设置')}>
          <IconSettings className="icon" />
          设置
        </button>
      </div>
      {update && update.status !== 'none' && update.status !== 'checking' && (
        <div className="update-indicator">
          <div className="update-indicator-title">
            {update.status === 'downloaded' ? `新版本 ${update.version || ''} 已就绪` : update.status === 'progress' ? '正在下载更新' : update.status === 'available' ? `发现新版本 ${update.version || ''}` : '更新检查失败'}
          </div>
          {update.status === 'progress' && (
            <>
              <div className="update-progress"><span style={{ width: `${Math.min(100, Math.max(0, update.percent || 0))}%` }} /></div>
              <div className="update-progress-text">{mb(update.transferred)} / {mb(update.total)}</div>
            </>
          )}
          {update.status === 'downloaded' && <button className="btn primary update-install-btn" onClick={installUpdate}>重启并安装</button>}
        </div>
      )}
      <div className="user-card">
        <div className="avatar">王</div>
        <div>
          <div className="user-name">王总</div>
          <div className="user-role">产品负责人 · 本机</div>
        </div>
      </div>
    </aside>
  );
}
