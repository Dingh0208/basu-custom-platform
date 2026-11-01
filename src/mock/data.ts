import type { ImportRecord, SummaryData, SummaryFieldKey, TranscriptRecord } from '../types';

export const initialImports: ImportRecord[] = [
  {
    id: 'imp-001',
    fileName: '2026-10-28_张三_会员小程序_通话录音.m4a',
    type: '音频',
    size: '42.8 MB',
    customer: '张三',
    project: '会员小程序商城',
    status: 'done',
    progress: 100,
    importedAt: '10:31',
    transcriptId: 'tr-001',
  },
  {
    id: 'imp-002',
    fileName: '微信聊天_张三_20261027.txt',
    type: '聊天记录',
    size: '1.2 MB',
    customer: '张三',
    project: '会员小程序商城',
    status: 'processing',
    progress: 60,
    importedAt: '10:28',
  },
  {
    id: 'imp-003',
    fileName: '某某科技_会员小程序_需求说明书.pdf',
    type: 'PDF',
    size: '3.4 MB',
    customer: '待归档',
    project: '—',
    status: 'inbox',
    progress: 0,
    importedAt: '10:20',
  },
];

export const defaultSummary: SummaryData = {
  oneLine:
    '客户要做会员小程序，预算 8–10 万，目标 11 月底上线，本周五前需给出方案和报价。',
  needs: '会员积分、微信支付、与现有 ERP 打通；担心工期影响双十一。',
  budget: '8–10 万（客户口头区间） · 待报价',
  timeline: '11 月底前上线 · 优先级高',
  decisionMakers: '张三（老板，拍板）；李四（运营，日常对接）',
  objections: '工期紧；客户在对比其他外包；优惠券和企微接口可能增加范围。',
  nextActions: '周五前发方案 + 报价；下周一电话确认。',
  paymentMethod: '',
  confidence: 0.92,
  evidenceCount: 6,
};

export const transcriptRecord: TranscriptRecord = {
  id: 'tr-001',
  title: '通话记录 · 会员小程序',
  fileName: '2026-10-28_张三_会员小程序_通话录音.m4a',
  fileSize: '42.8 MB',
  duration: 1938,
  importedAt: '10:24',
  customer: '张三',
  company: '某某科技有限公司',
  project: '会员小程序商城',
  source: '手机通话录音',
  segments: [
    { id: 's01', start: 0, end: 18, speaker: 'customer', text: '王总，我们这边想做一个会员小程序，主要给老客户做积分和复购。' },
    { id: 's02', start: 18, end: 26, speaker: 'me', text: '明白，现在会员数据是在 ERP 里还是 Excel？' },
    { id: 's03', start: 26, end: 41, speaker: 'customer', text: '在 ERP 里，主要还是想打通，不然两边对不上。' },
    { id: 's04', start: 41, end: 62, speaker: 'customer', text: '预算大概八到十万，最好十一月底前能上线。' },
    { id: 's05', start: 62, end: 75, speaker: 'me', text: '双十一前时间比较紧，我建议先上核心的积分和支付，营销玩法二期再加。' },
    { id: 's06', start: 75, end: 90, speaker: 'customer', text: '可以，先看方案。我们老板张三拍板，我这边运营负责对接。' },
    { id: 's07', start: 90, end: 102, speaker: 'me', text: '那我周五前把方案和报价发您，下周一电话确认。' },
    { id: 's08', start: 102, end: 118, speaker: 'customer', text: '行，另外还要能发优惠券，最好能跟企微打通。' },
    { id: 's09', start: 118, end: 138, speaker: 'me', text: '企微接口可以评估，优惠券放在二期也可以。' },
    { id: 's10', start: 138, end: 156, speaker: 'customer', text: '我这边最担心的是工期，双十一前如果上不了，效果就差很多。' },
    { id: 's11', start: 156, end: 171, speaker: 'me', text: '理解，我们先把核心流程排出来，本周五给您一个明确的时间表。' },
    { id: 's12', start: 171, end: 190, speaker: 'customer', text: '行，另外报价里把会员等级和积分规则也拆开写一下。' },
    { id: 's13', start: 190, end: 205, speaker: 'me', text: '没问题，我会在方案里单独列出来。' },
  ],
  summary: defaultSummary,
  requirements: [
    { id: 'req-1', title: '会员积分与复购体系', status: '已确认', priority: 'P0', source: '00:00 / 00:26' },
    { id: 'req-2', title: '微信支付接入', status: '已确认', priority: 'P0', source: '01:02' },
    { id: 'req-3', title: '与现有 ERP 会员数据打通', status: '待确认', priority: 'P0', source: '00:26' },
    { id: 'req-4', title: '优惠券 + 企微接口（二期）', status: '待确认', priority: 'P1', source: '01:42' },
  ],
  citations: [
    { id: 'c1', label: '一句话结论', time: 41, quote: '预算大概八到十万，最好十一月底前能上线。' },
    { id: 'c2', label: '客户需求与痛点', time: 0, quote: '主要给老客户做积分和复购。' },
    { id: 'c3', label: '预算与报价', time: 41, quote: '预算大概八到十万。' },
    { id: 'c4', label: '时间与优先级', time: 41, quote: '最好十一月底前能上线。' },
    { id: 'c5', label: '决策人与角色', time: 75, quote: '我们老板张三拍板，我这边运营负责对接。' },
    { id: 'c6', label: '异议与风险', time: 138, quote: '我这边最担心的是工期，双十一前如果上不了，效果就差很多。' },
  ],
};

export const evidenceTimes: Record<SummaryFieldKey, number> = {
  oneLine: 41,
  needs: 0,
  budget: 41,
  timeline: 41,
  decisionMakers: 75,
  objections: 138,
  nextActions: 90,
  paymentMethod: 0,
};

export const summaryFields: Array<{
  key: SummaryFieldKey;
  label: string;
  multiline?: boolean;
}> = [
  { key: 'oneLine', label: '一句话结论', multiline: true },
  { key: 'needs', label: '客户需求与痛点', multiline: true },
  { key: 'budget', label: '预算与报价' },
  { key: 'timeline', label: '时间与优先级' },
  { key: 'decisionMakers', label: '决策人与角色', multiline: true },
  { key: 'objections', label: '异议与风险', multiline: true },
  { key: 'nextActions', label: '下一步动作', multiline: true },
  { key: 'paymentMethod', label: '付款方式' },
];
