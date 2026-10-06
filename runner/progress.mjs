// Only the explicit prefix is accepted as reporter data. Other JSON stays a log.
export const PREFIX = '@@TEST_PROGRESS@@';
export class Progress {
  constructor(adapter = 'auto') {
    this.adapter = adapter;
    this.scopes = new Map();
    this.reporterSeen = false;
    this.currentClass = null;
    this.mavenInvocation = 0;
    this.kind = null;
    this.phase = 'no-progress-observed';
  }
  event(value) {
    const integer = (number) => Number.isSafeInteger(number) && number >= 0;
    if (!value || typeof value.scope !== 'string' || !value.scope.trim() || value.scope.length > 512 ||
        !(value.total === null || integer(value.total)) ||
        !['resolved', 'passed', 'failed', 'skipped'].every((key) => integer(value[key])) ||
        value.resolved !== value.passed + value.failed + value.skipped ||
        (value.total !== null && value.resolved > value.total) ||
        (value.final !== undefined && typeof value.final !== 'boolean') ||
        (value.totalStable !== undefined && typeof value.totalStable !== 'boolean')) return false;
    if (!this.reporterSeen) this.scopes.clear();
    this.reporterSeen = true;
    this.kind = 'events';
    this.scopes.set(value.scope, {
      total: value.total, resolved: value.resolved, passed: value.passed,
      failed: value.failed, skipped: value.skipped,
      totalStable: value.total !== null && value.totalStable === true,
      final: value.final === true,
    });
    this.phase = typeof value.phase === 'string' ? value.phase.slice(0, 120) : 'executing-tests';
    return true;
  }
  line(line) {
    const clean = line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
    const index = clean.indexOf(PREFIX);
    if (index >= 0) {
      try { return this.event(JSON.parse(clean.slice(index + PREFIX.length).trim())); }
      catch { return false; }
    }
    // `exit` still honours explicit events; without them the exit code alone decides.
    if (this.reporterSeen || this.adapter === 'events' || this.adapter === 'exit') return false;
    if (this.adapter === 'auto' || this.adapter === 'maven') {
      // A goal banner identifies a new module/execution, even when its FQCNs
      // appeared earlier. The final reactor aggregate has no class identity.
      if (/---\s+[^\s]+:[^\s]+.*\s@\s+[^\s]+\s+---/.test(clean)) {
        this.mavenInvocation += 1;
        this.currentClass = null;
        return false;
      }
      if (/^\s*(?:\[INFO\]\s*)?Results:/.test(clean)) this.currentClass = null;
      const running = clean.match(/^\s*(?:\[INFO\]\s*)?Running\s+([\w.$]+)\s*$/);
      if (running) {
        this.currentClass = running[1];
        this.kind = 'maven';
        this.phase = 'executing-tests';
        return true;
      }
      const summary = clean.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/);
      if (summary) {
        const className = clean.match(/(?:--\s*in|in)\s+([\w.$]+)\s*$/)?.[1] ?? this.currentClass;
        // Maven's final aggregate has no class: do not count that line again.
        if (!className) return false;
        const [total, failures, errors, skipped] = summary.slice(1).map(Number);
        const failed = failures + errors;
        if (failed + skipped > total) return false;
        this.scopes.set(`${this.mavenInvocation}:${className}`, { total, resolved: total, passed: total - failed - skipped,
          failed, skipped, final: true, totalStable: false });
        this.currentClass = null;
        this.kind = 'maven';
        this.phase = 'executing-tests';
        return true;
      }
    }
    if (this.adapter === 'auto' || this.adapter === 'karma') {
      const executed = clean.match(/^(.*?)Executed\s+(\d+)\s+of\s+(\d+)(.*)$/);
      if (executed) {
        const [, prefix, count, maximum, rest] = executed;
        const total = Number(maximum);
        const failed = Number(rest.match(/\(?\s*(\d+)\s+FAILED\s*\)?/i)?.[1] ?? 0);
        const skipped = Number(rest.match(/\(?\s*skipped\s+(\d+)\s*\)?/i)?.[1] ?? 0);
        const resolved = Number(count) + skipped;
        if (resolved > total || failed > Number(count)) return false;
        this.scopes.set(prefix.trim() || 'karma', { total, resolved,
          passed: Number(count) - failed, failed, skipped,
          totalStable: true, final: resolved === total });
        this.kind = 'karma';
        this.phase = 'executing-tests';
        return true;
      }
    }
    return false;
  }
  values(finished = false, complete = finished) {
    const scopes = [...this.scopes.values()];
    const sum = (key) => scopes.reduce((value, scope) => value + scope[key], 0);
    const known = scopes.length > 0 && scopes.every((scope) => scope.total !== null);
    const total = known && (this.kind !== 'maven' || (finished && complete)) ? sum('total') : null;
    // A finalized module/browser does not prove all later scopes have been discovered.
    const totalStable = finished && complete && total !== null && (this.kind === 'maven' ||
      scopes.every((scope) => scope.totalStable));
    const resolved = sum('resolved');
    return { unit: 'tests', total, resolved, passed: sum('passed'), failed: sum('failed'),
      skipped: sum('skipped'), totalStable,
      percent: total !== null && total > 0 ? Math.round(resolved / total * 1000) / 10 : null,
      phase: this.phase, progressObserved: scopes.length > 0 };
  }
}
