import { useEffect, useRef, useState } from 'react';
import type { CustomerProfile, CustomerProject, ImportRecord, MailMessage, ProjectListItem, TaskRecord, WeChatImportSelection } from '../types';
import { cancelTask, deleteTaskRecord, fetchAppSettings, fetchTask, fetchTasks, getHealth, getWechatImportStatus, importMailMessages, importWechatChat, retryTask, saveAppSettings } from '../api/client';
import { IconChat, IconFile, IconMic, IconRefresh, IconUpload } from './Icons';
import { getDesktopBridge } from '../desktopBridge';
import Modal from './Modal';
import MailImportModal from './MailImportModal';
import CustomerProfileModal from './CustomerProfileModal';
import ProjectModal from './ProjectModal';
import WeChatImportModal from './WeChatImportModal';
import { customerLabel, needsAssociation } from '../materials';

type ImportCenterProps = {
  onMaterials: () => void;
  imports: ImportRecord[];
  sidecarOnline: boolean;
  onAddFiles: (files: File[], chatScreenshot?: boolean) => Promise<File[]>;
  onPasteText: (text: string) => void;
  onOpenRecord: (record: ImportRecord) => void;
  onToast: (message: string) => void;
  onImportSubmitted: () => void;
  onDeleteRecord: (record: ImportRecord) => void;
  projects: ProjectListItem[];
  customers: string[];
  selectedCustomer: string;
  onCustomerChange: (name: string) => void;
  onCustomerCreated: (data: Partial<CustomerProfile> & { name: string; tags: string[] }) => Promise<CustomerProfile | null>;
  onProjectCreated: (customer: string, data: Partial<CustomerProject>) => Promise<CustomerProject | null>;
  selectedProject: string;
  onProjectChange: (name: string) => void;
};

type PendingImport = {
  id: string;
  kind: 'file' | 'mail' | 'wechat';
  name: string;
  detail: string;
  selected: boolean;
  status: 'ready' | 'running' | 'done' | 'failed';
  message?: string;
  file?: File;
  chatScreenshot?: boolean;
  mail?: MailMessage;
  email?: string;
  wechat?: WeChatImportSelection;
};

function fileIcon(type: string) {
  if (type === '音频') return <IconMic size={14} />;
  if (type === '聊天记录') return <IconChat size={14} />;
  return <IconFile size={14} />;
}

