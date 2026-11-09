import type { ImportRecord } from './types';

export function needsAssociation(record: ImportRecord) {
  return ['', '待归档', '待确认'].includes(record.customer) || !record.project || record.project === '—';
}

export function customerLabel(customer: string) {
  return customer && !['待归档', '待确认'].includes(customer) ? customer : '未关联';
}
