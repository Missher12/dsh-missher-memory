import { parentPort } from 'node:worker_threads'

if (parentPort === null) throw new Error('delayed reader fixture requires a worker parent')

parentPort.on('message', (request: { id: number }) => {
  setTimeout(() => {
    parentPort?.postMessage({ id: request.id, status: 'ok', rows: [] })
  }, 80)
})