export default function ImportCenter({ imports, onMaterials, sidecarOnline, onAddFiles, onPasteText, onOpenRecord, onToast, onImportSubmitted, onDeleteRecord, projects, customers, selectedCustomer, onCustomerChange, onCustomerCreated, onProjectCreated, selectedProject, onProjectChange }: ImportCenterProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [mailOpen, setMailOpen] = useState(() => new URLSearchParams(window.location.search).get('mail') === '1');
  const [wechatOpen, setWechatOpen] = useState(false);
  const [componentOpen, setComponentOpen] = useState(false);
  const [componentProgress, setComponentProgress] = useState(0);
  const [componentBusy, setComponentBusy] = useState(false);
  const [componentError, setComponentError] = useState('');
  const [pending, setPending] = useState<PendingImport[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const batchRunning = useRef(false);
  const nextPendingId = useRef(0);
  const selectedPending = pending.filter((item) => item.selected && (item.status === 'ready' || item.status === 'failed'));
  const [aiImportEnabled, setAiImportEnabled] = useState(false);
  const [aiSettingLoaded, setAiSettingLoaded] = useState(false);
  const [aiSettingBusy, setAiSettingBusy] = useState(false);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [deletingTaskId, setDeletingTaskId] = useState('');
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);

  const done = imports.filter((x) => x.status === 'done' || x.status === 'inbox').length;
  const processing = imports.filter((x) => x.status === 'processing').length;

  useEffect(() => getDesktopBridge()?.onWeChatComponentProgress?.((percent) => setComponentProgress(percent)), []);

  async function openWechat() {
    if (!sidecarOnline) { onToast('本地服务未连接，请先启动服务'); return; }
    const bridge = getDesktopBridge();
    if (!bridge?.getWeChatComponent) { setWechatOpen(true); return; }
    const state = await bridge.getWeChatComponent();
    if (state.installed) setWechatOpen(true);
    else { setComponentError(''); setComponentOpen(true); }
  }

  async function downloadWechat() {
    const bridge = getDesktopBridge();
    if (!bridge?.downloadWeChatComponent || componentBusy) return;
    setComponentBusy(true);
    setComponentError('');
    setComponentProgress(0);
    const result = await bridge.downloadWeChatComponent();
    setComponentBusy(false);
    if (result.installed) { setComponentOpen(false); setWechatOpen(true); }
    else setComponentError(result.error || '下载或安装失败，请检查网络连接后重试');
  }

  useEffect(() => {
    if (!sidecarOnline) return;
    let mounted = true;
    void fetchAppSettings().then((settings) => {
      if (!mounted) return;
      if (settings) setAiImportEnabled(settings.aiImportEnabled);
      setAiSettingLoaded(true);
    });
    return () => { mounted = false; };
  }, [sidecarOnline]);

  async function toggleAiImport() {
    if (!aiSettingLoaded || aiSettingBusy) return;
    const enabled = !aiImportEnabled;
    setAiSettingBusy(true);
    const settings = await saveAppSettings({ aiImportEnabled: enabled });
    setAiSettingBusy(false);
    if (!settings) {
      onToast('保存失败，请确认 Sidecar 已连接');
      return;
    }
    setAiImportEnabled(settings.aiImportEnabled);
    onToast(settings.aiImportEnabled ? '新导入资料将自动 AI 分析' : '新导入资料仅本地解析');
  }

  async function saveImportCustomer(data: Partial<CustomerProfile> & { name: string; tags: string[] }) {
    const created = await onCustomerCreated(data);
    if (!created) { onToast('客户创建失败，请检查名称是否重复'); return false; }
    onCustomerChange(created.name);
    setCustomerModalOpen(false);
    onToast('客户已创建并设为本次导入客户');
    return true;
  }

  async function saveImportProject(data: Partial<CustomerProject>) {
    if (!selectedCustomer) return false;
    const created = await onProjectCreated(selectedCustomer, data);
    if (!created) { onToast('项目创建失败，请检查名称是否重复'); return false; }
    onProjectChange(created.name);
    setProjectModalOpen(false);
    onToast('项目已创建并设为默认项目');
    return true;
  }

  useEffect(() => {
    if (!sidecarOnline) {
      setTasks([]);
      return;
    }
    let mounted = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await fetchTasks();
        if (mounted && data) setTasks(data);
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    // 减少轮询频率：从 3000ms 增加到 5000ms
    const timer = window.setInterval(refresh, 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [sidecarOnline]);

  async function changeTask(task: TaskRecord, action: 'retry' | 'cancel') {
    const result = action === 'retry' ? await retryTask(task.id) : await cancelTask(task.id);
    if (!result) {
      onToast(action === 'retry' ? '任务重试失败' : '任务取消失败');
      return;
    }
    setTasks((current) => action === 'retry'
      ? [result, ...current.filter((item) => item.id !== task.id && item.id !== result.id)]
      : current.map((item) => item.id === result.id ? result : item));
    onToast(action === 'retry' ? '任务已重新排队' : '任务已取消');
  }

  async function removeTask(task: TaskRecord) {
    if (!window.confirm('确定删除这条处理任务记录？已导入的资料和分析结果会保留。')) return;
    setDeletingTaskId(task.id);
    const result = await deleteTaskRecord(task.id);
    setDeletingTaskId('');
    if (!result) {
      const health = await getHealth();
      onToast(health && (health.apiRevision ?? 0) < 24
        ? '本地服务版本较旧，请重启服务后再删除任务记录'
        : '删除失败；若任务刚取消，请等待任务收尾后重试');
      return;
    }
    setTasks((current) => current.filter((item) => item.id !== task.id));
    onToast('任务记录已删除，资料仍保留');
  }

  function taskStatus(task: TaskRecord) {
    if (task.status === 'running') return '处理中';
    if (task.status === 'queued') return '排队中';
    if (task.status === 'failed') return '失败';
    if (task.status === 'cancelled') return '已取消';
    return '已完成';
  }

  function acceptFiles(files: File[], chatScreenshot = false) {
    if (!files.length) return;
    setPending((current) => [...current, ...files.map((file): PendingImport => ({
      id: `file-${++nextPendingId.current}`, kind: 'file', name: file.name,
      detail: `${chatScreenshot ? '聊天截图' : '本地文件'} · ${Math.max(1, Math.round(file.size / 1024))} KB`,
      selected: true, status: 'ready', file, chatScreenshot,
    }))]);
  }

  function addMail(email: string, messages: MailMessage[]) {
    setPending((current) => {
      const existing = new Set(current.map((item) => item.id));
      return [...current, ...messages.filter((item) => !existing.has(`mail:${email}:${item.uidValidity}:${item.uid}`)).map((item): PendingImport => ({
        id: `mail:${email}:${item.uidValidity}:${item.uid}`, kind: 'mail', name: item.subject,
        detail: `邮箱邮件 · ${item.sender} · ${item.sentAt}`, selected: true, status: 'ready', mail: item, email,
      }))];
    });
  }

  function addWechat(selection: WeChatImportSelection) {
    const id = `wechat:${JSON.stringify(selection)}`;
    setPending((current) => current.some((item) => item.id === id) ? current : [...current, {
      id, kind: 'wechat', name: `${selection.customer || selection.username} · 微信聊天`,
      detail: `${selection.startDate || '不限开始'} 至 ${selection.endDate || '不限结束'} · 预计 ${selection.messageCount} 条`,
      selected: true, status: 'ready', wechat: selection,
    }]);
  }

  function updatePending(ids: string[], values: Partial<PendingImport>) {
    setPending((current) => current.map((item) => ids.includes(item.id) ? { ...item, ...values } : item));
  }

  async function submitPending() {
    if (batchRunning.current || !selectedPending.length || !sidecarOnline) return;
    batchRunning.current = true;
    setBatchBusy(true);
    const units: PendingImport[][] = [];
    for (const item of selectedPending) {
      const group = item.kind === 'mail' ? units.find((unit) => unit[0].kind === 'mail' && unit[0].email === item.email && unit[0].mail?.uidValidity === item.mail?.uidValidity && unit.length < 100) : undefined;
      if (group) group.push(item); else units.push([item]);
    }
    let succeeded = 0;
    let failed = 0;
    const pause = () => new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
    try {
      for (const unit of units) {
        const item = unit[0];
        const ids = unit.map((entry) => entry.id);
        updatePending(ids, { status: 'running', message: '正在提交…' });
        try {
          if (item.kind === 'file' && item.file) {
            const errors = await onAddFiles([item.file], item.chatScreenshot);
            if (errors.length) throw new Error('文件导入失败，请检查文件格式、大小或本地服务后重试');
          } else if (item.kind === 'wechat' && item.wechat) {
            let job = await importWechatChat({ ...item.wechat, customer: selectedCustomer, project: selectedProject });
            if (!job) throw new Error('微信提取未能启动，请检查微信组件或等待已有任务完成');
            const jobId = job.jobId;
            let missed = 0;
            while (job.status === 'running') {
              updatePending(ids, { message: `${job.message} ${job.progress ?? 0}%` });
              await pause();
              const next = await getWechatImportStatus();
              if (!next) { if (++missed >= 5) throw new Error('无法读取微信提取进度，请检查服务后重试'); continue; }
              missed = 0;
              if (next.jobId !== jobId) throw new Error('微信提取任务已变化，请检查资料后重试');
              job = next;
            }
            if (job.status !== 'done') throw new Error(job.message || '微信聊天提取失败');
          } else if (item.kind === 'mail' && item.mail && item.email) {
            const started = await importMailMessages(item.email, item.mail.uidValidity, unit.map((entry) => ({ uid: entry.mail!.uid })));
            if (!started?.taskId) throw new Error('邮件导入未能启动，请检查账号、候选列表或等待已有邮箱任务完成');
            let missed = 0;
            while (true) {
              const task = await fetchTask(started.taskId);
              if (!task) { if (++missed >= 5) throw new Error('无法读取邮件导入进度，请检查服务后重试'); await pause(); continue; }
              missed = 0;
              updatePending(ids, { message: task.stage || `正在导入 ${task.progress}%` });
              if (task.status === 'succeeded') break;
              if (task.status === 'failed' || task.status === 'cancelled') throw new Error(task.error || '邮件导入失败，可重试剩余邮件');
              await pause();
            }
          }
          succeeded += unit.length;
          updatePending(ids, { status: 'done', selected: false, message: '已提交，解析进度可在处理任务中查看' });
        } catch (error) {
          failed += unit.length;
          const reason = error instanceof Error ? error.message : '导入失败，请重试';
          updatePending(ids, { status: 'failed', message: item.kind === 'mail' ? `${reason}；同组已成功邮件会保留，重试自动跳过` : reason });
        }
        await onImportSubmitted();
      }
    } finally {
      batchRunning.current = false;
      setBatchBusy(false);
    }
    onToast(`本次成功提交 ${succeeded} 项${failed ? `，${failed} 项需重试检查，已成功内容保留且不会重复导入` : ''}`);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    acceptFiles(Array.from(e.dataTransfer.files));
  }

  function submitPaste() {
    if (!pasteText.trim()) {
      onToast('请先粘贴一段聊天记录');
      return;
    }
    onPasteText(pasteText.trim());
    setPasteText('');
    setPasteOpen(false);
  }

  return (
    <>
      <header className="topbar">
        <div className="crumbs">
          <strong>导入中心</strong>
          <span className="badge done">本地处理</span>
          <span className={`badge ${sidecarOnline ? 'done' : 'warn'}`} style={{ marginLeft: 2 }}>{sidecarOnline ? 'Sidecar 已连接' : '内置 Mock'}</span>
        </div>
        <div className="top-actions">
          <button className="btn" disabled={batchBusy} onClick={() => void openWechat()}><IconChat size={15} />从微信库提取</button>
          <button className="btn" disabled={batchBusy} onClick={() => setMailOpen(true)}>
            <IconFile size={15} />选择邮箱邮件
          </button>
          <button className="btn primary" disabled={batchBusy} onClick={() => fileInput.current?.click()}>
            <IconUpload size={15} />选择文件
          </button>
        </div>
      </header>

      <div className="kpi-row">
        <div className="kpi">
          <IconUpload className="icon" />
          <div><div className="kpi-num">{done}</div><div className="kpi-label">今日已导入</div></div>
        </div>
        <div className="kpi">
          <svg className="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          <div><div className="kpi-num">{processing}</div><div className="kpi-label">处理中</div></div>
        </div>
      </div>

      <div className="import-workspace">
        <div className="import-left">
          <section
            className={`dropzone ${dragOver ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); if (!batchBusy) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => { if (batchBusy) event.preventDefault(); else handleDrop(event); }}
          >
            <div className="drop-icon"><IconUpload size={28} /></div>
            <div className="drop-title">多种来源，加入清单后统一导入</div>
            <div className="drop-sub">本地文件、微信聊天和勾选的邮箱邮件，可以一次提交</div>
            <div className="drop-actions">
              <button className="btn primary" disabled={batchBusy} onClick={() => fileInput.current?.click()}>选择文件</button>
              <button className="btn" disabled={batchBusy} onClick={() => setPasteOpen(true)}>粘贴文本</button>
              <button className="btn" disabled={batchBusy} onClick={() => imageInput.current?.click()}>聊天截图</button>
              <button className="btn" disabled={batchBusy} onClick={() => void openWechat()}>从微信库提取</button>
              <button className="btn" disabled={batchBusy} onClick={() => setMailOpen(true)}>选择邮箱邮件</button>
            </div>
            <div className="drop-hint">单文件最大 100 MB · 普通图片自动 OCR · 聊天截图请使用专用入口</div>
            <div className="type-chips">
              <span className="type-chip">mp3 / m4a / wav</span><span className="type-chip">mp4 / mov</span><span className="type-chip">PDF / 扫描件</span><span className="type-chip">doc / docx / xls / xlsx</span><span className="type-chip">ppt / pptx</span><span className="type-chip">图片 / eml</span><span className="type-chip">txt / html / json</span>
            </div>
          </section>

          {pending.length > 0 && (
            <section className="card import-selection-card">
              <div className="card-head">
                <div><div className="card-title">待导入清单 · {pending.length} 项</div><div className="card-sub">选中 {selectedPending.length} 项；仅当前页面暂存，提交后按项处理，成功项保留</div></div>
                <button className="btn primary" disabled={batchBusy || !selectedPending.length || !sidecarOnline} onClick={() => void submitPending()}>{batchBusy ? '正在导入…' : `导入已选（${selectedPending.length}）`}</button>
              </div>
              <div className="import-selection-list">
                {pending.map((item) => (
                  <div className="import-selection-row" key={item.id}>
                    <input type="checkbox" aria-label={`选择 ${item.name}`} checked={item.selected} disabled={batchBusy || item.status === 'done'} onChange={() => setPending((current) => current.map((entry) => entry.id === item.id ? { ...entry, selected: !entry.selected } : entry))} />
                    <div><strong>{item.name}</strong><small>{item.detail}</small>{item.message && <small className={item.status === 'failed' ? 'danger-text' : ''}>{item.message}</small>}</div>
                    <span className={`badge ${item.status === 'done' ? 'done' : item.status === 'running' ? 'processing' : 'warn'}`}>{item.status === 'done' ? '已提交' : item.status === 'running' ? '处理中' : item.status === 'failed' ? '失败待重试' : '待提交'}</span>
                    <button className="btn ghost" disabled={batchBusy} onClick={() => setPending((current) => current.filter((entry) => entry.id !== item.id))}>移除</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {sidecarOnline && tasks.length > 0 && (
            <section className="card task-queue-card">
              <div className="card-head">
                <div><div className="card-title">处理任务</div><div className="card-sub">任务会持久化保存；失败后可重试，运行中可取消，结束后可删除记录</div></div>
                <IconRefresh size={15} className="muted-icon" />
              </div>
              <div className="task-queue-list">
                {tasks.slice(0, 8).map((task) => {
                  const record = imports.find((item) => item.id === task.importId);
                  return (
                    <div className="task-queue-row" key={task.id}>
                      <div className="task-queue-main">
                        <strong>{record?.fileName ?? (task.kind === 'chat_analysis' ? '聊天解析任务' : task.kind === 'mail_discover' ? '邮件列表读取' : task.kind === 'mail_import' ? '已选邮件导入' : '导入任务')}</strong>
                        <span>{taskStatus(task)} · 尝试 {task.attempt}/{task.maxAttempts} · {task.progress}%</span>
                        {task.error && <em>{task.error}</em>}
                      </div>
                      <div className="task-queue-actions">
                        {(task.status === 'failed' || task.status === 'cancelled') && <button className="btn ghost" onClick={() => void changeTask(task, 'retry')}>重试</button>}
                        {(task.status === 'queued' || task.status === 'running') && <button className="btn ghost danger-text" onClick={() => void changeTask(task, 'cancel')}>取消</button>}
                        {(task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled') && <button className="btn ghost danger-text" disabled={deletingTaskId === task.id} onClick={() => void removeTask(task)}>{deletingTaskId === task.id ? '删除中…' : '删除记录'}</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="card recent-card">
            <div className="card-head">
              <div><div className="card-title">最近导入</div><div className="card-sub">处理完成后可在资料中查看和关联</div></div>
              <span className="badge done">{imports.length} 条记录</span>
            </div>
            <div style={{ overflow: 'auto' }}>
              <table className="table">
                <thead><tr><th>文件</th><th>类型</th><th>大小</th><th>识别客户</th><th>状态</th><th>导入时间</th><th>操作</th></tr></thead>
                <tbody>
                  {imports.map((record) => (
                    <tr key={record.id} style={{ cursor: record.status === 'done' ? 'pointer' : 'default' }} onClick={() => onOpenRecord(record)}>
                      <td>
                        <div className="file-cell">
                          <div className="mini-ico">{fileIcon(record.type)}</div>
                          <div>
                            <div className="file-cell-name">{record.fileName}</div>
                            <div className="file-cell-sub">
                              {record.type} · {record.project === '—' ? '未关联项目' : record.project}
                              <button
                                className="file-delete-link"
                                onClick={(e) => { e.stopPropagation(); onDeleteRecord(record); }}
                              >删除</button>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>{record.type}</td>
                      <td>{record.size}</td>
                      <td>{customerLabel(record.customer)}</td>
                      <td>
                        {record.status === 'processing' ? (
                          <>
                            <span className="progress-line"><span style={{ width: `${record.progress}%` }} /></span>
                            <span className="badge processing">解析中</span>
                          </>
                        ) : record.status === 'done' || record.status === 'inbox' ? (
                          <span className="badge done">已完成</span>
                        ) : record.status === 'failed' ? (
                          <span className="badge" style={{ background: '#fef3f2', color: '#b42318' }}>处理失败</span>
                        ) : record.status === 'cancelled' ? (
                          <span className="badge warn">已取消</span>
                        ) : null}
                      </td>
                      <td>{record.importedAt}</td>
                      <td>
                        {needsAssociation(record) && <button className="btn import-archive-btn" onClick={(e) => { e.stopPropagation(); onMaterials(); }}>关联</button>}
                        <button
                          className="btn danger-btn import-delete-btn"
                          onClick={(e) => { e.stopPropagation(); onDeleteRecord(record); }}
                        >删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: '1px solid #f2f4f7', color: '#667085', fontSize: 10.5, background: '#fafbfc' }}>
              <span style={{ fontWeight: 600, color: '#344054' }}>处理流程</span>
              {aiImportEnabled
                ? <><span className="pill">转写 / 解析</span><span>→</span><span className="pill">生成摘要与需求</span></>
                : <><span className="pill">本地解析</span><span>→</span><span className="pill">保存资料</span><span>→</span><span>需要时在需求澄清中分析</span></>}
              <span style={{ marginLeft: 'auto', color: '#98a2b3' }}>未关联资料可在「资料」中确认归属</span>
            </div>
          </section>
        </div>

        <aside className="card settings-card">
          <div className="card-head"><div><div className="card-title">导入设置</div><div className="card-sub">AI 设置与设置页共享，仅影响之后新导入资料</div></div></div>
          <div className="settings-body">
            <div className="setting">
              <div className="import-setting-label"><div className="setting-label">关联客户</div><button className="import-setting-create" disabled={batchBusy} onClick={() => setCustomerModalOpen(true)}>＋ 新建客户</button></div>
              <select className="select" disabled={batchBusy} value={selectedCustomer} onChange={(e) => onCustomerChange(e.target.value)}>
                <option value="">暂不关联客户</option>
                {customers.map((customer) => <option key={customer} value={customer}>{customer}</option>)}
              </select>
            </div>
            <div className="setting">
              <div className="import-setting-label"><div className="setting-label">默认项目</div><button className="import-setting-create" disabled={batchBusy || !selectedCustomer} onClick={() => setProjectModalOpen(true)}>＋ 新建项目</button></div>
              <select className="select" disabled={batchBusy} value={selectedProject} onChange={(e) => onProjectChange(e.target.value)}>
                <option value="">不指定项目</option>
                {projects.filter((project) => !selectedCustomer || project.customer === selectedCustomer).map((project) => <option key={project.id} value={project.name}>{project.name}（{project.customer}）</option>)}
              </select>
            </div>
            <div className="setting">
              <div className="setting-top">
                <div><div className="setting-label">新资料自动 AI 分析</div><div className="setting-desc">关闭时仅本地解析；音视频在需求澄清中手动启动时转写</div></div>
                <button className={`switch ${aiImportEnabled ? 'on' : ''}`} role="switch" aria-checked={aiImportEnabled} disabled={!aiSettingLoaded || aiSettingBusy || batchBusy} onClick={() => void toggleAiImport()} aria-label="新资料自动 AI 分析" />
              </div>
            </div>
            <div className="small-note">未指定客户的资料会保留在「资料」中，可随时关联或新建客户和项目。</div>
          </div>
        </aside>
      </div>

      <footer className="statusbar">
        <div className="status-left"><span><span className="status-dot" />本地数据 · 原始文件保存在本机</span><span>新资料自动 AI：{aiSettingLoaded && aiImportEnabled ? '开启' : '关闭'}</span></div>
        <div>客户信息聚合工作台 · Sprint 2</div>
      </footer>

      <input ref={fileInput} className="file-input-hidden" type="file" multiple onChange={(e) => { acceptFiles(Array.from(e.target.files ?? [])); e.currentTarget.value = ''; }} />
      <input ref={imageInput} className="file-input-hidden" type="file" accept="image/*" multiple onChange={(e) => { acceptFiles(Array.from(e.target.files ?? []), true); e.currentTarget.value = ''; }} />

      <Modal open={pasteOpen} title="粘贴聊天记录" subtitle="支持微信聊天文字、邮件正文或任意文本" onClose={() => setPasteOpen(false)}>
        <div className="modal-body">
          <textarea className="modal-textarea" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="把聊天记录粘贴到这里，例如：&#10;张三：我们想做一个会员小程序，预算 8–10 万&#10;我：明白，我周五前把方案发您" />
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => setPasteOpen(false)}>取消</button>
          <button className="btn primary" onClick={submitPaste}>导入并解析</button>
        </div>
      </Modal>

      <MailImportModal open={mailOpen} onClose={() => setMailOpen(false)} onSelected={addMail} />
      <WeChatImportModal open={wechatOpen} onClose={() => setWechatOpen(false)} onSelected={addWechat} onToast={onToast} />
      <Modal open={componentOpen} title="微信库提取组件" subtitle="此组件尚未安装，需要下载后才能提取本地微信聊天记录" onClose={() => { if (!componentBusy) setComponentOpen(false); }}>
        <div className="modal-body">
          <p>组件只在首次使用时下载，安装在本机用户目录；已有组件的旧版用户会直接进入提取界面。</p>
          {componentBusy && <div role="status">下载中 {componentProgress}%<div className="wechat-progress-track"><span style={{ width: `${componentProgress}%` }} /></div></div>}
          {componentError && <p role="alert" className="danger-text">{componentError}</p>}
        </div>
        <div className="modal-actions"><button className="btn" disabled={componentBusy} onClick={() => setComponentOpen(false)}>取消</button><button className="btn primary" disabled={componentBusy} onClick={() => void downloadWechat()}>{componentBusy ? '下载中…' : '下载组件'}</button></div>
      </Modal>
      <CustomerProfileModal open={customerModalOpen} onClose={() => setCustomerModalOpen(false)} onSave={saveImportCustomer} />
      <ProjectModal open={projectModalOpen} customerName={selectedCustomer} onClose={() => setProjectModalOpen(false)} onSave={saveImportProject} />
    </>
  );
}
