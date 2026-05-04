'use client';

import { useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Report topic request form.
 *
 * Design refs:
 * - ui-design-system.md sec 4.5 (form inputs), 9.1 (page header)
 * - power design-guidelines.md 4.1 Labeling, 4.4 Field Design, 3.5 Error Recovery
 *
 * Fixed along the way: an orphan text node rendering outside the form,
 * an unused fetch response variable, and a deprecated FormEvent import.
 */

const MARKETPLACES = [
  'WW (Worldwide)',
  'US',
  'CA',
  'MX',
  'BR',
  'UK',
  'DE',
  'FR',
  'IT',
  'ES',
  'NL',
  'SE',
  'PL',
  'JP',
  'AU',
  'SG',
  'IN',
  'AE',
  'SA',
  'TR',
];

const SELLER_ORIGINS = [
  'CN (China)',
  'US',
  'UK',
  'DE',
  'JP',
  'IN',
  'KR',
  'WW (All Origins)',
  'Other',
];

type Status = 'idle' | 'submitting' | 'success' | 'error';

export default function RequestPage() {
  const { user } = useAuth();

  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [marketplace, setMarketplace] = useState('WW (Worldwide)');
  const [sellerOrigin, setSellerOrigin] = useState('CN (China)');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!topic.trim()) return;

    setStatus('submitting');
    setErrorMessage('');

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          description: description.trim() || undefined,
          marketplace,
          sellerOrigin,
        }),
      });
      if (!res.ok) {
        throw new Error(`Submit failed (${res.status})`);
      }
      setStatus('success');
      setTopic('');
      setDescription('');
      setMarketplace('WW (Worldwide)');
      setSellerOrigin('CN (China)');
    } catch (err) {
      setStatus('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'Something went wrong'
      );
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">
          Request a Report Topic
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Have a topic you&apos;d like us to cover? Submit your request below
          and our team will review it.
        </p>
      </div>

      {status === 'success' ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-success/20 bg-success-bg p-8 text-center">
          <CheckCircle2
            className="mb-3 h-10 w-10 text-success"
            strokeWidth={1.75}
          />
          <h2 className="text-base font-semibold text-success-fg">
            Request Submitted
          </h2>
          <p className="mt-1 text-sm text-success-fg/80">
            Your report topic request has been sent to the admin team.
          </p>
          <Button
            variant="outline"
            className="mt-6"
            onClick={() => setStatus('idle')}
          >
            Submit Another Request
          </Button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-border bg-card p-6 shadow-sm"
        >
          {status === 'error' && (
            <div className="mb-4 rounded-md border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger-fg">
              {errorMessage}
            </div>
          )}

          <div className="mb-5">
            <label
              htmlFor="topic"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Topic <span className="text-danger">*</span>
            </label>
            <Input
              id="topic"
              type="text"
              required
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g., Account Health Dashboard Changes in Q2"
            />
          </div>

          <div className="mb-5">
            <label
              htmlFor="description"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Description{' '}
              <span className="text-foreground-subtle">(optional)</span>
            </label>
            <textarea
              id="description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide additional context or specific areas you'd like covered..."
              className={cn(
                'flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle',
                'transition-colors resize-y',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:border-border-strong',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            />
          </div>

          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="marketplace"
                className="mb-1.5 block text-sm font-medium text-foreground"
              >
                Marketplace
              </label>
              <Select
                id="marketplace"
                value={marketplace}
                onChange={(e) => setMarketplace(e.target.value)}
              >
                {MARKETPLACES.map((mp) => (
                  <option key={mp} value={mp}>
                    {mp}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label
                htmlFor="sellerOrigin"
                className="mb-1.5 block text-sm font-medium text-foreground"
              >
                Seller Origin
              </label>
              <Select
                id="sellerOrigin"
                value={sellerOrigin}
                onChange={(e) => setSellerOrigin(e.target.value)}
              >
                {SELLER_ORIGINS.map((so) => (
                  <option key={so} value={so}>
                    {so}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="mb-5 rounded-md bg-muted px-4 py-3 text-sm text-foreground-muted">
            Submitting as{' '}
            <span className="font-medium text-foreground">
              {user?.email || '-'}
            </span>
          </div>

          <Button
            type="submit"
            disabled={status === 'submitting' || !topic.trim()}
            className="w-full"
          >
            {status === 'submitting' ? 'Submitting...' : 'Submit Request'}
          </Button>
        </form>
      )}
    </div>
  );
}
