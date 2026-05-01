import type { TopTopic } from '@/types/report';

/**
 * TopTopicsTable — structured Top-N summary table rendered directly from
 * TopTopic[] (v4 schema), not from AI-produced table JSON.
 *
 * Columns (fixed):
 *   Rank / Topic / 热度 (Voice Volume) / Keywords / 卖家讨论 / 严重度
 *
 * Rank column respects the `cross_engine_confirmed` hint:
 *   - rank "1 ✓" renders bold + green tick (cross-engine)
 *   - rank "1"    renders normal (single-engine observation)
 */

const SEVERITY_STYLES: Record<TopTopic['severity'], {
  label: string;
  className: string;
}> = {
  high: {
    label: '高',
    className: 'bg-red-50 text-red-700 border-red-200',
  },
  medium: {
    label: '中',
    className: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  },
  low: {
    label: '低',
    className: 'bg-blue-50 text-[#146eb4] border-blue-200',
  },
};

function RankBadge({
  rank,
  confirmed,
}: {
  rank: string;
  confirmed: boolean | undefined;
}) {
  if (confirmed) {
    return (
      <span className="font-bold text-[#232f3e]">
        {rank.replace(/\s*✓\s*/, '')} <span className="text-green-600">✓</span>
      </span>
    );
  }
  return <span className="text-gray-700">{rank}</span>;
}

export interface TopTopicsTableProps {
  topics: TopTopic[];
  /** Table heading — optional. */
  caption?: string;
}

export default function TopTopicsTable({ topics, caption }: TopTopicsTableProps) {
  if (!topics || topics.length === 0) return null;
  return (
    <div className="my-5 rounded-lg overflow-hidden border border-gray-200">
      {caption && (
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 text-sm font-semibold text-[#232f3e]">
          {caption}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left px-4 py-3 font-semibold text-[#232f3e] border-b border-gray-200 w-16">
                Rank
              </th>
              <th className="text-left px-4 py-3 font-semibold text-[#232f3e] border-b border-gray-200">
                Topic
              </th>
              <th className="text-left px-4 py-3 font-semibold text-[#232f3e] border-b border-gray-200 w-20">
                热度
              </th>
              <th className="text-left px-4 py-3 font-semibold text-[#232f3e] border-b border-gray-200">
                Keywords
              </th>
              <th className="text-left px-4 py-3 font-semibold text-[#232f3e] border-b border-gray-200">
                卖家讨论
              </th>
              <th className="text-left px-4 py-3 font-semibold text-[#232f3e] border-b border-gray-200 w-20">
                严重度
              </th>
            </tr>
          </thead>
          <tbody>
            {topics.map((t, i) => {
              const sev = SEVERITY_STYLES[t.severity];
              return (
                <tr key={i} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 border-b border-gray-100">
                    <RankBadge rank={t.rank} confirmed={t.cross_engine_confirmed} />
                  </td>
                  <td className="px-4 py-3 border-b border-gray-100 text-gray-800 font-medium">
                    {t.topic}
                  </td>
                  <td className="px-4 py-3 border-b border-gray-100 text-gray-800">
                    {t.voice_volume.toFixed(1)}
                  </td>
                  <td className="px-4 py-3 border-b border-gray-100 text-gray-700 text-xs">
                    {t.keywords.join('、')}
                  </td>
                  <td className="px-4 py-3 border-b border-gray-100 text-gray-800">
                    {t.seller_discussion}
                  </td>
                  <td className="px-4 py-3 border-b border-gray-100">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium border ${sev.className}`}
                    >
                      {sev.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
