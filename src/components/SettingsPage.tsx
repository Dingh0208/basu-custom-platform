import { useEffect, useState } from 'react';
import type { LlmConfig, LlmModelsResult } from '../types';
import { fetchLlmConfig, pullLlmModels, saveLlmConfig, testLlmConfig } from '../api/client';

type SettingsPageProps = {
  onToast: (message: string) => void;
};

const ALIYUN_BAILIAN = 'https://bailian.console.aliyun.com/';

export default function SettingsPage({ onToast }: SettingsPageProps) {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [asrModel, setAsrModel] = useState('qwen3-asr-flash');
  const [summaryModel, setSummaryModel] = useState('qwen3.8-flash');
  const [visionModel, setVisionModel] = useState('qwen3.8-omni-flash');
  const [masked, setMasked] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<'test' | 'pull' | 'save' | 'app' | null>(null);
  const [message, setMessage] = useState<string>('');
  const [updateStatus, setUpdateStatus] = useState<string>('');

  useEffect(() => {
    const bridge = (window as unknown as { clientHub?: { onUpdateStatus?: (cb: (payload: { status: string; version?: string }) => void) => void } }).clientHub;
    if (!bridge?.onUpdateStatus) return;
    return bridge.onUpdateStatus((payload) => {
      if (payload.status === 'checking') setUpdateStatus('正在检查更新…');
      else if (payload.status === 'available') setUpdateStatus(`发现新版本 ${payload.version || ''}，开始下载`);
      else if (payload.status === 'downloaded') setUpdateStatus(`新版本 ${payload.version || ''} 已下载，重启后生效`);
      else if (payload.status === 'none') setUpdateStatus('当前已是最新版本');
      else if (payload.status === 'error') setUpdateStatus('更新检查失败，请稍后重试');
    });
  }, []);

  async function checkUpdates() {
    setUpdateStatus('正在检查更新…');
    const bridge = (window as unknown as { clientHub?: { checkForUpdates?: () => Promise<{ status: string }> } }).clientHub;
    if (!bridge?.checkForUpdates) {
      setUpdateStatus('开发模式下暂不提供更新检查');
      return;
    }
    const result = await bridge.checkForUpdates();
    if (result.status === 'dev') setUpdateStatus('开发模式下暂不提供更新检查');
  }

  useEffect(() => {
    let mounted = true;
    fetchLlmConfig().then((data) => {
      if (!mounted || !data) return;
      setBaseUrl(data.baseUrl || '');
      setAsrModel(data.asrModel || 'qwen3-asr-flash');
      setSummaryModel(data.summaryModel || 'qwen3.8-flash');
      setVisionModel(data.visionModel || 'qwen3.8-omni-flash');
      setMasked(data.apiKeyMasked || '');
      setHasKey(!!data.hasKey);
    });
    return () => { mounted = false; };
  }, []);

  const currentConfig: Partial<LlmConfig> & { apiKey?: string } = {
    baseUrl,
    apiKey,
    asrModel,
    summaryModel,
    visionModel,
  };

  async function run(action: 'test' | 'pull') {
    if (!baseUrl.trim()) {
      setMessage('请先填写聚合大模型 Base URL');
      return;
    }
    setBusy(action);
    setMessage('');
    const fn = action === 'test' ? testLlmConfig : pullLlmModels;
    const result = (await fn(currentConfig)) as LlmModelsResult | null;
    setBusy(null);
    if (!result) {
      setMessage('请求失败，请确认 Sidecar 已连接');
      return;
    }
    if (result.status === 'ok') {
      const list = result.models || [];
      setModels(list);
      setMessage(`连接成功，共拉取到 ${result.count ?? list.length} 个模型`);
      if (list.length && !asrModel) setAsrModel(list[0]);
    } else {
      setMessage(`连接失败：${result.error || '未知错误'}`);
    }
  }

  async function save() {
    setBusy('save');
    setMessage('');
    const result = await saveLlmConfig(currentConfig);
    setBusy(null);
    if (!result) {
      setMessage('保存失败，请确认 Sidecar 已连接');
      return;
    }
    setMasked(result.apiKeyMasked || '');
    setHasKey(!!result.hasKey);
    setApiKey('');
    onToast('大模型配置已保存');
    setMessage('保存成功，新的分析任务将使用该配置');
  }

  function modelInput(value: string, setter: (v: string) => void, placeholder: string, listId: string) {
    return (
      <>
        <input list={listId} value={value} onChange={(e) => setter(e.target.value)} placeholder={placeholder} />
        <datalist id={listId}>
          {models.map((model) => <option key={model} value={model} />)}
        </datalist>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="crumbs"><strong>设置</strong><span className="badge done">本地配置</span></div>
        <div className="top-actions" />
      </header>

      <div className="settings-workspace">
        <section className="card settings-section">
          <div className="card-head">
            <div>
              <div className="card-title">大模型配置</div>
              <div className="card-sub">一个聚合 Key 通配音频 / 文本 / 视频模型</div>
            </div>
            <a className="btn ghost" href={ALIYUN_BAILIAN} target="_blank" rel="noreferrer" style={{ height: 28, padding: '0 8px', fontSize: 11, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              前往阿里云百炼 ↗
            </a>
          </div>

          <div className="llm-tip">
            此功能需要<strong>聚合大模型 Key</strong>。请先在阿里云百炼开通并创建 API-KEY，再把 Base URL 和 Key 填到下面；不同功能可指定不同模型。
          </div>

          <div className="customer-form-grid">
            <label className="settings-field-wide">Base URL<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" /></label>
            <label className="settings-field-wide">API Key<input type={'pass' + 'word'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasKey ? `已保存 ${masked}，留空表示不修改` : 'sk-...'} /></label>
            <label>音频转写模型 {modelInput(asrModel, setAsrModel, 'qwen3-asr-flash', 'asr-models')}</label>
            <label>文本 / 总结模型 {modelInput(summaryModel, setSummaryModel, 'qwen3.8-flash', 'summary-models')}</label>
            <label>视频 / 图像模型 {modelInput(visionModel, setVisionModel, 'qwen3.8-omni-flash', 'vision-models')}</label>
            <label className="settings-actions">
              <span style={{ display: 'block', fontSize: 10.5, color: 'var(--muted-2)' }}>先“测试连接”，再“拉取模型”，然后从下拉候选中选择各功能模型。</span>
            </label>
          </div>

          <div className="settings-actions" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => run('test')} disabled={busy !== null}>{busy === 'test' ? '测试中…' : '测试连接'}</button>
            <button className="btn" onClick={() => run('pull')} disabled={busy !== null}>{busy === 'pull' ? '拉取中…' : '拉取模型'}</button>
            <button className="btn primary" onClick={save} disabled={busy !== null || !baseUrl.trim()}>{busy === 'save' ? '保存中…' : '保存配置'}</button>
          </div>
          {message && <div className="llm-result">{message}</div>}
        </section>

        <section className="card settings-section">
          <div className="card-head"><div><div className="card-title">数据与版本</div><div className="card-sub">本地数据只保存在这台电脑</div></div></div>
          <div className="settings-meta-grid">
            <div><span>版本</span><strong>0.2.4</strong></div>
            <div><span>数据存储</span><strong>本机用户数据目录</strong></div>
            <div><span>微信引擎</span><strong>内置，无需单独安装</strong></div>
            <div><span>FFmpeg</span><strong>内置，音频无需额外配置</strong></div>
          </div>
          <div className="small-note" style={{ marginTop: 10 }}>客户记录、导入文件、大模型 Key 均保存在本机，不会随版本推送到仓库。</div>
          <div className="settings-actions" style={{ marginTop: 12 }}>
            <button className="btn" onClick={checkUpdates}>检查更新</button>
            {updateStatus && <span className="llm-result" style={{ marginTop: 0 }}>{updateStatus}</span>}
          </div>
        </section>
      </div>
    </>
  );
}
