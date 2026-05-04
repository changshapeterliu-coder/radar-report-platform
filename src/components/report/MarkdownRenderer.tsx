'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Lightbulb,
  AlertTriangle,
  CheckCircle2,
  BarChart3,
  Quote as QuoteIcon,
} from 'lucide-react';

/**
 * MarkdownRenderer — the v4 content body renderer.
 *
 * Parses Markdown (GFM-flavoured) to HTML with three extensions:
 *
 * 1. GitHub-style admonition blockquotes render as colored callouts:
 *      > [!INSIGHT]
 *      > ...key takeaway text...
 *
 *    Types: INSIGHT / WARNING / RECOMMENDATION / STAT / QUOTE.
 *
 * 2. Typography uses our tokens (ui-design-system.md sec 1) and bilingual
 *    line-height rules (sec 2.2 Chinese paragraphs get leading-relaxed).
 *
 * 3. Raw HTML is allowed but sanitized — AI-produced inline spans stay safe.
 */

type CalloutType = 'insight' | 'warning' | 'recommendation' | 'stat' | 'quote';

interface CalloutPalette {
  containerClass: string;
  labelClass: string;
  Icon: typeof Lightbulb;
}

// Icons replace the emoji from the earlier version (ui-design-system sec 4.4).
const CALLOUT_PALETTE: Record<CalloutType, CalloutPalette> = {
  insight: {
    containerClass: 'border-primary bg-primary-soft/40',
    labelClass: 'text-primary',
    Icon: Lightbulb,
  },
  warning: {
    containerClass: 'border-danger bg-danger-bg',
    labelClass: 'text-danger-fg',
    Icon: AlertTriangle,
  },
  recommendation: {
    containerClass: 'border-success bg-success-bg',
    labelClass: 'text-success-fg',
    Icon: CheckCircle2,
  },
  stat: {
    containerClass: 'border-info bg-info-bg',
    labelClass: 'text-info-fg',
    Icon: BarChart3,
  },
  quote: {
    containerClass: 'border-border-strong',
    labelClass: 'text-foreground-subtle',
    Icon: QuoteIcon,
  },
};

const CALLOUT_LABEL_KEYS: Record<CalloutType, string> = {
  insight: 'report.callout.insight',
  warning: 'report.callout.warning',
  recommendation: 'report.callout.recommendation',
  stat: 'report.callout.stat',
  quote: 'report.callout.quote',
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

function BlockquoteRenderer({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const info = extractAdmonitionType(children);
  if (info) {
    const palette = CALLOUT_PALETTE[info.type];
    const Icon = palette.Icon;
    return (
      <div
        className={`my-4 rounded-md border-l-2 py-2 pl-4 ${palette.containerClass}`}
      >
        <p
          className={`mb-1 flex items-center gap-1.5 text-xs font-medium ${palette.labelClass}`}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          {t(CALLOUT_LABEL_KEYS[info.type])}
        </p>
        <div className="space-y-1 text-[15px] leading-relaxed text-foreground">
          {info.rest}
        </div>
      </div>
    );
  }
  return (
    <blockquote className="my-4 border-l-2 border-border-strong py-1 pl-4 italic text-foreground-muted">
      {children}
    </blockquote>
  );
}

/**
 * Walks the first-paragraph children of a blockquote looking for a
 * literal "[!TYPE]" token. If found, returns the type + the rest of the
 * quote content (with the admonition tag stripped).
 */
function extractAdmonitionType(
  children: ReactNode
): { type: CalloutType; rest: ReactNode } | null {
  const arr = Array.isArray(children) ? children : [children];
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
  const newFirstPara = {
    ...firstPara,
    props: {
      ...firstPara.props,
      children: stripped ? [stripped, ...paraArr.slice(1)] : paraArr.slice(1),
    },
  } as typeof firstPara;
  const rest = [
    ...arr.slice(0, firstParaIdx),
    newFirstPara,
    ...arr.slice(firstParaIdx + 1),
  ];
  return { type, rest };
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-8 mb-3 text-2xl font-semibold text-foreground">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-7 mb-3 text-xl font-semibold text-foreground">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 mb-2 text-lg font-semibold text-foreground">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-4 mb-2 text-base font-semibold text-foreground">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="my-3 text-[15px] leading-[1.85] text-foreground">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="my-3 list-outside list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-foreground marker:text-foreground-subtle">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-outside list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed text-foreground marker:text-foreground-subtle">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-info hover:underline"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-foreground-muted">{children}</em>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[13px] text-foreground">
      {children}
    </code>
  ),
  hr: () => <hr className="my-6 border-border" />,
  blockquote: BlockquoteRenderer,
  // GFM tables
  table: ({ children }) => (
    <div className="my-5 overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/40">{children}</thead>
  ),
  th: ({ children }) => (
    <th
      scope="col"
      className="border-b border-border px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted"
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border px-4 py-3 text-foreground">
      {children}
    </td>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-muted/40">{children}</tr>
  ),
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
  const { t } = useTranslation();
  if (!source || source.trim().length === 0) {
    return (
      <p className="py-8 text-center text-sm italic text-foreground-subtle">
        {t('report.emptyModule')}
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
