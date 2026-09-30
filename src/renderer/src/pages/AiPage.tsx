import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildScanDigest, estimateTokens } from '@shared/digest';
import { formatBytes, formatCount } from '@shared/format';
import { PROVIDER_CATALOG, TOOL_CALLING_NOTES } from '@shared/models';
import type { AgentStepView, PendingAgentAction } from '@shared/agentTools';
import { useAppStore } from '../store/useAppStore';
import { useAgentStore } from '../store/useAgentStore';
import { Markdown } from '../components/Markdown';
import { AiModelBar } from '../components/AiModelBar';
import { Button, Empty, HintBanner, Segmented, Switch } from '../components/ui';
import {
  IconSpark,
  IconStop,
  IconWarn,
  IconInfo,
  IconLayers,
  IconRefresh
} from '../components/Icons';

type Mode = 'agent' | 'chat';

const QUICK_GOALS = [
  '全面诊断这台电脑的存储状况，告诉我空间主要被什么吃掉了',
  '找出 D 盘里 3 年以上未修改、且大于 100 MB 的文件，评估后清理掉安全的那部分',
  '找出 E 盘下所有的空文件夹并清理掉',
  '告诉我哪个目录最占空间，并给出可执行的清理方案',
  '把「下载」目录里一年前的安装包移动到归档文件夹'
];

const CHAT_QUICK = [
  '分析这份磁盘占用，告诉我空间主要被什么吃掉了',
  '我这台机器该怎么做长期的空间管理？'
];

