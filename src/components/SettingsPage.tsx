import { useEffect, useRef, useState } from 'react';
import type { AppSettings, BackupSummary, Diagnostics, LlmConfig, LlmModelsResult, WeChatStatus } from '../types';
import {
  clearLlmApiKey,
  downloadBackup,
  fetchAppSettings,
  fetchBackups,
  fetchDiagnostics,
  fetchLlmConfig,
  getWechatStatus,
  pullLlmModels,
  restoreBackup,
  saveAppSettings,
  saveLlmConfig,
  testLlmConfig,
} from '../api/client';
import { IconRefresh } from './Icons';

type SettingsPageProps = {
  onToast: (message: string) => void;
};

type SettingsSectionId = 'llm' | 'import' | 'data' | 'diagnostics' | 'updates' | 'about';

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string; hint: string }> = [
  { id: 'llm', label: '大模型', hint: '配置音频、文本和图像分析使用的模型' },
  { id: 'import', label: '导入偏好', hint: '设置新资料的默认负责人、项目和处理方式' },
  { id: 'data', label: '数据与备份', hint: '管理本地数据库、附件和备份文件' },
  { id: 'diagnostics', label: '本地诊断', hint: '查看 Sidecar、FFmpeg 和微信引擎状态' },
  { id: 'updates', label: '更新', hint: '控制自动更新检查和检查频率' },
  { id: 'about', label: '隐私与关于', hint: '查看密钥存储、版本和本地文件说明' },
];

const ALIYUN_BAILIAN = 'https://bailian.console.aliyun.com/';
const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultProject: '',
  defaultOwner: '王总',
  autoMatch: true,
  autoProcess: true,
  autoUpdate: true,
  updateIntervalHours: 3,
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

function healthLabel(diagnostics: Diagnostics | null) {
  if (!diagnostics) return '未连接';
  return diagnostics.status === 'ok' ? '运行正常' : '需要检查';
}

