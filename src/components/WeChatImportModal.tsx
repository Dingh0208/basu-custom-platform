import { useEffect, useMemo, useState } from 'react';
import type { WeChatJob, WeChatSession, WeChatStatus } from '../types';
import {
  getWechatImportStatus,
  getWechatPrepareStatus,
  getWechatSessions,
  getWechatStatus,
  importWechatChat,
  previewWechatMessages,
  startWechatPrepare,
} from '../api/client';
import { IconChat, IconRefresh, IconSearch } from './Icons';
import Modal from './Modal';

type WeChatImportModalProps = {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  onToast: (message: string) => void;
};

const TYPE_OPTIONS = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'voice', label: '语音' },
  { value: 'video', label: '视频' },
  { value: 'file', label: '文件' },
  { value: 'link', label: '链接' },
  { value: 'chatHistory', label: '聊天记录' },
  { value: 'quote', label: '引用' },
  { value: 'system', label: '系统消息' },
  { value: 'emoji', label: '表情' },
  { value: 'transfer', label: '转账' },
  { value: 'redPacket', label: '红包' },
  { value: 'location', label: '位置' },
  { value: 'voip', label: '通话' },
];

export default function WeChatImportModal({ open, onClose, onImported, onToast }: WeChatImportModalProps) {
  const [status, setStatus] = useState<WeChatStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<WeChatSession[]>([]);
  const [sessionQuery, setSessionQuery] = useState('');
  const [account, setAccount] = useState('');
  const [selectedUsername, setSelectedUsername] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['text', 'image', 'voice', 'video', 'file', 'link']);
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [prepareJob, setPrepareJob] = useState<WeChatJob | null>(null);
  const [importJob, setImportJob] = useState<WeChatJob | null>(null);

  const selectedSession = sessions.find((item) => item.username === selectedUsername) ?? null;
  const visibleSessions = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((session) => `${session.name}${session.lastMessage || ''}`.toLowerCase().includes(q));
  }, [sessions, sessionQuery]);

  async function loadSessions(accountName: string) {
    setLoading(true);
    const sessionData = await getWechatSessions(accountName, 500);
    setSessions(sessionData?.sessions ?? []);
    setLoading(false);
  }

  async function refreshEngine() {
    const result = await getWechatStatus();
    setStatus(result);
    setPrepared(Boolean(result?.prepared));
    if (result?.available && result.accounts?.length) {
      const accountName = result.defaultAccount || result.accounts[0];
      setAccount(accountName);
      await loadSessions(accountName);
    }
    return result;
  }

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoading(true);
    setStatus(null);
    setSessions([]);
    setSelectedUsername('');
    setPreviewTotal(null);
    setPrepared(false);
    setPrepareJob(null);
    setImportJob(null);
    getWechatStatus().then(async (result) => {
      if (!mounted) return;
      setStatus(result);
      setPrepared(Boolean(result?.prepared));
      if (result?.prepareJob?.status === 'running') setPrepareJob(result.prepareJob);
      if (result?.available && result.accounts?.length) {
        const accountName = result.defaultAccount || result.accounts[0];
        setAccount(accountName);
        const sessionData = await getWechatSessions(accountName, 500);
        if (!mounted) return;
        setSessions(sessionData?.sessions ?? []);
      }
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [open]);

  useEffect(() => {
    if (!open || prepareJob?.status !== 'running') return;
    let mounted = true;
    const timer = window.setInterval(async () => {
      const job = await getWechatPrepareStatus();
      if (!mounted || !job) return;
      setPrepareJob(job);
      if (job.status === 'done') {
        window.clearInterval(timer);
        setPrepared(true);
        onToast('微信库更新完成，可以开始提取');
        await refreshEngine();
      } else if (job.status === 'failed') {
        window.clearInterval(timer);
        onToast(job.message || '微信库更新失败');
      }
    }, 900);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [open, prepareJob?.status]);

  useEffect(() => {
    if (!open || importJob?.status !== 'running') return;
    let mounted = true;
    const timer = window.setInterval(async () => {
      const job = await getWechatImportStatus();
      if (!mounted || !job) return;
      setImportJob(job);
      if (job.status === 'done') {
        window.clearInterval(timer);
        setImporting(false);
        onToast(`已提取 ${job.messageCount ?? 0} 条消息，聊天解析已生成`);
        onImported();
        onClose();
      } else if (job.status === 'failed') {
        window.clearInterval(timer);
        setImporting(false);
        onToast(job.message || '微信聊天提取失败');
      }
    }, 900);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [open, importJob?.status]);

  useEffect(() => {
    if (!open || !status?.available || !account || !selectedUsername) return;
    let mounted = true;
    const timer = window.setTimeout(() => {
      setPreviewing(true);
      previewWechatMessages(account, selectedUsername, startDate, endDate, selectedTypes).then((data) => {
        if (mounted) {
          setPreviewTotal(data?.total ?? null);
          setPreviewing(false);
        }
      });
    }, 300);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [open, status?.available, account, selectedUsername, startDate, endDate, selectedTypes]);

  function toggleType(value: string) {
    setSelectedTypes((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  async function handlePrepare() {
    setPrepareJob({ status: 'running', progress: 2, message: '正在准备更新微信库…' });
    const job = await startWechatPrepare();
    if (!job) {
      setPrepareJob({ status: 'failed', progress: 0, message: '无法启动微信库更新' });
      onToast('无法启动微信库更新，请检查微信解析引擎');
      return;
    }
    setPrepareJob(job);
  }

  async function handleImport() {
    if (!prepared) {
      onToast('请先点击“更新微信库”，完成数据库解密后再提取');
      return;
    }
    if (!selectedSession) {
      onToast('请先选择一个微信会话');
      return;
    }
    if (!selectedTypes.length) {
      onToast('请至少选择一种记录类型');
      return;
    }
    setImporting(true);
    setImportJob({ status: 'running', progress: 1, message: '正在排队提取…' });
    const job = await importWechatChat({
      account,
      username: selectedSession.username,
      startDate,
      endDate,
      types: selectedTypes,
      customer: selectedSession.name,
      project: '',
    });
    if (!job) {
      setImporting(false);
      setImportJob({ status: 'failed', progress: 0, message: '微信聊天提取失败' });
      onToast('微信聊天提取失败，请检查微信解析引擎');
      return;
    }
    setImportJob(job);
  }

  return (
    <Modal open={open} title="从微信聊天库提取" subtitle="选择账号、会话、日期和记录类型；提取后自动进入聊天解析与客户 360" onClose={onClose} className="wechat-import-modal">
      <div className="wechat-import-body">
        <div className="wechat-session-pane">
          <div className="wechat-pane-head">
            <div className="wechat-pane-title"><IconChat size={16} /> 微信会话</div>
            <div className="wechat-pane-actions">
              <button className="btn ghost wechat-update-btn" disabled={prepareJob?.status === 'running'} onClick={handlePrepare}>
                {prepareJob?.status === 'running' ? `解密中 ${prepareJob.progress || 0}%` : '更新微信库'}
              </button>
              <button className="icon-btn" title="刷新" onClick={async () => { await refreshEngine(); }}><IconRefresh size={15} /></button>
            </div>
          </div>
          <div className={`wechat-ready-line ${prepared ? 'ok' : 'warn'}`}>
            <span className="wechat-ready-dot" />
            {prepared ? '微信库已解密，可以提取' : '微信库尚未更新，请先点击「更新微信库」'}
          </div>
          {prepareJob && prepareJob.status !== 'idle' && (
            <div className="wechat-job-box">
              <div className="wechat-job-line"><span>{prepareJob.message}</span><strong>{prepareJob.progress || 0}%</strong></div>
              <div className="wechat-progress-track"><span style={{ width: `${prepareJob.progress || 0}%` }} /></div>
              {prepareJob.currentFile && <div className="wechat-job-detail">{prepareJob.currentFile}</div>}
            </div>
          )}
          {status?.available ? (
            <>
              <div className="wechat-account-line">
                <span>账号</span>
                <select value={account} onChange={async (e) => {
                  const next = e.target.value;
                  setAccount(next);
                  setSelectedUsername('');
                  setLoading(true);
                  const data = await getWechatSessions(next, 500);
                  setSessions(data?.sessions ?? []);
                  setLoading(false);
                }}>
                  {status.accounts.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                {status.accountInfos?.find((item) => item.account === account)?.selfDisplayName && (
                  <span className="wechat-self-name">{status.accountInfos.find((item) => item.account === account)?.selfDisplayName}</span>
                )}
              </div>
              <div className="search-box" style={{ margin: '8px 0' }}>
                <IconSearch size={15} />
                <input value={sessionQuery} onChange={(e) => setSessionQuery(e.target.value)} placeholder="搜索会话名称或最后一条消息" />
              </div>
              <div className="wechat-session-list">
                {loading ? <div className="empty-panel">正在读取微信会话…</div> : visibleSessions.map((session) => (
                  <button
                    key={session.username}
                    className={`wechat-session-row ${selectedUsername === session.username ? 'on' : ''}`}
                    onClick={() => setSelectedUsername(session.username)}
                  >
                    <span className="wechat-session-avatar">{session.name.slice(0, 1)}</span>
                    <span className="wechat-session-main">
                      <span className="wechat-session-name">{session.name}</span>
                      <span className="wechat-session-preview">{session.lastMessage || '暂无消息'}</span>
                    </span>
                    <span className="wechat-session-time">{session.lastMessageTime || ''}</span>
                  </button>
                ))}
                {!loading && visibleSessions.length === 0 && <div className="empty-panel">没有匹配的会话</div>}
              </div>
            </>
          ) : (
            <div className="wechat-unavailable">
              <div className="empty-panel">微信解析引擎未连接</div>
              <div className="small-note">{status?.error || '内置微信引擎未就绪，请检查安装包是否包含 wechat-engine 目录。'}</div>
            </div>
          )}
        </div>

        <div className="wechat-config-pane">
          <div className="wechat-pane-title"><IconChat size={16} /> 提取条件</div>
          <div className="wechat-selected-session">
            {selectedSession ? (
              <>
                <div className="wechat-selected-name">{selectedSession.name}</div>
                <div className="wechat-selected-meta">{selectedSession.username} · 最后消息 {selectedSession.lastMessageTime || '—'}</div>
              </>
            ) : <div className="empty-hint">请在左侧选择一个会话</div>}
          </div>
          <div className="wechat-date-row">
            <label>开始日期<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
            <label>结束日期<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          </div>
          <div className="small-note" style={{ marginTop: -4 }}>留空表示不限日期；日期按本机时区计算。</div>
          <div className="wechat-type-label">记录类型</div>
          <div className="wechat-type-grid">
            {TYPE_OPTIONS.map((option) => (
              <label key={option.value} className={`wechat-type ${selectedTypes.includes(option.value) ? 'on' : ''}`}>
                <input type="checkbox" checked={selectedTypes.includes(option.value)} onChange={() => toggleType(option.value)} />
                {option.label}
              </label>
            ))}
          </div>
          <div className="wechat-preview-box">
            <span>预计消息数</span>
            <strong>{previewing ? '统计中…' : previewTotal == null ? '选择会话后统计' : `${previewTotal} 条`}</strong>
          </div>
          {importJob && importJob.status !== 'idle' && (
            <div className="wechat-job-box">
              <div className="wechat-job-line"><span>{importJob.message}</span><strong>{importJob.progress || 0}%</strong></div>
              <div className="wechat-progress-track"><span style={{ width: `${importJob.progress || 0}%` }} /></div>
            </div>
          )}
          <div className="small-note">提取后会自动写入聊天记录、客户档案和客户 360 时间线，并触发 AI 对话解析。</div>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!prepared || !selectedSession || !selectedTypes.length || importing || !status?.available} onClick={handleImport}>
          {importing ? `提取中 ${importJob?.progress || 0}%` : '开始提取'}
        </button>
      </div>
    </Modal>
  );
}
