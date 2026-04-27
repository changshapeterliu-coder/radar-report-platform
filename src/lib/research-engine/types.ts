// Re-export types from the shared scheduled-runs types file.
// The research-engine folder is intentionally import-isolated from
// business code (Supabase clients, Inngest SDK, db types). It may
// only import from @/types/report (ReportContent) and this local
// types file (which transitively pulls from @/types/scheduled-runs,
// which itself depends on @/types/report only).
export type {
  ChannelType,
  CoverageWindow,
  DeepDiveOutput,
  EngineError,
  EngineErrorClass,
  EngineLoopTrace,
  LoopStage,
  ModuleKey,
  ResearchEngineInput,
  ResearchEngineOutput,
  Top5Entry,
  Top5RankerOutput,
} from '@/types/scheduled-runs';

export { CHANNEL_WEIGHT, MODULE_KEYS } from '@/types/scheduled-runs';
