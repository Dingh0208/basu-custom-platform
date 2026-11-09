import { useEffect, useRef, useState } from 'react';
import type { AppSettings, BackupSummary, Diagnostics, LlmConfig, LlmModelsResult, MailConfig, ProjectListItem } from '../types';
import {
  clearLlmApiKey,
  downloadBackup,
  fetchAppSettings,
  fetchArchivedProjects,
  fetchBackups,
  fetchDiagnostics,
  fetchLlmConfig,
  fetchMailConfig,
  getHealth,
  pullLlmModels,
  restoreBackup,
  restoreProject,
  saveAppSettings,
  saveLlmConfig,
  saveMailConfig,
  testMailConnection,
  testLlmConfig,
} from '../api/client';
import type { Health } from '../api/client';
import { IconRefresh } from './Icons';
import appPackage from '../../package.json';
import { getDesktopBridge } from '../desktopBridge';

type SettingsPageProps = {
  onToast: (message: string) => void;
  onDataChanged: () => Promise<void>;
  onOpenMailImport: () => void;
};

type SettingsSectionId = 'llm' | 'import' | 'data' | 'archived' | 'diagnostics' | 'updates' | 'notifications' | 'about' | 'mail';

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string; hint: string }> = [
  { id: 'llm', label: '大模型', hint: '配置音频、文本和图像分析使用的模型' },
  { id: 'import', label: '导入偏好', hint: '设置新资料的默认负责人、项目和处理方式' },
  { id: 'data', label: '数据与备份', hint: '管理本地数据库、附件和备份文件' },
  { id: 'archived', label: '已归档内容', hint: '查看和恢复已归档的项目和客户' },
  { id: 'diagnostics', label: '本地诊断', hint: '查看 Sidecar 和 FFmpeg 状态' },
  { id: 'updates', label: '更新', hint: '控制自动更新检查和检查频率' },
  { id: 'notifications', label: '通知', hint: '设置待办到期提醒和免打扰时间' },
  { id: 'about', label: '隐私与关于', hint: '查看密钥存储、版本和本地文件说明' },
  { id: 'mail', label: '邮箱', hint: '配置 QQ 邮箱并手动拉取收件箱' },
];

const ALIYUN_BAILIAN = 'https://bailian.console.aliyun.com/';
const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultProject: '',
  defaultOwner: '王总',
  aiImportEnabled: false,
  autoUpdate: true,
  updateIntervalHours: 3,
  systemNotifications: true,
  quietStart: '22:00',
  quietEnd: '08:00',
};

function formatBytes(bytes: number) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatBackupDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function healthLabel(health: Health | null, diagnostics: Diagnostics | null) {
  if (!health || health.status !== 'ok') return '未连接';
  if ((health.apiRevision ?? 0) < 5) return 'Sidecar 已连接，版本较旧';
  if (!diagnostics) return '诊断接口不可用';
  return diagnostics.status === 'ok' ? '运行正常' : '需要检查';
}

