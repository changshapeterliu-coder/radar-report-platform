'use client';

import type { ContentBlock } from '@/types/report';

export default function BlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'heading':
      return (
        <h3 className="text-lg font-semibold text-[#232f3e] mt-8 mb-2">
          {block.text}
        </h3>
      );

    case 'narrative':
      return (
        <p className="text-[15px] leading-[1.85] text-gray-800">
          {block.text}
        </p>
      );

    case 'insight':
      return (
        <div className="border-l-2 border-[#ff9900] pl-4 py-1 my-4">
          {block.label && (
            <p className="text-xs text-[#ff9900] font-medium mb-1">{block.label}</p>
          )}
          <p className="text-[15px] leading-relaxed text-[#232f3e]">{block.text}</p>
        </div>
      );

    case 'quote':
      return (
        <blockquote className="border-l-2 border-gray-300 pl-4 py-1 my-4">
          <p className="text-[15px] leading-relaxed text-gray-700 italic">
            {block.quote}
          </p>
          {block.source && (
            <p className="mt-2 text-xs text-gray-500">— {block.source}</p>
          )}
        </blockquote>
      );

    case 'stat':
      return (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 my-5">
          {(block.stats ?? []).map((s, i) => (
            <div key={i} className="border-l-2 border-gray-300 pl-3 py-1">
              <p className="text-2xl font-bold text-[#232f3e]">{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      );

    case 'warning':
      return (
        <div className="border-l-2 border-red-400 pl-4 py-1 my-4">
          {block.label && (
            <p className="text-xs text-red-500 font-medium mb-1">{block.label}</p>
          )}
          <p className="text-[15px] leading-relaxed text-[#232f3e]">{block.text}</p>
        </div>
      );

    case 'recommendation':
      return (
        <div className="border-l-2 border-green-500 pl-4 py-1 my-4">
          {block.label && (
            <p className="text-xs text-green-600 font-medium mb-1">{block.label}</p>
          )}
          <p className="text-[15px] leading-relaxed text-[#232f3e]">{block.text}</p>
        </div>
      );

    case 'list':
      return (
        <ol className="space-y-1.5 text-[15px] text-gray-800 list-decimal list-inside marker:text-gray-400 my-4">
          {(block.items ?? []).map((item, i) => (
            <li key={i}>
              {item.title && <span className="font-medium">{item.title}</span>}
              {item.title && ' — '}
              {item.content}
              {item.meta && (
                <span className="text-xs text-gray-400 ml-1">{item.meta}</span>
              )}
            </li>
          ))}
        </ol>
      );

    default:
      return null;
  }
}
