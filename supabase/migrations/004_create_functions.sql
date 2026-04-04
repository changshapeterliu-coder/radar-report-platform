-- ============================================================
-- 004_create_functions.sql
-- Create RPC functions (full-text search)
-- Run this script in the Supabase Dashboard SQL Editor
-- ============================================================

-- Full-text search function for reports
CREATE OR REPLACE FUNCTION search_reports(search_query TEXT, domain_filter UUID)
RETURNS SETOF reports AS $$
  SELECT * FROM reports
  WHERE domain_id = domain_filter
    AND status = 'published'
    AND search_vector @@ plainto_tsquery('english', search_query)
  ORDER BY ts_rank(search_vector, plainto_tsquery('english', search_query)) DESC;
$$ LANGUAGE sql STABLE;
