// Only synthetic fixture content is served; the checkout reporter is copied here.
module.exports = function (config) {
  const enabled = process.env.FIXTURE_REPORTER !== 'off'
  config.set({
    // Exercise the buffered transport deterministically in the cancellation gate.
    ...(process.env.FIXTURE_MODE === 'slow' ? { transports: ['polling'] } : {}),
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [require('karma-jasmine'), require('karma-chrome-launcher'),
      require('@angular-devkit/build-angular/plugins/karma'), require('./reporter.cjs')],
    reporters: enabled ? ['progress', 'claude-test-progress'] : ['progress'],
    browsers: ['FixtureChrome'],
    customLaunchers: { FixtureChrome: { base: 'ChromeHeadless',
      flags: ['--no-sandbox', '--disable-dev-shm-usage'] } },
    hostname: '127.0.0.1',
    listenAddress: '127.0.0.1',
    port: Number(process.env.FIXTURE_PORT),
    client: { args: [process.env.FIXTURE_MODE || 'outcomes'],
      jasmine: { random: false, timeoutInterval: 120000 } },
    browserNoActivityTimeout: 120000,
    singleRun: true,
    colors: false
  })
}