export function AiPage(): JSX.Element {
  const [mode, setMode] = useState<Mode>('agent');

  const result = useAppStore((s) => s.result);
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const info = useAppStore((s) => s.info);
  const setPage = useAppStore((s) => s.setPage);

  const provider = useMemo(
    () => settings?.providers.find((p) => p.id === settings.activeProviderId) ?? null,
    [settings]
  );
  const catalog = useMemo(() => PROVIDER_CATALOG.find((c) => c.id === provider?.id), [provider?.id]);

  /** 「运行环境」面板是否显示（存进设置，跨会话保留） */
  const panelVisible = settings?.ui.aiPanel ?? true;

  return (
    <div className="page--flush" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div className="split">
        <div className="chat-layout" style={{ flex: 1, minWidth: 0 }}>
          <div className="list-pane__head" style={{ gap: 10 }}>
            <Segmented
              value={mode}
              options={[
                { value: 'agent', label: '智能体（能动手）' },
                { value: 'chat', label: '纯对话' }
              ]}
              onChange={(v) => setMode(v)}
            />
            <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              {mode === 'agent'
                ? '智能体会真实读取磁盘、检索文件，并在你确认后执行删除 / 移动'
                : '只做分析问答，不会对你的文件做任何改动'}
            </span>
            <div className="toolbar__spacer" />
            <Button
              size="sm"
              variant="soft"
              title={panelVisible ? '收起右侧「运行环境」面板' : '展开右侧「运行环境」面板'}
              onClick={() =>
                void saveSettings({ ui: { ...settings!.ui, aiPanel: !panelVisible } })
              }
            >
              {panelVisible ? '收起运行环境' : '运行环境'}
            </Button>
          </div>

          {mode === 'agent' ? <AgentPanel /> : <ChatPanel />}
        </div>

        {/* 右侧信息栏（可收起：面板占 330px，聊天内容多的时候会显得挤） */}
        {panelVisible ? (
        <div className="cart" style={{ width: 330, flex: '0 0 330px' }}>
          <div className="cart__head">
            <IconSpark size={15} />
            <span style={{ fontWeight: 700, fontSize: 12.5 }}>运行环境</span>
            <div className="toolbar__spacer" />
            <Button size="sm" variant="ghost" onClick={() => setPage('settings')}>
              设置
            </Button>
          </div>

          <div className="cart__body" style={{ padding: 14 }}>
            <div className="card" style={{ boxShadow: 'none', marginBottom: 12 }}>
              <div className="card__head" style={{ marginBottom: 8 }}>
                <span className="card__title">当前 AI 服务</span>
                {provider?.hasApiKey ? (
                  <span className="tag tag--success">已配置</span>
                ) : (
                  <span className="tag tag--warning">未配置 Key</span>
                )}
              </div>
              <div className="kv">
                <span className="kv__k">服务商</span>
                <span className="kv__v">{catalog?.label ?? provider?.label ?? '—'}</span>
              </div>
              <div className="kv">
                <span className="kv__k">模型</span>
                <span className="kv__v mono truncate" style={{ maxWidth: 160 }} title={provider?.model}>
                  {provider?.model || '—'}
                </span>
              </div>
              <div className="kv">
                <span className="kv__k">协议</span>
                <span className="kv__v">
                  {provider?.apiStyle === 'anthropic' ? 'Anthropic Messages' : 'OpenAI 兼容'}
                </span>
              </div>
              {provider && TOOL_CALLING_NOTES[provider.id] ? (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.7 }}>
                  工具调用：{TOOL_CALLING_NOTES[provider.id]}
                </div>
              ) : null}
              {provider && !provider.hasApiKey ? (
                <div style={{ marginTop: 8 }}>
                  <Button size="sm" full onClick={() => setPage('settings')}>
                    去填写 API Key
                  </Button>
                </div>
              ) : null}
            </div>

            {mode === 'agent' && catalog && catalog.modelOptions.length > 0 ? (
              <div className="card" style={{ boxShadow: 'none', marginBottom: 12 }}>
                <div className="card__head" style={{ marginBottom: 6 }}>
                  <span className="card__title">推荐模型</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {catalog.modelOptions.map((m) => (
                    <span key={m} className="tag" style={{ fontSize: 10.5 }}>
                      {m}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 7, lineHeight: 1.6 }}>
                  模型名会随服务商更新而变化。设置页的「获取可用模型」会直接拉取你账号下的真实列表。
                </div>
              </div>
            ) : null}

            <div className="card" style={{ boxShadow: 'none', marginBottom: 12 }}>
              <div className="card__head" style={{ marginBottom: 8 }}>
                <span className="card__title">本机数据</span>
              </div>
              {result ? (
                <>
                  <div className="kv">
                    <span className="kv__k">扫描根路径</span>
                    <span className="kv__v mono truncate" style={{ maxWidth: 150 }} title={result.root}>
                      {result.root}
                    </span>
                  </div>
                  <div className="kv">
                    <span className="kv__k">总占用</span>
                    <span className="kv__v">{formatBytes(result.totalSize)}</span>
                  </div>
                  <div className="kv">
                    <span className="kv__k">文件数</span>
                    <span className="kv__v">{formatCount(result.totalFiles)}</span>
                  </div>
                  <div className="kv">
                    <span className="kv__k">摘要 tokens</span>
                    <span className="kv__v">≈ {estimateTokens(buildScanDigest(result)).toLocaleString('zh-CN')}</span>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.8 }}>
                  还没有扫描数据。智能体本身可以直接读磁盘和目录；也可以先
                  <button
                    type="button"
                    style={{
                      border: 'none',
                      background: 'none',
                      color: 'var(--accent)',
                      cursor: 'pointer',
                      padding: '0 3px',
                      fontWeight: 650
                    }}
                    onClick={() => setPage('analyze')}
                  >
                    做一次扫描
                  </button>
                  获得更完整的视图。
                </div>
              )}
            </div>

            <HintBanner kind="info">
              <div style={{ display: 'flex', gap: 8 }}>
                <IconInfo size={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
                <span>
                  只发送文件元数据（路径、体积、时间），不会上传文件内容。
                  所有删除 / 移动操作都会先弹确认卡片，删除默认走回收站。
                </span>
              </div>
            </HintBanner>

            {info?.demoMode ? (
              <div style={{ marginTop: 10 }}>
                <HintBanner>当前是浏览器预览模式，智能体走演示脚本，不会真的动你的文件。</HintBanner>
              </div>
            ) : null}
          </div>
        </div>
        ) : null}
      </div>
    </div>
  );
}

/* ================================================================== *
 * 智能体面板
 * ================================================================== */

