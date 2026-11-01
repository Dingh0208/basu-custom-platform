import { useEffect, useState } from 'react';
import type { ChatAttachment } from '../types';
import { API_BASE, fetchChat, fetchTranscript, previewAttachment, transcribeAttachment } from '../api/client';
import { IconFile } from './Icons';
import Modal from './Modal';

type Props = {
  sourceId: string;
  sourceType: 'chat' | 'transcript';
  attachments: ChatAttachment[];
  sidecarOnline: boolean;
  onToast: (message: string) => void;
};

export default function AttachmentList({ sourceId, sourceType, attachments, sidecarOnline, onToast }: Props) {
  const [items, setItems] = useState(attachments);
  const [selected, setSelected] = useState<ChatAttachment | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const processing = items.some((item) => item.transcriptStatus === 'processing');

  useEffect(() => { setItems(attachments); setSelected(null); }, [sourceId]);
  useEffect(() => { setItems(attachments); }, [attachments]);
  useEffect(() => {
    if (!sidecarOnline || !processing) return;
    let mounted = true;
    let inFlight = false;
    const timer = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const record = sourceType === 'chat' ? await fetchChat(sourceId) : await fetchTranscript(sourceId);
        if (mounted && record) setItems(record.attachments || []);
      } finally { inFlight = false; }
    }, 2500);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [sourceId, sourceType, processing, sidecarOnline]);

  const url = selected?.storedName ? `${API_BASE}/api/files/${encodeURIComponent(selected.storedName)}` : '';
  const pdf = selected && /\.pdf$/i.test(selected.name);
  const media = selected && ['image', 'voice', 'video'].includes(selected.kind);
  const textPreview = selected && /\.(docx|xlsx|eml|txt|csv)$/i.test(selected.name);

  useEffect(() => {
    setPreview(null);
    setPreviewError(false);
    setLoading(false);
    if (!selected?.storedName || !textPreview) return;
    let mounted = true;
    setLoading(true);
    previewAttachment(selected.storedName).then((result) => {
      if (!mounted) return;
      setPreview(result?.text ?? null);
      setPreviewError(!result);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [selected, textPreview]);

  async function transcribe(item: ChatAttachment) {
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, transcriptStatus: 'processing', transcriptError: '' } : entry));
    const result = await transcribeAttachment(sourceType, sourceId, item.id);
    if (!result) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, transcriptStatus: 'failed', transcriptError: '转写启动失败，请检查本地服务后重试' } : entry));
      onToast('语音转写启动失败，请重试');
    } else onToast('语音转写已开始，完成后自动显示结果');
  }

  async function downloadCopy() {
    if (!url) return;
    try {
      const response = await fetch(`${url}?download=1`);
      if (!response.ok) throw new Error('download failed');
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = selected?.name || 'attachment';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch { onToast('附件下载失败，请检查本地服务'); }
  }

  return <>
    <div className="attachment-list" aria-live="polite">
      {items.length === 0 && <div className="empty-hint">暂无附件</div>}
      {items.map((item) => <div className="attachment-item" key={item.id}>
        <button className="attachment-open" onClick={() => item.storedName ? setSelected(item) : onToast('原始附件未离线保存，请在微信中查看或重新导入')}>
          {item.kind === 'image' && item.storedName ? <img className="attachment-thumb" loading="lazy" src={`${API_BASE}/api/files/${encodeURIComponent(item.storedName)}`} alt={item.name} /> : <span className="attachment-ico"><IconFile size={17} /></span>}
          <span className="attachment-main"><span className="attachment-name" title={item.name}>{item.name}</span><span className="attachment-label">{item.storedName ? '已离线保存 · 点击预览' : '原始附件未保存'}</span></span>
        </button>
        {item.kind === 'voice' && item.storedName && <button className="btn ghost" disabled={!sidecarOnline || item.transcriptStatus === 'processing' || item.transcriptStatus === 'done'} onClick={() => void transcribe(item)}>{item.transcriptStatus === 'processing' ? '转写中…' : item.transcriptStatus === 'done' ? '已转写' : item.transcriptStatus === 'failed' ? '重试转写' : '转写语音'}</button>}
        {item.transcript && <div className="attachment-transcript">语音转写：{item.transcript}</div>}
        {item.transcriptError && <div className="attachment-transcript" role="alert">{item.transcriptError}</div>}
      </div>)}
    </div>
    <Modal open={!!selected} title={selected?.name || '附件预览'} subtitle="本机离线副本" onClose={() => setSelected(null)} className="attachment-preview">
      <div className="modal-body">
        {selected?.kind === 'image' && <img className="attachment-preview-image" src={url} alt={selected.name} />}
        {selected?.kind === 'voice' && <audio controls src={url}>当前格式无法播放，请下载后打开。</audio>}
        {selected?.kind === 'video' && <video controls src={url}>当前格式无法播放，请下载后打开。</video>}
        {pdf && !media && <iframe src={url} title={selected?.name} />}
        {loading && <div className="empty-panel" role="status">正在提取附件原文…</div>}
        {previewError && <div className="empty-panel" role="alert">预览失败，请下载后打开。<button className="btn ghost" onClick={() => setSelected((item) => item ? { ...item } : item)}>重试</button></div>}
        {preview !== null && <pre className="attachment-preview-text">{preview || '附件没有可读文本'}</pre>}
        {!media && !pdf && !textPreview && <div className="empty-panel">此格式可下载到本机后使用对应程序打开。</div>}
      </div>
      <div className="modal-actions"><button className="btn" onClick={() => void downloadCopy()}>下载副本</button><button className="btn primary" onClick={() => setSelected(null)}>关闭</button></div>
    </Modal>
  </>;
}
