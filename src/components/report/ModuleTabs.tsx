'use client';

export interface ModuleTabsProps {
  titles: string[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

export default function ModuleTabs({ titles, activeIndex, onSelect }: ModuleTabsProps) {
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {titles.map((title, i) => {
          const isActive = i === activeIndex;
          return (
            <button
              key={i}
              onClick={() => onSelect(i)}
              className={`px-5 py-2 rounded-t text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-[#f2f3f3] text-[#232f3e] font-bold'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {title}
            </button>
          );
        })}
      </div>
    </div>
  );
}
