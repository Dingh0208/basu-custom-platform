import { useEffect, useRef, useState } from 'react';
import type { PersonalProfile } from '../types';
import appPackage from '../../package.json';
import { getDesktopBridge } from '../desktopBridge';
import {
  IconHome,
  IconUsers,
  IconFolder,
  IconUpload,
  IconFile,
  IconCheckSquare,
  IconSparkles,
  IconClarification,
  IconSettings,
  IconSearch,
} from './Icons';

type SidebarProps = {
  notificationEntry: React.ReactNode;
  profile: PersonalProfile;
  onProfile: () => void;
  active: 'home' | 'import' | 'materials' | 'customers' | 'projects' | 'settings' | 'todos' | 'clarifications' | 'other';
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
  { key: 'materials', label: '资料', icon: IconFile },
];

const workItems = [
  { key: 'tasks', label: '待办', icon: IconCheckSquare },
  { key: 'clarifications', label: '需求澄清', icon: IconClarification },
  { key: 'qa', label: 'AI 问答', icon: IconSparkles },
];

const CURRENT_VERSION = appPackage.version;
const RELEASES_URL = 'https://github.com/Dingh0208/clientatlas/releases';

export default function Sidebar({ notificationEntry, profile, onProfile, active, onNavigate }: SidebarProps) {
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' });
  const [versionOpen, setVersionOpen] = useState(false);
  const versionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge?.onUpdateStatus) return;
    let receivedEvent = false;
    const cleanup = bridge.onUpdateStatus((payload) => {
      receivedEvent = true;
      setUpdate((current) => ({ ...current, ...payload }));
    });
    void bridge.getUpdateState?.().then((payload) => {
      if (payload && !receivedEvent) setUpdate((current) => ({ ...current, ...payload }));
    });
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
    const bridge = getDesktopBridge();
    setUpdate((current) => ({ ...current, status: 'installing' }));
    const started = await bridge?.installUpdate?.();
    if (started === false) setUpdate((current) => ({ ...current, status: 'error' }));
  }

  async function downloadUpdate() {
    const bridge = getDesktopBridge();
    setUpdate((current) => ({ ...current, status: 'progress', percent: 0 }));
    const result = await bridge?.downloadUpdate?.();
    if (!result || result.status === 'error') setUpdate((current) => ({ ...current, status: 'error' }));
  }

  async function checkUpdates() {
    if (['progress', 'downloaded', 'installing'].includes(update.status)) return;
    const bridge = getDesktopBridge();
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
    (active === 'home' && key === 'home') || (active === 'import' && key === 'import') || (active === 'materials' && key === 'materials') || (active === 'customers' && key === 'customers') || (active === 'projects' && key === 'projects');

  return (
    <aside className="sidebar">
      <div className="brand">
          <img className="brand-mark" src="/clientatlas-icon.png" alt="" />
        <div>
          <div className="brand-name">ClientAtlas</div>
          <div className="brand-sub">客户情报工作台</div>
          <div className="brand-version-wrap" ref={versionMenuRef}>
            <button className={`brand-version ${hasUpdate ? 'has-update' : ''}`} onClick={() => setVersionOpen((open) => !open)} aria-expanded={versionOpen} aria-haspopup="dialog">v{CURRENT_VERSION}{hasUpdate && <span className="brand-version-dot" />}</button>
            {versionOpen && (
              <div className="version-popover" role="dialog" aria-label="应用更新">
                <div className="version-popover-head"><span>当前版本</span><button className="version-refresh" onClick={() => void checkUpdates()} aria-label="检查更新">↻</button></div>
                <div className="version-popover-current">v{CURRENT_VERSION}</div>
                <div className={`version-popover-status ${hasUpdate ? 'has-update' : ''}`}>{update.status === 'progress' ? '正在进行更新' : update.status === 'installing' ? '正在安装更新…' : hasUpdate && update.version ? `最新版本 v${update.version}` : update.status === 'checking' ? '正在检查更新…' : update.status === 'error' ? '更新检查失败，请重试' : '当前已是最新版本'}</div>
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
        <button className="nav-item global-search-trigger" title="全局搜索" aria-label="全局搜索" onClick={() => onNavigate('全局搜索')}><IconSearch className="icon" />全局搜索<kbd>Ctrl K</kbd></button>
        {mainItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={`nav-item ${isActive(item.key) || active === item.key ? 'active' : ''}`}
              title={item.label}
              aria-label={item.label}
              onClick={() => onNavigate(item.label)}
            >
              <Icon className="icon" />
              {item.label}
            </button>
          );
        })}
        <div className="nav-label">工作</div>
        {workItems.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.key} title={item.label} aria-label={item.label} className={`nav-item ${(active === 'todos' && item.key === 'tasks') || active === item.key ? 'active' : ''}`} onClick={() => onNavigate(item.label)}>
              <Icon className="icon" />
              {item.label}
            </button>
          );
        })}
        <div className="nav-spacer" />
        {notificationEntry}
        <button className={`nav-item ${active === 'settings' ? 'active' : ''}`} title="设置" aria-label="设置" onClick={() => onNavigate('设置')}>
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
