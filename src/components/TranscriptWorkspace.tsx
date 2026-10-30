import { useEffect, useMemo, useState } from 'react';
import type { CitationItem, RequirementItem, SummaryData, TranscriptRecord, TranscriptSegment } from '../types';
import { evidenceTimes, summaryFields } from '../mock/data';
import {
  IconBack,
  IconDownload,
  IconLink,
  IconMaximize,
  IconMic,
  IconPause,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconVolume,
} from './Icons';

type TranscriptWorkspaceProps = {
  record: TranscriptRecord;
  sidecarOnline: boolean;
  onBack: () => void;
  onToast: (message: string) => void;
};

const waveHeights = [10, 16, 22, 14, 28, 34, 18, 26, 32, 12, 22, 30, 20, 14, 36, 24, 16, 28, 10, 18, 32, 22, 12, 26, 30, 16, 24, 34, 18, 12, 28, 20, 14, 24, 32, 16, 22, 10, 18, 26];

function formatTime(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function highlight(text: string, query: string) {
  if (!query.trim()) return text;
  const lower = text.toLowerCase();
  const q = query.trim().toLowerCase();
  const parts: React.ReactNode[] = [];
  let start = 0;
  let idx = lower.indexOf(q);
  let key = 0;
  while (idx !== -1) {
    parts.push(text.slice(start, idx));
    parts.push(<mark key={key++}>{text.slice(idx, idx + q.length)}</mark>);
    start = idx + q.length;
    idx = lower.indexOf(q, start);
  }
  parts.push(text.slice(start));
  return parts;
}

function segmentLabel(s: TranscriptSegment) {
  if (s.speaker === 'customer') return '客户';
  if (s.speaker === 'me') return '我';
  return '说话人';
}

export default function TranscriptWorkspace({ record, sidecarOnline, onBack, onToast }: TranscriptWorkspaceProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [query, setQuery] = useState('');
  const [onlyCustomer, setOnlyCustomer] = useState(false);
  const [summary, setSummary] = useState<SummaryData>({ ...record.summary });
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'requirements' | 'citations'>(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    return tab === 'requirements' || tab === 'citations' ? tab : 'summary';
  });

  useEffect(() => {
    setSummary({ ...record.summary });
    setCurrentTime(0);
    setPlaying(false);
  }, [record.id]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setCurrentTime((t) => {
        const next = t + speed;
        if (next >= record.duration) {
          setPlaying(false);
          return record.duration;
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [playing, speed, record.duration]);

  const activeSegment = record.segments.find((s) => currentTime >= s.start && currentTime < s.end);
  const activeId = activeSegment?.id;

  const visibleSegments = useMemo(() => {
    let list = record.segments;
    if (onlyCustomer) list = list.filter((s) => s.speaker === 'customer');
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((s) => s.text.toLowerCase().includes(q));
    }
    return list;
  }, [record.segments, onlyCustomer, query]);

  const activeBars = Math.round((currentTime / record.duration) * waveHeights.length);

  const requirements: RequirementItem[] = useMemo(() => {
    if (record.requirements?.length) return record.requirements;
    const parts = (summary.needs || '')
      .split(/[；;、。，,]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 5);
    return parts.map((title, index) => ({
      id: `auto-req-${index}`,
      title,
      status: '待确认',
      priority: index < 2 ? 'P0' : 'P1',
      source: 'AI 摘要',
    }));
  }, [record.requirements, summary.needs]);

  const citations: CitationItem[] = useMemo(() => {
    if (record.citations?.length) return record.citations;
    return record.segments.slice(0, 6).map((segment, index) => ({
      id: `seg-cite-${index}`,
      label: '原文片段',
      time: segment.start,
      quote: segment.text,
    }));
  }, [record.citations, record.segments]);

  function showToast(message: string) {
    onToast(message);
  }

  function handleRegenerate() {
    setGenerating(true);
    showToast('正在重新生成摘要…');
    window.setTimeout(() => {
      setSummary({ ...record.summary });
      setGenerating(false);
      showToast('摘要已重新生成，请核对后保存');
    }, 1600);
  }

  function handleSave() {
    setEditing(false);
    showToast('摘要修改已保存到本地');
  }

  function locateEvidence(key: keyof SummaryData) {
    const time = evidenceTimes[key] ?? 0;
    setCurrentTime(time);
    setPlaying(false);
    showToast(`已定位到原文 ${formatTime(time)}`);
  }

  function handleReprocess() {
    setReprocessing(true);
    showToast('正在重新转写与生成摘要…');
    window.setTimeout(() => {
      setReprocessing(false);
      showToast('转写与摘要已更新');
    }, 1600);
  }

  return (
    <>
      <header className="topbar">
        <div className="crumbs">
          <button className="back-link" onClick={onBack}><IconBack size={14} />返回</button>
          <span className="sep">/</span>
          <span>客户</span><span className="sep">/</span><span>{record.customer}</span><span className="sep">/</span>
          <strong>{record.title}</strong>
          <span className="badge done">已完成</span>
          <span className={`badge ${sidecarOnline ? 'done' : 'warn'}`}>{sidecarOnline ? 'Sidecar 已连接' : '内置 Mock'}</span>
        </div>
        <div className="top-actions">
          <button className="btn" onClick={handleReprocess} disabled={reprocessing}>
            <IconRefresh size={15} className={reprocessing ? 'icon-sm spin' : 'icon-sm'} />重新处理
          </button>
          <button className="btn" onClick={() => showToast('已生成 PDF 纪要（原型模拟）')}>
            <IconDownload size={15} />导出纪要
          </button>
          <button className="btn primary" onClick={() => showToast('已添加待办：周五前发方案 + 报价')}>
            <IconPlus size={15} />添加待办
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="left-rail">
          <section className="card file-card">
            <div className="card-head"><div><div className="card-title">文件信息</div><div className="card-sub">原始录音 · 本地保存</div></div></div>
            <div className="card-body">
              <div className="file-row">
                <div className="file-ico"><IconMic size={18} /></div>
                <div><div className="file-name">{record.fileName}</div><div className="file-meta">{record.fileSize} · {formatTime(record.duration)} · 导入于 {record.importedAt}</div></div>
              </div>
              <dl className="kv-list">
                <div className="kv"><dt>客户</dt><dd>{record.customer} · {record.company}</dd></div>
                <div className="kv"><dt>项目</dt><dd>{record.project}</dd></div>
                <div className="kv"><dt>来源</dt><dd>{record.source}</dd></div>
                <div className="kv"><dt>存储位置</dt><dd>本机 / 客户资料 / 2026-10</dd></div>
              </dl>
            </div>
          </section>
          <section className="card">
            <div className="card-head"><div className="card-title">处理进度</div><span className="badge done">全部完成</span></div>
            <div className="card-body">
              <div className="progress-steps">
                <div className="step done"><span className="step-dot">✓</span>上传完成<span className="step-time">10:24</span></div>
                <div className="step done"><span className="step-dot">✓</span>转码完成<span className="step-time">10:25</span></div>
                <div className="step done"><span className="step-dot">✓</span>转写完成<span className="step-time">10:29</span></div>
                <div className="step done"><span className="step-dot">✓</span>摘要完成<span className="step-time">10:31</span></div>
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-head"><div className="card-title">摘要依据</div></div>
            <div className="card-body">
              <div className="empty-hint" style={{ color: '#475467' }}><span style={{ width: 20, height: 20, borderRadius: 6, background: '#eef4ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>{citations.length}</span>条原文引用已关联</div>
              <div style={{ marginTop: 10, fontSize: 10.5, color: '#98a2b3', lineHeight: 1.7 }}>所有结论可点击引用图标，跳转到对应录音时间点。</div>
            </div>
          </section>
        </aside>

        <section className="center">
          <div className="card audio-card">
            <button className="play-btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? '暂停' : '播放'}>
              {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
            </button>
            <div className="wave" aria-hidden="true">
              {waveHeights.map((h, i) => <i key={i} className={i < activeBars ? 'on' : ''} style={{ height: h }} />)}
            </div>
            <span className="audio-time">{formatTime(currentTime)} / {formatTime(record.duration)}</span>
            <div className="audio-tools">
              <button className="speed" style={{ cursor: 'pointer' }} onClick={() => setSpeed((s) => (s >= 2 ? 1 : Number((s + 0.25).toFixed(2))))}>{speed.toFixed(2).replace(/0$/, '')}x</button>
              <IconVolume size={15} />
              <IconMaximize size={15} />
            </div>
          </div>

          <div className="card transcript-card">
            <div className="transcript-head">
              <span className="transcript-title">转写稿</span><span className="transcript-count">{formatTime(record.duration)} · {record.segments.length} 句</span>
              <div className="search-box">
                <IconSearch size={15} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索转写稿" aria-label="搜索转写稿" />
              </div>
              <div className="seg">
                <button className={!onlyCustomer ? 'on' : ''} onClick={() => setOnlyCustomer(false)}>全部</button>
                <button className={onlyCustomer ? 'on' : ''} onClick={() => setOnlyCustomer(true)}>只看客户</button>
              </div>
            </div>
            <div className="transcript-body">
              {visibleSegments.length === 0 && <div className="empty-panel">没有找到匹配的转写内容</div>}
              {visibleSegments.map((segment) => (
                <div key={segment.id} className={`t-row ${activeId === segment.id ? 'active' : ''}`} onClick={() => { setCurrentTime(segment.start); setPlaying(false); }}>
                  <div className="t-time">{formatTime(segment.start)}</div>
                  <span className={`speaker ${segment.speaker}`}>{segmentLabel(segment)}</span>
                  <div className="t-text">{highlight(segment.text, query)}</div>
                </div>
              ))}
              <div style={{ textAlign: 'center', padding: '16px 0 4px', color: '#98a2b3', fontSize: 10.5 }}>— 已显示 {visibleSegments.length} / {record.segments.length} 句 · 滚动查看更早内容 —</div>
            </div>
          </div>
        </section>

        <aside className="right-rail">
          <div className="card summary-card">
            <div className="summary-head">
              <div className="summary-top">
                <div className="title-wrap"><span className="card-title">AI 摘要</span><span className="ai-badge">✦ AI 生成</span><span className="confidence">置信度 {Math.round(summary.confidence * 100)}%</span></div>
                <button className="btn ghost" style={{ height: 28, padding: '0 8px', fontSize: 11 }} onClick={() => setEditing((e) => !e)}>{editing ? '取消编辑' : '编辑'}</button>
              </div>
              <div className="tabs">
                <button className={`tab ${activeTab === 'summary' ? 'on' : ''}`} onClick={() => setActiveTab('summary')}>摘要</button>
                <button className={`tab ${activeTab === 'requirements' ? 'on' : ''}`} onClick={() => setActiveTab('requirements')}>需求 <span className="count">{requirements.length}</span></button>
                <button className={`tab ${activeTab === 'citations' ? 'on' : ''}`} onClick={() => setActiveTab('citations')}>原文引用 <span className="count">{citations.length}</span></button>
              </div>
            </div>
            <div className="summary-body">
              {activeTab === 'summary' && summaryFields.map((field) => {
                const value = summary[field.key];
                return (
                  <div className="summary-section" key={field.key}>
                    <div className="summary-label">
                      {field.label}
                      <button className="icon-btn" style={{ width: 16, height: 16, padding: 0 }} onClick={() => locateEvidence(field.key)} aria-label={`查看${field.label}原文`}>
                        <IconLink size={13} className="evidence" />
                      </button>
                    </div>
                    {editing ? (
                      <div className="summary-value editing">
                        {field.multiline ? (
                          <textarea
                            className="summary-textarea"
                            value={value as string}
                            onChange={(e) => setSummary((s) => ({ ...s, [field.key]: e.target.value }))}
                            placeholder={field.key === 'paymentMethod' ? '未提及' : ''}
                          />
                        ) : (
                          <input
                            className="summary-input"
                            value={value as string}
                            onChange={(e) => setSummary((s) => ({ ...s, [field.key]: e.target.value }))}
                            placeholder={field.key === 'paymentMethod' ? '未提及' : ''}
                          />
                        )}
                      </div>
                    ) : (
                      <div className={`summary-value ${!value ? 'empty' : ''}`}>{value || '未提及'}</div>
                    )}
                  </div>
                );
              })}

              {activeTab === 'requirements' && (
                <div className="requirement-list">
                  {requirements.map((req) => (
                    <div className="requirement-item" key={req.id}>
                      <div className="requirement-title">{req.title}</div>
                      <div className="requirement-meta">
                        <span className={`pill ${req.status === '已确认' ? 'green' : ''}`}>{req.status}</span>
                        <span className="pill amber">{req.priority}</span>
                        <span>{req.source}</span>
                      </div>
                      <button className="btn ghost" style={{ height: 24, padding: '0 6px', fontSize: 10.5, marginTop: 6 }} onClick={() => showToast('已加入项目需求清单')}>加入项目</button>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'citations' && (
                <div className="citation-list">
                  {citations.map((citation) => (
                    <button
                      className="citation-item"
                      key={citation.id}
                      onClick={() => {
                        setCurrentTime(citation.time);
                        setPlaying(false);
                        showToast(`已定位到原文 ${formatTime(citation.time)}`);
                      }}
                    >
                      <div className="citation-head">
                        <span className="citation-label">{citation.label}</span>
                        <span className="citation-time">{formatTime(citation.time)}</span>
                      </div>
                      <div className="citation-quote">“{citation.quote}”</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {activeTab === 'summary' && (
              <>
                <div className="summary-footer">
                  <button className="btn secondary" onClick={handleRegenerate} disabled={generating}>
                    <IconRefresh size={15} className={generating ? 'icon-sm spin' : 'icon-sm'} />重新生成
                  </button>
                  <button className="btn primary" onClick={handleSave}>保存修改</button>
                </div>
                <div className="evidence-note">摘要仅依据本次通话转写生成 · 共 {citations.length} 条原文引用</div>
              </>
            )}
          </div>
        </aside>
      </div>

      <footer className="statusbar">
        <div className="status-left"><span><span className="status-dot" />本地数据已自动保存 10:32</span><span>AI：{sidecarOnline ? '本地 Sidecar · MaaS' : '内置 Mock · 未连接'}</span><span>转写：qwen3-asr-flash · 真实链路</span></div>
        <div>客户信息聚合工作台 · Sprint 1</div>
      </footer>
    </>
  );
}