function AgentPanel(): JSX.Element {
  const running = useAgentStore((s) => s.running);
  const steps = useAgentStore((s) => s.steps);
  const transcript = useAgentStore((s) => s.transcript);
  const pending = useAgentStore((s) => s.pending);
  const error = useAgentStore((s) => s.error);
  const run = useAgentStore((s) => s.run);
  const resolvePending = useAgentStore((s) => s.resolvePending);
  const reset = useAgentStore((s) => s.reset);
  const stop = useAgentStore((s) => s.stop);

  const [goal, setGoal] = useState('');
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript.length, steps.length, pending]);

  const submit = (): void => {
    const text = goal.trim();
    if (!text || running) return;
    setGoal('');
    void run(text);
  };

  const hasContent = transcript.length > 0 || steps.length > 0;

  return (
    <>
      <div className="chat-stream" ref={streamRef} style={{ flex: 1 }}>
        {!hasContent ? (
          <div style={{ maxWidth: 760, margin: '16px auto 0' }}>
            <Empty
              icon={<IconSpark size={24} />}
              title="告诉我你想达成什么，我来动手"
              desc="和普通聊天不同 —— 智能体会真的去读磁盘、检索文件、做完安全校验后执行清理或整理，每一步都展示给你看。"
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 4 }}>
              {QUICK_GOALS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGoal(g)}
                  style={{
                    textAlign: 'left',
                    padding: '10px 13px',
                    border: '1px solid var(--border)',
                    borderRadius: 9,
                    background: 'var(--bg-elevated)',
                    cursor: 'pointer',
                    fontSize: 12.5,
                    color: 'var(--text-primary)',
                    lineHeight: 1.6
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <AgentTranscript />
        )}
      </div>

      {pending ? <PendingActionCard pending={pending} onResolve={resolvePending} /> : null}

      {error ? (
        <div style={{ padding: '0 20px 8px' }}>
          <HintBanner kind="danger">
            <b>运行出错：</b>
            {error}
            <div style={{ marginTop: 4, fontSize: 11.5 }}>
              常见原因：当前模型不支持工具调用、API Key 无效、或网络不可达。可到「设置 → AI 服务」用「测试连接」确认。
            </div>
          </HintBanner>
        </div>
      ) : null}

      <AiModelBar />

      <div className="chat-compose">
        <div className="chat-compose__actions">
          <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            目标越具体越准 —— 目录、时间范围、体积阈值都可以写进去
          </span>
          <div className="toolbar__spacer" />
          {running ? (
            <Button size="sm" variant="danger" onClick={stop}>
              <IconStop size={12} /> 停止
            </Button>
          ) : null}
          {hasContent ? (
            <Button size="sm" variant="ghost" onClick={reset}>
              <IconRefresh size={12} /> 清空
            </Button>
          ) : null}
        </div>
        <div className="chat-compose__row">
          <textarea
            className="textarea"
            rows={2}
            placeholder="例如：找出 D 盘里 3 年以上、超过 100MB 的文件，检查后把安全的清理掉"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            style={{ flex: 1 }}
            disabled={running || Boolean(pending)}
          />
          <Button variant="primary" size="lg" onClick={submit} disabled={!goal.trim() || running || Boolean(pending)}>
            {running ? '执行中…' : '开始'}
          </Button>
        </div>
      </div>
    </>
  );
}

function AgentTranscript(): JSX.Element {
  const transcript = useAgentStore((s) => s.transcript);
  const steps = useAgentStore((s) => s.steps);
  const running = useAgentStore((s) => s.running);

  return (
    <div style={{ paddingBottom: 8 }}>
      {transcript.map((entry) => (
        <div key={entry.id} className={`chat-msg chat-msg--${entry.role === 'user' ? 'user' : 'ai'}`}>
          <div className="chat-msg__avatar">{entry.role === 'user' ? '我' : entry.role === 'error' ? '!' : 'AI'}</div>
          <div className="chat-bubble">
            {entry.role === 'error' ? (
              <span style={{ color: 'var(--danger)' }}>{entry.content}</span>
            ) : (
              <Markdown text={entry.content} />
            )}
          </div>
        </div>
      ))}

      {steps.length > 0 ? (
        <div style={{ padding: '4px 20px 8px 68px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {steps.map((step) => (
            <AgentStepCard key={step.id} step={step} />
          ))}
        </div>
      ) : null}

      {running ? (
        <div style={{ padding: '2px 20px 10px 68px', fontSize: 12, color: 'var(--text-tertiary)' }}>
          <span className="pulse">●</span> 智能体正在思考…
        </div>
      ) : null}
    </div>
  );
}

const STEP_STATUS: Record<AgentStepView['status'], { tone: string; text: string }> = {
  running: { tone: 'accent', text: '执行中' },
  done: { tone: 'success', text: '完成' },
  failed: { tone: 'danger', text: '失败' },
  'pending-confirm': { tone: 'warning', text: '待确认' },
  skipped: { tone: 'muted', text: '已跳过' }
};

