'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Login page.
 *
 * Design refs:
 * - ui-design-system.md sec 9.1 (page header), sec 4.5 (form inputs),
 *   sec 11 anti-pattern 7 ("Outline-heavy forms — modern SaaS uses
 *   single-border inputs on a white card")
 * - power design-guidelines.md sec 3.13 Trust and Motivation (login is a
 *   trust-sensitive surface — polish, clear affordances, no noise)
 *
 * Preserved verbatim (the test suite pins these):
 * - Exact labels 邮箱 / 密码
 * - Button text 登录 / 登录中... on submit state
 * - Error message strings for all three failure branches
 * - Heading 'Radar Report Platform'
 */
export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error: signInError } = await signIn(email, password);

      if (signInError) {
        if (signInError.toLowerCase().includes('rate')) {
          setError('登录尝试过多，请稍后再试');
        } else {
          setError('邮箱或密码错误');
        }
        return;
      }

      router.push('/dashboard');
    } catch {
      setError('服务暂时不可用，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Brand mark — no card wrapper (modern SaaS: put the mark on the
            background, not behind chrome). The form sits as a separate card
            beneath it. */}
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-primary">
            Radar Report Platform
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">
            登录以进入您的雷达报告平台
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          {error && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-md border border-danger/20 bg-danger-bg px-3 py-2.5 text-sm text-danger-fg"
            >
              <AlertCircle
                className="mt-0.5 h-4 w-4 flex-shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-medium text-foreground"
              >
                邮箱
              </label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="请输入邮箱"
                disabled={loading}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-foreground"
              >
                密码
              </label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                disabled={loading}
              />
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? '登录中...' : '登录'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
