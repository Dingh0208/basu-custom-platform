import { useEffect, useRef, useState } from 'react';
import type { PersonalProfile } from '../types';
import {
  IconHome,
  IconUsers,
  IconFolder,
  IconUpload,
  IconInbox,
  IconCheckSquare,
  IconSparkles,
  IconSettings,
  IconSearch,
} from './Icons';

type SidebarProps = {
  notificationEntry: React.ReactNode;
  profile: PersonalProfile;
  onProfile: () => void;
  active: 'home' | 'import' | 'inbox' | 'customers' | 'projects' | 'settings' | 'todos' | 'other';
  inboxCount: number;
  onNavigate: (label: string) => void;
};

type UpdateState = {
  status: string;
  version?: string;
  percent?: number;
  transferred?: number;
  total?: number;
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

const CURRENT_VERSION = '0.2.7';
const RELEASES_URL = 'https://github.com/Dingh0208/basu-custom-platform/releases';

export default function Sidebar({ notificationEntry, profile, onProfile, active, inboxCount, onNavigate }: SidebarProps) {
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' });
  const [versionOpen, setVersionOpen] = useState(false);
  const versionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bridge = (window as unknown as { clientHub?: { onUpdateStatus?: (cb: (payload: UpdateState) => void) => (() => void) | void; getUpdateState?: () => Promise<UpdateState | null> } }).clientHub;
    if (!bridge?.onUpdateStatus) return;
    const cleanup = bridge.onUpdateStatus((payload) => setUpdate((current) => ({ ...current, ...payload })));
    void bridge.getUpdateState?.().then((payload) => { if (payload) setUpdate((current) => ({ ...current, ...payload })); });
    return cleanup;
  }, []);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (versionMenuRef.current && !versionMenuRef.current.contains(event.target as Node)) setVersionOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  async function installUpdate() {
    const bridge = (window as unknown as { clientHub?: { installUpdate?: () => Promise<boolean> } }).clientHub;
    await bridge?.installUpdate?.();
  }

  async function downloadUpdate() {
    const bridge = (window as unknown as { clientHub?: { downloadUpdate?: () => Promise<{ status: string }> } }).clientHub;
    setUpdate((current) => ({ ...current, status: 'progress', percent: 0 }));
    const result = await bridge?.downloadUpdate?.();
    if (!result || result.status === 'error') setUpdate((current) => ({ ...current, status: 'error' }));
  }

  async function checkUpdates() {
    const bridge = (window as unknown as { clientHub?: { checkForUpdates?: () => Promise<{ status: string }> } }).clientHub;
    setUpdate({ status: 'checking' });
    if (!bridge?.checkForUpdates) {
      setUpdate({ status: 'error' });
      return;
    }
    const result = await bridge.checkForUpdates();
    if (result.status === 'dev') setUpdate({ status: 'none' });
    else if (result.status === 'error') setUpdate({ status: 'error' });
  }

  const hasUpdate = ['available', 'progress', 'downloaded'].includes(update.status);

  const isActive = (key: string) =>
    (active === 'home' && key === 'home') || (active === 'import' && key === 'import') || (active === 'customers' && key === 'customers') || (active === 'projects' && key === 'projects');

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">C</div>
        <div>
          <div className="brand-name">ClientHub</div>
          <div className="brand-sub">客户情报工作台</div>
          <div className="brand-version-wrap" ref={versionMenuRef}>
            <button className={`brand-version ${hasUpdate ? 'has-update' : ''}`} onClick={() => setVersionOpen((open) => !open)} aria-expanded={versionOpen} aria-haspopup="dialog">v{CURRENT_VERSION}{hasUpdate && <span className="brand-version-dot" />}</button>
            {versionOpen && (
              <div className="version-popover" role="dialog" aria-label="应用更新">
                <div className="version-popover-head"><span>当前版本</span><button className="version-refresh" onClick={() => void checkUpdates()} aria-label="检查更新">↻</button></div>
                <div className="version-popover-current">v{CURRENT_VERSION}</div>
                <div className={`version-popover-status ${hasUpdate ? 'has-update' : ''}`}>{hasUpdate && update.version ? `最新版本 v${update.version}` : update.status === 'checking' ? '正在检查更新…' : update.status === 'error' ? '更新检查失败，请重试' : '当前已是最新版本'}</div>
                {update.status === 'available' && <button className="btn primary version-action" onClick={() => void downloadUpdate()}>下载更新</button>}
                {update.status === 'progress' && <><div className="version-progress"><span style={{ width: `${Math.min(100, Math.max(0, update.percent || 0))}%` }} /></div><div className="version-progress-text">正在下载 {Math.round(update.percent || 0)}%</div></>}
                {update.status === 'downloaded' && <button className="btn primary version-action" onClick={() => void installUpdate()}>重启该应用</button>}
                {(update.status === 'idle' || update.status === 'none' || update.status === 'error') && <button className="btn version-action" onClick={() => void checkUpdates()}>检查更新</button>}
                <div className="version-popover-links"><a className="version-history-link" href={RELEASES_URL} target="_blank" rel="noreferrer">查看历史更新 ↗</a><button className="version-settings-link" onClick={() => { setVersionOpen(false); onNavigate('设置'); }}>更新设置</button></div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="nav">
        <button className="nav-item global-search-trigger" onClick={() => onNavigate('全局搜索')}><IconSearch className="icon" />全局搜索<kbd>Ctrl K</kbd></button>
        {mainItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={`nav-item ${isActive(item.key) || active === item.key ? 'active' : ''}`}
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
            <button key={item.key} className={`nav-item ${active === 'todos' && item.key === 'tasks' ? 'active' : ''}`} onClick={() => onNavigate(item.label)}>
              <Icon className="icon" />
              {item.label}
            </button>
          );
        })}
        <div className="nav-spacer" />
        {notificationEntry}
        <button className={`nav-item ${active === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('设置')}>
          <IconSettings className="icon" />
          设置
        </button>
      </div>
      <button className="user-card" onClick={onProfile} aria-label="编辑个人信息" title="编辑个人信息">
        <span className="avatar">{profile.name.slice(0, 1)}</span>
        <div>
          <div className="user-name">{profile.name}</div>
          <div className="user-role">{profile.role || '本机用户'} · {profile.company || '本机'}</div>
        </div>
      </button>
    </aside>
  );
}
