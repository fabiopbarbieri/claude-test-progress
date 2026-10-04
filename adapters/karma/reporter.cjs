'use strict'

const { randomBytes } = require('crypto')
const PREFIX = '@@TEST_PROGRESS@@'

function TestProgressReporter () {
  const session = `${process.pid}:${randomBytes(8).toString('hex')}`
  let cycle = 0
  let browsers = new Map()

  function count (value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0
  }

  function stateFor (browser) {
    if (!browsers.has(browser.id)) {
      browsers.set(browser.id, {
        browser,
        scope: `karma:${session}:${cycle}:${browser.id}:${browser.name}`,
        started: false,
        totalKnown: false,
        completed: false
      })
    }
    return browsers.get(browser.id)
  }

  function emit (state, final) {
    // run_start precedes browser_start: Karma 4/5 clears results before the total is reported.
    const result = state.started ? (state.browser.lastResult || {}) : {}
    const passed = count(result.success)
    const failed = count(result.failed)
    const skipped = count(result.skipped)
    const resolved = passed + failed + skipped
    const validTotal = Number.isSafeInteger(result.total) && result.total >= 0
    if (state.started && validTotal && result.total > 0) state.totalKnown = true
    const total = state.totalKnown && validTotal ? Math.max(result.total, resolved) : null
    process.stdout.write(PREFIX + JSON.stringify({
      scope: state.scope,
      total,
      resolved,
      passed,
      failed,
      skipped,
      final,
      totalStable: final && total !== null,
      phase: final ? 'finalizing' : (state.started ? 'executing' : 'discovering')
    }) + '\n')
  }

  this.onRunStart = function (collection) {
    cycle++
    browsers = new Map()
    collection.forEach(browser => emit(stateFor(browser), false))
  }

  this.onBrowserStart = function (browser, info) {
    const state = stateFor(browser)
    state.started = true
    state.totalKnown = !!info && Number.isSafeInteger(info.total) && info.total >= 0
    emit(state, false)
  }

  this.onSpecComplete = function (browser) {
    const state = stateFor(browser)
    state.started = true
    emit(state, false)
  }

  this.onBrowserComplete = function (browser) {
    const state = stateFor(browser)
    state.completed = true
    emit(state, true)
  }

  this.onRunComplete = function () {
    // Includes browsers removed from Karma's collection after a disconnect.
    for (const state of browsers.values()) {
      if (!state.completed) {
        state.completed = true
        emit(state, true)
      }
    }
  }
}

TestProgressReporter.$inject = []
module.exports = { 'reporter:claude-test-progress': ['type', TestProgressReporter] }
