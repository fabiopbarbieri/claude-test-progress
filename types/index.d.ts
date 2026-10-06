// Test Progress state contract: what the pane and the band draw, held by the host so a hot reload keeps it.

/** One module of the workspace catalogue, as the collector reports it. */
export type TestProgressModule = {
  id: string
  label: string
  language: string | null
  order: number
  enabled: boolean
  directoryPresent: boolean
  origin: string
  diagnostics: TestProgressDiagnostic[]
}

/** A diagnostic is either plain text or a coded message. */
export type TestProgressDiagnostic = string | { code?: string; message?: string; blocking?: boolean }

/** One run's snapshot. Counts are observed, never estimated; `total: null` is unknown, not zero. */
export type TestProgressJob = {
  schemaVersion: number
  moduleId: string
  runId: string
  source: 'config'
  status: 'preparing' | 'running' | 'completed' | 'failed' | 'cancelled' | 'error'
  phase: string
  adapter?: string
  total?: number | null
  totalStable?: boolean
  resolved?: number
  passed?: number
  failed?: number
  skipped?: number
  percent?: number | null
  exitCode?: number | null
  elapsedMs?: number
  error?: string
  recoveryRequired?: boolean
  cancellable?: boolean
  logPath?: string
  logTail?: string[]
  heartbeatAt?: string | null
  lastOutputAt?: string | null
  lastProgressAt?: string | null
  collectorRuntime?: { version: string; source: string }
  nodeRuntime?: { version: string; source: string; nvmrc?: string | null }
}

export type TestProgressWorkspace = {
  moduleConfig?: {
    status: 'absent' | 'valid' | 'invalid'
    schemaVersion: number | null
    enabledIds: string[]
    diagnostics?: TestProgressDiagnostic[]
  }
  stateBlocked?: boolean
  error?: string
}

/** The Node the collector bootstrapped, reused for later queries of the same identity. */
export type TestProgressCollector = { identity: string; path: string; source: string }

/** Everything the pane and band draw, plus the session identity it belongs to. */
export type TestProgressPanel = {
  identity: string
  generation: number
  sessionOwner: string
  modules: Record<string, TestProgressModule>
  jobs: Record<string, TestProgressJob>
  stateDiagnostics: Record<string, TestProgressDiagnostic[]>
  workspace: TestProgressWorkspace | null
  busy: boolean
  lastError: string
  registrationError: string
  selectedLogs: { id: string; runId: string } | null
  logTail: string[]
  chooseLogs: boolean
  showHelp: boolean
  /** Runs the person has seen in the pane; the band keeps only unseen failures. */
  seenRuns: string[]
  collector: TestProgressCollector | null
}

declare module 'claude-code' {
  interface PluginState {
    'test-progress': { panel: TestProgressPanel }
  }
}
