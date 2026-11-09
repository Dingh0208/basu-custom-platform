export function renderClarificationDocument(document) {
  const escape = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const count = document.groups.reduce((total, group) => total + group.questions.length, 0);
  let number = 0;
  const groups = document.groups.map((group) => `<section><h2>${escape(group.label)}</h2>${group.questions.map((question) => `<article><div class="meta">${escape(question.priority)} / ${escape(question.category)}</div><h3><span>${String(++number).padStart(2, '0')}.</span> ${escape(question.text)}</h3><p class="source">原文依据：${escape(question.source)}</p></article>`).join('')}</section>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(document.title)}</title><style>
    @page{size:A4;margin:20mm 22mm}*{box-sizing:border-box}body{margin:0;font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif;font-size:10.5pt;line-height:1.65;color:#203d39;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    header{border-bottom:2px solid #16796e;padding-bottom:18px;margin-bottom:24px}.brand{font-size:9pt;letter-spacing:1px;color:#16796e}h1{font-size:25pt;line-height:1.3;margin:12px 0;overflow-wrap:anywhere}header p{margin:6px 0;font-size:9pt;color:#667872}
    h2{font-size:15pt;color:#16796e;border-bottom:1px solid #dbe7e3;padding:0 0 8px;margin:24px 0 16px;break-after:avoid}article{margin-bottom:14px;break-inside:avoid}.meta{font-size:9pt;color:#16796e}h3{font-size:11pt;line-height:1.6;margin:4px 0 6px;white-space:pre-wrap;overflow-wrap:anywhere}h3 span{color:#16796e}.source{font-size:9pt;color:#667872;background:#f3f7f5;border-left:2px solid #b8d1ca;margin:0;padding:5px 10px;white-space:pre-wrap;overflow-wrap:anywhere}footer{border-top:1px solid #dbe7e3;margin-top:28px;padding-top:10px;font-size:8pt;color:#667872}
    @media print{footer{position:fixed;bottom:-12mm;left:0;right:0;margin:0}}
  </style></head><body><header><div class="brand">CLIENTATLAS / 需求澄清清单</div><h1>${escape(document.title)}</h1><p>共 ${count} 个问题 · ${document.groups.length} 个客户/项目分区 · 导出日期 ${escape(document.date)}</p><p>请按优先级逐项确认；每题下方引用对应原文，便于核对提问依据。</p></header>${groups}<footer>ClientAtlas · 需求澄清清单</footer></body></html>`;
}
