import { useEffect, useMemo, useState } from 'react';
import type { ClarificationRecord, ImportRecord, LlmConfig, ProjectListItem } from '../types';
import {
  cancelTask,
  appendClarificationSources,
  createClarification,
  deleteClarification,
  fetchClarification,
  fetchClarificationMetrics,
  fetchClarifications,
  fetchImports,
  fetchLlmConfig,
  fetchProjects,
  fetchTasks,
  duplicateClarification,
  downloadClarificationWord,
  createClarificationQuestion,
  confirmClarificationAction,
  generateClarificationFollowup,
  previewClarificationAction,
  recordClarificationAnswer,
  recordClarificationCopies,
  replaceClarificationSources,
  startClarificationAnalysis,
  updateClarificationQuestion,
  updateClarification,
} from '../api/client';
import type { ClarificationMetrics, ClarificationQuestion } from '../types';

type ClarificationWorkspaceProps = {
  online: boolean;
  initialCustomer?: string;
  initialProject?: string;
  initialRecordId?: string;
  onSource: (sourceId: string, recordId: string) => void;
  onToast: (message: string) => void;
};

type ScopeFilter = 'all' | 'unarchived';

type ClarificationActionForm = {
  action: 'requirement' | 'project';
  customer: string;
  project: string;
  targetProjectId: string;
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2';
  stage: string;
  budget: string;
  targetLaunchDate: string;
  owner: string;
};

const CLARIFICATION_CATEGORIES = [
  '业务目标/指标', '用户与流程', '一期范围', '平台与交互', '数据迁移',
  '接口与第三方', '权限/安全/合规', '性能/可靠性', '工期/预算/合同', '验收/上线/运维/售后',
];

function materialState(record: ImportRecord) {
  if (record.status === 'done') return { readable: true, label: '可分析', reason: '' };
  if (record.status === 'processing') return { readable: false, label: '处理中', reason: '资料仍在解析，完成后才能分析' };
  if (record.status === 'failed') return { readable: false, label: '不可读', reason: '导入处理失败，请回到导入中心重试' };
  if (record.status === 'cancelled') return { readable: false, label: '不可读', reason: '导入任务已取消，请重新导入' };
  return { readable: false, label: '待归档', reason: '尚未完成客户识别与解析' };
}

function toSource(record: ImportRecord) {
  const state = materialState(record);
  return {
    sourceType: record.transcriptId?.startsWith('chat-') ? 'chat' : record.transcriptId ? 'transcript' : 'import',
    sourceId: record.id,
    customerId: record.customer === '待归档' ? '' : record.customer,
    projectId: record.project === '—' ? '' : record.project,
    displayName: record.fileName,
    sourceKind: record.type,
    readable: state.readable,
    extractionError: state.reason,
    occurredAt: record.importedAt,
  };
}

function formatRecordStatus(status: string) {
  if (status === 'draft') return '草稿';
  if (status === 'awaiting_confirmation') return '待确认';
  if (status === 'analyzing') return '分析中';
  if (status === 'partial') return '部分完成';
  if (status === 'active') return '已生成';
  if (status === 'failed') return '分析失败';
  if (status === 'completed') return '已完成';
  return status;
}

function priorityLabel(priority: string) {
  if (priority === 'must_confirm') return '必须先确认';
  if (priority === 'important') return '重要';
  return '后续确认';
}

function questionStatusLabel(status: string) {
  if (status === 'not_applicable') return '不适用';
  if (status === 'asked') return '已问';
  if (status === 'answered') return '已回答';
  return '待问';
}

function conclusionLabel(type: string) {
  return ({ fact: '已知事实', inference: '推断', gap: '资料未提及/信息不足', conflict: '资料冲突' } as Record<string, string>)[type] || '待核验';
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character));
}

function languageLabel(language: string) {
  if (!language || language === 'zh-CN') return '简体中文';
  return language === 'en' ? 'English' : language;
}

