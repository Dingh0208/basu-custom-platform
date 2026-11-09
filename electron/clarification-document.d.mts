export interface ClarificationDocument {
  title: string;
  date: string;
  groups: Array<{
    label: string;
    questions: Array<{ text: string; priority: string; category: string; source: string }>;
  }>;
}
export function renderClarificationDocument(document: ClarificationDocument): string;
