import type { ReportContent } from './report';

export interface Database {
  public: {
    Tables: {
      domains: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          created_at?: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          role: 'team_member' | 'admin';
          language_preference: 'zh' | 'en';
          created_at: string;
        };
        Insert: {
          id: string;
          role?: 'team_member' | 'admin';
          language_preference?: 'zh' | 'en';
          created_at?: string;
        };
        Update: {
          id?: string;
          role?: 'team_member' | 'admin';
          language_preference?: 'zh' | 'en';
          created_at?: string;
        };
      };
      reports: {
        Row: {
          id: string;
          domain_id: string;
          created_by: string;
          title: string;
          type: 'regular' | 'topic';
          date_range: string;
          week_label: string | null;
          status: 'draft' | 'published';
          content: ReportContent;
          content_translated: ReportContent | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          domain_id: string;
          created_by: string;
          title: string;
          type: 'regular' | 'topic';
          date_range: string;
          week_label?: string | null;
          status?: 'draft' | 'published';
          content: ReportContent;
          content_translated?: ReportContent | null;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          domain_id?: string;
          created_by?: string;
          title?: string;
          type?: 'regular' | 'topic';
          date_range?: string;
          week_label?: string | null;
          status?: 'draft' | 'published';
          content?: ReportContent;
          content_translated?: ReportContent | null;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      news: {
        Row: {
          id: string;
          domain_id: string;
          created_by: string;
          title: string;
          summary: string | null;
          content: string;
          source_channel: string;
          is_pinned: boolean;
          published_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          domain_id: string;
          created_by: string;
          title: string;
          summary?: string | null;
          content: string;
          source_channel: string;
          is_pinned?: boolean;
          published_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          domain_id?: string;
          created_by?: string;
          title?: string;
          summary?: string | null;
          content?: string;
          source_channel?: string;
          is_pinned?: boolean;
          published_at?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          domain_id: string;
          type: 'report' | 'news';
          title: string;
          summary: string | null;
          reference_id: string;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          domain_id: string;
          type: 'report' | 'news';
          title: string;
          summary?: string | null;
          reference_id: string;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          domain_id?: string;
          type?: 'report' | 'news';
          title?: string;
          summary?: string | null;
          reference_id?: string;
          is_read?: boolean;
          created_at?: string;
        };
      };
      topic_rankings: {
        Row: {
          id: string;
          report_id: string;
          domain_id: string;
          module_index: number;
          topic_label: string;
          rank: number;
          week_label: string | null;
          raw_reason: string | null;
          raw_keywords: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          report_id: string;
          domain_id: string;
          module_index?: number;
          topic_label: string;
          rank: number;
          week_label?: string | null;
          raw_reason?: string | null;
          raw_keywords?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          report_id?: string;
          domain_id?: string;
          module_index?: number;
          topic_label?: string;
          rank?: number;
          week_label?: string | null;
          raw_reason?: string | null;
          raw_keywords?: string | null;
          created_at?: string;
        };
      };
      schedule_configs: {
        Row: {
          id: string;
          domain_id: string;
          enabled: boolean;
          cadence: 'weekly' | 'biweekly';
          day_of_week: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
          time_of_day: string;
          timezone: string;
          report_type: 'regular' | 'topic';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          domain_id: string;
          enabled?: boolean;
          cadence?: 'weekly' | 'biweekly';
          day_of_week?: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
          time_of_day?: string;
          timezone?: string;
          report_type?: 'regular' | 'topic';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          domain_id?: string;
          enabled?: boolean;
          cadence?: 'weekly' | 'biweekly';
          day_of_week?: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
          time_of_day?: string;
          timezone?: string;
          report_type?: 'regular' | 'topic';
          created_at?: string;
          updated_at?: string;
        };
      };
      prompt_templates: {
        Row: {
          id: string;
          domain_id: string;
          prompt_type:
            | 'engine_a_hot_radar'
            | 'engine_b_hot_radar'
            | 'shared_deep_dive'
            | 'synthesizer_prompt'
            | 'daily_scan_prompt'
            | 'daily_canonicalization_prompt';
          template_text: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          domain_id: string;
          prompt_type:
            | 'engine_a_hot_radar'
            | 'engine_b_hot_radar'
            | 'shared_deep_dive'
            | 'synthesizer_prompt'
            | 'daily_scan_prompt'
            | 'daily_canonicalization_prompt';
          template_text: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          domain_id?: string;
          prompt_type?:
            | 'engine_a_hot_radar'
            | 'engine_b_hot_radar'
            | 'shared_deep_dive'
            | 'synthesizer_prompt'
            | 'daily_scan_prompt'
            | 'daily_canonicalization_prompt';
          template_text?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      scheduled_runs: {
        Row: {
          id: string;
          domain_id: string;
          trigger_type: 'scheduled' | 'manual';
          status: 'queued' | 'running' | 'succeeded' | 'failed' | 'partial';
          coverage_window_start: string;
          coverage_window_end: string;
          week_label: string;
          draft_report_id: string | null;
          failure_reason: string | null;
          gemini_output: unknown | null;
          kimi_output: unknown | null;
          synthesizer_output: unknown | null;
          duration_ms: number | null;
          triggered_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          domain_id: string;
          trigger_type: 'scheduled' | 'manual';
          status?: 'queued' | 'running' | 'succeeded' | 'failed' | 'partial';
          coverage_window_start: string;
          coverage_window_end: string;
          week_label: string;
          draft_report_id?: string | null;
          failure_reason?: string | null;
          gemini_output?: unknown | null;
          kimi_output?: unknown | null;
          synthesizer_output?: unknown | null;
          duration_ms?: number | null;
          triggered_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          domain_id?: string;
          trigger_type?: 'scheduled' | 'manual';
          status?: 'queued' | 'running' | 'succeeded' | 'failed' | 'partial';
          coverage_window_start?: string;
          coverage_window_end?: string;
          week_label?: string;
          draft_report_id?: string | null;
          failure_reason?: string | null;
          gemini_output?: unknown | null;
          kimi_output?: unknown | null;
          synthesizer_output?: unknown | null;
          duration_ms?: number | null;
          triggered_at?: string;
          completed_at?: string | null;
        };
      };
      // ══════════ Daily Hot-Topic Alert feature (spec: daily-hot-topic-alert) ══════════
      // Added by migration 015. See `.kiro/specs/daily-hot-topic-alert/design.md` §数据模型.
      // `src/types/daily-alert.ts` carries the business-layer companion types.

      daily_alert_configs: {
        Row: {
          id: string;
          domain_id: string;
          enabled: boolean;
          time_of_day: string;           // 'HH:MM' Asia/Shanghai
          timezone: 'Asia/Shanghai';      // V1 pinned
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          domain_id: string;
          enabled?: boolean;
          time_of_day?: string;
          timezone?: 'Asia/Shanghai';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          domain_id?: string;
          enabled?: boolean;
          time_of_day?: string;
          timezone?: 'Asia/Shanghai';
          created_at?: string;
          updated_at?: string;
        };
      };
      daily_alert_runs: {
        Row: {
          id: string;
          domain_id: string;
          trigger_type: 'scheduled' | 'manual';
          status: 'queued' | 'running' | 'succeeded' | 'failed';
          coverage_window_start_date: string; // 'YYYY-MM-DD' Asia/Shanghai
          coverage_window_start: string;      // ISO timestamptz
          coverage_window_end: string;        // ISO timestamptz
          produced_alert_id: string | null;
          topic_count: number | null;
          new_canonical_count: number | null;
          failure_reason: string | null;
          raw_output: string | null;          // truncated to ~500 chars
          triggered_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          domain_id: string;
          trigger_type: 'scheduled' | 'manual';
          status?: 'queued' | 'running' | 'succeeded' | 'failed';
          coverage_window_start_date: string;
          coverage_window_start: string;
          coverage_window_end: string;
          produced_alert_id?: string | null;
          topic_count?: number | null;
          new_canonical_count?: number | null;
          failure_reason?: string | null;
          raw_output?: string | null;
          triggered_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          domain_id?: string;
          trigger_type?: 'scheduled' | 'manual';
          status?: 'queued' | 'running' | 'succeeded' | 'failed';
          coverage_window_start_date?: string;
          coverage_window_start?: string;
          coverage_window_end?: string;
          produced_alert_id?: string | null;
          topic_count?: number | null;
          new_canonical_count?: number | null;
          failure_reason?: string | null;
          raw_output?: string | null;
          triggered_at?: string;
          completed_at?: string | null;
        };
      };
      daily_hot_topic_alerts: {
        Row: {
          id: string;
          domain_id: string;
          run_id: string;
          coverage_window_start_date: string;
          status: 'published';                 // CHECK-enforced literal
          empty_day_message_zh: string | null;
          empty_day_message_en: string | null;
          published_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          domain_id: string;
          run_id: string;
          coverage_window_start_date: string;
          status?: 'published';
          empty_day_message_zh?: string | null;
          empty_day_message_en?: string | null;
          published_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          domain_id?: string;
          run_id?: string;
          coverage_window_start_date?: string;
          status?: 'published';
          empty_day_message_zh?: string | null;
          empty_day_message_en?: string | null;
          published_at?: string;
          created_at?: string;
        };
      };
      daily_hot_topics: {
        Row: {
          id: string;
          alert_id: string;
          domain_id: string;                   // denormalized for composite FK
          topic_name_zh: string;
          topic_name_en: string | null;
          keywords: string[];                  // JSONB array
          sample_quotes: Array<{ text: string; source_label: string }>;
          source_links: Array<{
            title: string;
            url: string;
            source_label: string;
            published_date: string | null;
          }>;
          hot_score: number;                   // CHECK 0..100
          summary_zh: string;
          summary_en: string | null;
          rank: number;                        // CHECK 1..10
          canonical_topic_key: string;         // FK tuple with domain_id → topic_canonicals
          is_new_canonical: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          alert_id: string;
          domain_id: string;
          topic_name_zh: string;
          topic_name_en?: string | null;
          keywords: string[];
          sample_quotes: Array<{ text: string; source_label: string }>;
          source_links: Array<{
            title: string;
            url: string;
            source_label: string;
            published_date: string | null;
          }>;
          hot_score: number;
          summary_zh: string;
          summary_en?: string | null;
          rank: number;
          canonical_topic_key: string;
          is_new_canonical: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          alert_id?: string;
          domain_id?: string;
          topic_name_zh?: string;
          topic_name_en?: string | null;
          keywords?: string[];
          sample_quotes?: Array<{ text: string; source_label: string }>;
          source_links?: Array<{
            title: string;
            url: string;
            source_label: string;
            published_date: string | null;
          }>;
          hot_score?: number;
          summary_zh?: string;
          summary_en?: string | null;
          rank?: number;
          canonical_topic_key?: string;
          is_new_canonical?: boolean;
          created_at?: string;
        };
      };
      topic_canonicals: {
        Row: {
          id: string;
          domain_id: string;
          canonical_topic_key: string;
          canonical_title_zh: string;
          canonical_title_en: string | null;
          canonical_description_zh: string;
          canonical_description_en: string | null;
          category_slug: string;
          secondary_axis_type: 'site' | 'category' | null;
          secondary_axis_value: string | null;
          first_seen_date: string;
          last_seen_date: string;
          seen_count: number;
          origin: 'daily_alert';               // V1 literal — widened by future spec
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          domain_id: string;
          canonical_topic_key: string;
          canonical_title_zh: string;
          canonical_title_en?: string | null;
          canonical_description_zh: string;
          canonical_description_en?: string | null;
          category_slug: string;
          secondary_axis_type?: 'site' | 'category' | null;
          secondary_axis_value?: string | null;
          first_seen_date: string;
          last_seen_date: string;
          seen_count?: number;
          origin?: 'daily_alert';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          domain_id?: string;
          canonical_topic_key?: string;
          canonical_title_zh?: string;
          canonical_title_en?: string | null;
          canonical_description_zh?: string;
          canonical_description_en?: string | null;
          category_slug?: string;
          secondary_axis_type?: 'site' | 'category' | null;
          secondary_axis_value?: string | null;
          first_seen_date?: string;
          last_seen_date?: string;
          seen_count?: number;
          origin?: 'daily_alert';
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Functions: {
      search_reports: {
        Args: {
          search_query: string;
          domain_filter: string;
        };
        Returns: Database['public']['Tables']['reports']['Row'][];
      };
    };
  };
}
