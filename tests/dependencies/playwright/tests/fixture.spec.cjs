const { test, expect } = require('@playwright/test')

const mode = process.env.FIXTURE_MODE || 'outcomes'

test('renders and clicks', async ({ page }) => {
  await page.setContent('<button onclick="this.textContent = \'done\'">go</button>')
  await page.click('button')
  await expect(page.locator('button')).toHaveText('done')
})

if (mode === 'outcomes') {
  test('fails on every attempt', async ({ page }) => {
    await page.setContent('<p>actual</p>')
    await expect(page.locator('p')).toHaveText('expected', { timeout: 500 })
  })

  test('is skipped', async () => {
    test.skip(true, 'fixture skip')
  })

  test('passes on retry', async ({ page }, testInfo) => {
    await page.setContent('<p>flaky</p>')
    expect(testInfo.retry).toBe(1)
  })

  test('fails as declared', async () => {
    test.fail()
    expect(1).toBe(2)
  })
}

if (mode === 'slow') {
  test('waits for cancellation', async ({ page }) => {
    await page.setContent('<p>waiting</p>')
    await page.waitForTimeout(110000)
  })
}
