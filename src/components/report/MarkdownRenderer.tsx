'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { ReactNode } from 'react';

/**
 * MarkdownRenderer — the v4 content body renderer.
 *
 * Parses Markdown (GFM-flavoured) to HTML, with three extensions:
 *
 * 1. GitHub-style admonition blockquotes:
 *    > [!INSIGHT]
 *    > ...key takeaway text...
 *
 *    Supported types: INSIGHT / WARNING / RECOMMENDATION / STAT / QUOTE.
 *    Each renders with a colored left-border + label header, matching the
 *    v3 block styles we had in the old JSON-block renderer.
 *
 * 2. Unicode emoji severity badges render as-is (🔴 高 / 🟡 中 / 🔵 低).
 *    Our Assembler prompt is the one that decides to emit these.
 *
 * 3. Raw HTML is allowed but sanitized — AI-produced HTML is therefore
 *    safe to render. This lets the Assembler use inline
 *    <span class="badge-high">...</span> if it wants to, without XSS risk.
 */

type CalloutType = 'insight' | 'warning' | 'recommendation' | 'stat' | 'quote';

const CALLOUT_COLORS: Record<CalloutType, {
  border: string;
  label: string;
  icon: string;
}> = {
  insight: { border: 'border-[#ff9900]', label: 'text-[#ff9900]', icon: '💡' },
  warning: { border: 'border-red-400', label: 'text-red-500', icon: '⚠️' },
  recommendation: { border: 'border-green-500', label: 'text-green-600', icon: '✅' },
  stat: { border: 'border-[#146eb4]', label: 'text-[#146eb4]', icon: '📊' },
  quote: { border: 'border-gray-300', label: 'text-gray-500', icon: '💬' },
};

const CALLOUT_LABELS: Record<CalloutType, string> = {
  insight: '核心洞察',
  warning: '风险提示',
  recommendation: '建议行动',
  stat: '量化观察',
  quote: '卖家原声',
};

// rehype-sanitize schema: allow our custom admonition + GFM table classes.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className'],
    span: [...(defaultSchema.attributes?.span ?? []), 'className'],
    div: [...(defaultSchema.attributes?.div ?? []), 'className'],
  },
};

/**
 * Custom blockquote renderer: detects `[!TYPE]` admonition header as the
 * first line and branches to a colored callout. Falls back to a plain
 * styled blockquote for regular `>` usage.
 */
function BlockquoteRenderer({ children }: { children?: ReactNode }) {
  const info = extractAdmonitionType(children);
  if (info) {
    const palette = CALLOUT_COLORS[info.type];
    return (
      <div className={`border-l-2 ${palette.border} pl-4 py-1 my-4`}>
        <p className={`text-xs font-medium mb-1 ${palette.label}`}>
          {palette.icon} {CALLOUT_LABELS[info.type]}
        </p>
        <div className="text-[15px] leading-relaxed text-[#232f3e] space-y-1">
          {info.rest}
        </div>
      </div>
    );
  }
  return (
    <blockquote className="border-l-2 border-gray-300 pl-4 py-1 my-4 text-gray-700 italic">
      {children}
    </blockquote>
  );
}

/**
 * Walks the first-paragraph children of a blockquote looking for a
 * literal "[!TYPE]" token. If found, returns the type + the rest of the
 * quote content (with the admonition tag stripped).
 *
 * ReactMarkdown renders `> [!INSIGHT]` as:
 *   <blockquote><p>[!INSIGHT]\n...rest...</p></blockquote>
 * so we inspect children[0].props.children[0] as a string.
 */
function extractAdmonitionType(
  children: ReactNode
): { type: CalloutType; rest: ReactNode } | null {
  const arr = Array.isArray(children) ? children : [children];
  // The blockquote's first real child is typically a <p> element.
  const firstParaIdx = arr.findIndex(
    (n) =>
      n !== null &&
      typeof n === 'object' &&
      'type' in (n as Record<string, unknown>)
  );
  if (firstParaIdx === -1) return null;
  const firstPara = arr[firstParaIdx] as {
    type: unknown;
    props?: { children?: ReactNode };
  };
  const paraChildren = firstPara.props?.children;
  const paraArr = Array.isArray(paraChildren) ? paraChildren : [paraChildren];
  const firstText = paraArr[0];
  if (typeof firstText !== 'string') return null;
  const match = /^\s*\[!(INSIGHT|WARNING|RECOMMENDATION|STAT|QUOTE)\]\s*/i.exec(
    firstText
  );
  if (!match) return null;
  const type = match[1].toLowerCase() as CalloutType;
  const stripped = firstText.slice(match[0].length);
  // Rebuild the first paragraph without the admonition tag, preserving
  // any other inline children (e.g. bold, links).
  const newFirstPara = {
    ...firstPara,
    props: {
      ...firstPara.props,
      children: stripped ? [stripped, ...paraArr.slice(1)] : paraArr.slice(1),
    },
  } as typeof firstPara;
  const rest = [...arr.slice(0, firstParaIdx), newFirstPara, ...arr.slice(firstParaIdx + 1)];
  return { type, rest };
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-bold text-[#232f3e] mt-8 mb-3">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-bold text-[#232f3e] mt-7 mb-3">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-semibold text-[#232f3e] mt-6 mb-2">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-semibold text-[#232f3e] mt-4 mb-2">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="text-[15px] leading-[1.85] text-gray-800 my-3">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc list-outside pl-5 space-y-1.5 text-[15px] text-gray-800 my-3 marker:text-gray-400">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-outside pl-5 space-y-1.5 text-[15px] text-gray-800 my-3 marker:text-gray-400">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#146eb4] hover:underline"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[#232f3e]">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-gray-700">{children}</em>,
  code: ({ children }) => (
    <code className="bg-gray-100 rounded px-1 py-0.5 text-[13px] font-mono text-[#232f3e]">
      {children}
    </code>
  ),
  hr: () => <hr className="my-6 border-gray-200" />,
  blockquote: BlockquoteRenderer,
  // GFM tables
  table: ({ children }) => (
    <div className="my-5 rounded-lg overflow-hidden border border-gray-200">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
  th: ({ children }) => (
    <th className="text-left px-4 py-3 font-semibold text-[#232f3e] border-b border-gray-200">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-3 border-b border-gray-100 text-gray-800">{children}</td>
  ),
  tr: ({ children }) => <tr className="hover:bg-gray-50/50">{children}</tr>,
};

export interface MarkdownRendererProps {
  /** Raw Markdown source. Safe even if empty. */
  source: string;
  /** Optional className for the outer wrapper. */
  className?: string;
}

export default function MarkdownRenderer({
  source,
  className,
}: MarkdownRendererProps) {
  if (!source || source.trim().length === 0) {
    return (
      <p className="text-sm text-gray-400 italic text-center py-8">
        本周该模块暂无显著发现 / No notable findings this period
      </p>
    );
  }
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
