import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { AiProviderConfig, AppSettings } from '@shared/types';
import { catalogEntry } from '@shared/models';
import { useAppStore } from '../store/useAppStore';
import { bridge } from '../bridge';
import { Button, Field, HintBanner, Modal, Segmented, SwitchRow, TextInput } from '../components/ui';
import { IconSpark, IconCheck, IconWarn, IconSettings, IconDisk, IconTrash, IconInfo, IconExternal } from '../components/Icons';

type Tab = 'ai' | 'scan' | 'cleanup' | 'appearance' | 'about';

export function SettingsPage(): JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const resetSettings = useAppStore((s) => s.resetSettings);
  const setTheme = useAppStore((s) => s.setTheme);
  const info = useAppStore((s) => s.info);
  const pushToast = useAppStore((s) => s.pushToast);

  const [tab, setTab] = useState<Tab>('ai');
  const [selectedId, setSelectedId] = useState<string>(settings?.activeProviderId ?? '');
  const [draft, setDraft] = useState<AiProviderConfig | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [modelList, setModelList] = useState<Array<{ id: string }>>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const p = settings.providers.find((x) => x.id === selectedId) ?? settings.providers[0];
    setDraft(p ? { ...p } : null);
    setApiKeyInput('');
    setTestResult(null);
    setModelList([]);
    setModelError(null);
  }, [settings, selectedId]);

  const activeProvider = useMemo(
    () => settings?.providers.find((p) => p.id === settings.activeProviderId),
    [settings]
  );

  const draftMeta = useMemo(() => (draft ? catalogEntry(draft.id) : undefined), [draft]);

  if (!settings) {
    return (
      <div className="page">
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>正在加载设置…</div>
      </div>
    );
  }

  const persistProvider = async (): Promise<void> => {
    if (!draft) return;
    const next: AiProviderConfig = { ...draft };
    if (apiKeyInput.trim()) next.apiKey = apiKeyInput.trim();
    const providers = settings.providers.map((p) => (p.id === draft.id ? next : p));
    await saveSettings({ providers });
    setApiKeyInput('');
    pushToast({ kind: 'success', title: '已保存', message: `${draft.label} 的配置已更新` });
  };

  const runTest = async (): Promise<void> => {
    if (!draft) return;
    setTesting(true);
    setTestResult(null);
    try {
      if (apiKeyInput.trim()) {
        const providers = settings.providers.map((p) =>
          p.id === draft.id ? { ...draft, apiKey: apiKeyInput.trim() } : p
        );
        await saveSettings({ providers });
      }
      const res = await bridge.aiTest(draft.id);
      setTestResult({ ok: res.ok, message: res.message + (res.sample ? ` · 返回「${res.sample}」` : '') });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  /**
   * 向服务商请求真实的模型列表。
   *
   * 这是解决「内置模型名会过期」的根本手段 —— 拉到的永远是你账号下当前可用的模型。
   * 需要先落盘 API Key（如果用户刚填了的话），否则服务端会拒绝。
   */
  const fetchModels = async (): Promise<void> => {
    if (!draft || fetchingModels) return;
    setFetchingModels(true);
    setModelError(null);
    try {
      if (apiKeyInput.trim()) {
        const providers = settings.providers.map((p) =>
          p.id === draft.id ? { ...draft, apiKey: apiKeyInput.trim() } : p
        );
        await saveSettings({ providers });
        setApiKeyInput('');
      }
      const res = await bridge.listProviderModels(draft.id);
      if (!res.ok) {
        setModelList([]);
        setModelError(res.error ?? '获取失败');
      } else if (res.models.length === 0) {
        setModelList([]);
        setModelError('服务商返回了空列表，可能是该端点不支持 /models 接口，请手动填写模型名。');
      } else {
        setModelList(res.models);
        pushToast({
          kind: 'success',
          title: `拉到 ${res.models.length} 个可用模型`,
          message: '点击标签即可填入'
        });
      }
    } catch (err) {
      setModelError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingModels(false);
    }
  };

  const setScan = (patch: Partial<AppSettings['scan']>): void => {
    void saveSettings({ scan: { ...settings.scan, ...patch } });
  };
  const setCleanup = (patch: Partial<AppSettings['cleanup']>): void => {
    void saveSettings({ cleanup: { ...settings.cleanup, ...patch } });
  };

  return (
    <div className="page">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="settings-nav">
          {(
            [
              { id: 'ai', label: 'AI 服务', icon: <IconSpark size={14} /> },
              { id: 'scan', label: '扫描设置', icon: <IconDisk size={14} /> },
              { id: 'cleanup', label: '清理与安全', icon: <IconTrash size={14} /> },
              { id: 'appearance', label: '外观', icon: <IconSettings size={14} /> },
              { id: 'about', label: '关于', icon: <IconInfo size={14} /> }
            ] as Array<{ id: Tab; label: string; icon: JSX.Element }>
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              className={`nav-item${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="nav-item__icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, maxWidth: 880 }}>
          {/* ---------------- AI ---------------- */}
          {tab === 'ai' ? (
            <>
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card__head">
                  <span className="card__title">服务商</span>
                  <div className="card__spacer" />
                  <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                    当前默认：{activeProvider?.label ?? '未选择'}
                  </span>
                </div>
                <div className="grid grid--2" style={{ gap: 8 }}>
                  {settings.providers.map((p) => (
                    <div
                      key={p.id}
                      className={`provider-item${p.id === selectedId ? ' active' : ''}`}
                      onClick={() => setSelectedId(p.id)}
                    >
                      <div className="provider-item__logo">{p.label.slice(0, 2)}</div>
                      <div style={{ minWidth: 0 }}>
                        <div className="provider-item__name">{p.label}</div>
                        <div className="provider-item__meta mono truncate">{p.model || '未设置模型'}</div>
                      </div>
                      <div className="provider-item__status" style={{ display: 'flex', gap: 5 }}>
                        {settings.activeProviderId === p.id ? <span className="tag tag--accent">默认</span> : null}
                        {p.hasApiKey ? (
                          <span className="tag tag--success">已配置</span>
                        ) : (
                          <span className="tag">未配置</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {draft ? (
                <div className="card" style={{ marginBottom: 14 }}>
                  <div className="card__head">
                    <span className="card__title">编辑「{draft.label}」</span>
                    <div className="card__spacer" />
                    <Button
                      size="sm"
                      variant={settings.activeProviderId === draft.id ? 'soft' : 'default'}
                      onClick={() => void saveSettings({ activeProviderId: draft.id })}
                      disabled={settings.activeProviderId === draft.id}
                    >
                      {settings.activeProviderId === draft.id ? (
                        <>
                          <IconCheck size={12} /> 已设为默认
                        </>
                      ) : (
                        '设为默认服务'
                      )}
                    </Button>
                  </div>

                  {draftMeta && (draftMeta.note || draftMeta.consoleUrl) ? (
                    <div style={{ marginBottom: 12 }}>
                      <HintBanner kind="info">
                        {draftMeta.note ? <div style={{ marginBottom: draftMeta.consoleUrl ? 5 : 0 }}>{draftMeta.note}</div> : null}
                        {draftMeta.consoleUrl ? (
                          <button
                            type="button"
                            onClick={() => void bridge.openExternal(draftMeta.consoleUrl ?? '')}
                            style={{
                              border: 'none',
                              background: 'none',
                              color: 'var(--accent)',
                              cursor: 'pointer',
                              padding: 0,
                              fontWeight: 650,
                              fontSize: 11.5
                            }}
                          >
                            前往控制台申请 / 管理 API Key →
                          </button>
                        ) : null}
                      </HintBanner>
                    </div>
                  ) : null}

                  <div className="grid grid--2" style={{ gap: 12 }}>
                    <Field label="显示名称">
                      <TextInput value={draft.label} onChange={(v) => setDraft({ ...draft, label: v })} />
                    </Field>

                    <Field label="接口协议" hint="Anthropic 使用 /v1/messages，其余按 OpenAI 兼容 /chat/completions">
                      <select
                        className="select"
                        value={draft.apiStyle}
                        onChange={(e) => setDraft({ ...draft, apiStyle: e.target.value as 'openai' | 'anthropic' })}
                      >
                        <option value="openai">OpenAI 兼容（OpenAI / DeepSeek / 通义 / Kimi / GLM / Ollama）</option>
                        <option value="anthropic">Anthropic Messages（Claude）</option>
                      </select>
                    </Field>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <Field label="API Base URL">
                      <TextInput value={draft.baseUrl} onChange={(v) => setDraft({ ...draft, baseUrl: v })} />
                    </Field>
                  </div>

                  <div className="grid grid--2" style={{ gap: 12, marginTop: 12 }}>
                    <Field label="API Key" hint={draft.apiKeyMasked ? `当前：${draft.apiKeyMasked}` : '尚未设置'}>
                      <input
                        className="input"
                        type="password"
                        placeholder={draft.hasApiKey ? '留空表示不修改' : 'sk-...'}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        spellCheck={false}
                      />
                    </Field>
                    <Field
                      label="模型名称"
                      hint="模型名会随服务商更新而变化，建议点右侧按钮直接拉取你账号下的可用列表"
                    >
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          className="input"
                          value={draft.model}
                          onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                          placeholder="例如 deepseek-v4-pro"
                          spellCheck={false}
                          list="sfm-model-options"
                        />
                        <Button
                          onClick={() => void fetchModels()}
                          disabled={fetchingModels}
                          title="向服务商请求 /models 接口"
                        >
                          {fetchingModels ? '获取中…' : '获取可用模型'}
                        </Button>
                      </div>
                      <datalist id="sfm-model-options">
                        {modelList.map((m) => (
                          <option key={m.id} value={m.id} />
                        ))}
                      </datalist>
                      {modelError ? (
                        <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 5, lineHeight: 1.6 }}>
                          {modelError}
                        </div>
                      ) : null}
                      {modelList.length > 0 ? (
                        <div style={{ marginTop: 7 }}>
                          <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                            拉到 {modelList.length} 个模型，点击可填入：
                          </div>
                          <div className="chips" style={{ maxHeight: 96, overflowY: 'auto' }}>
                            {modelList.slice(0, 60).map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                className={`seg__btn${draft.model === m.id ? ' active' : ''}`}
                                style={{ fontSize: 10.5 }}
                                onClick={() => setDraft({ ...draft, model: m.id })}
                              >
                                {m.id}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </Field>
                  </div>

                  <div className="grid grid--2" style={{ gap: 12, marginTop: 12 }}>
                    <Field label={`温度（${draft.temperature.toFixed(1)}）`} hint="数值越低回答越稳定">
                      <input
                        type="range"
                        min={0}
                        max={1.5}
                        step={0.1}
                        value={draft.temperature}
                        onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="最大输出 Token">
                      <input
                        className="input"
                        type="number"
                        min={256}
                        max={32000}
                        step={256}
                        value={draft.maxTokens}
                        onChange={(e) => setDraft({ ...draft, maxTokens: Number(e.target.value) })}
                      />
                    </Field>
                  </div>

                  {/*
                    上下文窗口按**模型**设置：现在的窗口从 32k 到 1M 都有，差一个数量级，
                    统一一个值要么浪费、要么超限。智能体每次请求前会按它截断历史。
                  */}
                  <Field
                    label="上下文长度（Token）"
                    hint="该模型的上下文窗口。智能体发请求前会按它截断历史，避免超长报错"
                  >
                    <select
                      className="select"
                      value={String(draft.contextWindow ?? 128000)}
                      onChange={(e) => setDraft({ ...draft, contextWindow: Number(e.target.value) })}
                    >
                      {[32000, 64000, 128000, 200000, 256000, 512000, 1000000, 2000000].map((n) => (
                        <option key={n} value={n}>
                          {n >= 1000000 ? `${n / 1000000}M` : `${n / 1000}k`} Token
                          {n === 128000 ? '（默认）' : ''}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {apiKeyInput.trim() ? (
                    <div style={{ marginTop: 12 }}>
                      <HintBanner kind="info">
                        检测到新的 API Key，保存后将替换原有密钥。
                        {info?.secureStorage
                          ? ' 本机支持系统级安全存储，密钥将以加密形式落盘。'
                          : ' 当前环境不支持系统级加密，密钥将以明文保存在应用数据目录中。'}
                      </HintBanner>
                    </div>
                  ) : null}
                  {!draft.hasApiKey && !apiKeyInput.trim() && draft.id !== 'ollama' ? (
                    <div style={{ marginTop: 12 }}>
                      <HintBanner>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <IconWarn size={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
                          <span>该服务尚未配置 API Key，AI 相关功能不可用。要使用 Claude，请选择「Anthropic Claude」并填写 Anthropic 的 Key。</span>
                        </div>
                      </HintBanner>
                    </div>
                  ) : null}

                  <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
                    <Button variant="primary" onClick={() => void persistProvider()}>
                      保存配置
                    </Button>
                    <Button onClick={() => void runTest()} disabled={testing}>
                      {testing ? '测试中…' : '测试连接'}
                    </Button>
                    {draft.hasApiKey ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          const providers = settings.providers.map((p) =>
                            p.id === draft.id ? { ...p, apiKey: '__CLEAR__', hasApiKey: false, apiKeyMasked: '' } : p
                          );
                          void saveSettings({ providers });
                          pushToast({ kind: 'warning', title: '已清除该服务的 API Key' });
                        }}
                      >
                        清除密钥
                      </Button>
                    ) : null}
                    <div className="toolbar__spacer" />
                    {testResult ? (
                      <span
                        className={`tag tag--${testResult.ok ? 'success' : 'danger'}`}
                        style={{ maxWidth: 380, whiteSpace: 'normal', textAlign: 'left' }}
                      >
                        {testResult.message}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <HintBanner kind="info">
                API Key 仅保存在本机应用数据目录，所有请求由主进程直连你选择的服务商，不经过任何中间服务器。
                浏览器预览模式下不提供真实网络调用。
              </HintBanner>
            </>
          ) : null}

          {/* ---------------- 扫描 ---------------- */}
          {tab === 'scan' ? (
            <>
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card__head">
                  <span className="card__title">性能</span>
                </div>
                <Field
                  label={`并发读取数：${settings.scan.concurrency}`}
                  hint="数值越高扫描越快，但会占用更多磁盘 IO 与内存。机械硬盘建议 16–32，固态硬盘建议 64–128。"
                >
                  <input
                    type="range"
                    min={4}
                    max={256}
                    step={4}
                    value={settings.scan.concurrency}
                    onChange={(e) => setScan({ concurrency: Number(e.target.value) })}
                  />
                </Field>
                <div style={{ height: 12 }} />
                <Field label={`目录树展开层级：${settings.scan.treeDepth}`} hint="层级越深，可视化时可下钻的层数越多，但内存占用更高。">
                  <input
                    type="range"
                    min={2}
                    max={12}
                    step={1}
                    value={settings.scan.treeDepth}
                    onChange={(e) => setScan({ treeDepth: Number(e.target.value) })}
                  />
                </Field>
              </div>

              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card__head">
                  <span className="card__title">跳过规则</span>
                </div>
                <SwitchRow
                  title="跳过隐藏文件与目录"
                  desc="以「.」开头的名称会被跳过（Windows 上为近似判断）"
                  checked={settings.scan.skipHidden}
                  onChange={(v) => setScan({ skipHidden: v })}
                />
                <SwitchRow
                  title="跳过系统保留目录"
                  desc="回收站、卷影副本、Windows.old、$WinREAgent 等无用户数据价值的位置"
                  checked={settings.scan.skipSystem}
                  onChange={(v) => setScan({ skipSystem: v })}
                />
                <SwitchRow
                  title="跳过 node_modules"
                  desc="前端项目依赖目录，文件数量极多但通常无需统计"
                  checked={settings.scan.skipNodeModules}
                  onChange={(v) => setScan({ skipNodeModules: v })}
                />
                <SwitchRow
                  title="跳过版本控制目录"
                  desc=".git / .svn / .hg"
                  checked={settings.scan.skipGit}
                  onChange={(v) => setScan({ skipGit: v })}
                />
              </div>

              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card__head">
                  <span className="card__title">排除规则</span>
                </div>
                <div className="grid grid--2" style={{ gap: 12 }}>
                  <Field label="排除的目录名" hint="多个用英文逗号分隔，精确匹配目录名">
                    <TextInput
                      value={settings.scan.excludeDirNames.join(', ')}
                      onChange={(v) =>
                        setScan({
                          excludeDirNames: v
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean)
                        })
                      }
                    />
                  </Field>
                  <Field label="排除的扩展名" hint="不含点，多个用英文逗号分隔，例如 tmp, log">
                    <TextInput
                      value={settings.scan.excludeExts.join(', ')}
                      onChange={(v) =>
                        setScan({ excludeExts: v.split(',').map((s) => s.trim().replace(/^\./, '').toLowerCase()).filter(Boolean) })
                      }
                    />
                  </Field>
                </div>
              </div>

              <div className="card">
                <div className="card__head">
                  <span className="card__title">大文件判定</span>
                </div>
                <Field
                  label={`大文件阈值：${settings.scan.largeFileThresholdMB} MB`}
                  hint="扫描时体积超过该值的文件会进入「大文件清理」列表"
                >
                  <input
                    type="range"
                    min={10}
                    max={5120}
                    step={10}
                    value={settings.scan.largeFileThresholdMB}
                    onChange={(e) => setScan({ largeFileThresholdMB: Number(e.target.value) })}
                  />
                </Field>
              </div>
            </>
          ) : null}

          {/* ---------------- 清理 ---------------- */}
          {tab === 'cleanup' ? (
            <>
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card__head">
                  <span className="card__title">删除方式</span>
                </div>
                <SwitchRow
                  title="默认移入系统回收站"
                  desc="强烈建议保持开启。文件可在系统回收站中恢复，代价是清空前仍占用空间。"
                  checked={settings.cleanup.useRecycleBin}
                  onChange={(v) => setCleanup({ useRecycleBin: v })}
                />
                <SwitchRow
                  title="永久删除前强制二次确认"
                  desc="要求勾选确认框后才能执行不可恢复的删除"
                  checked={settings.cleanup.confirmPermanentDelete}
                  onChange={(v) => setCleanup({ confirmPermanentDelete: v })}
                />
              </div>

              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card__head">
                  <span className="card__title">内置安全防护</span>
                </div>
                <div style={{ fontSize: 12, lineHeight: 2, color: 'var(--text-secondary)' }}>
                  以下规则始终生效，无法关闭：
                  <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                    <li>拒绝删除磁盘根目录</li>
                    <li>拒绝删除 Windows / Program Files / ProgramData / 引导分区等系统关键位置</li>
                    <li>拒绝删除 pagefile.sys、hiberfil.sys 等系统文件</li>
                    <li>自动过滤受保护路径，并对父子路径去重，避免重复删除</li>
                    <li>批量操作逐项统计成功与失败，失败原因可追溯</li>
                  </ul>
                </div>
              </div>

              <div className="card">
                <div className="card__head">
                  <span className="card__title">危险操作</span>
                </div>
                <Button variant="danger" onClick={() => setConfirmReset(true)}>
                  恢复所有默认设置
                </Button>
                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 8 }}>
                  将清空所有 AI 服务配置（含 API Key）与扫描偏好设置。
                </div>
              </div>
            </>
          ) : null}

          {/* ---------------- 外观 ---------------- */}
          {tab === 'appearance' ? (
            <div className="card">
              <div className="card__head">
                <span className="card__title">主题</span>
              </div>
              <Segmented
                value={settings.ui.theme}
                options={[
                  { value: 'light', label: '浅色' },
                  { value: 'dark', label: '深色' },
                  { value: 'system', label: '跟随系统' }
                ]}
                onChange={(v) => setTheme(v)}
              />
              <div className="divider" />
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
                界面配色在浅色/深色主题下均按 WCAG AA 对比度设计；矩形树图、环形图等可视化会同步切换。
              </div>

              {/* ---------------- 液态玻璃 ---------------- */}
              <div className="divider" />
              <div className="card__head" style={{ marginBottom: 8 }}>
                <span className="card__title">液态玻璃效果</span>
                <span className="tag" style={{ fontSize: 10.5 }}>
                  实验性
                </span>
              </div>
              <SwitchRow
                title="开启液态玻璃（Liquid Glass）"
                desc="侧栏、顶栏、卡片等表面变成半透明玻璃，并对身后背景做真实折射（SVG 位移贴图），而不是普通磨砂。会持续占用 GPU。"
                checked={settings.ui.glass}
                onChange={(v) => void saveSettings({ ui: { ...settings.ui, glass: v } })}
              />

              {settings.ui.glass ? (
                <>
                  <Field label="折射强度" hint={`${settings.ui.glassScale} px —— 0 表示只做磨砂不折射`}>
                    <input
                      type="range"
                      min={0}
                      max={120}
                      step={4}
                      value={settings.ui.glassScale}
                      onChange={(e) =>
                        void saveSettings({
                          ui: { ...settings.ui, glassScale: Number(e.target.value) }
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  </Field>
                  <SwitchRow
                    title="背景光斑缓慢漂移"
                    desc="关掉后背景静止，更省电；折射效果不受影响，只是玻璃后面的细节不再移动。"
                    checked={settings.ui.glassScene}
                    onChange={(v) => void saveSettings({ ui: { ...settings.ui, glassScene: v } })}
                  />
                  <div style={{ marginTop: 12 }}>
                    <HintBanner kind="info">
                      只把折射加在「面积大、位置稳定」的表面上；文件列表这类密集滚动区域不加，以免拖慢滚动。
                      如果切换页面或滚动变得不流畅，先把折射强度调低，或关掉背景漂移。
                    </HintBanner>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {/* ---------------- 关于 ---------------- */}
          {tab === 'about' ? (
            <div className="card">
              <div className="card__head">
                <span className="card__title">关于本应用</span>
              </div>
              <div className="kv">
                <span className="kv__k">名称</span>
                <span className="kv__v">智能文件管理器 SmartFileManager</span>
              </div>
              <div className="kv">
                <span className="kv__k">版本</span>
                <span className="kv__v">{info?.version ?? '0.1.0'}</span>
              </div>
              <div className="kv">
                <span className="kv__k">运行模式</span>
                <span className="kv__v">{info?.demoMode ? '浏览器预览（演示数据）' : '桌面客户端'}</span>
              </div>
              <div className="kv">
                <span className="kv__k">平台</span>
                <span className="kv__v">
                  {info?.platform} / {info?.arch}
                </span>
              </div>
              {!info?.demoMode ? (
                <>
                  <div className="kv">
                    <span className="kv__k">Electron</span>
                    <span className="kv__v">{info?.electron}</span>
                  </div>
                  <div className="kv">
                    <span className="kv__k">Chromium</span>
                    <span className="kv__v">{info?.chrome}</span>
                  </div>
                  <div className="kv">
                    <span className="kv__k">Node.js</span>
                    <span className="kv__v">{info?.node}</span>
                  </div>
                </>
              ) : null}
              <div className="kv">
                <span className="kv__k">数据目录</span>
                <span className="kv__v mono" style={{ maxWidth: 420, wordBreak: 'break-all' }}>
                  {info?.userDataPath}
                </span>
              </div>
              <div className="divider" />
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
                本工具完全离线运行（仅 AI 请求会直连你选择的服务商）。扫描过程只读取文件元数据，
                任何删除操作都需经过路径安全校验，默认走系统回收站。
              </div>
              <div style={{ marginTop: 14 }}>
                <Button
                  onClick={() =>
                    void bridge.openExternal('https://github.com/')
                  }
                >
                  <IconExternal size={13} /> 查看项目主页
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {confirmReset ? (
        <Modal
          title="恢复默认设置"
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <Button onClick={() => setConfirmReset(false)}>取消</Button>
              <Button
                variant="danger"
                onClick={() => {
                  void resetSettings();
                  setConfirmReset(false);
                }}
              >
                确认恢复
              </Button>
            </>
          }
        >
          <HintBanner kind="danger">
            此操作会清除所有 AI 服务配置（包括已保存的 API Key）与扫描偏好，且不可撤销。
          </HintBanner>
        </Modal>
      ) : null}
    </div>
  );
}