export default function SettingsPage({ onToast, onDataChanged, onOpenMailImport }: SettingsPageProps) {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [asrModel, setAsrModel] = useState('qwen3-asr-flash');
  const [summaryModel, setSummaryModel] = useState('qwen3.8-flash');
  const [visionModel, setVisionModel] = useState('qwen3.8-omni-flash');
  const [masked, setMasked] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<'test' | 'pull' | 'save' | 'clear' | null>(null);
  const [message, setMessage] = useState('');
  const [updateStatus, setUpdateStatus] = useState('');
  const [updatePhase, setUpdatePhase] = useState<'idle' | 'checking' | 'available' | 'progress' | 'downloaded' | 'installing' | 'none' | 'error'>('idle');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [backupBusy, setBackupBusy] = useState<'export' | 'restore' | null>(null);
  const [backupMessage, setBackupMessage] = useState('');
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [appBusy, setAppBusy] = useState(false);
  const [appMessage, setAppMessage] = useState('');
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [sidecarHealth, setSidecarHealth] = useState<Health | null>(null);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [diagnosticMessage, setDiagnosticMessage] = useState('');
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('llm');
  const [archivedProjects, setArchivedProjects] = useState<ProjectListItem[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState(false);
  const [restoringProjectId, setRestoringProjectId] = useState<string | null>(null);
  const [mailConfig, setMailConfig] = useState<MailConfig | null>(null);
  const [mailEmail, setMailEmail] = useState('');
  const [mailPassword, setMailPassword] = useState('');
  const [mailBusy, setMailBusy] = useState<'save' | 'test' | null>(null);
  const [mailMessage, setMailMessage] = useState('');
  const backupInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge?.onUpdateStatus) return;
    let receivedEvent = false;
    const applyUpdateState = (payload: { status: string; version?: string; percent?: number }) => {
      if (payload.status === 'checking') { setUpdatePhase('checking'); setUpdateStatus('正在检查更新…'); }
      else if (payload.status === 'available') { setUpdatePhase('available'); setUpdateStatus(`发现新版本 ${payload.version || ''}，点击下载`); }
      else if (payload.status === 'progress') { setUpdatePhase('progress'); setUpdateProgress(payload.percent || 0); setUpdateStatus('正在进行更新…'); }
      else if (payload.status === 'downloaded') { setUpdatePhase('downloaded'); setUpdateProgress(100); setUpdateStatus(`新版本 ${payload.version || ''} 已下载，点击重启应用`); }
      else if (payload.status === 'installing') { setUpdatePhase('installing'); setUpdateStatus('正在安装更新…'); }
      else if (payload.status === 'none') { setUpdatePhase('none'); setUpdateStatus('当前已是最新版本'); }
      else if (payload.status === 'error') { setUpdatePhase('error'); setUpdateStatus('更新检查失败，请稍后重试'); }
    };
    const cleanup = bridge.onUpdateStatus((payload) => {
      receivedEvent = true;
      applyUpdateState(payload);
    });
    void bridge.getUpdateState?.().then((payload) => { if (payload && !receivedEvent) applyUpdateState(payload); });
    return cleanup;
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([fetchLlmConfig(), fetchAppSettings(), fetchBackups(), getHealth(), fetchDiagnostics(), fetchMailConfig()]).then(([llm, app, backupList, health, diag, mail]) => {
      if (!mounted) return;
      if (llm) {
        setBaseUrl(llm.baseUrl || '');
        setAsrModel(llm.asrModel || 'qwen3-asr-flash');
        setSummaryModel(llm.summaryModel || 'qwen3.8-flash');
        setVisionModel(llm.visionModel || 'qwen3.8-omni-flash');
        setMasked(llm.apiKeyMasked || '');
        setHasKey(!!llm.hasKey);
      }
      if (app) setAppSettings({ ...DEFAULT_APP_SETTINGS, ...app });
      if (backupList) setBackups(backupList);
      setSidecarHealth(health);
      setDiagnostics(diag);
      if (mail) {
        setMailConfig(mail);
        setMailEmail(mail.email);
      }
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (activeSection !== 'archived') return;
    let mounted = true;
    setArchivedLoading(true);
    fetchArchivedProjects().then((data) => {
      if (!mounted) return;
      setArchivedError(data === null);
      if (data) setArchivedProjects(data);
      setArchivedLoading(false);
    });
    return () => { mounted = false; };
  }, [activeSection]);

  async function retryArchivedProjects() {
    setArchivedLoading(true);
    const data = await fetchArchivedProjects();
    setArchivedError(data === null);
    if (data) setArchivedProjects(data);
    setArchivedLoading(false);
  }

  async function handleRestoreProject(projectId: string) {
    setRestoringProjectId(projectId);
    const result = await restoreProject(projectId);
    setRestoringProjectId(null);
    if (!result?.restored) {
      onToast(result?.error || '项目恢复失败，请检查本地服务连接');
      return;
    }
    await Promise.all([retryArchivedProjects(), onDataChanged()]);
    onToast('项目与客户档案已恢复');
  }

  const currentConfig: Partial<LlmConfig> & { apiKey?: string } = { baseUrl, apiKey, asrModel, summaryModel, visionModel };

  async function checkUpdates() {
    setUpdatePhase('checking');
    setUpdateStatus('正在检查更新…');
    const bridge = getDesktopBridge();
    if (!bridge?.checkForUpdates) {
      setUpdateStatus('开发模式下暂不提供更新检查');
      return;
    }
    const result = await bridge.checkForUpdates();
    if (result.status === 'dev') { setUpdatePhase('none'); setUpdateStatus('开发模式下暂不提供更新检查'); }
    else if (result.status === 'error') { setUpdatePhase('error'); setUpdateStatus('更新检查失败，请稍后重试'); }
  }

  async function downloadUpdate() {
    const bridge = getDesktopBridge();
    setUpdatePhase('progress');
    setUpdateProgress(0);
    setUpdateStatus('正在进行更新…');
    const result = await bridge?.downloadUpdate?.();
    if (!result || result.status === 'error') {
      setUpdatePhase('error');
      setUpdateStatus(result?.status === 'error' ? '更新下载失败，请稍后重试' : '开发模式下暂不提供更新下载');
    }
  }

  async function installUpdate() {
    const bridge = getDesktopBridge();
    setUpdatePhase('installing');
    setUpdateStatus('正在安装更新…');
    const started = await bridge?.installUpdate?.();
    if (started === false) { setUpdatePhase('error'); setUpdateStatus('更新安装未启动，请重试'); }
  }

  async function refreshDiagnostics() {
    setDiagnosticBusy(true);
    setDiagnosticMessage('正在检测 Sidecar 和 FFmpeg…');
    const [health, diag, backupList] = await Promise.all([getHealth(), fetchDiagnostics(), fetchBackups()]);
    setSidecarHealth(health);
    setDiagnostics(diag);
    if (backupList) setBackups(backupList);
    setDiagnosticBusy(false);
    if (!health || health.status !== 'ok') {
      setDiagnosticMessage('检测失败：127.0.0.1:8765 无响应。安装版可点击“启动 / 重启服务”；开发模式请在终端运行 pnpm electron:dev。');
    } else if ((health.apiRevision ?? 0) < 5) {
      setDiagnosticMessage(`Sidecar 可连接，但版本 ${health.version || '未知'} / API ${health.apiRevision ?? '未知'} 较旧，缺少当前诊断接口。请退出旧版 ClientAtlas 后启动新版；若是开发环境，请停止旧进程并重新运行 pnpm electron:dev。`);
    } else if (!diag) {
      setDiagnosticMessage(`Sidecar ${health.version} 已连接，但详细诊断接口暂不可用。可重试检测，或启动 / 重启本地服务。`);
    } else {
      setDiagnosticMessage('检测完成：Sidecar 与本地诊断接口均可用');
    }
  }

  async function restartSidecar() {
    if (!window.confirm('重启本地服务可能中断正在进行的转写或解析任务。是否继续？')) return;
    setDiagnosticBusy(true);
    setDiagnosticMessage('正在启动 Sidecar 并等待健康检查…');
    try {
      const bridge = getDesktopBridge();
      const result = await bridge?.restartSidecar?.();
      if (!result || result.status === 'dev') {
        setDiagnosticBusy(false);
        setDiagnosticMessage('开发模式下由 pnpm electron:dev 管理 Sidecar。请在启动终端按 Ctrl+C 后重新运行该命令。');
        return;
      }
      if (result.status === 'missing') {
        setDiagnosticBusy(false);
        setDiagnosticMessage('未找到内置 Sidecar 程序。请重新安装 ClientAtlas，或检查安装目录中的 resources/ai-sidecar/clientatlas-ai.exe。');
        return;
      }
      if (result.status === 'legacy') {
        await refreshDiagnostics();
        setDiagnosticMessage(`服务仍由旧版 ${result.version || '未知'} / API ${result.apiRevision ?? '未知'} 响应。请完全退出所有 ClientAtlas 窗口后重新打开；不要结束不明来源的本地进程。`);
        return;
      }
      if (result.status !== 'ready') {
        await refreshDiagnostics();
        setDiagnosticMessage('Sidecar 未在 12 秒内通过健康检查。程序可能被安全软件隔离，或端口 8765 被其他服务占用；可重试检测并检查安装目录。');
        return;
      }
      await refreshDiagnostics();
    } catch {
      setDiagnosticBusy(false);
      setDiagnosticMessage('启动 Sidecar 时发生错误。请重新检测；若持续失败，请重启 ClientAtlas 并检查安装目录。');
    }
  }

  async function run(action: 'test' | 'pull') {
    if (!baseUrl.trim()) {
      setMessage('请先填写聚合大模型 Base URL');
      return;
    }
    setBusy(action);
    setMessage('');
    const fn = action === 'test' ? testLlmConfig : pullLlmModels;
    const result = (await fn(currentConfig)) as LlmModelsResult | null;
    setBusy(null);
    if (!result) {
      setMessage('请求失败，请确认 Sidecar 已连接');
      return;
    }
    if (result.status === 'ok') {
      const list = result.models || [];
      setModels(list);
      setMessage(`连接成功，共拉取到 ${result.count ?? list.length} 个模型`);
      if (list.length && !asrModel) setAsrModel(list[0]);
    } else {
      setMessage(`连接失败：${result.error || '未知错误'}`);
    }
  }

  async function save() {
    setBusy('save');
    setMessage('');
    const result = await saveLlmConfig(currentConfig);
    setBusy(null);
    if (!result) {
      setMessage('保存失败，请确认 Sidecar 已连接');
      return;
    }
    setMasked(result.apiKeyMasked || '');
    setHasKey(!!result.hasKey);
    setApiKey('');
    onToast('大模型配置已保存');
    setMessage('保存成功，新的分析任务将使用该配置');
  }

  async function clearKey() {
    if (!hasKey || !window.confirm('确定删除本机保存的大模型 Key 吗？删除后新的 AI 任务将回退到 Mock 模式。')) return;
    setBusy('clear');
    const result = await clearLlmApiKey();
    setBusy(null);
    if (!result) {
      setMessage('删除失败，请确认 Sidecar 已连接');
      return;
    }
    setApiKey('');
    setMasked('');
    setHasKey(false);
    onToast('已删除本机保存的大模型 Key');
    setMessage('Key 已从本机安全存储中删除');
  }

  async function saveApplicationSettings() {
    setAppBusy(true);
    setAppMessage('');
    const result = await saveAppSettings(appSettings);
    if (!result) {
      setAppBusy(false);
      setAppMessage('保存失败，请确认 Sidecar 已连接');
      return;
    }
    setAppSettings(result);
    const bridge = getDesktopBridge();
    await bridge?.configureUpdates?.({ enabled: result.autoUpdate, intervalHours: result.updateIntervalHours });
    setAppBusy(false);
    setAppMessage('应用设置已保存');
    onToast('应用设置已保存');
  }

  async function toggleAiImport() {
    const enabled = !appSettings.aiImportEnabled;
    setAppBusy(true);
    setAppMessage('');
    const result = await saveAppSettings({ aiImportEnabled: enabled });
    setAppBusy(false);
    if (!result) {
      setAppMessage('保存失败，请确认 Sidecar 已连接');
      return;
    }
    setAppSettings((current) => ({ ...current, aiImportEnabled: result.aiImportEnabled }));
    setAppMessage(enabled ? '新导入资料将自动分析' : '新导入资料将只做本地解析');
  }

  async function saveMailbox() {
    setMailBusy('save');
    setMailMessage('');
    const result = await saveMailConfig({ email: mailEmail, ...(mailPassword ? { password: mailPassword } : {}) });
    setMailBusy(null);
    if (!result) {
      setMailMessage('保存失败，请检查邮箱地址和本地服务连接');
      return;
    }
    setMailConfig(result);
    setMailEmail(result.email);
    setMailPassword('');
    setMailMessage('邮箱配置已保存；保存操作不会连接或拉取邮件');
  }

  async function testMailbox() {
    setMailBusy('test');
    setMailMessage('正在测试 QQ 邮箱 IMAP 连接…');
    const result = await testMailConnection();
    setMailBusy(null);
    setMailMessage(!result ? '连接测试失败，请检查本地服务' : result.status === 'ok' ? '连接成功，可到导入中心勾选邮件' : `连接失败：${result.error || '请检查邮箱地址和授权码'}`);
  }

  async function exportBackup() {
    setBackupBusy('export');
    setBackupMessage('正在生成备份…');
    const blob = await downloadBackup();
    if (!blob) {
      setBackupBusy(null);
      setBackupMessage('备份导出失败，请确认 Sidecar 已连接');
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `clientatlas-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`;
    link.click();
    URL.revokeObjectURL(url);
    setBackupBusy(null);
    const backupList = await fetchBackups();
    if (backupList) setBackups(backupList);
    setBackupMessage('备份已导出，并保存在本机数据目录');
  }

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result || '');
        resolve(value.includes(',') ? value.split(',', 2)[1] : value);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function importBackup(file: File) {
    setBackupBusy('restore');
    setBackupMessage('正在校验并恢复备份…');
    try {
      const result = await restoreBackup(await readFileAsBase64(file));
      if (!result) {
        setBackupMessage('备份恢复失败，请确认文件有效且没有任务正在处理');
        setBackupBusy(null);
        return;
      }
      setBackupMessage('恢复成功，正在刷新本地数据…');
      window.setTimeout(() => window.location.reload(), 500);
    } catch {
      setBackupMessage('备份文件读取失败');
      setBackupBusy(null);
    }
  }

  function modelInput(value: string, setter: (v: string) => void, placeholder: string, listId: string) {
    return <><input list={listId} value={value} onChange={(e) => setter(e.target.value)} placeholder={placeholder} /><datalist id={listId}>{models.map((model) => <option key={model} value={model} />)}</datalist></>;
  }

  return (
    <>
      <header className="topbar settings-topbar"><div className="crumbs"><strong>设置</strong><span className="badge done">本地配置</span></div><div className="settings-topbar-meta"><span className="status-dot" />数据保存在本机</div></header>

      <div className="settings-page">
        <div className="settings-page-intro">
          <div className="settings-intro-copy"><div className="settings-eyebrow">WORKSPACE SETTINGS</div><div className="settings-page-description">{SETTINGS_SECTIONS.find((section) => section.id === activeSection)?.hint}</div></div>
          <nav className="settings-nav" aria-label="设置分区">
            {SETTINGS_SECTIONS.map((section, index) => <button key={section.id} type="button" className={activeSection === section.id ? 'on' : ''} onClick={() => setActiveSection(section.id)} aria-current={activeSection === section.id ? 'page' : undefined}><span>{String(index + 1).padStart(2, '0')}</span>{section.label}</button>)}
          </nav>
        </div>

      <div className="settings-workspace settings-workspace-expanded">
        <main className="settings-main-column">
          <section className="card settings-section" id="settings-llm" hidden={activeSection !== 'llm'}>
            <div className="card-head settings-card-head"><div className="settings-section-heading"><span className="settings-section-index">01</span><div><div className="card-title">大模型配置</div><div className="card-sub">为音频、文本和图像分析指定模型</div></div></div><a className="btn ghost settings-external-link" href={ALIYUN_BAILIAN} target="_blank" rel="noreferrer">前往阿里云百炼 ↗</a></div>
            <div className="llm-tip">Key 使用 Windows DPAPI 加密保存在本机。发布包不包含任何 API Key，备份文件也会排除密钥。</div>
            <div className="customer-form-grid">
              <label className="settings-field-wide">Base URL<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" /></label>
              <label className="settings-field-wide">API Key<input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasKey ? `已保存 ${masked}，留空表示不修改` : 'sk-...'} /></label>
              <label>音频转写模型 {modelInput(asrModel, setAsrModel, 'qwen3-asr-flash', 'asr-models')}</label>
              <label>文本 / 总结模型 {modelInput(summaryModel, setSummaryModel, 'qwen3.8-flash', 'summary-models')}</label>
              <label>视频 / 图像模型 {modelInput(visionModel, setVisionModel, 'qwen3.8-omni-flash', 'vision-models')}</label>
            </div>
            <div className="settings-actions settings-actions-spaced settings-llm-actions"><button className="btn" onClick={() => run('test')} disabled={busy !== null}>{busy === 'test' ? '测试中…' : '测试连接'}</button><button className="btn" onClick={() => run('pull')} disabled={busy !== null}>{busy === 'pull' ? '拉取中…' : '拉取模型'}</button><button className="btn primary" onClick={save} disabled={busy !== null || !baseUrl.trim()}>{busy === 'save' ? '保存中…' : '保存配置'}</button><button className="btn ghost danger-text" onClick={() => void clearKey()} disabled={busy !== null || !hasKey}>{busy === 'clear' ? '删除中…' : '删除已保存 Key'}</button></div>
            {message && <div className="llm-result settings-feedback" aria-live="polite">{message}</div>}
          </section>

          <section className="card settings-section" id="settings-data" hidden={activeSection !== 'data'}>
            <div className="card-head settings-card-head"><div className="settings-section-heading"><span className="settings-section-index">03</span><div><div className="card-title">数据与备份</div><div className="card-sub">客户、项目、附件和任务都保存在本机</div></div></div></div>
            <div className="settings-meta-grid settings-meta-grid-wide"><div><span>版本</span><strong>{appPackage.version}</strong></div><div><span>数据库</span><strong>{diagnostics ? formatBytes(diagnostics.databaseSize) : '未读取'}</strong></div><div><span>数据目录</span><strong title={diagnostics?.dataDir}>{diagnostics?.dataDir || '本机用户数据目录'}</strong></div><div><span>备份数量</span><strong>{backups.length} 份</strong></div></div>
            <div className="backup-panel"><div className="backup-panel-title">备份与恢复</div><div className="small-note">备份包含业务数据、附件和任务记录，不包含 API Key。恢复前会自动创建一份当前数据备份。</div><div className="settings-actions settings-actions-spaced"><button className="btn" onClick={exportBackup} disabled={backupBusy !== null}>{backupBusy === 'export' ? '导出中…' : '导出备份'}</button><button className="btn" onClick={() => backupInput.current?.click()} disabled={backupBusy !== null}>{backupBusy === 'restore' ? '恢复中…' : '从备份恢复'}</button><input ref={backupInput} className="file-input-hidden" type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void importBackup(file); }} /></div>{backups[0] && <div className="settings-last-backup">最近备份：{formatBackupDate(backups[0].createdAt)} · {formatBytes(backups[0].size)}</div>}{backupMessage && <div className="llm-result settings-feedback" aria-live="polite">{backupMessage}</div>}</div>
          </section>

          <section className="card settings-section" id="settings-archived" hidden={activeSection !== 'archived'}>
            <div className="card-head settings-card-head"><div className="settings-section-heading"><span className="settings-section-index">04</span><div><div className="card-title">已归档内容</div><div className="card-sub">删除客户后，相关项目会自动归档</div></div></div></div>
            <div className="small-note">恢复项目时会同时恢复缺失的客户档案；已删除的沟通记录、需求和待办不会恢复。</div>
            {archivedLoading ? (
              <div className="empty-panel">加载中...</div>
            ) : archivedError ? (
              <div className="empty-panel">归档项目加载失败，请确认已启动新版 Sidecar。<button className="btn" onClick={() => void retryArchivedProjects()}>重试</button></div>
            ) : archivedProjects.length === 0 ? (
              <div className="empty-panel">暂无归档项目</div>
            ) : (
              <div className="archived-project-list">
                {archivedProjects.map((project) => (
                  <div key={project.id} className="archived-project-item">
                    <div className="archived-project-main">
                      <strong>{project.name}</strong>
                      <small>{project.customer} · {project.customerCompany} · {project.stage}</small>
                    </div>
                    <button
                      className="btn ghost"
                      onClick={() => void handleRestoreProject(project.id)}
                      disabled={restoringProjectId !== null}
                    >
                      {restoringProjectId === project.id ? '恢复中…' : '恢复'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="settings-side-column">
          <section className="card settings-section" id="settings-diagnostics" hidden={activeSection !== 'diagnostics'}>
            <div className="card-head settings-card-head"><div className="settings-section-heading"><span className="settings-section-index">05</span><div><div className="card-title">本地服务与诊断</div><div className="card-sub">确认 Sidecar 和 FFmpeg 状态</div></div></div><button className="icon-btn" onClick={() => void refreshDiagnostics()} aria-label="刷新诊断" disabled={diagnosticBusy}><IconRefresh size={15} /></button></div>
            <div className="diagnostic-status"><span className={`status-dot ${sidecarHealth?.status === 'ok' ? 'online' : ''}`} /><strong>{healthLabel(sidecarHealth, diagnostics)}</strong><span>127.0.0.1:{diagnostics?.port || 8765}</span></div>
            <div className="settings-status-grid"><div><span>Sidecar</span><strong className={sidecarHealth?.status === 'ok' ? (sidecarHealth.apiRevision ?? 0) < 5 ? 'settings-warn' : 'settings-ok' : 'settings-warn'}>{sidecarHealth?.status === 'ok' ? `API ${sidecarHealth.apiRevision ?? '未知'}` : '未响应'}</strong></div><div><span>AI 模式</span><strong>{diagnostics?.mode === 'maas' || sidecarHealth?.mode === 'maas' ? 'MaaS' : sidecarHealth ? 'Mock' : '未检测'}</strong></div><div><span>FFmpeg</span><strong className={diagnostics?.ffmpeg.available ? 'settings-ok' : diagnostics ? 'settings-warn' : ''}>{diagnostics ? diagnostics.ffmpeg.available ? '可用' : '不可用' : sidecarHealth?.status === 'ok' ? '等待新版诊断' : '未检测'}</strong></div></div>
            <div className="small-note">Sidecar 版本：{sidecarHealth?.version || '—'} · API：{sidecarHealth?.apiRevision ?? '—'}</div><div className="settings-actions settings-actions-spaced"><button className="btn" onClick={() => void restartSidecar()} disabled={diagnosticBusy}>{diagnosticBusy ? '处理中…' : sidecarHealth?.status === 'ok' ? '重启本地服务' : '启动 / 重试服务'}</button><button className="btn" onClick={() => void refreshDiagnostics()} disabled={diagnosticBusy}>{diagnosticBusy ? '检测中…' : '重新检测'}</button></div>{diagnosticMessage && <div className="llm-result settings-feedback" aria-live="polite">{diagnosticMessage}</div>}
          </section>

          <section className="card settings-section" id="settings-import" hidden={activeSection !== 'import'}>
            <div className="card-head settings-card-head"><div className="settings-section-heading"><span className="settings-section-index">02</span><div><div className="card-title">导入默认值</div><div className="card-sub">新资料会沿用这些偏好</div></div></div></div>
            <div className="settings-form-stack"><label>默认负责人<input value={appSettings.defaultOwner} onChange={(e) => setAppSettings((current) => ({ ...current, defaultOwner: e.target.value }))} placeholder="例如：王总" /></label><label>默认项目<input value={appSettings.defaultProject} onChange={(e) => setAppSettings((current) => ({ ...current, defaultProject: e.target.value }))} placeholder="留空表示不指定" /></label><div className="settings-toggle-row"><div><strong>新资料自动 AI 分析</strong><span>开启后自动转写/解析并生成摘要与需求；客户和项目仍由你在导入时选择，未选择时保持未关联</span></div><button className={`switch ${appSettings.aiImportEnabled ? 'on' : ''}`} role="switch" aria-checked={appSettings.aiImportEnabled} disabled={appBusy} onClick={() => void toggleAiImport()} aria-label="新资料自动 AI 分析" /></div><button className="btn primary settings-save-btn" onClick={() => void saveApplicationSettings()} disabled={appBusy}>{appBusy ? '保存中…' : '保存导入默认值'}</button>{appMessage && <div className="llm-result settings-feedback" aria-live="polite">{appMessage}</div>}</div>
          </section>

          <section className="card settings-section" id="settings-updates" hidden={activeSection !== 'updates'}>
            <div className="card-head settings-card-head"><div className="settings-section-heading"><span className="settings-section-index">06</span><div><div className="card-title">更新设置</div><div className="card-sub">控制后台检查和下载行为</div></div></div></div>
            <div className="settings-toggle-row"><div><strong>自动检查更新</strong><span>发现新版本后提醒，下载由你确认</span></div><button className={`switch ${appSettings.autoUpdate ? 'on' : ''}`} onClick={() => setAppSettings((current) => ({ ...current, autoUpdate: !current.autoUpdate }))} aria-label="切换自动检查更新" /></div><label className="settings-field-inline">检查频率<select value={appSettings.updateIntervalHours} onChange={(e) => setAppSettings((current) => ({ ...current, updateIntervalHours: Number(e.target.value) }))}><option value={1}>每 1 小时</option><option value={3}>每 3 小时</option><option value={6}>每 6 小时</option><option value={12}>每 12 小时</option><option value={24}>每天</option></select></label><div className="settings-actions settings-actions-spaced settings-update-actions"><button className="btn" onClick={() => void checkUpdates()} disabled={updatePhase === 'checking' || updatePhase === 'progress' || updatePhase === 'downloaded' || updatePhase === 'installing'}>立即检查</button>{updatePhase === 'available' && <button className="btn primary" onClick={() => void downloadUpdate()}>下载更新</button>}{updatePhase === 'downloaded' && <button className="btn primary" onClick={() => void installUpdate()}>重启该应用</button>}<button className="btn primary" onClick={() => void saveApplicationSettings()} disabled={appBusy}>{appBusy ? '保存中…' : '保存更新设置'}</button></div>{updatePhase === 'progress' && <div className="settings-update-progress"><div><span>正在进行更新</span><strong>{Math.round(updateProgress)}%</strong></div><div className="version-progress"><span style={{ width: `${Math.min(100, Math.max(0, updateProgress))}%` }} /></div></div>}{updateStatus && <div className="llm-result settings-feedback" aria-live="polite">{updateStatus}</div>}
          </section>

          <section className="card settings-section" id="settings-notifications" hidden={activeSection !== 'notifications'}>
            <div className="card-head settings-card-head"><div className="settings-section-heading"><span className="settings-section-index">07</span><div><div className="card-title">待办提醒</div><div className="card-sub">到期日 09:00 提醒；启动应用后补充未送达的到期提醒</div></div></div></div>
            <div className="settings-form-stack">
              <div className="settings-toggle-row"><div><strong>Windows 系统通知</strong><span>应用运行时发送；应用内通知始终保留</span></div><button className={`switch ${appSettings.systemNotifications ? 'on' : ''}`} role="switch" aria-checked={appSettings.systemNotifications} aria-label="Windows 系统通知" onClick={() => setAppSettings((current) => ({ ...current, systemNotifications: !current.systemNotifications }))} /></div>
              <label>免打扰开始<input type="time" value={appSettings.quietStart} onChange={(e) => setAppSettings((current) => ({ ...current, quietStart: e.target.value }))} /></label>
              <label>免打扰结束<input type="time" value={appSettings.quietEnd} onChange={(e) => setAppSettings((current) => ({ ...current, quietEnd: e.target.value }))} /></label>
              <p className="small-note">开始与结束时间相同时关闭免打扰。关闭应用后不发送系统通知。</p>
              <button className="btn primary settings-save-btn" disabled={appBusy} onClick={() => void saveApplicationSettings()}>{appBusy ? '保存中…' : '保存通知设置'}</button>
              {appMessage && <div className="llm-result settings-feedback" aria-live="polite">{appMessage}</div>}
            </div>
          </section>
          <section className="card settings-section" id="settings-about" hidden={activeSection !== 'about'}>
            <div className="card-head settings-card-head"><div className="settings-section-heading"><span className="settings-section-index">08</span><div><div className="card-title">隐私与关于</div><div className="card-sub">本地优先，便于排查和恢复</div></div></div></div><div className="privacy-note"><strong>密钥存储</strong><span>{diagnostics?.apiKeyStorage || 'Windows DPAPI'}</span></div><div className="privacy-note"><strong>原始文件</strong><span>默认只保存在本机，不会自动上传</span></div><div className="privacy-note"><strong>当前版本</strong><span>ClientAtlas {appPackage.version} · API revision {sidecarHealth?.apiRevision ?? '—'}</span></div><div className="small-note">删除客户、恢复备份和删除 API Key 都会影响本机数据，请在操作前确认。</div>
          </section>
          <section className="card settings-section" id="settings-mail" hidden={activeSection !== 'mail'}>
            <div className="card-head settings-card-head"><div className="settings-section-heading"><span className="settings-section-index">09</span><div><div className="card-title">QQ 邮箱</div><div className="card-sub">IMAP 收件箱 · 手动拉取</div></div></div></div>
            <div className="settings-form-stack">
              <label>邮箱地址<input type="email" value={mailEmail} onChange={(event) => setMailEmail(event.target.value)} placeholder="name@qq.com" autoComplete="email" /></label>
              <label>IMAP 服务器<input value="imap.qq.com:993 · SSL" readOnly /></label>
              <label>IMAP 授权码<input type="password" value={mailPassword} onChange={(event) => setMailPassword(event.target.value)} placeholder={mailConfig?.configured ? '已加密保存，留空表示不修改' : '输入 QQ 邮箱授权码'} autoComplete="new-password" /></label>
              <div className="settings-actions settings-actions-spaced">
                <button className="btn" onClick={() => void saveMailbox()} disabled={mailBusy !== null || !mailEmail.trim()}>{mailBusy === 'save' ? '保存中…' : '保存配置'}</button>
                <button className="btn" onClick={() => void testMailbox()} disabled={mailBusy !== null || !mailConfig?.configured || mailEmail.trim().toLowerCase() !== mailConfig.email || !!mailPassword}>{mailBusy === 'test' ? '测试中…' : '测试连接'}</button>
                <button className="btn primary" onClick={onOpenMailImport} disabled={mailBusy !== null || !mailConfig?.configured || mailEmail.trim().toLowerCase() !== mailConfig.email || !!mailPassword}>选择邮件导入</button>
              </div>
              <div className="small-note">仅收件箱；首次读取近 30 天，之后增量更新列表。勾选并提交的邮件才进入资料，邮件只做本地解析，不自动进行 AI 分析。</div>
              {mailConfig?.lastDiscoverAt && <div className="settings-last-backup">上次更新列表：{formatBackupDate(mailConfig.lastDiscoverAt)}</div>}
              {mailConfig?.lastImportAt && <div className="settings-last-backup">上次导入：{formatBackupDate(mailConfig.lastImportAt)} · 处理 {mailConfig.lastImportCount} 封</div>}
              {mailMessage && <div className="llm-result settings-feedback" aria-live="polite">{mailMessage}</div>}
            </div>
          </section>
        </aside>
      </div>
      </div>
    </>
  );
}
