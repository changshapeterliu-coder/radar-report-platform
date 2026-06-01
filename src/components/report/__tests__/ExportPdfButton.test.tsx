import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ExportPdfButton } from '@/components/report/ExportPdfButton';

// Stub i18n so labels resolve to their keys — deterministic, and avoids
// pulling in the i18next singleton init. The task endorses this fallback.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const originalPrint = window.print;
const originalTitle = document.title;

beforeEach(() => {
  document.title = 'Original Tab Title';
});

afterEach(() => {
  // Restore globals mutated by the component / tests.
  window.print = originalPrint;
  document.title = originalTitle;
  vi.clearAllMocks();
});

describe('ExportPdfButton', () => {
  it('renders an outline-variant button (not primary) with the Printer icon and the export label', () => {
    render(<ExportPdfButton filenameBase="my-report" />);

    const button = screen.getByRole('button', { name: /report\.export\.button/ });
    expect(button).toBeInTheDocument();

    // Outline variant markers present, primary variant markers absent (R5.4).
    expect(button.className).toContain('bg-card');
    expect(button.className).toContain('border');
    expect(button.className).not.toContain('bg-primary');
    expect(button.className).not.toContain('text-primary-foreground');

    // Printer icon renders as an inline svg inside the button.
    expect(button.querySelector('svg')).not.toBeNull();
  });

  it('click calls window.print exactly once and sets document.title to filenameBase at print time', () => {
    const titleAtPrint: string[] = [];
    window.print = vi.fn(() => {
      titleAtPrint.push(document.title);
    });

    render(<ExportPdfButton filenameBase="radar-report-2026-w21" />);

    fireEvent.click(screen.getByRole('button', { name: /report\.export\.button/ }));

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(titleAtPrint).toEqual(['radar-report-2026-w21']);
  });

  it('ignores a second click while busy, then re-enables after afterprint', () => {
    // Sync mock that does NOT fire afterprint (jsdom never auto-fires it),
    // so the busy guard stays engaged between the two clicks.
    window.print = vi.fn();

    render(<ExportPdfButton filenameBase="my-report" />);
    const button = screen.getByRole('button', { name: /report\.export\.button/ });

    fireEvent.click(button); // first activation
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();

    fireEvent.click(button); // ignored — busy guard (R10.1)
    expect(window.print).toHaveBeenCalledTimes(1);

    // afterprint resets the busy state and re-enables the control.
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(button).not.toBeDisabled();

    fireEvent.click(button); // now allowed again
    expect(window.print).toHaveBeenCalledTimes(2);
  });

  it('restores document.title and re-enables on afterprint (covers save AND cancel)', () => {
    window.print = vi.fn();

    render(<ExportPdfButton filenameBase="my-report" />);
    const button = screen.getByRole('button', { name: /report\.export\.button/ });

    fireEvent.click(button);
    expect(document.title).toBe('my-report');
    expect(button).toBeDisabled();

    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });

    expect(document.title).toBe('Original Tab Title');
    expect(button).not.toBeDisabled();
  });

  it('surfaces the error message and restores document.title when window.print throws', () => {
    window.print = vi.fn(() => {
      throw new Error('print failed');
    });

    render(<ExportPdfButton filenameBase="my-report" />);
    const button = screen.getByRole('button', { name: /report\.export\.button/ });

    fireEvent.click(button);

    // Title restored, busy cleared, localized error surfaced (R9.4, R10.3).
    expect(document.title).toBe('Original Tab Title');
    expect(button).not.toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('report.export.error');
  });
});