function AgentStepCard({ step }: { step: AgentStepView }): JSX.Element {
  const [open, setOpen] = useState(false);
  const status = STEP_STATUS[step.status];

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 9,
        background: 'var(--bg-elevated)',
        overflow: 'hidden'
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px', cursor: 'pointer' }}
        onClick={() => setOpen(!open)}
      >
        <IconLayers size={13} style={{ color: 'var(--text-tertiary)', flex: '0 0 auto' }} />
        <span style={{ fontWeight: 650, fontSize: 12 }}>{step.label ?? step.toolName}</span>
        <span className={`tag tag--${status.tone}`} style={{ fontSize: 10 }}>
          {status.text}
        </span>
        {step.summary ? (
          <span
            className="truncate"
            style={{ fontSize: 11.5, color: 'var(--text-secondary)', flex: 1, minWidth: 0 }}
          >
            {step.summary}
          </span>
        ) : (
          <span style={{ flex: 1 }} />
        )}
        {step.elapsedMs ? (
          <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>
            {(step.elapsedMs / 1000).toFixed(1)}s
          </span>
        ) : null}
        <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{open ? '收起' : '详情'}</span>
      </div>

      {open ? (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: '9px 11px',
            background: 'var(--bg-sunken)',
            fontSize: 11.5
          }}
        >
          <div style={{ color: 'var(--text-tertiary)', marginBottom: 5, fontWeight: 650 }}>调用参数</div>
          <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 10.5 }}>
            {JSON.stringify(step.args ?? {}, null, 2)}
          </pre>
          {step.text ? (
            <>
              <div style={{ color: 'var(--text-tertiary)', margin: '9px 0 5px', fontWeight: 650 }}>返回结果</div>
              <pre
                className="mono"
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  fontSize: 10.5,
                  maxHeight: 260,
                  overflowY: 'auto'
                }}
              >
                {step.text}
              </pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ================================================================== *
 * 危险操作确认卡片
 * ================================================================== */

