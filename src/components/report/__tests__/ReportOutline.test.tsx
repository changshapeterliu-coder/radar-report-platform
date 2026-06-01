import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ReportOutline from '@/components/report/ReportOutline';
import type { Section } from '@/lib/report-export';

// Stub i18n so labels resolve to their keys.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// jsdom has no IntersectionObserver — stub a no-op class so the scroll-spy
// effect mounts without throwing. We don't assert scroll-spy behavior here.
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    NoopIntersectionObserver;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ReportOutline', () => {
  const sections: Section[] = [
    { id: 'module-0', title: '账户健康概览' },
    { id: 'module-1', title: 'Appeals & Reinstatement' },
    { id: 'module-2', title: 'KYC / Verification' },
  ];

  it('renders one entry per section with the section titles and the desktop label', () => {
    render(<ReportOutline sections={sections} />);

    // Desktop outline label (rendered once in the aside).
    expect(screen.getAllByText('report.outline.label').length).toBeGreaterThan(0);

    // The clickable desktop entries — one anchor per section, in order.
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(sections.length);
    sections.forEach((section, i) => {
      expect(links[i]).toHaveAttribute('href', `#${section.id}`);
      expect(links[i]).toHaveTextContent(section.title);
    });
  });

  it('renders a mobile select with one option per section', () => {
    render(<ReportOutline sections={sections} />);

    const select = screen.getByRole('combobox');
    const options = within(select).getAllByRole('option');
    expect(options).toHaveLength(sections.length);
    expect(options[0]).toHaveValue('module-0');
    expect(options[1]).toHaveValue('module-1');
    expect(options[2]).toHaveValue('module-2');
  });

  it('returns null for an empty section list', () => {
    const { container } = render(<ReportOutline sections={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
