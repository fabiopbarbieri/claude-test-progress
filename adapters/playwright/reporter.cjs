'use strict'

const { randomBytes } = require('crypto')
const PREFIX = '@@TEST_PROGRESS@@'

class TestProgressReporter {
  constructor () {
    this.scope = null
    this.total = 0
    // Keyed by TestCase so retries and repeatEach copies are never counted twice.
    this.outcomes = new Map()
  }

  printsToStdio () {
    return false
  }

  emit (final) {
    if (this.scope === null) return
    let passed = 0
    let failed = 0
    let skipped = 0
    for (const outcome of this.outcomes.values()) {
      if (outcome === 'skipped') skipped++
      else if (outcome === 'unexpected') failed++
      else passed++
    }
    const resolved = passed + failed + skipped
    process.stdout.write(PREFIX + JSON.stringify({
      scope: this.scope,
      total: Math.max(this.total, resolved),
      resolved,
      passed,
      failed,
      skipped,
      final,
      // allTests() is the whole plan of this run (projects, repeats and shard included).
      totalStable: true,
      phase: final ? 'finalizing' : 'executing'
    }) + '\n')
  }

  onBegin (config, suite) {
    this.scope = `playwright:${process.pid}:${randomBytes(8).toString('hex')}`
    this.total = suite.allTests().length
    this.outcomes = new Map()
    this.emit(false)
  }

  onTestEnd (test, result) {
    // An interrupted attempt did not resolve the test; a failed attempt with
    // retries left will run again and must not be reported yet.
    if (result.status === 'interrupted') return
    // test.fail() settles on an expected failure, just like a pass.
    const settled = result.status === test.expectedStatus || result.status === 'skipped' ||
      result.retry >= test.retries
    if (!settled) return
    // expected and flaky both count as passed.
    this.outcomes.set(test, test.outcome())
    this.emit(false)
  }

  onEnd () {
    this.emit(true)
  }
}

module.exports = TestProgressReporter
