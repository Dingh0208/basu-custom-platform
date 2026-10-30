import { useEffect, useMemo, useState } from 'react';
import type { ChatParticipant, ChatRecord } from '../types';
import { API_BASE, reanalyzeChat, updateChatParticipants } from '../api/client';
import {
  IconChat,
  IconDownload,
  IconFile,
  IconMic,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconUsers,
} from './Icons';
import Modal from './Modal';

type ChatWorkspaceProps = {
  record: ChatRecord;
  sidecarOnline: boolean;
  onBack: () => void;
  onToast: (message: string) => void;
  onChatUpdate?: (chat: ChatRecord) => void;
};

function roleLabel(role: string) {
  if (role === 'me') return '我';
  if (role === 'customer') return '客户';
  return '参与者';
}

function timeOf(value: string) {
  const parts = value.split(' ');
  return parts.length > 1 ? parts[1].slice(0, 5) : value;
}

export default function ChatWorkspace({ record, sidecarOnline, onBack, onToast, onChatUpdate }: ChatWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'summary' | 'qa' | 'requirements'>('summary');
  const [participants, setParticipants] = useState<ChatParticipant[]>(record.participants);
  const [roleEditorOpen, setRoleEditorOpen] = useState(false);
  const [savingRoles, setSavingRoles] = useState(false);

  useEffect(() => {
    setParticipants(record.participants);
  }, [record.id]);

  const roleMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const participant of participants) map[participant.name] = participant.role;
    return map;
  }, [participants]);

  const messages = useMemo(() => {
    if (!query.trim()) return record.messages;
    const q = query.trim().toLowerCase();
    return record.messages.filter((m) => m.content.toLowerCase().includes(q) || m.sender.toLowerCase().includes(q));
  }, [record.messages, query]);

  const analysis = record.analysis;
  const customerName = record.customer || participants.find((p) => p.role === 'customer')?.name || '客户';
  const meName = participants.find((p) => p.role === 'me')?.name || '我';
  const attachments = record.attachments ?? [];
  const sourceLabel = /\.(png|jpe?g|webp)$/i.test(record.fileName) ? '来自聊天截图 OCR' : '来自聊天文本';

  async function handleReanalyze() {
    if (!sidecarOnline) {
      onToast('当前为内置 Mock，无法触发真实解析');
      return;
    }
    const result = await reanalyzeChat(record.id);
    if (!result) {
      onToast('重新分析请求失败，请检查 Sidecar');
      return;
    }
    onToast('已开始重新分析，完成后刷新即可看到新解析结果');
  }

  async function saveRoles() {
    setSavingRoles(true);
    if (sidecarOnline) {
      const updated = await updateChatParticipants(record.id, participants);
      if (!updated) {
        setSavingRoles(false);
        onToast('角色保存失败，请检查 Sidecar');
        return;
      }
      onChatUpdate?.(updated);
      setParticipants(updated.participants);
      onToast('聊天角色已更新');
    } else {
      onToast('当前为内置 Mock，角色修改已保存在本地视图');
    }
    setSavingRoles(false);
    setRoleEditorOpen(false);
  }

  return (
    <>
      <header className="topbar">
        <div className="crumbs">
          <button className="back-link" onClick={onBack}><span style={{ fontSize: 14 }}>←</span>返回</button>
          <span className="sep">/</span>
          <span>客户</span><span className="sep">/</span><span>{customerName}</span><span className="sep">/</span>
          <strong>{record.title}</strong>
          <span className="badge done">已完成</span>
          <span className={`badge ${sidecarOnline ? 'done' : 'warn'}`}>{sidecarOnline ? 'Sidecar 已连接' : '内置 Mock'}</span>
        </div>
        <div className="top-actions">
          <button className="btn" onClick={handleReanalyze}><IconRefresh size={15} />重新分析</button>
          <button className="btn" onClick={() => onToast('聊天记录导出已生成（原型模拟）')}><IconDownload size={15} />导出记录</button>
          <button className="btn primary" onClick={() => onToast(`已添加待办：跟进 ${customerName} 的后续沟通`)}><IconPlus size={15} />添加待办</button>
        </div>
      </header>

      <div className="chat-workspace">
        <aside className="chat-left">
          <section className="card">
            <div className="card-head"><div><div className="card-title">聊天信息</div><div className="card-sub">{sourceLabel}</div></div></div>
            <div className="card-body">
              <div className="file-row">
                <div className="file-ico"><IconChat size={18} /></div>
                <div><div className="file-name">{record.fileName}</div><div className="file-meta">{record.messageCount} 条消息 · {record.startedAt?.slice(0, 10)}</div></div>
              </div>
              <dl className="kv-list">
                <div className="kv"><dt>客户</dt><dd>{customerName}</dd></div>
                <div className="kv"><dt>项目</dt><dd>{record.project}</dd></div>
                <div className="kv"><dt>时间范围</dt><dd>{record.startedAt?.slice(11, 16)}–{record.endedAt?.slice(11, 16)}</dd></div>
                <div className="kv"><dt>参与者</dt><dd>{record.participants.map((p) => p.name).join(' / ')}</dd></div>
              </dl>
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <div className="card-title">参与者</div>
              <button className="btn ghost" style={{ height: 26, padding: '0 6px', fontSize: 10.5 }} onClick={() => setRoleEditorOpen(true)}>调整角色</button>
            </div>
            <div className="card-body">
              {participants.map((p) => (
                <div className="participant-row" key={p.name}>
                  <span className={`customer-avatar ${p.role === 'me' ? 'me-avatar' : ''}`}>{p.name.slice(0, 1)}</span>
                  <div><div className="participant-name">{p.name}</div><div className="participant-role">{roleLabel(p.role)}</div></div>
                </div>
              ))}
              <div className="small-note" style={{ marginTop: 14 }}>“我”由 Sidecar 根据聊天内容推断，当前判断为 <strong style={{ color: '#344054' }}>{meName}</strong>。如果不对，请点“调整角色”。</div>
            </div>
          </section>
          <section className="card">
            <div className="card-head"><div className="card-title">附件索引</div><span className="badge done">{attachments.length}</span></div>
            <div className="card-body">
              {attachments.length === 0 ? (
                <div className="empty-hint">暂无图片、语音或文件附件</div>
              ) : (
                <div className="attachment-list">
                  {attachments.map((attachment) => (
                    <button
                      className="attachment-item"
                      key={attachment.id}
                      onClick={() => attachment.storedName ? window.open(`${API_BASE}/api/files/${encodeURIComponent(attachment.storedName)}`, '_blank') : attachment.externalUrl ? window.open(String(attachment.externalUrl), '_blank') : onToast(`${attachment.label || attachment.name}：原始文件未保留`)}
                    >
                      {attachment.kind === 'image' && (attachment.storedName || attachment.externalUrl) ? (
                        <img className="attachment-thumb" src={attachment.storedName ? `${API_BASE}/api/files/${encodeURIComponent(attachment.storedName)}` : String(attachment.externalUrl)} alt={attachment.name} />
                      ) : (
                        <span className="attachment-ico">
                          {attachment.kind === 'voice' ? <IconMic size={15} /> : attachment.kind === 'file' || attachment.kind === 'video' ? <IconFile size={15} /> : <IconChat size={15} />}
                        </span>
                      )}
                      <span className="attachment-main">
                        <span className="attachment-name">{attachment.name}</span>
                        <span className="attachment-label">{attachment.label || attachment.kind}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        </aside>

        <section className="chat-center">
          <div className="card chat-card">
            <div className="chat-head">
              <div><div className="card-title">聊天记录</div><div className="card-sub">{record.messageCount} 条消息 · {record.startedAt} — {record.endedAt}</div></div>
              <div className="search-box" style={{ marginLeft: 'auto' }}>
                <IconSearch size={15} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索聊天内容" />
              </div>
            </div>
            <div className="chat-body">
              {messages.map((message) => {
                const role = roleMap[message.sender] ?? 'customer';
                const messageAttachments = attachments.filter((attachment) => attachment.messageId === message.id);
                return (
                  <div className={`chat-row ${role === 'me' ? 'me' : 'customer'}`} key={message.id}>
                    <span className="chat-avatar">{message.sender.slice(0, 1)}</span>
                    <div className="chat-bubble-wrap">
                      <div className="chat-meta"><span>{message.sender}</span><span>{timeOf(message.sentAt)}</span></div>
                      <div className="chat-bubble">{message.content}</div>
                      {messageAttachments.length > 0 && (
                        <div className="bubble-attachments">
                          {messageAttachments.map((attachment) => (
                            <span className="bubble-attachment" key={attachment.id}>{attachment.name}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {messages.length === 0 && <div className="empty-panel">没有找到匹配的聊天内容</div>}
            </div>
          </div>
        </section>

        <aside className="chat-right">
          <div className="card summary-card">
            <div className="summary-head">
              <div className="summary-top">
                <div className="title-wrap"><span className="card-title">AI 对话解析</span><span className="ai-badge">✦ AI 生成</span></div>
                <button className="btn ghost" style={{ height: 28, padding: '0 8px', fontSize: 11 }} onClick={() => onToast('对话解析已更新')}>刷新</button>
              </div>
              <div className="tabs">
                <button className={`tab ${activeTab === 'summary' ? 'on' : ''}`} onClick={() => setActiveTab('summary')}>摘要</button>
                <button className={`tab ${activeTab === 'qa' ? 'on' : ''}`} onClick={() => setActiveTab('qa')}>关键问答 <span className="count">{analysis.keyQa.length}</span></button>
                <button className={`tab ${activeTab === 'requirements' ? 'on' : ''}`} onClick={() => setActiveTab('requirements')}>需求/承诺 <span className="count">{analysis.requirements.length + analysis.commitments.length}</span></button>
              </div>
            </div>
            <div className="summary-body">
              {activeTab === 'summary' && (
                <>
                  <div className="summary-section">
                    <div className="summary-label">聊天主题</div>
                    <div className="summary-value">{analysis.topic || '未识别'}</div>
                  </div>
                  <div className="summary-section">
                    <div className="summary-label">聊天摘要</div>
                    <div className="summary-value">{analysis.summary || '暂无摘要'}</div>
                  </div>
                  <div className="summary-section">
                    <div className="summary-label">参与者判断</div>
                    <div className="summary-value">{analysis.participants.map((p) => `${p.name}（${p.role}）`).join('；') || '未识别'}</div>
                  </div>
                  <div className="summary-section">
                    <div className="summary-label">标签</div>
                    <div className="pill-line">{analysis.tags.length ? analysis.tags.map((tag) => <span className="pill blue" key={tag}>{tag}</span>) : <span className="summary-value empty">无</span>}</div>
                  </div>
                </>
              )}
              {activeTab === 'qa' && (
                <div className="qa-list">
                  {analysis.keyQa.length === 0 && <div className="empty-panel">本次聊天以闲聊为主，未识别出明确问答</div>}
                  {analysis.keyQa.map((qa, index) => (
                    <div className="qa-item" key={index}>
                      <div className="qa-q">Q：{qa.question}</div>
                      <div className="qa-a">A：{qa.answer}</div>
                      {qa.evidence && <div className="qa-evidence">原文：{qa.evidence}</div>}
                    </div>
                  ))}
                </div>
              )}
              {activeTab === 'requirements' && (
                <div className="requirement-list">
                  {analysis.requirements.length === 0 && <div className="empty-panel">本次聊天未形成明确需求</div>}
                  {analysis.requirements.map((req, index) => (
                    <div className="requirement-item" key={index}>
                      <div className="requirement-title">{req.title}</div>
                      {req.description && <div className="summary-value" style={{ marginTop: 4 }}>{req.description}</div>}
                      <div className="requirement-meta"><span className="pill amber">{req.priority || 'P1'}</span><span>{req.status || '待确认'}</span></div>
                    </div>
                  ))}
                  {analysis.commitments.map((commitment, index) => (
                    <div className="requirement-item" key={`c-${index}`}>
                      <div className="requirement-title">承诺：{commitment.content}</div>
                      <div className="requirement-meta"><span className="pill blue">{commitment.owner || '我方'}</span><span>{commitment.due || '未约定时间'}</span></div>
                    </div>
                  ))}
                  {analysis.nextActions.map((action, index) => (
                    <div className="requirement-item" key={`n-${index}`}>
                      <div className="requirement-title">下一步：{action.action}</div>
                      <div className="requirement-meta"><span className="pill">{action.owner || '待定'}</span><span>{action.due || '未约定时间'}</span></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="evidence-note">聊天解析由 qwen3.8-flash 生成 · {record.messageCount} 条消息</div>
          </div>
        </aside>
      </div>

      <footer className="statusbar">
        <div className="status-left"><span><span className="status-dot" />本地数据 · SQLite</span><span>AI：{sidecarOnline ? '本地 Sidecar · MaaS' : '内置 Mock · 未连接'}</span><span>聊天解析：qwen3.8-flash</span></div>
        <div>客户信息聚合工作台 · Sprint 2</div>
      </footer>

      <Modal open={roleEditorOpen} title="调整聊天角色" subtitle="修改后会同步气泡方向、客户名称与 AI 解析中的参与者角色" onClose={() => setRoleEditorOpen(false)}>
        <div className="modal-body">
          <div className="role-editor-list">
            {participants.map((participant) => (
              <div className="role-editor-row" key={participant.name}>
                <div>
                  <div className="participant-name">{participant.name}</div>
                  <div className="participant-role">当前：{roleLabel(participant.role)}</div>
                </div>
                <div className="segmented" style={{ width: 180, marginTop: 0 }}>
                  <button
                    className={participant.role === 'me' ? 'on' : ''}
                    onClick={() => setParticipants((list) => list.map((p) => p.name === participant.name ? { ...p, role: 'me' } : p))}
                  >我</button>
                  <button
                    className={participant.role === 'customer' ? 'on' : ''}
                    onClick={() => setParticipants((list) => list.map((p) => p.name === participant.name ? { ...p, role: 'customer' } : p))}
                  >客户</button>
                </div>
              </div>
            ))}
          </div>
          <div className="small-note" style={{ marginTop: 14 }}>必须保留一个“我”和一个“客户”。如果对话中只有一个真实客户，请把另一方设为“我”。</div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => setRoleEditorOpen(false)}>取消</button>
          <button className="btn primary" onClick={saveRoles} disabled={savingRoles}>{savingRoles ? '保存中…' : '保存角色'}</button>
        </div>
      </Modal>
    </>
  );
}
