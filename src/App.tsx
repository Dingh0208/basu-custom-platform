import { useEffect, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import ImportCenter from './components/ImportCenter';
import TranscriptWorkspace from './components/TranscriptWorkspace';
import CustomerList from './components/CustomerList';
import ChatWorkspace from './components/ChatWorkspace';
import SettingsPage from './components/SettingsPage';
import ProjectPage from './components/ProjectPage';
import Toast from './components/Toast';
import { initialImports, transcriptRecord } from './mock/data';
import type { ChatRecord, ImportRecord, ProjectListItem, TranscriptRecord, View } from './types';
import {
  createChatImport,
  createChatScreenshot,
  createImport,
  deleteImport,
  fetchChat,
  fetchAppSettings,
  fetchImports,
  fetchProjects,
  fetchTranscript,
  getHealth,
  pasteImport,
} from './api/client';

function formatSize(bytes: number) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function inferType(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp3', 'm4a', 'wav', 'amr', 'aac', 'flac'].includes(ext)) return '音频';
  if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) return '视频';
  if (ext === 'pdf') return 'PDF';
  if (['doc', 'docx'].includes(ext)) return 'Word';
  if (['xls', 'xlsx'].includes(ext)) return 'Excel';
  if (['ppt', 'pptx'].includes(ext)) return 'PPT';
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) return '图片';
  if (['zip', 'rar', '7z'].includes(ext)) return '压缩包';
  if (['txt', 'html', 'json', 'csv'].includes(ext)) return '聊天记录';
  return '文件';
}

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',', 2)[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [view, setView] = useState<View>(() => {
    const value = new URLSearchParams(window.location.search).get('view');
    return value === 'transcript' || value === 'customers' || value === 'chat' || value === 'settings' || value === 'projects' ? value : 'import';
  });
  const [transcriptOrigin, setTranscriptOrigin] = useState<'import' | 'customers'>('import');
  const [imports, setImports] = useState<ImportRecord[]>(initialImports);
  const [activeTranscript, setActiveTranscript] = useState<TranscriptRecord>(transcriptRecord);
  const [activeChat, setActiveChat] = useState<ChatRecord | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string>(() =>
    new URLSearchParams(window.location.search).get('id') || 'tr-001',
  );
  const [selectedChatId, setSelectedChatId] = useState<string>(() =>
    new URLSearchParams(window.location.search).get('id') || '',
  );
  const [sidecarOnline, setSidecarOnline] = useState(false);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  // Detect the local Python sidecar; keep retrying so `pnpm dev:full` works even if Vite is ready first.
  useEffect(() => {
    let mounted = true;
    let retryTimer: number | undefined;
    const check = async () => {
      const health = await getHealth();
      if (!mounted) return;
      if (health?.status === 'ok') {
        setSidecarOnline(true);
        const data = await fetchImports();
        if (mounted && data) setImports(data);
        const projectData = await fetchProjects();
        const appSettings = await fetchAppSettings();
        if (mounted && projectData) {
          setProjects(projectData);
          setSelectedProject((current) => current || appSettings?.defaultProject || '');
        }
        return;
      }
      setSidecarOnline(false);
      retryTimer = window.setTimeout(check, 2000);
    };
    check();
    return () => {
      mounted = false;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, []);

  // Poll the sidecar while it is online so processing records update from the persisted store.
  useEffect(() => {
    if (!sidecarOnline) return;
    const timer = window.setInterval(async () => {
      const data = await fetchImports();
      if (data) setImports(data);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [sidecarOnline]);

  // Local fallback simulation when the sidecar is not running.
  useEffect(() => {
    if (sidecarOnline) return;
    const timer = window.setInterval(() => {
      setImports((records) =>
        records.map((record) => {
          if (record.status !== 'processing') return record;
          const next = Math.min(100, record.progress + 20);
          if (next >= 100) {
            return { ...record, progress: 100, status: 'done', customer: record.customer === '待归档' ? '待确认' : record.customer };
          }
          return { ...record, progress: next };
        }),
      );
    }, 900);
    return () => window.clearInterval(timer);
  }, [sidecarOnline]);

  // Load the selected transcript from the sidecar when entering the transcript view.
  useEffect(() => {
    if (!sidecarOnline || view !== 'transcript') return;
    let mounted = true;
    fetchTranscript(selectedRecordId || 'tr-001').then((data) => {
      if (mounted && data) setActiveTranscript(data);
    });
    return () => {
      mounted = false;
    };
  }, [sidecarOnline, view, selectedRecordId]);

  useEffect(() => {
    if (!sidecarOnline || view !== 'chat' || !selectedChatId) return;
    let mounted = true;
    fetchChat(selectedChatId).then((data) => {
      if (mounted && data) setActiveChat(data);
    });
    return () => {
      mounted = false;
    };
  }, [sidecarOnline, view, selectedChatId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const inboxCount = useMemo(() => imports.filter((x) => x.status === 'inbox').length, [imports]);

  function showToast(message: string) {
    setToast(message);
  }

  function handleNavigate(label: string) {
    if (label === '导入中心') {
      setView('import');
      return;
    }
    if (label === '客户') {
      setView('customers');
      return;
    }
    if (label === '设置') {
      setView('settings');
      return;
    }
    if (label === '项目') {
      setView('projects');
      return;
    }
    showToast(`${label} 模块将在 Sprint 2 提供`);
  }

  async function handleAddFiles(files: File[]) {
    if (!files.length) return;
    if (sidecarOnline) {
      let duplicates = 0;
      for (const file of files) {
        const type = inferType(file.name);
        const known = /张三|某某科技|会员小程序/.test(file.name);
        if (type === '聊天记录' && file.size <= 8 * 1024 * 1024) {
          const text = await file.text();
          const chat = await createChatImport(text, { fileName: file.name, customer: known ? '张三' : '', project: selectedProject });
          if (chat?.chatId) continue;
        }
        if (type === '图片' && file.size <= 12 * 1024 * 1024) {
          showToast('正在识别聊天截图，请稍候…');
          const imageBase64 = await fileToBase64(file);
          const chat = await createChatScreenshot(imageBase64, file.type || 'image/png', file.name, {
            customer: known ? '张三' : undefined,
            project: selectedProject || undefined,
          });
          if (chat?.chatId) {
            showToast('聊天截图已识别，正在生成对话解析');
            continue;
          }
        }
        const media = type === '音频' || type === '视频';
        const audioBase64 = media ? await fileToBase64(file) : undefined;
        const result = await createImport({
          fileName: file.name,
          type,
          size: formatSize(file.size),
          customer: known ? '张三' : '待归档',
          project: selectedProject || '—',
          kind: type,
          audioBase64,
          mimeType: media ? (file.type || (type === '视频' ? 'video/mp4' : 'audio/mpeg')) : undefined,
        });
        if (result?.duplicate) duplicates += 1;
      }
      const data = await fetchImports();
      if (data) setImports(data);
      showToast(duplicates > 0 ? `${files.length} 个文件已提交，其中 ${duplicates} 个重复文件已跳过` : `已提交 ${files.length} 个文件到本地 Sidecar，正在上传并转写`);
      return;
    }

    const newRecords: ImportRecord[] = files.map((file, index) => {
      const type = inferType(file.name);
      const known = /张三|某某科技|会员小程序/.test(file.name);
      return {
        id: `imp-${Date.now()}-${index}`,
        fileName: file.name,
        type,
        size: formatSize(file.size),
        customer: known ? '张三' : '待归档',
        project: selectedProject || '—',
        status: 'processing',
        progress: 0,
        importedAt: nowTime(),
        transcriptId: type === '音频' || type === '视频' ? 'tr-001' : undefined,
      };
    });
    setImports((records) => [...newRecords, ...records]);
    showToast(`已导入 ${files.length} 个文件，正在识别客户与转写（本地模拟）`);
  }

  async function refreshImports() {
    const data = await fetchImports();
    if (data) setImports(data);
  }

  async function handleWechatImported() {
    await refreshImports();
    showToast('微信聊天记录已进入分析队列，完成后可在客户 360 查看');
  }

  async function handleDeleteRecord(record: ImportRecord) {
    if (!window.confirm(`确定删除「${record.fileName}」？\n\n会删除该文件、转写/聊天内容、关联需求和项目统计，但不会删除客户档案。`)) return;
    const result = await deleteImport(record.id);
    if (!result) {
      showToast('删除失败，请稍后重试');
      return;
    }
    await refreshImports();
    showToast(`已删除「${record.fileName}」及其关联内容`);
  }

  async function handlePasteText(text: string) {
    if (sidecarOnline) {
      const result = await pasteImport(text, { project: selectedProject });
      const data = await fetchImports();
      if (data) setImports(data);
      showToast(result ? '已提交粘贴文本到本地 Sidecar，正在解析对话' : 'Sidecar 暂时不可用，已切换为本地模拟');
      if (result) return;
    }
    const known = /张三|某某科技|会员小程序/.test(text);
    const record: ImportRecord = {
      id: `imp-${Date.now()}`,
      fileName: `粘贴文本_${new Date().toLocaleDateString('zh-CN')}.txt`,
      type: '聊天记录',
      size: `${text.length} 字`,
      customer: known ? '张三' : '待归档',
      project: selectedProject || '—',
      status: 'processing',
      progress: 0,
      importedAt: nowTime(),
      transcriptId: 'tr-001',
    };
    setImports((records) => [record, ...records]);
    showToast('已接收粘贴文本，正在解析对话（本地模拟）');
  }

  async function handleOpenRecord(record: ImportRecord, origin: 'import' | 'customers' = 'import') {
    if (record.status === 'processing') {
      showToast('文件仍在处理中，请稍候');
      return;
    }
    if (record.status === 'inbox') {
      showToast('该文件尚未识别客户，请到「待归档」中处理');
      return;
    }
    if (record.status === 'failed') {
      showToast('处理失败：请检查 Sidecar 日志、API Key 与音频格式');
      return;
    }
    if (record.type === '聊天记录' && record.transcriptId?.startsWith('chat-')) {
      setSelectedChatId(record.transcriptId);
      setTranscriptOrigin(origin);
      if (sidecarOnline) {
        const chat = await fetchChat(record.transcriptId);
        if (chat) setActiveChat(chat);
      }
      setView('chat');
      return;
    }
    if (record.transcriptId) {
      setSelectedRecordId(record.transcriptId);
      setTranscriptOrigin(origin);
      if (sidecarOnline) {
        const data = await fetchTranscript(record.transcriptId);
        if (data) setActiveTranscript(data);
      }
      setView('transcript');
      return;
    }
    showToast('该文件已完成，转写稿将在聊天解析链路中生成');
  }

  return (
    <div className="app">
      <Sidebar
        active={view === 'transcript' || view === 'chat' ? transcriptOrigin : view === 'customers' ? 'customers' : view === 'projects' ? 'projects' : 'import'}
        inboxCount={inboxCount}
        onNavigate={handleNavigate}
      />
      <main className="main">
        {view === 'import' ? (
          <ImportCenter
            imports={imports}
            sidecarOnline={sidecarOnline}
            onAddFiles={handleAddFiles}
            onPasteText={handlePasteText}
            onOpenRecord={(record) => handleOpenRecord(record, 'import')}
            onToast={showToast}
            onWechatImported={handleWechatImported}
            onDeleteRecord={handleDeleteRecord}
            projects={projects}
            selectedProject={selectedProject}
            onProjectChange={setSelectedProject}
          />
        ) : view === 'customers' ? (
          <CustomerList
            imports={imports}
            onOpenRecord={(record) => handleOpenRecord(record, 'customers')}
            onToast={showToast}
            onRefreshImports={refreshImports}
          />
        ) : view === 'chat' && activeChat ? (
          <ChatWorkspace
            record={activeChat}
            sidecarOnline={sidecarOnline}
            onBack={() => setView(transcriptOrigin)}
            onToast={showToast}
            onChatUpdate={setActiveChat}
          />
        ) : view === 'settings' ? (
          <SettingsPage onToast={showToast} />
        ) : view === 'projects' ? (
          <ProjectPage onToast={showToast} />
        ) : (
          <TranscriptWorkspace
            record={activeTranscript}
            sidecarOnline={sidecarOnline}
            onBack={() => setView(transcriptOrigin)}
            onToast={showToast}
          />
        )}
      </main>
      <Toast message={toast} />
    </div>
  );
}
