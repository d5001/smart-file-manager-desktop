import type { JSX, ReactNode } from 'react';
import { Fragment } from 'react';

/**
 * 轻量 Markdown 渲染器。
 * 不引入第三方依赖，也不使用 dangerouslySetInnerHTML，避免 XSS 与打包体积。
 */

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\n]+\*)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE_RE).filter((p) => p !== '');
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (/^`[^`]+`$/.test(part)) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if (/^\*[^*\n]+\*$/.test(part)) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      return (
        <a key={key} href={link[2]} target="_blank" rel="noreferrer noopener">
          {link[1]}
        </a>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function isDivider(line: string): boolean {
  return /^\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');
}

export function Markdown({ text }: { text: string }): JSX.Element {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const nextKey = (): string => `md-${key++}`;

  while (i < lines.length) {
    const line = lines[i];

    /* 代码块 */
    if (/^\s*```/.test(line)) {
      const lang = line.trim().slice(3).trim();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre key={nextKey()} data-lang={lang}>
          <code>{code.join('\n')}</code>
        </pre>
      );
      continue;
    }

    /* 标题 */
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2], nextKey());
      if (level === 1) blocks.push(<h1 key={nextKey()}>{content}</h1>);
      else if (level === 2) blocks.push(<h2 key={nextKey()}>{content}</h2>);
      else blocks.push(<h3 key={nextKey()}>{content}</h3>);
      i += 1;
      continue;
    }

    /* 分隔线 */
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={nextKey()} />);
      i += 1;
      continue;
    }

    /* 表格 */
    if (line.trim().startsWith('|') && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <table key={nextKey()}>
          <thead>
            <tr>
              {header.map((h, hi) => (
                <th key={hi}>{renderInline(h, `th-${hi}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci}>{renderInline(c, `td-${ri}-${ci}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }

    /* 引用 */
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push(<blockquote key={nextKey()}>{renderInline(quote.join(' '), nextKey())}</blockquote>);
      continue;
    }

    /* 无序列表 */
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={nextKey()}>
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `li-${ii}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    /* 有序列表 */
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={nextKey()}>
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `oli-${ii}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    /* 空行 */
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    /* 段落 */
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*(#{1,6}\s|```|>|[-*+]\s|\d+[.)]\s|\|)/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }

    // 防御性推进：流式输出时表格可能只到达一半（有 | 表头但分隔行还没来），
    // 此时上面的分支都不会消费该行，必须强制前进，否则会死循环卡死渲染进程。
    if (para.length === 0) {
      para.push(lines[i]);
      i += 1;
    }

    blocks.push(<p key={nextKey()}>{renderInline(para.join(' '), nextKey())}</p>);
  }

  return <div className="md">{blocks}</div>;
}
