'use client';

import { Lightbulb, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { ContentBlock } from '@/types/report';

/**
 * Renders a single ContentBlock from the v4 schema.
 *
 * Design refs:
 * - ui-design-system.md sec 1 (tokens), sec 2.2 (Chinese leading-relaxed)
 * - power design-guidelines.md sec 6.2 Emphasis (sparingly)
 */

export default function BlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'heading':
      return (
        <h3 className="mt-8 mb-2 text-lg font-semibold text-foreground">
          {block.text}
        </h3>
      );

    case 'narrative':
      return (
        <p className="text-[15px] leading-[1.85] text-foreground">
          {block.text}
        </p>
      );

    case 'insight':
      return (
        <div className="my-4 rounded-md border-l-2 border-primary bg-primary-soft/40 py-2 pl-4">
          {block.label && (
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
              <Lightbulb className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              {block.label}
            </p>
          )}
          <p className="text-[15px] leading-relaxed text-foreground">
            {block.text}
          </p>
        </div>
      );

    case 'quote':
      return (
        <blockquote className="my-4 border-l-2 border-border-strong py-1 pl-4">
          <p className="text-[15px] leading-relaxed italic text-foreground-muted">
            {block.quote}
          </p>
          {block.source && (
            <p className="mt-2 text-xs text-foreground-subtle">
              — {block.source}
            </p>
          )}
        </blockquote>
      );

    case 'stat':
      return (
        <div className="my-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {(block.stats ?? []).map((s, i) => (
            <div
              key={i}
              className="border-l-2 border-border-strong py-1 pl-3"
            >
              <p className="text-2xl font-semibold text-foreground">{s.value}</p>
              <p className="mt-0.5 text-xs text-foreground-muted">{s.label}</p>
            </div>
          ))}
        </div>
      );

    case 'warning':
      return (
        <div className="my-4 rounded-md border-l-2 border-danger bg-danger-bg py-2 pl-4">
          {block.label && (
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-danger-fg">
              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              {block.label}
            </p>
          )}
          <p className="text-[15px] leading-relaxed text-foreground">
            {block.text}
          </p>
        </div>
      );

    case 'recommendation':
      return (
        <div className="my-4 rounded-md border-l-2 border-success bg-success-bg py-2 pl-4">
          {block.label && (
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-success-fg">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              {block.label}
            </p>
          )}
          <p className="text-[15px] leading-relaxed text-foreground">
            {block.text}
          </p>
        </div>
      );

    case 'list':
      return (
        <ol className="my-4 list-inside list-decimal space-y-1.5 text-[15px] leading-relaxed text-foreground marker:text-foreground-subtle">
          {(block.items ?? []).map((item, i) => (
            <li key={i}>
              {item.title && (
                <span className="font-medium">{item.title}</span>
              )}
              {item.title && ' — '}
              {item.content}
              {item.meta && (
                <span className="ml-1 text-xs text-foreground-subtle">
                  {item.meta}
                </span>
              )}
            </li>
          ))}
        </ol>
      );

    default:
      return null;
  }
}