export default function SettingsPage({ onToast }: SettingsPageProps) {
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
  const [updatePhase, setUpdatePhase] = useState<'idle' | 'checking' | 'available' | 'progress' | 'downloaded' | 'none' | 'error'>('idle');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [backupBusy, setBackupBusy] = useState<'export' | 'restore' | null>(null);
  const [backupMessage, setBackupMessage] = useState('');
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [appBusy, setAppBusy] = useState(false);
  const [appMessage, setAppMessage] = useState('');
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [wechatStatus, setWechatStatus] = useState<WeChatStatus | null>(null);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [diagnosticMessage, setDiagnosticMessage] = useState('');
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('llm');
  const backupInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const bridge = (window as unknown as { clientHub?: { onUpdateStatus?: (cb: (payload: { status: string; version?: string; percent?: number }) => void) => (() => void) | void; getUpdateState?: () => Promise<{ status: string; version?: string; percent?: number } | null> } }).clientHub;
    if (!bridge?.onUpdateStatus) return;
    const applyUpdateState = (payload: { status: string; version?: string; percent?: number }) => {
      if (payload.status === 'checking') { setUpdatePhase('checking'); setUpdateStatus('正在检查更新…'); }
      else if (payload.status === 'available') { setUpdatePhase('available'); setUpdateStatus(`发现新版本 ${payload.version || ''}，点击下载`); }
      else if (payload.status === 'progress') { setUpdatePhase('progress'); setUpdateProgress(payload.percent || 0); setUpdateStatus('正在下载更新…'); }
      else if (payload.status === 'downloaded') { setUpdatePhase('downloaded'); setUpdateProgress(100); setUpdateStatus(`新版本 ${payload.version || ''} 已下载，点击重启应用`); }
      else if (payload.status === 'none') { setUpdatePhase('none'); setUpdateStatus('当前已是最新版本'); }
      else if (payload.status === 'error') { setUpdatePhase('error'); setUpdateStatus('更新检查失败，请稍后重试'); }
    };
    const cleanup = bridge.onUpdateStatus(applyUpdateState);
    void bridge.getUpdateState?.().then((payload) => { if (payload) applyUpdateState(payload); });
    return cleanup;
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([fetchLlmConfig(), fetchAppSettings(), fetchBackups(), fetchDiagnostics(), getWechatStatus()]).then(([llm, app, backupList, diag, wechat]) => {
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
      if (diag) setDiagnostics(diag);
      if (wechat) setWechatStatus(wechat);
    });
    return () => { mounted = false; };
  }, []);

  const currentConfig: Partial<LlmConfig> & { apiKey?: string } = { baseUrl, apiKey, asrModel, summaryModel, visionModel };

  async function checkUpdates() {
    setUpdatePhase('checking');
    setUpdateStatus('正在检查更新…');
    const bridge = (window as unknown as { clientHub?: { checkForUpdates?: () => Promise<{ status: string }> } }).clientHub;
    if (!bridge?.checkForUpdates) {
      setUpdateStatus('开发模式下暂不提供更新检查');
      return;
    }
    const result = await bridge.checkForUpdates();
    if (result.status === 'dev') { setUpdatePhase('none'); setUpdateStatus('开发模式下暂不提供更新检查'); }
    else if (result.status === 'error') { setUpdatePhase('error'); setUpdateStatus('更新检查失败，请稍后重试'); }
  }

  async function downloadUpdate() {
    const bridge = (window as unknown as { clientHub?: { downloadUpdate?: () => Promise<{ status: string }> } }).clientHub;
    setUpdatePhase('progress');
    setUpdateProgress(0);
    setUpdateStatus('正在下载更新…');
    const result = await bridge?.downloadUpdate?.();
    if (!result || result.status === 'error') {
      setUpdatePhase('error');
      setUpdateStatus(result?.status === 'error' ? '更新下载失败，请稍后重试' : '开发模式下暂不提供更新下载');
    }
  }

  async function installUpdate() {
    const bridge = (window as unknown as { clientHub?: { installUpdate?: () => Promise<boolean> } }).clientHub;
    await bridge?.installUpdate?.();
  }

  async function refreshDiagnostics() {
    setDiagnosticBusy(true);
    setDiagnosticMessage('正在读取本地服务状态…');
    const [diag, wechat, backupList] = await Promise.all([fetchDiagnostics(), getWechatStatus(), fetchBackups()]);
    if (diag) setDiagnostics(diag);
    if (wechat) setWechatStatus(wechat);
    if (backupList) setBackups(backupList);
    setDiagnosticBusy(false);
    setDiagnosticMessage(diag ? '状态已刷新' : '本地服务未响应，请确认 Sidecar 已启动');
  }

  async function restartSidecar() {
    setDiagnosticBusy(true);
    setDiagnosticMessage('正在重启本地服务…');
    const bridge = (window as unknown as { clientHub?: { restartSidecar?: () => Promise<{ status: string }> } }).clientHub;
    const result = await bridge?.restartSidecar?.();
    if (!result || result.status === 'dev') {
      setDiagnosticBusy(false);
      setDiagnosticMessage('开发模式请重启 npm / Electron 启动命令');
      return;
    }
    window.setTimeout(() => { void refreshDiagnostics(); }, 800);
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
    const bridge = (window as unknown as { clientHub?: { configureUpdates?: (settings: { enabled: boolean; intervalHours: number }) => Promise<boolean> } }).clientHub;
    await bridge?.configureUpdates?.({ enabled: result.autoUpdate, intervalHours: result.updateIntervalHours });
    setAppBusy(false);
    setAppMessage('导入与更新设置已保存');
    onToast('应用设置已保存');
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
    link.download = `clienthub-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`;
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
            <div className="card-head settings-card-head"><div className="settings-section-heading"><span className="settings-section-index">02</span><div><div className="card-title">数据与备份</div><div className="card-sub">客户、项目、附件和任务都保存在本机</div></div></div></div>
            <div className="settings-meta-grid settings-meta-grid-wide"><div><span>版本</span><strong>0.2.6</strong></div><div><span>数据库</span><strong>{diagnostics ? formatBytes(diagnostics.databaseSize) : '未读取'}</strong></div><div><span>数据目录</span><strong title={diagnostics?.dataDir}>{diagnostics?.dataDir || '本机用户数据目录'}</strong></div><div><span>备份数量</span><strong>{backups.length} 份</strong></div></div>
            <div className="backup-panel"><div className="backup-panel-title">备份与恢复</div><div className="small-note">备份包含业务数据、附件和任务记录，不包含 API Key。恢复前会自动创建一份当前数据备份。</div><div className="settings-actions settings-actions-spaced"><button className="btn" onClick={exportBackup} disabled={backupBusy !== null}>{backupBusy === 'export' ? '导出中…' : '导出备份'}</button><button className="btn" onClick={() => backupInput.current?.click()} disabled={backupBusy !== null}>{backupBusy === 'restore' ? '恢复中…' : '从备份恢复'}</button><input ref={backupInput} className="file-input-hidden" type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void importBackup(file); }} /></div>{backups[0] && <div className="settings-last-backup">最近备份：{formatBackupDate(backups[0].createdAt)} · {formatBytes(backups[0].size)}</div>}{backupMessage && <div className="llm-result settings-feedback" aria-live="polite">{backupMessage}</div>}</div>
          </section>
        </main>

        <aside className="settings-side-column">
          <section className="card settings-section" id="settings-diagnostics" hidden={activeSection !== 'diagnostics'}>
            <div className="card-head settings-card-head"><div className="settings-section-heading"><span className="settings-section-index">03</span><div><div className="card-title">本地服务与诊断</div><div className="card-sub">确认 Sidecar、FFmpeg 和微信引擎状态</div></div></div><button className="icon-btn" onClick={() => void refreshDiagnostics()} aria-label="刷新诊断" disabled={diagnosticBusy}><IconRefresh size={15} /></button></div>
            <div className="diagnostic-status"><span className={`status-dot ${diagnostics ? 'online' : ''}`} /><strong>{healthLabel(diagnostics)}</strong><span>127.0.0.1:{diagnostics?.port || 8765}</span></div>
            <div className="settings-status-grid"><div><span>Sidecar</span><strong>{diagnostics ? `API ${diagnostics.apiRevision}` : '未连接'}</strong></div><div><span>AI 模式</span><strong>{diagnostics?.mode === 'maas' ? 'MaaS' : 'Mock'}</strong></div><div><span>FFmpeg</span><strong className={diagnostics?.ffmpeg.available ? 'settings-ok' : 'settings-warn'}>{diagnostics?.ffmpeg.available ? '可用' : '未检测'}</strong></div><div><span>微信引擎</span><strong className={wechatStatus?.available ? 'settings-ok' : 'settings-warn'}>{wechatStatus?.available ? '可用' : '未连接'}</strong></div></div>
            <div className="small-note">版本：{diagnostics?.version || '—'} · 微信账号：{wechatStatus?.accounts?.length || 0} 个</div><div className="settings-actions settings-actions-spaced"><button className="btn" onClick={() => void restartSidecar()} disabled={diagnosticBusy}>{diagnosticBusy ? '处理中…' : '重启本地服务'}</button></div>{diagnosticMessage && <div className="llm-result settings-feedback" aria-live="polite">{diagnosticMessage}</div>}
          </section>

          <section className="card settings-section" id="settings-import" hidden={activeSection !== 'import'}>
            <div className="card-head settings-card-head"><div className="settings-section-heading"><span className="settings-section-index">04</span><div><div className="card-title">导入默认值</div><div className="card-sub">新资料会沿用这些偏好</div></div></div></div>
            <div className="settings-form-stack"><label>默认负责人<input value={appSettings.defaultOwner} onChange={(e) => setAppSettings((current) => ({ ...current, defaultOwner: e.target.value }))} placeholder="例如：王总" /></label><label>默认项目<input value={appSettings.defaultProject} onChange={(e) => setAppSettings((current) => ({ ...current, defaultProject: e.target.value }))} placeholder="留空表示按内容判断" /></label><div className="settings-toggle-row"><div><strong>自动识别客户</strong><span>按手机号、微信号、邮箱和文件名匹配</span></div><button className={`switch ${appSettings.autoMatch ? 'on' : ''}`} onClick={() => setAppSettings((current) => ({ ...current, autoMatch: !current.autoMatch }))} aria-label="切换自动识别客户" /></div><div className="settings-toggle-row"><div><strong>导入后自动处理</strong><span>转写、摘要、需求抽取和建索引</span></div><button className={`switch ${appSettings.autoProcess ? 'on' : ''}`} onClick={() => setAppSettings((current) => ({ ...current, autoProcess: !current.autoProcess }))} aria-label="切换导入后自动处理" /></div><button className="btn primary settings-save-btn" onClick={() => void saveApplicationSettings()} disabled={appBusy}>{appBusy ? '保存中…' : '保存导入设置'}</button>{appMessage && <div className="llm-result settings-feedback" aria-live="polite">{appMessage}</div>}</div>
          </section>

          <section className="card settings-section" id="settings-updates" hidden={activeSection !== 'updates'}>
            <div className="card-head settings-card-head"><div className="settings-section-heading"><span className="settings-section-index">05</span><div><div className="card-title">更新设置</div><div className="card-sub">控制后台检查和下载行为</div></div></div></div>
            <div className="settings-toggle-row"><div><strong>自动检查更新</strong><span>发现新版本后提醒，下载由你确认</span></div><button className={`switch ${appSettings.autoUpdate ? 'on' : ''}`} onClick={() => setAppSettings((current) => ({ ...current, autoUpdate: !current.autoUpdate }))} aria-label="切换自动检查更新" /></div><label className="settings-field-inline">检查频率<select value={appSettings.updateIntervalHours} onChange={(e) => setAppSettings((current) => ({ ...current, updateIntervalHours: Number(e.target.value) }))}><option value={1}>每 1 小时</option><option value={3}>每 3 小时</option><option value={6}>每 6 小时</option><option value={12}>每 12 小时</option><option value={24}>每天</option></select></label><div className="settings-actions settings-actions-spaced settings-update-actions"><button className="btn" onClick={() => void checkUpdates()} disabled={updatePhase === 'checking' || updatePhase === 'progress'}>立即检查</button>{updatePhase === 'available' && <button className="btn primary" onClick={() => void downloadUpdate()}>下载更新</button>}{updatePhase === 'downloaded' && <button className="btn primary" onClick={() => void installUpdate()}>重启该应用</button>}<button className="btn primary" onClick={() => void saveApplicationSettings()} disabled={appBusy}>{appBusy ? '保存中…' : '保存更新设置'}</button></div>{updatePhase === 'progress' && <div className="settings-update-progress"><div><span>下载进度</span><strong>{Math.round(updateProgress)}%</strong></div><div className="version-progress"><span style={{ width: `${Math.min(100, Math.max(0, updateProgress))}%` }} /></div></div>}{updateStatus && <div className="llm-result settings-feedback" aria-live="polite">{updateStatus}</div>}
          </section>

          <section className="card settings-section" id="settings-about" hidden={activeSection !== 'about'}>
            <div className="card-head settings-card-head"><div className="settings-section-heading"><span className="settings-section-index">06</span><div><div className="card-title">隐私与关于</div><div className="card-sub">本地优先，便于排查和恢复</div></div></div></div><div className="privacy-note"><strong>密钥存储</strong><span>{diagnostics?.apiKeyStorage || 'Windows DPAPI'}</span></div><div className="privacy-note"><strong>原始文件</strong><span>默认只保存在本机，不会自动上传</span></div><div className="privacy-note"><strong>当前版本</strong><span>ClientHub 0.2.6 · API revision 4</span></div><div className="small-note">删除客户、恢复备份和删除 API Key 都会影响本机数据，请在操作前确认。</div>
          </section>
        </aside>
      </div>
      </div>
    </>
  );
}
