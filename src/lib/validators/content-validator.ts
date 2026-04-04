import type { ReportContent, ReportModule, ReportTable } from '@/types/report';
import type { ContentValidationError } from '@/types/errors';

/**
 * Validates ReportContent structure for both regular and topic reports.
 * Shared between Edge Functions and frontend for client-side pre-validation.
 *
 * @returns Empty array if valid, array of errors if invalid.
 */
export function validateReportContent(
  content: unknown,
  reportType: 'regular' | 'topic'
): ContentValidationError[] {
  const errors: ContentValidationError[] = [];

  if (!content || typeof content !== 'object') {
    errors.push({
      field: 'content',
      path: 'content',
      message: 'Content must be a non-null object',
    });
    return errors;
  }

  const c = content as Record<string, unknown>;

  // Validate top-level required fields
  if (typeof c.title !== 'string' || c.title.trim() === '') {
    errors.push({
      field: 'title',
      path: 'content.title',
      message: 'Title is required and must be a non-empty string',
    });
  }

  if (typeof c.dateRange !== 'string' || c.dateRange.trim() === '') {
    errors.push({
      field: 'dateRange',
      path: 'content.dateRange',
      message: 'Date range is required and must be a non-empty string',
    });
  }

  if (!Array.isArray(c.modules)) {
    errors.push({
      field: 'modules',
      path: 'content.modules',
      message: 'Modules must be an array',
    });
    return errors;
  }

  // Validate module count based on report type
  const modules = c.modules as unknown[];

  if (reportType === 'regular' && modules.length !== 4) {
    errors.push({
      field: 'modules',
      path: 'content.modules',
      message: `Regular report must contain exactly 4 modules, got ${modules.length}`,
    });
  }

  if (reportType === 'topic' && modules.length < 1) {
    errors.push({
      field: 'modules',
      path: 'content.modules',
      message: 'Topic report must contain at least 1 module',
    });
  }

  // Validate each module
  for (let i = 0; i < modules.length; i++) {
    validateModule(modules[i], i, errors);
  }

  return errors;
}

function validateModule(
  mod: unknown,
  index: number,
  errors: ContentValidationError[]
): void {
  const basePath = `content.modules[${index}]`;

  if (!mod || typeof mod !== 'object') {
    errors.push({
      field: `modules[${index}]`,
      path: basePath,
      message: 'Module must be a non-null object',
    });
    return;
  }

  const m = mod as Record<string, unknown>;

  // Module title is required
  if (typeof m.title !== 'string' || m.title.trim() === '') {
    errors.push({
      field: 'title',
      path: `${basePath}.title`,
      message: 'Module title is required and must be a non-empty string',
    });
  }

  // Validate tables if present
  if (m.tables !== undefined) {
    if (!Array.isArray(m.tables)) {
      errors.push({
        field: 'tables',
        path: `${basePath}.tables`,
        message: 'Tables must be an array',
      });
    } else {
      for (let t = 0; t < m.tables.length; t++) {
        validateTable(m.tables[t], index, t, errors);
      }
    }
  }
}

function validateTable(
  table: unknown,
  moduleIndex: number,
  tableIndex: number,
  errors: ContentValidationError[]
): void {
  const basePath = `content.modules[${moduleIndex}].tables[${tableIndex}]`;

  if (!table || typeof table !== 'object') {
    errors.push({
      field: `tables[${tableIndex}]`,
      path: basePath,
      message: 'Table must be a non-null object',
    });
    return;
  }

  const t = table as Record<string, unknown>;

  if (!Array.isArray(t.headers)) {
    errors.push({
      field: 'headers',
      path: `${basePath}.headers`,
      message: 'Table headers must be an array',
    });
    return;
  }

  const headerCount = t.headers.length;

  if (!Array.isArray(t.rows)) {
    errors.push({
      field: 'rows',
      path: `${basePath}.rows`,
      message: 'Table rows must be an array',
    });
    return;
  }

  // Validate row/cell consistency
  for (let r = 0; r < t.rows.length; r++) {
    const row = t.rows[r] as Record<string, unknown> | null | undefined;
    if (!row || typeof row !== 'object') {
      errors.push({
        field: `rows[${r}]`,
        path: `${basePath}.rows[${r}]`,
        message: 'Row must be a non-null object',
      });
      continue;
    }

    if (!Array.isArray(row.cells)) {
      errors.push({
        field: 'cells',
        path: `${basePath}.rows[${r}].cells`,
        message: 'Row cells must be an array',
      });
      continue;
    }

    if (row.cells.length !== headerCount) {
      errors.push({
        field: 'cells',
        path: `${basePath}.rows[${r}].cells`,
        message: `Row has ${row.cells.length} cells but table has ${headerCount} headers`,
      });
    }
  }
}
