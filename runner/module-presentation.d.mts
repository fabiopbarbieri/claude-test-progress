// Types for module-presentation.mjs, shared by the hooks module and the collector.
import type { TestProgressDiagnostic, TestProgressJob, TestProgressModule } from '../types/index.d.ts';

type Tone = 'success' | 'error' | 'warning' | 'inactive';
type Envelope = {
  schemaVersion: number
  ok: boolean
  modules: Record<string, TestProgressModule>
  jobs: Record<string, TestProgressJob>
  stateDiagnostics: Record<string, TestProgressDiagnostic[]>
  workspace: import('../types/index.d.ts').TestProgressWorkspace
  actionResults?: Record<string, { ok: boolean; action?: string; error?: string }>
  error?: string
  collector?: { path?: unknown; source?: unknown }
}

export const ACTIVE: Set<string>;
export const labels: Record<string, string>;
export const configStatus: Record<string, string>;
export function validateEnvelope(data: unknown): Envelope;
export function parseCommand(raw: unknown): { action: 'list' | 'start' | 'status' | 'logs' | 'cancel' | 'help' | 'paths'; moduleId: string; text: boolean };
export function visibleModuleIds(modules: Record<string, TestProgressModule>, jobs: Record<string, TestProgressJob>,
  diagnostics: Record<string, TestProgressDiagnostic[]>): string[];
export type ModuleSort = 'order' | 'name' | 'recent' | 'attention';
export const SORTS: ModuleSort[];
export const sortLabels: Record<ModuleSort, string>;
export function nextSort(sort: ModuleSort): ModuleSort;
export function sortModuleIds(ids: string[], modules: Record<string, TestProgressModule>,
  jobs: Record<string, TestProgressJob>, sort: ModuleSort): string[];
export function moduleTitle(id: string, module: TestProgressModule | undefined): string;
export function percentage(job: TestProgressJob): string;
export function progressText(job: TestProgressJob): string;
export function countSummary(job: TestProgressJob): string;
export function diagnosticText(item: TestProgressDiagnostic): string;
export function sanitizeText(value: unknown): string;
export function sanitizeTail(tail: unknown): string[];
export function sanitizeLogText(value: unknown): string;
export function plainTail(tail: unknown): string[];
export type SpanStyle = { color?: string; backgroundColor?: string; bold?: boolean; dimColor?: boolean; italic?: boolean;
  underline?: boolean; inverse?: boolean; strikethrough?: boolean };
export function ansiSpans(line: string): { text: string; style: SpanStyle | null }[];
export function statusGlyph(job: TestProgressJob | undefined): { glyph: string; color: Tone };
export function progressBar(job: TestProgressJob, cells?: number): { done: string; rest: string };
export function outcomeText(job: TestProgressJob): { text: string; color: Tone };
export function finishedWithFailure(job: TestProgressJob | undefined): boolean;
export function summaryCounts(ids: string[], jobs: Record<string, TestProgressJob>): { passed: number; failed: number; total: number };
export function readableTail(lines: string[], prefix: string): string[];
export function compactPercent(job: TestProgressJob): string;
export function compactCounts(job: TestProgressJob): { text: string; color: Tone }[];
export function clock(ms: number | undefined): string;
