import delay from 'delay'
import fs from 'fs-extra'
import ms from 'ms'
import path from 'path'
import DeviceDescriptors from 'puppeteer/DeviceDescriptors'

export const loadPage = async ({ cluster, page, requestInterception, screenshot }) => {
  return await cluster.execute({
    ...page,
    target: page.url,
    url: `${page.url}#${page.original ? 'original' : 'optimized'}/${page.options.isMobile ? 'mobile' : 'desktop'}/${page.identifier}`
  }, async ({ page, data }) => {
    const resources = {}

    // init event handlers
    await page.setRequestInterception(true)
    await page.on('request', requestInterception)
    await page._client.on('Network.dataReceived', (event) => {
      const req = page._networkManager._requestIdToRequest.get(event.requestId)

      if (!req) {
        return
      }

      const url = req.url()

      if (url.startsWith('data:')) {
        return
      }

      const length = event.dataLength

      if (!resources[url]) {
        resources[url] = { size: 0 }
      }

      resources[url].size += length
    })

    if (data.options.isMobile) {
      await page.emulate(DeviceDescriptors['iPhone 8'])
    }

    // begin load page
    await page.goto(data.target, {
      timeout: ms('3m'),
      ...data.options
    })

    if (screenshot) {
      await fs.ensureDir(path.dirname(screenshot))

      await delay(ms('1s'))

      await page.screenshot({
        path: screenshot,
        fullPage: true
      })
    }

    // extract useful metrics
    const performance = JSON.parse(await page.evaluate(
      () => JSON.stringify(window.performance)
    ))

    const latestTiming = Object.entries(performance.timing).reduce(
      (max, [ key, value ]) => max.value > value ? max : { key, value }, { value: 0 }
    )

    const downloadedBytes = Object.values(resources).reduce(
      (sum, { size }) => sum + (size || 0), 0
    )

    const timeToFirstByte = performance.timing.responseStart - performance.timing.requestStart
    const request = performance.timing.requestStart - performance.timing.connectEnd
    const response = performance.timing.responseEnd - performance.timing.responseStart
    const processing = performance.timing.loadEventStart - performance.timing.domLoading

    return {
      loadTime: latestTiming.value - performance.timing.navigationStart,
      timeToFirstByte,
      request,
      response,
      processing,
      downloadedBytes
    }
  })
}
