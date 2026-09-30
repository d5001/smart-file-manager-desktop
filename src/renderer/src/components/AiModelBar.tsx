import { useMemo } from 'react';
import { catalogEntry } from '@shared/models';
import { useAppStore } from '../store/useAppStore';
import { messageTokens, useAgentStore } from '../store/useAgentStore';
import { Button, Segmented } from './ui';

/**
 * 对话区底部的模型控制条：模型 / 模型强度 / 上下文上限 + 上下文管理。
 *
 * 「模型强度」映射到 temperature —— 越"发散"模型越自由、越"稳健"越保守。
 * 对于会真的删文件的智能体，稳健档更安全，所以默认值是 0.7（均衡）。
 */
const STRENGTH = [
  { value: 'steady', label: '稳健', temp: 0.2 },
  { value: 'balanced', label: '均衡', temp: 0.7 },
  { value: 'wild', label: '发散', temp: 1.1 }
] as const;

/** 128000 → "128k"，1000000 → "1M" */
function formatWindow(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
  return `${Math.round(n / 1000)}k`;
}

export function AiModelBar({ showContext = true }: { showContext?: boolean }): JSX.Element | null {
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const clearContext = useAgentStore((s) => s.clearContext);
  const compactContext = useAgentStore((s) => s.compactContext);
  const messages = useAgentStore((s) => s.messages);

  const provider = settings?.providers.find((p) => p.id === settings.activeProviderId);
  const catalog = provider ? catalogEntry(provider.id) : undefined;

  /** 当前上下文已占用的估算 token（含 system 提示词） */
  const usedTokens = useMemo(() => messages.reduce((n, m) => n + messageTokens(m), 0), [messages]);

  /** 把"当前实际用的模型"也塞进候选里 —— 用户可能手填了一个不在推荐列表里的名字 */
  const models = useMemo(() => {
    const list = catalog?.modelOptions ?? [];
    const cur = provider?.model;
    return cur && !list.includes(cur) ? [cur, ...list] : list;
  }, [catalog, provider?.model]);

  if (!settings || !provider) return null;

  const patchProvider = (patch: { model?: string; temperature?: number }): void => {
    void saveSettings({
      providers: settings.providers.map((p) => (p.id === provider.id ? { ...p, ...patch } : p))
    });
  };

  // 温度是任意值，反查出最接近的档位显示
  const strength =
    STRENGTH.reduce((best, s) =>
      Math.abs(s.temp - provider.temperature) < Math.abs(best.temp - provider.temperature) ? s : best
    ) ?? STRENGTH[1];

  return (
    <div className="aimodel">
      <span className="aimodel__label">模型</span>
      <select
        className="select"
        style={{ maxWidth: 190 }}
        value={provider.model}
        onChange={(e) => patchProvider({ model: e.target.value })}
      >
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <span className="aimodel__label">模型强度</span>
      <Segmented
        value={strength.value}
        options={STRENGTH.map((s) => ({ value: s.value, label: s.label }))}
        onChange={(v) => {
          const hit = STRENGTH.find((s) => s.value === v);
          if (hit) patchProvider({ temperature: hit.temp });
        }}
      />

      {showContext ? (
        <>
          <div className="aimodel__spacer" />
          {/* 上下文窗口是"每个模型"的属性，去设置里改（这里是只读提示） */}
          <span className="aimodel__count" title="上下文窗口按模型在「设置 → AI 服务」里配置">
            窗口 {formatWindow(provider.contextWindow ?? 128000)} · 已用 ≈{usedTokens}
          </span>
          <Button size="sm" variant="soft" onClick={compactContext} title="把已完成的工作压成一条摘要，省 token">
            压缩
          </Button>
          <Button size="sm" variant="soft" onClick={clearContext} title="清空模型看到的历史（界面记录保留）">
            清空
          </Button>
        </>
      ) : null}
    </div>
  );
}
