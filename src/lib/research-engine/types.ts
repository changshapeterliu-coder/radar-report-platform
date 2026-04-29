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
  EducationOpportunity,
  EngineAssembledContent,
  EngineError,
  EngineErrorClass,
  EngineLoopTrace,
  HotRadarModuleKey,
  HotRadarOutput,
  HotRadarTopic,
  LoopStage,
  PromptKey,
  ResearchEngineInput,
  ResearchEngineOutput,
  ToolFeedbackItem,
} from '@/types/scheduled-runs';

export { CHANNEL_WEIGHT, HOT_RADAR_MODULE_KEYS } from '@/types/scheduled-runs';
