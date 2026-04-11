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
