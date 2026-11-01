import { useEffect, useRef, useState } from 'react';
import type { ImportRecord, ProjectListItem, TaskRecord } from '../types';
import { cancelTask, fetchTasks, retryTask } from '../api/client';
import { IconChat, IconFile, IconMic, IconRefresh, IconUpload } from './Icons';
import Modal from './Modal';
import WeChatImportModal from './WeChatImportModal';
import { needsArchive } from './InboxArchive';

type ImportCenterProps = {
  onInbox: () => void;
  imports: ImportRecord[];
  sidecarOnline: boolean;
  onAddFiles: (files: File[], chatScreenshot?: boolean) => void;
  onPasteText: (text: string) => void;
  onOpenRecord: (record: ImportRecord) => void;
  onToast: (message: string) => void;
  onWechatImported: () => void;
  onDeleteRecord: (record: ImportRecord) => void;
  projects: ProjectListItem[];
  selectedProject: string;
  onProjectChange: (name: string) => void;
};

function fileIcon(type: string) {
  if (type === '音频') return <IconMic size={14} />;
  if (type === '聊天记录') return <IconChat size={14} />;
  return <IconFile size={14} />;
}

export default function ImportCenter({ imports, onInbox, sidecarOnline, onAddFiles, onPasteText, onOpenRecord, onToast, onWechatImported, onDeleteRecord, projects, selectedProject, onProjectChange }: ImportCenterProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [wechatOpen, setWechatOpen] = useState(() => new URLSearchParams(window.location.search).get('wechat') === '1');
  const [autoMatch, setAutoMatch] = useState(true);
  const [autoProcess, setAutoProcess] = useState(true);
  const [aiMode, setAiMode] = useState<'aliyun' | 'mock'>('aliyun');
  const [tasks, setTasks] = useState<TaskRecord[]>([]);

  const done = imports.filter((x) => x.status === 'done').length;
  const processing = imports.filter((x) => x.status === 'processing').length;
  const inbox = imports.filter(needsArchive).length;

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
    const timer = window.setInterval(refresh, 3000);
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

  function taskStatus(task: TaskRecord) {
    if (task.status === 'running') return '处理中';
    if (task.status === 'queued') return '排队中';
    if (task.status === 'failed') return '失败';
    if (task.status === 'cancelled') return '已取消';
    return '已完成';
  }

  function acceptFiles(files: File[]) {
    if (!files.length) return;
    onAddFiles(files);
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
          <button className="btn" onClick={() => setWechatOpen(true)}>
            <IconChat size={15} />从微信库提取
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()}>
            <IconFile size={15} />批量导入
          </button>
          <button className="btn primary" onClick={() => fileInput.current?.click()}>
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
        <button className="kpi kpi-inbox" onClick={onInbox} aria-label={`处理 ${inbox} 条待归档资料`}>
          <svg className="icon" viewBox="0 0 24 24"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
          <div><div className="kpi-num">{inbox}</div><div className="kpi-label">待归档</div></div>
        </button>
        <div className="kpi" style={{ marginLeft: 'auto' }}>
          <IconMic className="icon" />
          <div><div className="kpi-num">32:18</div><div className="kpi-label">最近一条录音</div></div>
        </div>
      </div>

      <div className="import-workspace">
        <div className="import-left">
          <section
            className={`dropzone ${dragOver ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="drop-icon"><IconUpload size={28} /></div>
            <div className="drop-title">拖入文件，自动识别客户</div>
            <div className="drop-sub">通话录音、微信聊天记录、邮件、需求文档、截图，统一进入客户时间线</div>
            <div className="drop-actions">
              <button className="btn primary" onClick={() => fileInput.current?.click()}>选择文件</button>
              <button className="btn" onClick={() => setPasteOpen(true)}>粘贴文本</button>
              <button className="btn" onClick={() => imageInput.current?.click()}>聊天截图</button>
              <button className="btn" onClick={() => setWechatOpen(true)}>从微信库提取</button>
            </div>
            <div className="drop-hint">单文件最大 100 MB · 普通图片自动 OCR · 聊天截图请使用专用入口</div>
            <div className="type-chips">
              <span className="type-chip">mp3 / m4a / wav</span><span className="type-chip">mp4 / mov</span><span className="type-chip">PDF / 扫描件</span><span className="type-chip">doc / docx / xls / xlsx</span><span className="type-chip">ppt / pptx</span><span className="type-chip">图片 / eml</span><span className="type-chip">txt / html / json</span>
            </div>
          </section>

          {sidecarOnline && tasks.length > 0 && (
            <section className="card task-queue-card">
              <div className="card-head">
                <div><div className="card-title">处理任务</div><div className="card-sub">任务会持久化保存；失败后可重试，运行中可取消</div></div>
                <IconRefresh size={15} className="muted-icon" />
              </div>
              <div className="task-queue-list">
                {tasks.slice(0, 8).map((task) => {
                  const record = imports.find((item) => item.id === task.importId);
                  return (
                    <div className="task-queue-row" key={task.id}>
                      <div className="task-queue-main">
                        <strong>{record?.fileName ?? (task.kind === 'chat_analysis' ? '聊天解析任务' : '导入任务')}</strong>
                        <span>{taskStatus(task)} · 尝试 {task.attempt}/{task.maxAttempts} · {task.progress}%</span>
                        {task.error && <em>{task.error}</em>}
                      </div>
                      <div className="task-queue-actions">
                        {(task.status === 'failed' || task.status === 'cancelled') && <button className="btn ghost" onClick={() => void changeTask(task, 'retry')}>重试</button>}
                        {(task.status === 'queued' || task.status === 'running') && <button className="btn ghost danger-text" onClick={() => void changeTask(task, 'cancel')}>取消</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="card recent-card">
            <div className="card-head">
              <div><div className="card-title">最近导入</div><div className="card-sub">处理完成后自动进入客户时间线</div></div>
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
                              {record.type} · {record.project}
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
                      <td>{record.customer}</td>
                      <td>
                        {record.status === 'processing' ? (
                          <>
                            <span className="progress-line"><span style={{ width: `${record.progress}%` }} /></span>
                            <span className="badge processing">解析中</span>
                          </>
                        ) : record.status === 'done' ? (
                          <span className="badge done">已完成</span>
                        ) : record.status === 'failed' ? (
                          <span className="badge" style={{ background: '#fef3f2', color: '#b42318' }}>处理失败</span>
                        ) : record.status === 'cancelled' ? (
                          <span className="badge warn">已取消</span>
                        ) : (
                          <span className="badge warn">待归档</span>
                        )}
                      </td>
                      <td>{record.importedAt}</td>
                      <td>
                        {needsArchive(record) && <button className="btn import-archive-btn" onClick={(e) => { e.stopPropagation(); onOpenRecord(record); }}>确认归属</button>}
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
              <span className="pill">识别客户</span><span>→</span><span className="pill">转写 / 解析</span><span>→</span><span className="pill">生成摘要与需求</span>
              <span style={{ marginLeft: 'auto', color: '#98a2b3' }}>未确认客户的资料可在「待归档」中确认归属</span>
            </div>
          </section>
        </div>

        <aside className="card settings-card">
          <div className="card-head"><div><div className="card-title">导入设置</div><div className="card-sub">仅影响本次导入</div></div></div>
          <div className="settings-body">
            <div className="setting">
              <div className="setting-top">
                <div><div className="setting-label">自动识别客户</div><div className="setting-desc">手机号 / 微信号 / 邮箱 / 文件名</div></div>
                <button className={`switch ${autoMatch ? 'on' : ''}`} onClick={() => setAutoMatch(!autoMatch)} aria-label="切换自动识别客户" />
              </div>
            </div>
            <div className="setting">
              <div className="setting-label">默认项目</div>
              <select className="select" value={selectedProject} onChange={(e) => onProjectChange(e.target.value)}>
                <option value="">不指定，按沟通内容判断</option>
                {projects.map((project) => <option key={project.id} value={project.name}>{project.name}（{project.customer}）</option>)}
              </select>
            </div>
            <div className="setting">
              <div className="setting-label">AI 处理模式</div>
              <div className="segmented">
                <button className={aiMode === 'aliyun' ? 'on' : ''} onClick={() => setAiMode('aliyun')}>阿里云百炼</button>
                <button className={aiMode === 'mock' ? 'on' : ''} onClick={() => setAiMode('mock')}>Mock</button>
              </div>
              <div className="setting-desc" style={{ marginTop: 7 }}>真实模式会消耗 API 额度；Mock 用于演示流程。</div>
            </div>
            <div className="setting">
              <div className="setting-label">识别规则</div>
              <div className="rule-list">
                <div className="rule"><span className="dot" />文件名包含客户姓名或公司名</div>
                <div className="rule"><span className="dot" />通话记录中的手机号匹配</div>
                <div className="rule"><span className="dot" />微信导出文件中的备注名匹配</div>
                <div className="rule"><span className="dot" />邮件发件人 / 收件人邮箱匹配</div>
              </div>
            </div>
            <div className="setting">
              <div className="setting-label">导入后自动处理</div>
              <div className="setting-top"><div className="setting-desc">转写 → 摘要 → 需求抽取 → 建索引</div><button className={`switch ${autoProcess ? 'on' : ''}`} onClick={() => setAutoProcess(!autoProcess)} aria-label="切换自动处理" /></div>
            </div>
            <div className="small-note"><strong style={{ color: '#344054' }}>小提示：</strong>识别不到客户的记录会进入“待归档”，不会丢失；您可以随时手动归档或新建客户。</div>
          </div>
        </aside>
      </div>

      <footer className="statusbar">
        <div className="status-left"><span><span className="status-dot" />本地数据 · 未上传原始文件</span><span>AI：{sidecarOnline ? '本地 Sidecar · MaaS' : '内置 Mock · 未连接'}</span></div>
        <div>客户信息聚合工作台 · Sprint 2</div>
      </footer>

      <input ref={fileInput} className="file-input-hidden" type="file" multiple onChange={(e) => { acceptFiles(Array.from(e.target.files ?? [])); e.currentTarget.value = ''; }} />
      <input ref={imageInput} className="file-input-hidden" type="file" accept="image/*" multiple onChange={(e) => { onAddFiles(Array.from(e.target.files ?? []), true); e.currentTarget.value = ''; }} />

      <Modal open={pasteOpen} title="粘贴聊天记录" subtitle="支持微信聊天文字、邮件正文或任意文本" onClose={() => setPasteOpen(false)}>
        <div className="modal-body">
          <textarea className="modal-textarea" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="把聊天记录粘贴到这里，例如：&#10;张三：我们想做一个会员小程序，预算 8–10 万&#10;我：明白，我周五前把方案发您" />
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => setPasteOpen(false)}>取消</button>
          <button className="btn primary" onClick={submitPaste}>导入并解析</button>
        </div>
      </Modal>

      <WeChatImportModal
        open={wechatOpen}
        onClose={() => setWechatOpen(false)}
        onImported={onWechatImported}
        onToast={onToast}
      />
    </>
  );
}