export default function ClarificationWorkspace({ online, initialCustomer = '', initialProject = '', initialRecordId = '', onSource, onToast }: ClarificationWorkspaceProps) {
  const [records, setRecords] = useState<ClarificationRecord[]>([]);
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [llm, setLlm] = useState<LlmConfig | null>(null);
  const [metrics, setMetrics] = useState<ClarificationMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<ClarificationRecord | null>(null);
  const [editorOpen, setEditorOpen] = useState(Boolean(initialCustomer || initialProject));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('简体中文');
  const [customerFilter, setCustomerFilter] = useState(initialCustomer);
  const [projectFilter, setProjectFilter] = useState(initialProject);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [analysisTaskId, setAnalysisTaskId] = useState('');
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [questionBusy, setQuestionBusy] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState('');
  const [editingText, setEditingText] = useState('');
  const [editingCategory, setEditingCategory] = useState('');
  const [editingPriority, setEditingPriority] = useState<ClarificationQuestion['priority']>('must_confirm');
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customCategory, setCustomCategory] = useState('业务目标/指标');
  const [customPriority, setCustomPriority] = useState<ClarificationQuestion['priority']>('must_confirm');
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [answerBusyId, setAnswerBusyId] = useState('');
  const [followupBusyId, setFollowupBusyId] = useState('');
  const [actionBusyId, setActionBusyId] = useState('');
  const [actionQuestionId, setActionQuestionId] = useState('');
  const [actionForm, setActionForm] = useState<ClarificationActionForm | null>(null);
  const [actionPreview, setActionPreview] = useState<{ action: string; target: Record<string, string>; changes: Record<string, string>; answerId: string } | null>(null);
  const [actionPreviewPayload, setActionPreviewPayload] = useState<Record<string, unknown> | null>(null);
  const [appendMode, setAppendMode] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [recordCustomerFilter, setRecordCustomerFilter] = useState('');
  const [recordProjectFilter, setRecordProjectFilter] = useState('');
  const [recordStatusFilter, setRecordStatusFilter] = useState('all');
  const [recordDateFilter, setRecordDateFilter] = useState('all');
  const [outputCustomer, setOutputCustomer] = useState('');
  const [outputProject, setOutputProject] = useState('');
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set());
  const [assignmentCustomer, setAssignmentCustomer] = useState('');
  const [assignmentProject, setAssignmentProject] = useState('');
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [assignmentSourceId, setAssignmentSourceId] = useState('');
  const [assignmentPreview, setAssignmentPreview] = useState<{ customer: string; project: string; questions: ClarificationQuestion[] } | null>(null);

  async function load() {
    if (!online) {
      setLoading(false);
      setError('本地服务未连接，连接后才能读取澄清记录和资料');
      return;
    }
    setLoading(true);
    setError('');
    const [recordData, importData, projectData, llmData, metricsData] = await Promise.all([
      fetchClarifications({ includeArchived }),
      fetchImports(),
      fetchProjects(),
      fetchLlmConfig(),
      fetchClarificationMetrics(),
    ]);
    if (!recordData || !importData) setError('需求澄清资料加载失败，请重试');
    if (recordData) setRecords(recordData);
    if (importData) setImports(importData);
    if (projectData) setProjects(projectData.filter((item) => !item.archived));
    if (llmData) setLlm(llmData);
    if (metricsData) setMetrics(metricsData);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [online, includeArchived]);

  useEffect(() => {
    if (online && initialRecordId) void openRecord(initialRecordId);
  }, [online, initialRecordId]);

  useEffect(() => {
    if (!online || !selectedRecord || selectedRecord.status !== 'analyzing') return;
    let mounted = true;
    let timer: number | undefined;
    const refresh = async () => {
      const [detail, tasks] = await Promise.all([
        fetchClarification(selectedRecord.id),
        fetchTasks(),
      ]);
      if (!mounted) return;
      if (detail) {
        setSelectedRecord(detail);
        setRecords((current) => current.map((item) => item.id === detail.id ? detail : item));
      }
      const task = tasks?.filter((item) => item.kind === 'clarification_analysis' && item.entityId === selectedRecord.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (task) setAnalysisTaskId(task.id);
      if ((detail?.status || selectedRecord.status) === 'analyzing') timer = window.setTimeout(refresh, 1800);
    };
    void refresh();
    return () => { mounted = false; if (timer) window.clearTimeout(timer); };
  }, [online, selectedRecord?.id, selectedRecord?.status]);

  const customers = useMemo(() => {
    const values = [initialCustomer, ...imports.map((item) => item.customer), ...records.flatMap((record) => record.customers ?? [])].filter((item) => item && item !== '待归档');
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [imports, initialCustomer, records]);

  const projectOptions = useMemo(() => {
    const values = [
      initialProject,
      ...projects.map((item) => item.name),
      ...records.flatMap((record) => record.projects ?? []),
      ...imports.map((item) => item.project).filter((item) => item && item !== '—'),
    ];
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [imports, initialProject, projects, records]);

  const customerOptions = useMemo(() => Array.from(new Set([
    ...customers,
    ...projects.map((item) => item.customer),
    ...(selectedRecord?.questions ?? []).map((item) => item.customerId).filter(Boolean),
  ])).sort((a, b) => a.localeCompare(b, 'zh-CN')), [customers, projects, selectedRecord?.questions]);

  const actionProjectOptions = useMemo(() => projects.filter((item) => !actionForm?.customer || item.customer === actionForm.customer), [actionForm?.customer, projects]);
  const assignmentProjectOptions = useMemo(() => projects.filter((item) => !assignmentCustomer || item.customer === assignmentCustomer), [assignmentCustomer, projects]);

  const questionSourceIds = useMemo(() => {
    const questions = selectedRecord?.questions ?? [];
    const byId = new Map(questions.map((question) => [question.id, question]));
    function collect(question: ClarificationQuestion, visited = new Set<string>()): Set<string> {
      if (visited.has(question.id)) return new Set();
      visited.add(question.id);
      const ids = new Set<string>();
      question.evidence.forEach((evidence) => {
        if (evidence.sourceSnapshotId.startsWith('answer:')) {
          const parent = byId.get(evidence.sourceSnapshotId.slice(7));
          if (parent) collect(parent, visited).forEach((id) => ids.add(id));
        } else if (evidence.sourceSnapshotId) ids.add(evidence.sourceSnapshotId);
      });
      return ids;
    }
    return new Map(questions.map((question) => [question.id, collect(question)]));
  }, [selectedRecord?.questions]);
  const unassignedQuestions = (selectedRecord?.questions ?? []).filter((question) => question.status !== 'deleted' && (!question.customerId || !question.projectId));
  const sourceQuestions = unassignedQuestions.filter((question) => questionSourceIds.get(question.id)?.has(assignmentSourceId));
  const sourceExclusiveQuestions = sourceQuestions.filter((question) => questionSourceIds.get(question.id)?.size === 1);

  const questionGroups = useMemo(() => {
    const groups = new Map<string, { customerId: string; projectId: string; questions: ClarificationQuestion[] }>();
    (selectedRecord?.questions ?? []).forEach((question) => {
      const customerId = question.customerId || '未归属客户';
      const projectId = question.projectId || '未归属项目';
      const key = `${customerId}::${projectId}`;
      const group = groups.get(key) ?? { customerId, projectId, questions: [] };
      group.questions.push(question);
      groups.set(key, group);
    });
    groups.forEach((group) => {
      group.questions.sort((a, b) => {
        const categoryDiff = CLARIFICATION_CATEGORIES.indexOf(a.category) - CLARIFICATION_CATEGORIES.indexOf(b.category);
        return categoryDiff || a.createdAt.localeCompare(b.createdAt);
      });
    });
    return Array.from(groups.values());
  }, [selectedRecord?.questions]);

  const outputCustomerOptions = useMemo(() => Array.from(new Set((selectedRecord?.questions ?? []).map((item) => item.customerId || '未归属客户'))).sort((a, b) => a.localeCompare(b, 'zh-CN')), [selectedRecord?.questions]);
  const outputProjectOptions = useMemo(() => Array.from(new Set((selectedRecord?.questions ?? [])
    .filter((item) => !outputCustomer || (item.customerId || '未归属客户') === outputCustomer)
    .map((item) => item.projectId || '未归属项目'))).sort((a, b) => a.localeCompare(b, 'zh-CN')), [outputCustomer, selectedRecord?.questions]);
  const publicQuestions = useMemo(() => (selectedRecord?.questions ?? []).filter((item) => {
    if (item.status === 'deleted' || item.status === 'not_applicable') return false;
    if (outputCustomer && (item.customerId || '未归属客户') !== outputCustomer) return false;
    if (outputProject && (item.projectId || '未归属项目') !== outputProject) return false;
    return true;
  }), [outputCustomer, outputProject, selectedRecord?.questions]);
  const visibleRecords = useMemo(() => {
    const cutoff = recordDateFilter === 'all' ? 0 : Date.now() - Number(recordDateFilter) * 24 * 60 * 60 * 1000;
    return records.filter((record) => {
      const scope = !Array.isArray(record.selectedScope) ? record.selectedScope : {};
      if (recordCustomerFilter && !(record.customers ?? []).includes(recordCustomerFilter) && scope?.customer !== recordCustomerFilter) return false;
      if (recordProjectFilter && !(record.projects ?? []).includes(recordProjectFilter) && scope?.project !== recordProjectFilter) return false;
      if (recordStatusFilter === 'unanswered' && record.openQuestionCount <= 0) return false;
      if (recordStatusFilter !== 'all' && recordStatusFilter !== 'unanswered' && record.status !== recordStatusFilter) return false;
      if (cutoff && new Date(record.updatedAt).getTime() < cutoff) return false;
      return true;
    });
  }, [recordCustomerFilter, recordDateFilter, recordProjectFilter, recordStatusFilter, records]);

  const filteredMaterials = useMemo(() => imports.filter((item) => {
    if (customerFilter && item.customer !== customerFilter) return false;
    if (projectFilter && item.project !== projectFilter) return false;
    if (scopeFilter === 'unarchived' && item.status !== 'inbox' && !['', '待归档', '待确认'].includes(item.customer)) return false;
    return true;
  }), [customerFilter, imports, projectFilter, scopeFilter]);

  const selectedMaterials = useMemo(
    () => imports.filter((item) => selectedIds.has(item.id)),
    [imports, selectedIds],
  );
  const readableSelected = selectedMaterials.filter((item) => materialState(item).readable);
  const allFilteredSelected = filteredMaterials.length > 0 && filteredMaterials.every((item) => selectedIds.has(item.id));

  function resetEditor() {
    setSelectedRecord(null);
    setEditorOpen(true);
    setConfirmOpen(false);
    setName('');
    setLanguage('简体中文');
    setCustomerFilter(initialCustomer);
    setProjectFilter(initialProject);
    setScopeFilter('all');
    setSelectedIds(new Set());
    setOutputCustomer('');
    setOutputProject('');
    setActionForm(null);
    setActionQuestionId('');
    setAppendMode(false);
    setSelectedQuestionIds(new Set());
    setAssignmentSourceId('');
    setAssignmentPreview(null);
  }

  async function openRecord(id: string) {
    const detail = await fetchClarification(id);
    if (!detail) {
      onToast('无法打开需求澄清单，请重试');
      return;
    }
    setSelectedRecord(detail);
    setEditorOpen(true);
    setConfirmOpen(false);
    setOutputCustomer('');
    setOutputProject('');
    setActionForm(null);
    setActionQuestionId('');
    setAppendMode(false);
    setSelectedQuestionIds(new Set());
    setAssignmentSourceId('');
    setAssignmentPreview(null);
    setName(detail.name);
    setLanguage(languageLabel(detail.language));
    setCustomerFilter('');
    setProjectFilter('');
    setScopeFilter('all');
    setSelectedIds(new Set((detail.sources ?? []).map((source) => source.sourceId).filter(Boolean)));
  }

  function locateAnswer(questionId: string) {
    const question = document.getElementById(`clarification-question-${questionId}`);
    if (!question) { onToast('原问题已删除，回答证据快照仍保留'); return; }
    question.closest('details')?.setAttribute('open', '');
    question.focus({ preventScroll: true });
    question.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function toggleMaterial(id: string) {
    if (!appendMode && selectedRecord && !['draft', 'awaiting_confirmation'].includes(selectedRecord.status)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleFiltered() {
    if (!appendMode && selectedRecord && !['draft', 'awaiting_confirmation'].includes(selectedRecord.status)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) filteredMaterials.forEach((item) => next.delete(item.id));
      else filteredMaterials.forEach((item) => next.add(item.id));
      return next;
    });
  }

  function scopeSnapshot() {
    return {
      label: Array.from(new Set(selectedMaterials.map(toSource).map((source) => `${source.customerId || '未归属客户'} · ${source.projectId || '未归属项目'}`))).join('、'),
      customer: customerFilter,
      project: projectFilter,
      materialScope: scopeFilter,
      sourceCount: selectedMaterials.length,
    };
  }

  function modelSnapshot() {
    return {
      provider: 'settings',
      summaryModel: llm?.summaryModel || '',
      configured: Boolean(llm?.hasKey && llm?.summaryModel),
    };
  }

  async function persistDraft() {
    if (!online) {
      onToast('本地服务未连接，暂时无法保存草稿');
      return null;
    }
    const outputLanguage = language.trim() === '简体中文' ? 'zh-CN' : language.trim();
    if (!outputLanguage) {
      onToast('请填写本次生成语言');
      return null;
    }
    setSaving(true);
    try {
      const selectedImportIds = new Set(imports.map((item) => item.id));
      const retainedSnapshots = (selectedRecord?.sources ?? [])
        .filter((source) => source.sourceId && selectedIds.has(source.sourceId) && !selectedImportIds.has(source.sourceId))
        .map((source) => ({
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          customerId: source.customerId,
          projectId: source.projectId,
          displayName: source.displayName,
          sourceKind: source.sourceKind,
          contentHash: source.contentHash,
          textSnapshot: source.textSnapshot,
          readable: source.readable,
          extractionError: source.extractionError,
          occurredAt: source.occurredAt,
        }));
      const sources = [...selectedMaterials.map(toSource), ...retainedSnapshots];
      let saved: ClarificationRecord | null = selectedRecord
        ? await replaceClarificationSources(selectedRecord.id, sources)
        : await createClarification({ name: name.trim() || undefined, language: outputLanguage, selectedScope: scopeSnapshot(), modelSnapshot: modelSnapshot(), sources });
      if (!saved) {
        onToast('草稿保存失败，请重试');
        return null;
      }
      if (selectedRecord && name.trim() && name.trim() !== selectedRecord.name) {
        saved = await updateClarification(saved.id, { name: name.trim(), language: outputLanguage, selectedScope: scopeSnapshot(), modelSnapshot: modelSnapshot(), status: 'draft' });
      } else if (selectedRecord) {
        saved = await updateClarification(saved.id, { language: outputLanguage, selectedScope: scopeSnapshot(), modelSnapshot: modelSnapshot(), status: 'draft' });
      }
      if (!saved) {
        onToast('草稿资料已更新，但名称保存失败，请重试');
        return null;
      }
      setSelectedRecord(saved);
      setName(saved.name);
      setRecords((current) => [saved!, ...current.filter((item) => item.id !== saved!.id)]);
      onToast('需求澄清单草稿已保存');
      return saved;
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    if (appendMode) {
      await openConfirmation();
      return;
    }
    if (selectedRecord && !['draft', 'awaiting_confirmation'].includes(selectedRecord.status)) {
      if (!name.trim()) { onToast('请填写澄清单名称'); return; }
      setSaving(true);
      const saved = await updateClarification(selectedRecord.id, { name: name.trim() });
      setSaving(false);
      if (!saved) { onToast('名称保存失败，请重试'); return; }
      setSelectedRecord(saved);
      setRecords((current) => current.map((item) => item.id === saved.id ? saved : item));
      onToast('澄清单名称已保存');
      return;
    }
    await persistDraft();
  }

  async function openConfirmation() {
    if (!selectedMaterials.length) {
      onToast('至少选择一份资料后才能确认');
      return;
    }
    if (!readableSelected.length) {
      onToast('当前选择中没有可分析资料，请等待解析完成或重新选择');
      return;
    }
    if (appendMode) { setConfirmOpen(true); return; }
    const saved = await persistDraft();
    if (saved) setConfirmOpen(true);
  }

  async function startAnalysis(incremental = false) {
    if (!selectedRecord) return;
    setAnalysisBusy(true);
    const result = await startClarificationAnalysis(selectedRecord.id, incremental);
    if (!result) {
      onToast('分析启动失败，请检查模型配置和可读资料');
      setAnalysisBusy(false);
      return;
    }
    if (result.taskId) setAnalysisTaskId(result.taskId);
    const detail = await fetchClarification(selectedRecord.id);
    if (detail) {
      setSelectedRecord(detail);
      setRecords((current) => current.map((item) => item.id === detail.id ? detail : item));
    }
    setAnalysisBusy(false);
    onToast(incremental ? '增量分析已开始，旧问题和证据会保留' : '分析已开始，完成后会保留在当前澄清单');
  }

  function beginAppendSources() {
    if (!selectedRecord || ['draft', 'awaiting_confirmation', 'analyzing', 'archived'].includes(selectedRecord.status)) return;
    setAppendMode(true);
    setSelectedIds(new Set());
    setCustomerFilter('');
    setProjectFilter('');
    setScopeFilter('all');
  }

  async function saveAppendSources() {
    if (!selectedRecord) return;
    if (!readableSelected.length) {
      onToast('至少选择一份可读的新资料');
      return;
    }
    setSaving(true);
    const updated = await appendClarificationSources(selectedRecord.id, selectedMaterials.map(toSource));
    if (!updated) {
      setSaving(false);
      onToast('追加资料失败，请重试');
      return;
    }
    setSelectedRecord(updated);
    setRecords((current) => current.map((item) => item.id === updated.id ? updated : item));
    setAppendMode(false);
    setSelectedIds(new Set((updated.sources ?? []).map((source) => source.sourceId).filter(Boolean)));
    setSaving(false);
    setAnalysisBusy(true);
    const started = await startClarificationAnalysis(updated.id, true);
    if (started?.taskId) setAnalysisTaskId(started.taskId);
    const detail = await fetchClarification(updated.id);
    if (detail) {
      setSelectedRecord(detail);
      setRecords((current) => current.map((item) => item.id === detail.id ? detail : item));
    }
    setAnalysisBusy(false);
    onToast(started ? '新增资料已保存，增量分析已开始' : '新增资料已保存，但分析启动失败，请重试');
  }

  async function cancelAnalysis() {
    if (!analysisTaskId) {
      onToast('正在查找分析任务，请稍后再试');
      return;
    }
    setAnalysisBusy(true);
    const task = await cancelTask(analysisTaskId);
    setAnalysisBusy(false);
    if (!task) {
      onToast('取消分析失败，请重试');
      return;
    }
    const detail = selectedRecord ? await fetchClarification(selectedRecord.id) : null;
    if (detail) {
      setSelectedRecord(detail);
      setRecords((current) => current.map((item) => item.id === detail.id ? detail : item));
    }
    onToast('分析已取消，已完成批次会保留');
  }

  async function refreshQuestionRecord() {
    if (!selectedRecord) return;
    const [detail, updatedMetrics] = await Promise.all([
      fetchClarification(selectedRecord.id),
      fetchClarificationMetrics(),
    ]);
    if (detail) {
      setSelectedRecord(detail);
      setRecords((current) => current.map((item) => item.id === detail.id ? detail : item));
    }
    if (updatedMetrics) setMetrics(updatedMetrics);
  }

  async function markQuestionAsked(questionId: string) {
    setAnswerBusyId(questionId);
    const updated = await updateClarificationQuestion(questionId, { status: 'asked' });
    setAnswerBusyId('');
    if (!updated) {
      onToast('更新提问状态失败，请重试');
      return;
    }
    await refreshQuestionRecord();
    onToast('已记录为已问，等待甲方回答');
  }

  async function saveQuestionAnswer(question: ClarificationQuestion) {
    const answerText = (answerDrafts[question.id] ?? question.answerText ?? '').trim();
    if (!answerText) {
      onToast('请先填写甲方回答');
      return;
    }
    setAnswerBusyId(question.id);
    const updated = await recordClarificationAnswer(question.id, answerText);
    setAnswerBusyId('');
    if (!updated) {
      onToast('回答保存失败，请重试');
      return;
    }
    await refreshQuestionRecord();
    onToast('甲方回答已保存');
  }

  async function generateFollowup(questionId: string) {
    setFollowupBusyId(questionId);
    const result = await generateClarificationFollowup(questionId);
    setFollowupBusyId('');
    if (!result) {
      onToast('追问生成失败，请检查模型配置后重试');
      return;
    }
    setSelectedRecord(result.record);
    setRecords((current) => current.map((item) => item.id === result.record.id ? result.record : item));
    onToast(result.added ? `已生成 ${result.added} 个追问` : '回答暂时没有需要继续确认的事项');
  }

  function openActionPanel(question: ClarificationQuestion, action: 'requirement' | 'project') {
    const customer = question.customerId || customerOptions[0] || '';
    const targetProject = projects.find((item) => item.customer === customer && item.name === question.projectId)
      || projects.find((item) => item.customer === customer);
    const latestAnswer = question.answers?.[question.answers.length - 1]?.answerText || question.answerText || '';
    setActionForm({
      action,
      customer,
      project: question.projectId || targetProject?.name || '—',
      targetProjectId: targetProject?.id || '',
      title: question.text,
      description: latestAnswer,
      priority: 'P1',
      stage: targetProject?.stage || '需求',
      budget: '',
      targetLaunchDate: '',
      owner: targetProject?.owner || '',
    });
    setActionQuestionId(question.id);
    setActionPreview(null);
    setActionPreviewPayload(null);
  }

  function actionPayload() {
    if (!actionForm) return {};
    if (actionForm.action === 'project') {
      const target = projects.find((item) => item.id === actionForm.targetProjectId);
      return {
        action: 'project', targetProjectId: actionForm.targetProjectId, description: actionForm.description,
        ...(actionForm.stage !== target?.stage ? { stage: actionForm.stage } : {}),
        ...(actionForm.owner !== target?.owner ? { owner: actionForm.owner } : {}),
        ...(actionForm.budget ? { budget: actionForm.budget } : {}),
        ...(actionForm.targetLaunchDate ? { targetLaunchDate: actionForm.targetLaunchDate } : {}),
      };
    }
    return {
      action: actionForm.action,
      customer: actionForm.customer,
      project: actionForm.project,
      targetProjectId: actionForm.targetProjectId,
      title: actionForm.title,
      description: actionForm.description,
      priority: actionForm.priority,
      stage: actionForm.stage,
      budget: actionForm.budget,
      targetLaunchDate: actionForm.targetLaunchDate,
      owner: actionForm.owner,
    };
  }

  async function previewAction(questionId: string) {
    if (!actionForm) return;
    setActionBusyId(questionId);
    const preview = await previewClarificationAction(questionId, actionPayload());
    setActionBusyId('');
    if (!preview) {
      onToast('无法生成回写预览，请检查目标和回答');
      return;
    }
    setActionPreview(preview);
    setActionPreviewPayload(actionPayload());
  }

  async function confirmAction(questionId: string) {
    if (!actionForm || !actionPreview || JSON.stringify(actionPayload()) !== JSON.stringify(actionPreviewPayload)) {
      onToast('请先生成并核对字段变更预览');
      setActionPreview(null);
      setActionPreviewPayload(null);
      return;
    }
    setActionBusyId(questionId);
    const result = await confirmClarificationAction(questionId, actionPayload());
    setActionBusyId('');
    if (!result) {
      onToast('回写保存失败，请重试');
      return;
    }
    setActionForm(null);
    setActionQuestionId('');
    setActionPreview(null);
    setActionPreviewPayload(null);
    await refreshQuestionRecord();
    onToast(actionForm.action === 'requirement' ? '已创建待确认需求' : '项目已更新');
  }

  async function changeRecordArchive(status: 'active' | 'archived') {
    if (!selectedRecord) return;
    const updated = await updateClarification(selectedRecord.id, { status });
    if (!updated) {
      onToast(status === 'archived' ? '归档失败，请重试' : '恢复失败，请重试');
      return;
    }
    setSelectedRecord(updated);
    setRecords((current) => current.map((item) => item.id === updated.id ? updated : item));
    onToast(status === 'archived' ? '需求澄清单已归档' : '需求澄清单已恢复');
  }

  async function removeSelectedRecord() {
    if (!selectedRecord || !window.confirm(`确定删除「${selectedRecord.name}」？原始资料不会被删除。`)) return;
    const deleted = await deleteClarification(selectedRecord.id);
    if (!deleted) {
      onToast('删除失败，请重试');
      return;
    }
    setSelectedRecord(null);
    setEditorOpen(false);
    setRecords((current) => current.filter((item) => item.id !== selectedRecord.id));
    onToast('需求澄清单已删除');
  }

  async function duplicateSelectedRecord() {
    if (!selectedRecord) return;
    const duplicate = await duplicateClarification(selectedRecord.id);
    if (!duplicate) {
      onToast('复制失败，请重试');
      return;
    }
    setSelectedRecord(duplicate);
    setRecords((current) => [duplicate, ...current]);
    setSelectedIds(new Set());
    setSelectedQuestionIds(new Set());
    setAssignmentSourceId('');
    setAssignmentPreview(null);
    setName(duplicate.name);
    setLanguage(languageLabel(duplicate.language));
    setEditorOpen(true);
    onToast('已复制为需求澄清单草稿，请重新选择资料');
  }

  function publicQuestionText() {
    const groups = new Map<string, ClarificationQuestion[]>();
    publicQuestions.forEach((question) => {
      const key = `${question.customerId || '未归属客户'} · ${question.projectId || '未归属项目'}`;
      groups.set(key, [...(groups.get(key) || []), question]);
    });
    const lines: string[] = [];
    groups.forEach((questions, group) => {
      lines.push(group);
      questions.forEach((question, index) => lines.push(`${index + 1}. ${question.text}`));
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  async function copyPublicQuestions() {
    const text = publicQuestionText();
    if (!text) {
      onToast('当前筛选范围没有可复制的问题');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (selectedRecord) {
        const generatedIds = publicQuestions
          .filter((question) => ['initial', 'incremental', 'followup'].includes(question.generatedFrom))
          .map((question) => question.id);
        if (!await recordClarificationCopies(selectedRecord.id, generatedIds)) {
          onToast('问题已复制，但复制记录保存失败');
          return;
        }
        const updatedMetrics = await fetchClarificationMetrics();
        if (updatedMetrics) setMetrics(updatedMetrics);
      }
      onToast('对外问题已复制，不包含内部证据');
    } catch {
      onToast('复制失败，请检查系统剪贴板权限');
    }
  }

  async function exportWord() {
    if (!selectedRecord) return;
    const blob = await downloadClarificationWord(selectedRecord.id, { customer: outputCustomer, project: outputProject });
    if (!blob) {
      onToast('Word 导出失败，请重试');
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedRecord.name || '需求澄清问题'}.docx`;
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 0);
    onToast('Word 文件已生成');
  }

  async function printPublicQuestions() {
    const text = publicQuestionText();
    if (!text) {
      onToast('当前筛选范围没有可导出的问题');
      return;
    }
    if (window.clientHub?.saveClarificationPdf) {
      try {
        const result = await window.clientHub.saveClarificationPdf({ title: selectedRecord?.name || '需求澄清问题', text });
        if (!result.canceled) onToast('PDF 文件已保存');
      } catch {
        onToast('PDF 导出失败，请重试');
      }
      return;
    }
    const frame = document.createElement('iframe');
    frame.title = '需求澄清问题打印';
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
    document.body.appendChild(frame);
    const printWindow = frame.contentWindow;
    if (!printWindow) {
      frame.remove();
      onToast('无法打开打印页面，请重试');
      return;
    }
    printWindow.document.open();
    printWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
    printWindow.document.write(`<html><head><title>${escapeHtml(selectedRecord?.name || '需求澄清问题')}</title><style>body{font-family:"Microsoft YaHei",sans-serif;padding:36px;color:#1f3331;line-height:1.7}h1{font-size:22px;margin:0 0 6px}p{white-space:pre-wrap;font-size:14px}</style></head><body><h1>${escapeHtml(selectedRecord?.name || '需求澄清问题')}</h1><p>${escapeHtml(text)}</p><script>window.onload=function(){window.print();}</script></body></html>`);
    printWindow.document.close();
  }

  function beginQuestionEdit(question: ClarificationQuestion) {
    setEditingQuestionId(question.id);
    setEditingText(question.text);
    setEditingCategory(question.category);
    setEditingPriority(question.priority);
  }

  async function saveQuestionEdit() {
    if (!editingQuestionId || !editingText.trim()) {
      onToast('问题文本不能为空');
      return;
    }
    setQuestionBusy(true);
    const updated = await updateClarificationQuestion(editingQuestionId, { text: editingText.trim(), category: editingCategory, priority: editingPriority });
    setQuestionBusy(false);
    if (!updated) {
      onToast('问题保存失败，请重试');
      return;
    }
    setEditingQuestionId('');
    await refreshQuestionRecord();
    onToast('问题已更新');
  }

  async function changeQuestionStatus(questionId: string, status: ClarificationQuestion['status']) {
    setQuestionBusy(true);
    const updated = await updateClarificationQuestion(questionId, { status });
    setQuestionBusy(false);
    if (!updated) {
      onToast('问题状态更新失败，请重试');
      return;
    }
    await refreshQuestionRecord();
    onToast(status === 'not_applicable' ? '问题已标记为不适用' : '问题已删除');
  }

  async function addCustomQuestion() {
    if (!selectedRecord || !customText.trim()) {
      onToast('请先填写自定义问题');
      return;
    }
    setQuestionBusy(true);
    const added = await createClarificationQuestion(selectedRecord.id, { text: customText.trim(), category: customCategory, priority: customPriority });
    setQuestionBusy(false);
    if (!added) {
      onToast('自定义问题保存失败，请重试');
      return;
    }
    setCustomText('');
    setCustomOpen(false);
    await refreshQuestionRecord();
    onToast('自定义问题已添加');
  }

  function previewAssignment() {
    if (!selectedQuestionIds.size || !assignmentCustomer) {
      onToast('请选择问题和目标客户');
      return;
    }
    const questions = unassignedQuestions.filter((question) => selectedQuestionIds.has(question.id));
    if (questions.length !== selectedQuestionIds.size) { onToast('问题状态已变化，请重新选择'); return; }
    if (questions.some((question) => (question.customerId && question.customerId !== assignmentCustomer) || (question.projectId && assignmentProject && question.projectId !== assignmentProject))) {
      onToast('所选问题已有其他归属，请取消勾选或调整目标，已有归属不会被覆盖');
      return;
    }
    setAssignmentPreview({ customer: assignmentCustomer, project: assignmentProject, questions });
  }

  async function assignSelectedQuestions() {
    if (!assignmentPreview || assignmentBusy) return;
    setAssignmentBusy(true);
    const { customer, project, questions } = assignmentPreview;
    const results = await Promise.all(questions.map((question) => updateClarificationQuestion(question.id, { customerId: question.customerId || customer, projectId: question.projectId || project })));
    const updated = new Map(results.filter((item): item is ClarificationQuestion => Boolean(item)).map((item) => [item.id, item]));
    setSelectedRecord((current) => current ? { ...current, questions: current.questions?.map((question) => updated.get(question.id) ?? question) } : current);
    setSelectedQuestionIds(new Set(questions.filter((question) => !updated.has(question.id)).map((question) => question.id)));
    setAssignmentPreview(null);
    await refreshQuestionRecord();
    setAssignmentBusy(false);
    onToast(updated.size === questions.length ? `已分配 ${updated.size} 个问题` : `已分配 ${updated.size} 个问题，${questions.length - updated.size} 个失败，请重试仍勾选的问题`);
  }

  async function confirmMaterials() {
    if (!selectedRecord) return;
    if (appendMode) { setConfirmOpen(false); await saveAppendSources(); return; }
    setAnalysisBusy(true);
    const updated = await updateClarification(selectedRecord.id, { status: 'awaiting_confirmation' });
    if (!updated) {
      onToast('确认资料失败，请重试');
      setAnalysisBusy(false);
      return;
    }
    setSelectedRecord(updated);
    setRecords((current) => current.map((item) => item.id === updated.id ? updated : item));
    setConfirmOpen(false);
    const started = await startClarificationAnalysis(updated.id);
    if (!started) {
      setAnalysisBusy(false);
      onToast('资料已确认，但分析启动失败，请检查模型配置后重试');
      return;
    }
    if (started.taskId) setAnalysisTaskId(started.taskId);
    const detail = await fetchClarification(updated.id);
    if (detail) {
      setSelectedRecord(detail);
      setRecords((current) => current.map((item) => item.id === detail.id ? detail : item));
    }
    setAnalysisBusy(false);
    onToast('资料已确认，分析已开始');
  }

  const editorTitle = selectedRecord ? '编辑需求澄清单' : '新建需求澄清单';
  const canEditMaterials = appendMode || !selectedRecord || ['draft', 'awaiting_confirmation'].includes(selectedRecord.status);
  const hasAnalyzedSources = selectedRecord?.sources?.some((source) => source.analyzed) ?? false;
  const hasPendingSources = selectedRecord?.sources?.some((source) => source.readable && !source.analyzed) ?? false;
  const savedModel = selectedRecord?.modelSnapshot;
  const confirmationModel = (savedModel && !Array.isArray(savedModel) ? String(savedModel.summaryModel || '') : '') || llm?.summaryModel || '未配置';
  const analysisProgress = selectedRecord && selectedRecord.totalBatches > 0
    ? Math.round(selectedRecord.completedBatches / selectedRecord.totalBatches * 100)
    : 0;

  return (
    <div className="clarification-workspace">
      <header className="topbar clarification-topbar">
        <div className="crumbs">
          <strong>需求澄清</strong>
          <span className="badge">选材与发送确认</span>
        </div>
        <div className="top-actions">
          {editorOpen && <button className="btn" onClick={() => { setEditorOpen(false); setConfirmOpen(false); }}>返回记录</button>}
          {editorOpen && selectedRecord && <button className="btn" onClick={() => void duplicateSelectedRecord()}>复制为草稿</button>}
          {editorOpen && selectedRecord && selectedRecord.status !== 'archived' && <button className="btn" onClick={() => void changeRecordArchive('archived')}>归档</button>}
          {editorOpen && selectedRecord?.status === 'archived' && <button className="btn" onClick={() => void changeRecordArchive('active')}>恢复</button>}
          {editorOpen && selectedRecord && !appendMode && !['draft', 'awaiting_confirmation', 'analyzing', 'archived'].includes(selectedRecord.status) && <button className="btn" onClick={beginAppendSources}>追加资料</button>}
          {editorOpen && appendMode && <button className="btn" onClick={() => { setAppendMode(false); setSelectedIds(new Set((selectedRecord?.sources ?? []).map((source) => source.sourceId).filter(Boolean))); }}>取消追加</button>}
          {editorOpen && selectedRecord && <button className="btn danger-btn" onClick={() => void removeSelectedRecord()}>删除</button>}
          <button className="btn primary" onClick={resetEditor}>新建分析</button>
        </div>
      </header>

      {loading ? <div className="clarification-state">正在读取需求澄清记录…</div> : error ? (
        <div className="clarification-state clarification-error"><strong>{error}</strong><button className="btn" onClick={() => void load()}>重新加载</button></div>
      ) : editorOpen ? (
        <div className="clarification-editor">
          <section className="clarification-editor-head">
            <div>
              <span className="section-kicker">资料审阅台</span>
              <h1>{editorTitle}</h1>
              <p>先明确哪些资料会发送给模型；跨客户、跨项目的选择会保留在同一份澄清单中。</p>
            </div>
            <div className="clarification-editor-summary">
              <strong>{selectedMaterials.length}</strong><span>已选资料</span>
              <strong className={readableSelected.length ? 'is-ready' : 'is-blocked'}>{readableSelected.length}</strong><span>可分析</span>
            </div>
          </section>

          <section className="card clarification-selection-card">
            <div className="card-head">
              <div><div className="card-title">1. 选择资料</div><div className="card-sub">可按客户、项目或未归档资料筛选，也可以跨范围组合</div></div>
              <label className="clarification-select-all"><input type="checkbox" checked={allFilteredSelected} onChange={toggleFiltered} disabled={!filteredMaterials.length || !canEditMaterials} />全选当前结果</label>
            </div>
            <div className="clarification-filters">
              <label>客户<select value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)}><option value="">全部客户</option>{customers.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label>项目<select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="">全部项目</option>{projectOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label>资料范围<select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as ScopeFilter)}><option value="all">全部资料</option><option value="unarchived">仅未归档</option></select></label>
            </div>
            <div className="clarification-material-list">
              {filteredMaterials.length ? filteredMaterials.map((item) => {
                const state = materialState(item);
                const checked = selectedIds.has(item.id);
                return (
                  <label className={`clarification-material ${checked ? 'selected' : ''}`} key={item.id}>
                    <input type="checkbox" checked={checked} onChange={() => toggleMaterial(item.id)} disabled={!canEditMaterials} />
                    <span className="clarification-material-main"><strong>{item.fileName}</strong><small>{item.type} · {item.customer || '未归属'} · {item.project || '未归属'} · {item.importedAt}</small></span>
                    <span className={`clarification-readable ${state.readable ? 'ready' : 'blocked'}`}>{state.label}{!state.readable && <em>{state.reason}</em>}</span>
                  </label>
                );
              }) : <div className="clarification-empty">没有符合当前筛选条件的资料</div>}
            </div>
          </section>

          {selectedRecord && selectedRecord.status !== 'draft' && selectedRecord.status !== 'awaiting_confirmation' && (
            <section className="card clarification-analysis-card">
              <div className="card-head"><div><div className="card-title">分析进度</div><div className="card-sub">已完成批次会立即保存；取消或失败后可以继续分析剩余批次</div></div><span className={`badge clarification-status status-${selectedRecord.status}`}>{formatRecordStatus(selectedRecord.status)}</span></div>
              <div className="clarification-analysis-progress"><div className="clarification-progress-track"><span style={{ width: `${analysisProgress}%` }} /></div><strong>{selectedRecord.completedBatches} / {selectedRecord.totalBatches || '—'} 批 · {selectedRecord.questionCount} 个问题</strong></div>
              {selectedRecord.errorMessage && <div className="clarification-analysis-error">{selectedRecord.errorMessage}</div>}
              <div className="clarification-analysis-actions">
                {selectedRecord.status === 'analyzing' && <button className="btn" onClick={() => void cancelAnalysis()} disabled={analysisBusy}>{analysisBusy ? '处理中…' : '取消分析'}</button>}
                {(selectedRecord.status === 'partial' || selectedRecord.status === 'failed' || (hasPendingSources && ['active', 'completed'].includes(selectedRecord.status))) && <button className="btn primary" onClick={() => void startAnalysis(hasAnalyzedSources)} disabled={analysisBusy}>{analysisBusy ? '启动中…' : selectedRecord.status === 'partial' ? '继续分析剩余批次' : '重试分析'}</button>}
              </div>
            </section>
          )}

          {selectedRecord && (
            <section className="card clarification-question-card">
              <div className="card-head">
                <div><div className="card-title">3. 问题工作台</div><div className="card-sub">按客户/项目分区，优先级在外层，固定行业维度在内层；证据只在应用内展示</div></div>
                <div className="clarification-output-actions"><select value={outputCustomer} onChange={(event) => { setOutputCustomer(event.target.value); setOutputProject(''); }}><option value="">全部客户</option>{outputCustomerOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={outputProject} onChange={(event) => setOutputProject(event.target.value)}><option value="">全部项目</option>{outputProjectOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="btn" onClick={() => void copyPublicQuestions()}>复制问题</button><button className="btn" onClick={() => void exportWord()}>导出 Word</button><button className="btn" onClick={printPublicQuestions}>保存 PDF</button><button className="btn" onClick={() => setCustomOpen((open) => !open)} disabled={questionBusy}>{customOpen ? '收起新增' : '新增问题'}</button></div>
              </div>
              {customOpen && (
                <div className="clarification-custom-form">
                  <label>问题文本<input value={customText} onChange={(event) => setCustomText(event.target.value)} placeholder="例如：一期是否需要支持多门店管理？" /></label>
                  <label>固定维度<select value={customCategory} onChange={(event) => setCustomCategory(event.target.value)}>{CLARIFICATION_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
                  <label>优先级<select value={customPriority} onChange={(event) => setCustomPriority(event.target.value as ClarificationQuestion['priority'])}><option value="must_confirm">必须先确认</option><option value="important">重要</option><option value="later">后续确认</option></select></label>
                  <button className="btn primary" onClick={() => void addCustomQuestion()} disabled={questionBusy}>添加问题</button>
                </div>
              )}
              {unassignedQuestions.length > 0 && (selectedRecord.sources?.length ?? 0) > 0 && (
                <div className="clarification-assignment-toolbar clarification-source-assignment">
                  <strong>按资料选择问题</strong>
                  <select aria-label="分配来源资料" value={assignmentSourceId} onChange={(event) => { setAssignmentSourceId(event.target.value); setSelectedQuestionIds(new Set()); }} disabled={assignmentBusy}>
                    <option value="">选择本单资料</option>{selectedRecord.sources?.map((source) => <option key={source.id} value={source.id}>{source.displayName} · {source.customerId || '未归属客户'} · {source.projectId || '未归属项目'}</option>)}
                  </select>
                  <button className="btn" onClick={() => setSelectedQuestionIds(new Set(sourceExclusiveQuestions.map((question) => question.id)))} disabled={assignmentBusy || !sourceExclusiveQuestions.length}>勾选关联问题（{sourceExclusiveQuestions.length}）</button>
                  {assignmentSourceId && <p>关联 {sourceQuestions.length} 个未归属问题，其中 {sourceQuestions.length - sourceExclusiveQuestions.length} 个引用多份资料，需在下方手动勾选。基于回答的追问按原问题证据关联；本次只分配问题，原始资料归属保留。</p>}
                </div>
              )}
              {selectedQuestionIds.size > 0 && (
                <div className="clarification-assignment-toolbar"><strong>已选 {selectedQuestionIds.size} 个未归属问题</strong><select aria-label="分配目标客户" value={assignmentCustomer} onChange={(event) => { setAssignmentCustomer(event.target.value); setAssignmentProject(''); }} disabled={assignmentBusy}><option value="">选择目标客户</option>{customerOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select><select aria-label="分配目标项目" value={assignmentProject} onChange={(event) => setAssignmentProject(event.target.value)} disabled={assignmentBusy}><option value="">不指定项目</option>{assignmentProjectOptions.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select><button className="btn primary" onClick={previewAssignment} disabled={assignmentBusy}>{assignmentBusy ? '分配中…' : '预览分配'}</button><button className="btn ghost" onClick={() => setSelectedQuestionIds(new Set())} disabled={assignmentBusy}>取消选择</button></div>
              )}
              {questionGroups.length ? questionGroups.map((group) => (
                <div className="clarification-question-group" key={`${group.customerId}::${group.projectId}`}>
                  <div className="clarification-question-group-head"><strong>{group.customerId}</strong><span>项目：{group.projectId}</span><em>{group.questions.length} 个问题</em></div>
                  {(['must_confirm', 'important', 'later'] as const).map((priority) => {
                    const questions = group.questions.filter((question) => question.priority === priority);
                    if (!questions.length) return null;
                    return (
                      <details className={`clarification-priority-block priority-${priority}`} key={priority} open={priority === 'must_confirm'}>
                        <summary className="clarification-priority-label"><span>{priorityLabel(priority)}</span><small>{questions.length}</small></summary>
                        {questions.map((question) => (
                          <article className="clarification-question-row" id={`clarification-question-${question.id}`} tabIndex={-1} key={question.id}>
                            {question.status !== 'deleted' && (!question.customerId || !question.projectId) && <input className="clarification-question-select" type="checkbox" checked={selectedQuestionIds.has(question.id)} onChange={() => setSelectedQuestionIds((current) => { const next = new Set(current); if (next.has(question.id)) next.delete(question.id); else next.add(question.id); return next; })} disabled={assignmentBusy} aria-label="选择问题归属" />}
                            {assignmentSourceId && questionSourceIds.get(question.id)?.has(assignmentSourceId) && <span className="clarification-category">{(questionSourceIds.get(question.id)?.size ?? 0) > 1 ? '所选资料 · 引用多份资料' : '所选资料关联问题'}</span>}
                            {editingQuestionId === question.id ? (
                              <div className="clarification-question-edit">
                                <textarea value={editingText} onChange={(event) => setEditingText(event.target.value)} rows={3} />
                                <div className="clarification-question-edit-fields"><select value={editingCategory} onChange={(event) => setEditingCategory(event.target.value)}>{CLARIFICATION_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select><select value={editingPriority} onChange={(event) => setEditingPriority(event.target.value as ClarificationQuestion['priority'])}><option value="must_confirm">必须先确认</option><option value="important">重要</option><option value="later">后续确认</option></select></div>
                                <div className="clarification-question-actions"><button className="btn primary" onClick={() => void saveQuestionEdit()} disabled={questionBusy}>保存</button><button className="btn" onClick={() => setEditingQuestionId('')}>取消</button></div>
                              </div>
                            ) : (
                              <>
                                <div className="clarification-question-main"><div className="clarification-question-meta"><span className="clarification-category">{question.category || '未分类'}</span><span className="clarification-category">{conclusionLabel(question.conclusionType)}</span><span className="clarification-question-status">{questionStatusLabel(question.status)}</span>{typeof question.confidence === 'number' && <span className="clarification-confidence">{question.confidence < 0.6 ? '低置信度 · 待核验 ' : '置信度 '}{Math.round(question.confidence * 100)}%</span>}</div><strong>{question.text}</strong>{question.rationale && <p>{question.rationale}</p>}</div>
                                <div className="clarification-question-actions"><button className="btn ghost" onClick={() => beginQuestionEdit(question)} disabled={questionBusy}>编辑</button>{question.status === 'pending' && <button className="btn ghost" onClick={() => void markQuestionAsked(question.id)} disabled={answerBusyId === question.id}>标记已问</button>}<button className="btn ghost" onClick={() => void changeQuestionStatus(question.id, 'not_applicable')} disabled={questionBusy || question.status === 'not_applicable'}>不适用</button><button className="btn ghost danger-text" onClick={() => void changeQuestionStatus(question.id, 'deleted')} disabled={questionBusy}>删除</button></div>
                                <div className="clarification-answer-panel">
                                  <div className="clarification-answer-head"><strong>甲方回答</strong><span>{question.answers?.length ? `已记录 ${question.answers.length} 次` : '尚未记录'}</span></div>
                                  <textarea value={answerDrafts[question.id] ?? question.answerText ?? ''} onChange={(event) => setAnswerDrafts((current) => ({ ...current, [question.id]: event.target.value }))} rows={3} placeholder={question.status === 'pending' ? '先标记已问，再记录甲方回答' : '记录甲方在微信、电话或会议中的原话'} />
                                  <div className="clarification-answer-actions"><button className="btn primary" onClick={() => void saveQuestionAnswer(question)} disabled={answerBusyId === question.id || question.status === 'pending'}>{answerBusyId === question.id ? '保存中…' : '保存回答'}</button>{question.status === 'answered' && <button className="btn" onClick={() => void generateFollowup(question.id)} disabled={followupBusyId === question.id}>{followupBusyId === question.id ? '生成中…' : '基于回答生成追问'}</button>} {question.status === 'answered' && <button className="btn" onClick={() => openActionPanel(question, 'requirement')}>转为需求</button>} {question.status === 'answered' && <button className="btn" onClick={() => openActionPanel(question, 'project')}>更新项目</button>}</div>
                                  {question.answers?.length > 0 && <details className="clarification-evidence"><summary>查看回答历史（{question.answers.length}）</summary>{question.answers.map((answer) => <div className="clarification-evidence-item" key={answer.id}><small>{answer.recordedAt}</small><p>{answer.answerText}</p></div>)}</details>}
                                  {actionQuestionId === question.id && actionForm && question.status === 'answered' && (
                                    <div className="clarification-action-panel">
                                      <div className="clarification-answer-head"><strong>{actionForm.action === 'requirement' ? '转为需求 · 预览后确认' : '更新项目 · 预览后确认'}</strong><button className="btn ghost" onClick={() => { setActionForm(null); setActionQuestionId(''); setActionPreview(null); setActionPreviewPayload(null); }}>关闭</button></div>
                                      {actionForm.action === 'requirement' ? (
                                        <div className="clarification-action-fields">
                                          <label>目标客户<select value={actionForm.customer} onChange={(event) => setActionForm({ ...actionForm, customer: event.target.value, project: '—' })}>{customerOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                                          <label>目标项目<select value={actionForm.project} onChange={(event) => setActionForm({ ...actionForm, project: event.target.value })}><option value="—">不指定项目</option>{projects.filter((item) => item.customer === actionForm.customer).map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
                                          <label>需求标题<input value={actionForm.title} onChange={(event) => setActionForm({ ...actionForm, title: event.target.value })} /></label>
                                          <label>需求优先级<select value={actionForm.priority} onChange={(event) => setActionForm({ ...actionForm, priority: event.target.value as ClarificationActionForm['priority'] })}><option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option></select></label>
                                          <label className="clarification-action-wide">需求描述<textarea value={actionForm.description} onChange={(event) => setActionForm({ ...actionForm, description: event.target.value })} rows={3} /></label>
                                        </div>
                                      ) : (
                                        <div className="clarification-action-fields">
                                          <label>目标项目<select value={actionForm.targetProjectId} onChange={(event) => { const project = projects.find((item) => item.id === event.target.value); setActionForm({ ...actionForm, targetProjectId: event.target.value, customer: project?.customer || actionForm.customer, project: project?.name || actionForm.project, stage: project?.stage || '需求', owner: project?.owner || '', budget: '', targetLaunchDate: '' }); }}>{actionProjectOptions.map((item) => <option key={item.id} value={item.id}>{item.customer} · {item.name}</option>)}</select></label>
                                          <label>项目阶段<select value={actionForm.stage} onChange={(event) => setActionForm({ ...actionForm, stage: event.target.value })}><option value="需求">需求</option><option value="报价">报价</option><option value="方案">方案</option><option value="签约">签约</option><option value="交付">交付</option></select></label>
                                          <label>预算<input value={actionForm.budget} onChange={(event) => setActionForm({ ...actionForm, budget: event.target.value })} placeholder="回答明确提到时填写" /></label>
                                          <label>目标上线时间<input type="date" value={actionForm.targetLaunchDate} onChange={(event) => setActionForm({ ...actionForm, targetLaunchDate: event.target.value })} /></label>
                                          <label>负责人<input value={actionForm.owner} onChange={(event) => setActionForm({ ...actionForm, owner: event.target.value })} /></label>
                                          <label className="clarification-action-wide">项目说明<textarea value={actionForm.description} onChange={(event) => setActionForm({ ...actionForm, description: event.target.value })} rows={3} /></label>
                                        </div>
                                      )}
                                      {actionPreview && <div className="clarification-action-preview"><strong>将保存以下字段</strong>{Object.entries(actionPreview.changes).map(([key, value]) => <div key={key}><span>{key}</span><b>{value || '—'}</b></div>)}</div>}
                                      <div className="clarification-answer-actions"><button className="btn" onClick={() => void previewAction(question.id)} disabled={actionBusyId === question.id}>{actionBusyId === question.id ? '处理中…' : '生成变更预览'}</button><button className="btn primary" onClick={() => void confirmAction(question.id)} disabled={actionBusyId === question.id || !actionPreview}>确认保存</button></div>
                                    </div>
                                  )}
                                </div>
                                {question.evidence.length > 0 && <details className="clarification-evidence"><summary>查看 {question.evidence.length} 条原文证据</summary>{question.evidence.map((evidence) => {
                                  const source = selectedRecord.sources?.find((item) => item.id === evidence.sourceSnapshotId);
                                  const answerQuestionId = evidence.sourceSnapshotId.startsWith('answer:') ? evidence.sourceSnapshotId.slice(7) : '';
                                  return <div className="clarification-evidence-item" key={evidence.id}>
                                    <p>“{evidence.excerpt}”</p>
                                    <small>{evidence.sourceLabel} · {evidence.sourceTime || '时间未知'} · {evidence.sourceReference || '来源快照'}</small>
                                    {answerQuestionId ? <button className="btn ghost" onClick={() => locateAnswer(answerQuestionId)}>查看原问题与回答</button>
                                      : source?.sourceId ? <button className="btn ghost" onClick={() => onSource(source.sourceId, selectedRecord.id)}>查看原始资料</button>
                                      : <small>来源记录未关联，已保留原文证据快照</small>}
                                  </div>;
                                })}</details>}
                              </>
                            )}
                          </article>
                        ))}
                      </details>
                    );
                  })}
                </div>
              )) : <div className="clarification-empty">暂时没有生成问题，可以先确认资料并开始分析，或新增自定义问题。</div>}
            </section>
          )}

          <section className="card clarification-draft-card">
            <div className="card-head"><div><div className="card-title">2. 保存澄清单</div><div className="card-sub">草稿保存资料快照和生成语言，之后可以继续补选或替换资料</div></div></div>
            <div className="clarification-draft-form">
              <label>澄清单名称<input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} placeholder="留空按客户/项目和日期命名" disabled={saving || analysisBusy || selectedRecord?.status === 'analyzing'} /></label>
              <label>生成语言<input value={language} onChange={(event) => setLanguage(event.target.value)} maxLength={32} placeholder="例如：简体中文、English、日本語" disabled={Boolean(selectedRecord && selectedRecord.status !== 'draft') || saving || analysisBusy} /></label>
              <div className="clarification-model-note"><span>默认文本模型</span><strong>{llm?.summaryModel || '未配置'}</strong><small>{llm?.hasKey ? '已配置 API Key' : '未配置 API Key，确认后仍可保存草稿'}</small></div>
            </div>
            <div className="clarification-editor-actions">
              <button className="btn" onClick={() => void saveDraft()} disabled={saving || analysisBusy || selectedRecord?.status === 'analyzing'}>{saving ? '保存中…' : appendMode ? '确认新增资料并分析' : canEditMaterials ? '保存草稿' : '保存名称'}</button>
              {selectedRecord?.status === 'awaiting_confirmation' && <button className="btn primary" onClick={() => void startAnalysis()} disabled={saving || analysisBusy}>{analysisBusy ? '启动中…' : '开始分析'}</button>}
              {(!selectedRecord || selectedRecord.status === 'draft') && <button className="btn primary" onClick={() => void openConfirmation()} disabled={saving || analysisBusy}>确认资料并开始分析</button>}
            </div>
          </section>
        </div>
      ) : (
        <div className="clarification-history">
          <section className="clarification-history-intro">
            <div><span className="section-kicker">老板工作台</span><h1>把已有资料整理成一套可直接提问的问题</h1><p>先从客户、项目或未归档资料中选材。每次发送前都会逐条列出资料名称、类型、可读性和使用模型。</p></div>
            <div className="clarification-history-stat"><strong>{visibleRecords.length}</strong><span>符合筛选的澄清单</span></div>
          </section>
          {metrics && <section className="clarification-metrics">
            <div className="clarification-metrics-head">
              <div><span className="section-kicker">使用基线</span><h2>前 {metrics.limit} 次完成分析</h2><p>{metrics.ready ? `首批 ${metrics.limit} 次分析基线已建立。` : `已有 ${metrics.baselineCount} 次纳入统计，达到 ${metrics.limit} 次后建立基线。`}</p></div>
              <strong>{metrics.engagementRate === null ? '—' : `${Math.round(metrics.engagementRate * 100)}%`}<small>保留、复制或已问</small></strong>
            </div>
            <div className="clarification-metrics-totals"><span>生成 <b>{metrics.generatedCount}</b></span><span>保留 <b>{metrics.retainedCount}</b></span><span>复制 <b>{metrics.copiedCount}</b></span><span>已问 <b>{metrics.askedCount}</b></span><span>参与 <b>{metrics.engagedCount}</b></span></div>
            {metrics.analyses.length > 0 && <div className="clarification-metrics-list">{metrics.analyses.map((analysis, index) => <div className="clarification-metrics-row" key={analysis.id}><strong>{index + 1}. {analysis.name}<small>{new Date(analysis.completedAt).toLocaleDateString('zh-CN')}</small></strong><span>{analysis.generatedCount} 生成</span><span>{analysis.retainedCount} 保留</span><span>{analysis.copiedCount} 复制</span><span>{analysis.askedCount} 已问</span></div>)}</div>}
          </section>}
          <section className="card clarification-record-list">
            <div className="card-head"><div><div className="card-title">历史澄清记录</div><div className="card-sub">草稿可继续补资料；分析中的记录会显示批次进度，失败后可继续重试</div></div><button className="btn primary" onClick={resetEditor}>新建分析</button></div>
            <div className="clarification-history-filters"><label>客户<select value={recordCustomerFilter} onChange={(event) => setRecordCustomerFilter(event.target.value)}><option value="">全部客户</option>{customerOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>项目<select value={recordProjectFilter} onChange={(event) => setRecordProjectFilter(event.target.value)}><option value="">全部项目</option>{projectOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>状态<select value={recordStatusFilter} onChange={(event) => setRecordStatusFilter(event.target.value)}><option value="all">全部状态</option><option value="draft">草稿</option><option value="unanswered">未完成</option><option value="completed">已完成</option><option value="archived">已归档</option></select></label><label>日期<select value={recordDateFilter} onChange={(event) => setRecordDateFilter(event.target.value)}><option value="all">全部日期</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option></select></label><label className="clarification-archive-toggle"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />包含已归档</label></div>
            {visibleRecords.length ? visibleRecords.map((record) => (
              <button className="clarification-record-row" key={record.id} onClick={() => void openRecord(record.id)}>
                <span className="clarification-record-main"><strong>{record.name}</strong><small>{record.customers?.join('、') || '未归属客户'} / {record.projects?.join('、') || '未归属项目'} · {record.sourceCount} 份资料 · {record.questionCount} 个问题 · {record.openQuestionCount} 个未完成 · 更新于 {record.updatedAt}</small></span>
                <span className={`badge clarification-status status-${record.status}`}>{formatRecordStatus(record.status)}</span>
                <span className="clarification-record-arrow">›</span>
              </button>
            )) : <div className="clarification-empty clarification-history-empty"><strong>{records.length ? '没有符合当前筛选条件的澄清单' : '还没有澄清记录'}</strong><span>{records.length ? '调整客户、项目、状态或日期筛选后再试。' : '从一份已导入资料开始，建立第一份澄清单。'}</span><button className="btn primary" onClick={resetEditor}>新建分析</button></div>}
          </section>
        </div>
      )}

      {assignmentPreview && (
        <div className="clarification-modal-backdrop">
          <section className="clarification-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="clarification-assignment-title">
            <div className="clarification-confirm-head"><div><span className="section-kicker">归属确认</span><h2 id="clarification-assignment-title">预览问题分配</h2></div></div>
            <p className="clarification-confirm-copy">共 {assignmentPreview.questions.length} 个问题。只补充客户/项目归属，保留原问题、回答和全部证据。引用多份资料的问题将作为一个整体分配，原始资料归属保留。</p>
            <div className="clarification-confirm-list">{assignmentPreview.questions.map((question) => <div className="clarification-confirm-item" key={question.id}><span><strong>{question.text}</strong><small>{question.customerId || '未归属客户'} / {question.projectId || '未归属项目'} → {question.customerId || assignmentPreview.customer} / {question.projectId || assignmentPreview.project || '不指定项目'}</small><small>证据资料：{Array.from(questionSourceIds.get(question.id) ?? []).map((id) => selectedRecord?.sources?.find((source) => source.id === id)?.displayName || '未关联资料').join('、') || '无资料证据'}{(questionSourceIds.get(question.id)?.size ?? 0) > 1 ? '（引用多份资料）' : ''}</small></span></div>)}</div>
            <div className="clarification-confirm-actions"><button className="btn" onClick={() => setAssignmentPreview(null)} disabled={assignmentBusy}>返回调整</button><button className="btn primary" onClick={() => void assignSelectedQuestions()} disabled={assignmentBusy}>{assignmentBusy ? '分配中…' : '确认分配'}</button></div>
          </section>
        </div>
      )}

      {confirmOpen && (
        <div className="clarification-modal-backdrop" role="presentation" onMouseDown={() => setConfirmOpen(false)}>
          <section className="clarification-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="clarification-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="clarification-confirm-head"><div><span className="section-kicker">发送前确认</span><h2 id="clarification-confirm-title">确认本次分析资料</h2></div><button className="icon-button" onClick={() => setConfirmOpen(false)} aria-label="关闭">×</button></div>
            <p className="clarification-confirm-copy">以下资料将发送给设置中的默认文本模型。不可读资料会保留在澄清单里，但不会成为有效分析输入。</p>
            <div className="clarification-confirm-meta"><span>资料范围 <strong>{selectedMaterials.length} 份</strong></span><span>可分析 <strong>{readableSelected.length} 份</strong></span><span>模型 <strong>{confirmationModel}</strong></span><span>生成语言 <strong>{languageLabel(selectedRecord?.language || 'zh-CN')}</strong></span></div>
            <div className="clarification-confirm-list">{selectedMaterials.map((item) => { const state = materialState(item); return <div className="clarification-confirm-item" key={item.id}><span><strong>{item.fileName}</strong><small>{item.type} · {item.customer || '未归属'} · {item.project || '未归属'}</small></span><span className={state.readable ? 'ready' : 'blocked'}>{state.label}{!state.readable && <small>{state.reason}</small>}</span></div>; })}</div>
            <div className="clarification-confirm-actions"><button className="btn" onClick={() => setConfirmOpen(false)}>返回调整</button><button className="btn primary" onClick={() => void confirmMaterials()} disabled={analysisBusy}>{analysisBusy ? '启动中…' : '确认并开始分析'}</button></div>
          </section>
        </div>
      )}
    </div>
  );
}
