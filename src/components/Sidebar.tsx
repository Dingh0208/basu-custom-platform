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
  active: 'import' | 'customers' | 'other';
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
  const isActive = (key: string) =>
    (active === 'import' && key === 'import') || (active === 'customers' && key === 'customers');

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
        <button className="nav-item" onClick={() => onNavigate('设置')}>
          <IconSettings className="icon" />
          设置
        </button>
      </div>
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
