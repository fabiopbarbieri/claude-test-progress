// Only synthetic page content is used; the checkout reporter is copied here.
const enabled = process.env.FIXTURE_REPORTER !== 'off'

module.exports = {
  testDir: './tests',
  // One worker keeps the slow cancellation case deterministic.
  workers: 1,
  retries: 1,
  timeout: 120000,
  reporter: enabled ? [['list'], ['./reporter.cjs']] : [['list']],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
}
