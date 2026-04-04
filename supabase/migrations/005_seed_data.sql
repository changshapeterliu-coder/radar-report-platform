-- ============================================================
-- 005_seed_data.sql
-- Insert seed data
-- Run this script in the Supabase Dashboard SQL Editor
-- ============================================================

-- Default domain: Account Health
INSERT INTO domains (name, description)
VALUES (
  'Account Health',
  'Amazon 中国卖家账户健康领域，涵盖封号趋势分析、下架商品分析、教育方案矩阵、工具反馈等模块的雷达报告和热点新闻。'
);

-- Note: Admin user should be created via Supabase Auth Dashboard
-- 1. Go to Supabase Dashboard > Authentication > Users
-- 2. Click "Add user" and create the admin account with email/password
-- 3. After the user is created, the on_auth_user_created trigger will
--    auto-create a profile with role='team_member'
-- 4. Then run the following SQL to promote the user to admin:
--
--    UPDATE profiles SET role = 'admin' WHERE id = '<user-uuid>';