function PendingActionCard({
  pending,
  onResolve
}: {
  pending: PendingAgentAction;
  onResolve: (approved: boolean) => Promise<void>;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const blocked = pending.items.filter((i) => i.blocked);
  const usable = pending.items.filter((i) => !i.blocked);
  const shown = showAll ? usable : usable.slice(0, 8);
  const isCleanup = pending.toolName === 'execute_cleanup';
  const useRecycle = pending.args['useRecycleBin'] !== false;
  const targetDir = typeof pending.args['targetDir'] === 'string' ? pending.args['targetDir'] : '';

  const resolve = async (ok: boolean): Promise<void> => {
    setBusy(true);
    await onResolve(ok);
    setBusy(false);
  };

  return (
    <div style={{ padding: '0 20px 10px' }}>
      <div
        style={{
          border: '1px solid var(--warning)',
          borderRadius: 11,
          background: 'var(--bg-elevated)',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '11px 14px',
            background: 'var(--warning-soft)'
          }}
        >
          <IconWarn size={16} style={{ color: 'var(--warning)' }} />
          <span style={{ fontWeight: 700, fontSize: 13 }}>需要你确认：{pending.label}</span>
          <div className="toolbar__spacer" />
          <span style={{ fontSize: 12, fontWeight: 650 }}>
            {usable.length} 项 · {formatBytes(pending.totalBytes)}
          </span>
        </div>

        <div style={{ padding: '12px 14px', fontSize: 12 }}>
          {isCleanup ? (
            <div style={{ marginBottom: 9, lineHeight: 1.8 }}>
              将这些文件
              <b style={{ color: useRecycle ? 'var(--success)' : 'var(--danger)' }}>
                {useRecycle ? '移入回收站（可恢复）' : '永久删除（不可恢复）'}
              </b>
              。回收站中的文件在清空前仍占用磁盘空间。
            </div>
          ) : targetDir ? (
            <div style={{ marginBottom: 9, lineHeight: 1.8 }}>
              目标目录：<span className="mono">{targetDir}</span>
              <br />
              同名冲突处理：
              <b>
                {pending.args['onConflict'] === 'skip'
                  ? '跳过'
                  : pending.args['onConflict'] === 'overwrite'
                    ? '覆盖'
                    : '自动重命名'}
              </b>
            </div>
          ) : null}

          {blocked.length > 0 ? (
            <div style={{ marginBottom: 9 }}>
              <HintBanner kind="danger">
                其中 <b>{blocked.length}</b> 项位于受保护的系统路径，会被自动跳过。
              </HintBanner>
            </div>
          ) : null}

          {shown.length > 0 ? (
            <div
              style={{
                maxHeight: 190,
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '4px 10px'
              }}
            >
              {shown.map((item) => (
                <div
                  key={item.path}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    padding: '5px 0',
                    borderBottom: '1px dashed var(--border)',
                    fontSize: 11.5
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div className="truncate" style={{ fontWeight: 600 }}>
                      {item.name}
                    </div>
                    <div
                      className="mono truncate"
                      style={{ color: 'var(--text-tertiary)', fontSize: 10.5 }}
                      title={item.path}
                    >
                      {item.path}
                    </div>
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 650, whiteSpace: 'nowrap' }}>
                    {item.size > 0 ? formatBytes(item.size) : '—'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>（该操作没有需要逐项列出的文件）</div>
          )}

          {usable.length > shown.length ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              style={{
                marginTop: 7,
                border: 'none',
                background: 'none',
                color: 'var(--accent)',
                cursor: 'pointer',
                padding: 0,
                fontSize: 11.5,
                fontWeight: 650
              }}
            >
              还有 {usable.length - shown.length} 项，展开查看
            </button>
          ) : null}

          <div style={{ display: 'flex', gap: 9, marginTop: 13 }}>
            <Button onClick={() => void resolve(false)} disabled={busy} full>
              取消
            </Button>
            <Button
              variant={isCleanup && useRecycle ? 'primary' : 'danger'}
              onClick={() => void resolve(true)}
              disabled={busy || usable.length === 0}
              full
            >
              {busy ? '执行中…' : `确认执行（${usable.length} 项）`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== *
 * 纯对话面板（保留原有能力）
 * ================================================================== */

function ChatPanel(): JSX.Element {
  const result = useAppStore((s) => s.result);
  const aiMessages = useAppStore((s) => s.aiMessages);
  const aiStreaming = useAppStore((s) => s.aiStreaming);
  const aiAnalyze = useAppStore((s) => s.aiAnalyze);
  const aiChat = useAppStore((s) => s.aiChat);
  const aiStop = useAppStore((s) => s.aiStop);
  const aiClear = useAppStore((s) => s.aiClear);

  const [input, setInput] = useState('');
  const [includeContext, setIncludeContext] = useState(true);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [aiMessages.length]);

  const digest = useMemo(() => (result && includeContext ? buildScanDigest(result) : ''), [result, includeContext]);

  const send = async (): Promise<void> => {
    const q = input.trim();
    if (!q || aiStreaming) return;
    setInput('');
    await aiChat(digest, q);
  };

  return (
    <>
      <div className="chat-stream" ref={streamRef}>
        {aiMessages.length === 0 ? (
          <div style={{ maxWidth: 720, margin: '18px auto 0' }}>
            <Empty
              icon={<IconSpark size={24} />}
              title="纯对话模式"
              desc="只做分析和问答，不会读取或修改你的文件。需要真正执行操作时，切到「智能体」。"
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {CHAT_QUICK.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="tag tag--accent"
                  style={{ cursor: 'pointer', border: 'none', padding: '5px 11px', fontSize: 11.5 }}
                  onClick={() => setInput(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          aiMessages.map((m) => (
            <div key={m.id} className={`chat-msg chat-msg--${m.role === 'user' ? 'user' : 'ai'}`}>
              <div className="chat-msg__avatar">{m.role === 'user' ? '我' : 'AI'}</div>
              <div className="chat-bubble">
                {m.error ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: 'var(--danger)' }}>
                    <IconWarn size={15} style={{ flex: '0 0 auto', marginTop: 2 }} />
                    <div>
                      <b>请求失败</b>
                      <div style={{ fontSize: 12, marginTop: 3, color: 'var(--text-secondary)' }}>{m.error}</div>
                    </div>
                  </div>
                ) : (
                  <div className={m.streaming ? 'typing-cursor' : ''}>
                    <Markdown text={m.content} />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="chat-compose">
        <div className="chat-compose__actions">
          <Button size="sm" variant="soft" disabled={!result || aiStreaming} onClick={() => void aiAnalyze(digest)}>
            <IconSpark size={13} /> 一键全面诊断
          </Button>
          <Button size="sm" variant="ghost" onClick={aiClear} disabled={aiMessages.length === 0}>
            清空对话
          </Button>
          <div className="toolbar__spacer" />
          <label className="flt" style={{ cursor: 'pointer' }}>
            <Switch checked={includeContext} onChange={setIncludeContext} />
            附带扫描摘要
          </label>
          {aiStreaming ? (
            <Button size="sm" variant="danger" onClick={() => void aiStop()}>
              <IconStop size={12} /> 停止
            </Button>
          ) : null}
        </div>
        <div className="chat-compose__row">
          <textarea
            className="textarea"
            rows={2}
            placeholder="输入你的问题，Enter 发送（Shift+Enter 换行）"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            style={{ flex: 1 }}
          />
          <Button variant="primary" size="lg" onClick={() => void send()} disabled={!input.trim() || aiStreaming}>
            发送
          </Button>
        </div>
      </div>
    </>
  );
}
