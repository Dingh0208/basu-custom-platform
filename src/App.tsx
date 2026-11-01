import { useEffect, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import ImportCenter from './components/ImportCenter';
import TranscriptWorkspace from './components/TranscriptWorkspace';
import CustomerList from './components/CustomerList';
import ChatWorkspace from './components/ChatWorkspace';
import SettingsPage from './components/SettingsPage';
import ProjectPage from './components/ProjectPage';
import HomePage from './components/HomePage';
import Toast from './components/Toast';
import GlobalSearch from './components/GlobalSearch';
import TodoWorkspace from './components/TodoWorkspace';
import InboxArchive, { needsArchive } from './components/InboxArchive';
import PersonalProfileModal, { defaultProfile } from './components/PersonalProfileModal';
import NotificationCenter from './components/NotificationCenter';
import { initialImports, transcriptRecord } from './mock/data';
import type { ChatRecord, ImportRecord, ProjectListItem, SearchResult, TranscriptRecord, View } from './types';
import {
  createChatImport,
  createChatScreenshot,
  createImport,
  deleteImport,
  fetchChat,
  fetchAppSettings,
  fetchImports,
  fetchProjects,
  fetchPersonalProfile,
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
  if (ext === 'eml') return '邮件';
  if (['doc', 'docx'].includes(ext)) return 'Word';
  if (['xls', 'xlsx'].includes(ext)) return 'Excel';
  if (['ppt', 'pptx'].includes(ext)) return 'PPT';
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'].includes(ext)) return '图片';
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
    return value === 'home' || value === 'transcript' || value === 'customers' || value === 'chat' || value === 'settings' || value === 'projects' || value === 'import' || value === 'todos' || value === 'inbox' ? value : 'home';
  });
  const [transcriptOrigin, setTranscriptOrigin] = useState<'import' | 'customers' | 'inbox'>('import');
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState(defaultProfile);
  const [todoFocus, setTodoFocus] = useState('');
  const [inboxFocus, setInboxFocus] = useState(() => new URLSearchParams(window.location.search).get('id') || '');
  const [customerFocus, setCustomerFocus] = useState(() => ({ customer: new URLSearchParams(window.location.search).get('customer') || '', requirement: new URLSearchParams(window.location.search).get('requirement') || '' }));
  const [projectFocus, setProjectFocus] = useState(() => new URLSearchParams(window.location.search).get('project') || '');
  const hasProcessingImports = useMemo(() => imports.some((record) => record.status === 'processing'), [imports]);

  function navigateTo(nextView: View, params: Record<string, string | undefined> = {}) {
    setView(nextView);
    const search = new URLSearchParams();
    if (nextView !== 'home') search.set('view', nextView);
    Object.entries(params).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    const query = search.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }

  // Detect the local Python sidecar; keep retrying so `pnpm dev:full` works even if Vite is ready first.
  useEffect(() => {
    let mounted = true;
    let retryTimer: number | undefined;
    const check = async () => {
      const health = await getHealth();
      if (!mounted) return;
      if (health?.status === 'ok') {
        setSidecarOnline(true);
        const [data, projectData, personal, appSettings] = await Promise.all([fetchImports(), fetchProjects(), fetchPersonalProfile(), fetchAppSettings()]);
        if (mounted && personal) setProfile(personal);
        if (mounted && data) setImports(data);
        if (mounted && projectData) {
          setProjects(projectData);
          setSelectedProject((current) => {
            if (current && projectData.some((project) => project.name === current)) return current;
            const preferred = appSettings?.defaultProject || '';
            return preferred && projectData.some((project) => project.name === preferred) ? preferred : '';
          });
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
    if (!sidecarOnline || !hasProcessingImports) return;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [data, projectData] = await Promise.all([fetchImports(), fetchProjects()]);
        if (data) setImports(data);
        if (projectData) {
          setProjects(projectData);
          setSelectedProject((current) => current && projectData.some((project) => project.name === current) ? current : '');
        }
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [hasProcessingImports, sidecarOnline]);

  // Local fallback simulation when the sidecar is not running.
  useEffect(() => {
    if (sidecarOnline || !hasProcessingImports) return;
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
  }, [hasProcessingImports, sidecarOnline]);

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
    if (!sidecarOnline || view !== 'chat' || !selectedChatId || activeChat?.status !== 'processing') return;
    let mounted = true;
    const timer = window.setInterval(() => {
      fetchChat(selectedChatId).then((data) => {
        if (mounted && data) setActiveChat(data);
      });
    }, 3000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [sidecarOnline, view, selectedChatId, activeChat?.status]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const inboxCount = useMemo(() => imports.filter(needsArchive).length, [imports]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen((open) => !open); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  function openCustomer(customer: string, requirement = '') {
    setCustomerFocus({ customer, requirement });
    navigateTo('customers', { customer, requirement });
  }

  async function openSource(id: string) {
    const record = imports.find((item) => item.id === id || item.transcriptId === id);
    if (record) { await handleOpenRecord(record, 'customers'); return; }
    if (id.startsWith('chat-')) {
      const chat = await fetchChat(id);
      if (chat) { setActiveChat(chat); setSelectedChatId(id); setTranscriptOrigin('customers'); navigateTo('chat', { id }); return; }
    } else {
      const transcript = await fetchTranscript(id);
      if (transcript) { setActiveTranscript(transcript); setSelectedRecordId(id); setTranscriptOrigin('customers'); navigateTo('transcript', { id }); return; }
    }
    showToast('来源记录不存在或暂时无法加载');
  }

  function openSearchResult(result: SearchResult) {
    if (result.kind === 'customer' || result.kind === 'requirement') openCustomer(result.customer, result.kind === 'requirement' ? result.id : '');
    else if (result.kind === 'project') { setProjectFocus(result.id); navigateTo('projects', { project: result.id }); }
    else void openSource(result.id);
  }

  function showToast(message: string) {
    setToast(message);
  }

  function handleNavigate(label: string) {
    if (label === '全局搜索') { setSearchOpen(true); return; }
    if (label === '待办') { navigateTo('todos'); return; }
    if (label === '首页') {
      navigateTo('home');
      return;
    }
    if (label === '导入中心') {
      navigateTo('import');
      return;
    }
    if (label === '客户') {
      setCustomerFocus({ customer: '', requirement: '' });
      navigateTo('customers');
      return;
    }
    if (label === '设置') {
      navigateTo('settings');
      return;
    }
    if (label === '项目') {
      setProjectFocus('');
      navigateTo('projects');
      return;
    }
    if (label === '待归档') {
      setInboxFocus('');
      navigateTo('inbox');
      return;
    }
    showToast(`${label} 模块将在 Sprint 2 提供`);
  }

  async function handleAddFiles(files: File[], chatScreenshot = false) {
    if (!files.length) return;
    if (sidecarOnline) {
      let duplicates = 0;
      let failed = 0;
      for (const file of files) {
        try {
          const type = inferType(file.name);
          const known = /张三|某某科技|会员小程序/.test(file.name);
          if (type === '聊天记录' && file.size <= 8 * 1024 * 1024) {
            const text = await file.text();
            const chat = await createChatImport(text, { fileName: file.name, customer: known ? '张三' : '', project: selectedProject });
            if (chat?.chatId) continue;
            failed += 1;
            continue;
          }
          if (type === '图片' && chatScreenshot) {
            if (file.size > 12 * 1024 * 1024) {
              failed += 1;
              showToast(`${file.name} 超过聊天截图的 12 MB 限制`);
              continue;
            }
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
            failed += 1;
            continue;
          }
          const media = type === '音频' || type === '视频';
          const document = ['PDF', 'Word', 'Excel', 'PPT', '邮件', '图片'].includes(type);
          if ((media || document) && file.size > 100 * 1024 * 1024) {
            failed += 1;
            showToast(`${file.name} 超过 100 MB，请压缩或拆分后重新导入`);
            continue;
          }
          const contentBase64 = media || document ? await fileToBase64(file) : undefined;
          const result = await createImport({
            fileName: file.name,
            type,
            size: formatSize(file.size),
            customer: known ? '张三' : '待归档',
            project: selectedProject || '—',
            kind: type,
            contentBase64,
            mimeType: file.type || (media ? (type === '视频' ? 'video/mp4' : 'audio/mpeg') : undefined),
          });
          if (!result) failed += 1;
          else if (result.duplicate) duplicates += 1;
        } catch {
          failed += 1;
        }
      }
      const data = await fetchImports();
      if (data) setImports(data);
      const suffix = failed ? `，${failed} 个文件处理失败` : '';
      showToast(duplicates > 0 ? `${files.length} 个文件已提交，其中 ${duplicates} 个重复文件已跳过${suffix}` : `已提交 ${files.length - failed} 个文件到本地 Sidecar 处理${suffix}`);
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
    const [data, projectData] = await Promise.all([fetchImports(), fetchProjects()]);
    if (data) setImports(data);
    if (projectData) setProjects(projectData);
    if (projectData) setSelectedProject((current) => projectData.some((project) => project.name === current) ? current : '');
  }

  async function handleWechatImported() {
    await refreshImports();
    const projectData = await fetchProjects();
    if (projectData) setProjects(projectData);
    showToast('微信聊天记录已进入分析队列，完成后可在客户 360 查看');
  }

  async function handleDeleteRecord(record: ImportRecord) {
    if (record.status === 'processing') {
      showToast('文件仍在处理中，请等待完成后再删除');
      return;
    }
    if (!window.confirm(`确定删除「${record.fileName}」？\n\n会删除该文件、转写/聊天内容、关联需求和项目统计，但不会删除客户档案。`)) return;
    if (!sidecarOnline) {
      setImports((records) => records.filter((item) => item.id !== record.id));
      showToast(`已删除「${record.fileName}」`);
      return;
    }
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
      if (!result) {
        showToast('无法识别这段聊天记录，请检查格式后重试');
        return;
      }
      const data = await fetchImports();
      if (data) setImports(data);
      showToast('已提交粘贴文本到本地 Sidecar，正在解析对话');
      return;
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

  async function handleOpenRecord(record: ImportRecord, origin: 'import' | 'customers' | 'inbox' = 'import', preview = false) {
    if (needsArchive(record) && !preview) {
      setInboxFocus(record.id);
      navigateTo('inbox', { id: record.id });
      return;
    }
    if (record.status === 'processing') {
      showToast('文件仍在处理中，请稍候');
      return;
    }
    if (record.status === 'failed') {
      showToast('处理失败：请检查 Sidecar 日志、API Key 与音频格式');
      return;
    }
    if (record.status === 'cancelled') {
      showToast('任务已取消，请在导入中心的任务列表中重试');
      return;
    }
    if (record.type === '聊天记录' && record.transcriptId?.startsWith('chat-')) {
      setActiveChat(null);
      setSelectedChatId(record.transcriptId);
      setTranscriptOrigin(origin);
      if (sidecarOnline) {
        const chat = await fetchChat(record.transcriptId);
        if (chat) setActiveChat(chat);
      }
      navigateTo('chat', { id: record.transcriptId });
      return;
    }
    if (record.transcriptId) {
      setSelectedRecordId(record.transcriptId);
      setTranscriptOrigin(origin);
      if (sidecarOnline) {
        const data = await fetchTranscript(record.transcriptId);
        if (data) setActiveTranscript(data);
      }
      navigateTo('transcript', { id: record.transcriptId });
      return;
    }
    showToast('该文件已完成，转写稿将在聊天解析链路中生成');
  }

  return (
    <div className="app">
      <Sidebar
        notificationEntry={<NotificationCenter online={sidecarOnline} onTodo={(id) => { setTodoFocus(id); navigateTo('todos'); }} />}
        profile={profile}
        onProfile={() => setProfileOpen(true)}
        active={view === 'transcript' || view === 'chat' ? transcriptOrigin : view}
        inboxCount={inboxCount}
        onNavigate={handleNavigate}
      />
      <main className="main">
        {view === 'home' ? (
          <HomePage
            online={sidecarOnline}
            onNavigate={handleNavigate}
            onOpenRecord={(record) => handleOpenRecord(record, 'import')}
            onToast={showToast}
          />
        ) : view === 'inbox' ? (
          <InboxArchive imports={imports} online={sidecarOnline} initialId={inboxFocus} onArchived={refreshImports} onNavigate={handleNavigate} onPreview={(record) => void handleOpenRecord(record, 'inbox', true)} onDelete={(record) => void handleDeleteRecord(record)} />
        ) : view === 'import' ? (
          <ImportCenter
            onInbox={() => handleNavigate('待归档')}
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
            online={sidecarOnline}
            key={`${customerFocus.customer}-${customerFocus.requirement}`}
            initialCustomer={customerFocus.customer}
            initialRequirement={customerFocus.requirement}
            onSource={openSource}
            imports={imports}
            onOpenRecord={(record) => handleOpenRecord(record, 'customers')}
            onToast={showToast}
            onRefreshImports={refreshImports}
          />
        ) : view === 'chat' ? (
          activeChat ? (
            <ChatWorkspace
              record={activeChat}
              sidecarOnline={sidecarOnline}
              onBack={() => navigateTo(transcriptOrigin)}
              onToast={showToast}
              onChatUpdate={(chat) => { setActiveChat(chat); void refreshImports(); }}
              onRequirement={openCustomer}
            />
          ) : (
            <div className="empty-panel" style={{ margin: 24 }}>正在加载聊天记录…</div>
          )
        ) : view === 'settings' ? (
          <SettingsPage onToast={showToast} />
        ) : view === 'projects' ? (
          <ProjectPage key={projectFocus} initialProject={projectFocus} onToast={showToast} onCustomer={openCustomer} />
        ) : view === 'todos' ? (
          <TodoWorkspace key={todoFocus} initialId={todoFocus} online={sidecarOnline} onSource={openSource} onRequirement={openCustomer} />
        ) : (
          <TranscriptWorkspace
            onRequirement={openCustomer}
            record={activeTranscript}
            sidecarOnline={sidecarOnline}
            onBack={() => navigateTo(transcriptOrigin)}
            onToast={showToast}
          />
        )}
      </main>
      <Toast message={toast} />
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={openSearchResult} />
      <PersonalProfileModal open={profileOpen} profile={profile} onClose={() => setProfileOpen(false)} onSaved={(saved) => { setProfile(saved); showToast('个人信息已保存'); }} />
    </div>
  );
}
