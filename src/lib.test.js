import { test } from 'node:test'
import { strictEqual } from 'node:assert'
import { createTunnelTcpClientHttp, createTunnelTcpServerKoaRouter, sleep, Uint8Array_toString } from './lib.js'
import net from 'net'
import http from 'http'
import { Transform } from 'node:stream'
import Koa from 'koa'
import Router from 'koa-router'

/**
 * @param {(ac: AbortController) => Promise<void>} func
 */
export async function runWithAbortController(func) {
    let ac = new AbortController()
    try {
        await func(ac)
        await sleep(1000)
    } finally { ac.abort() }
}

test('tunnel-tcp-socket-test-http', async () => {
    // node --test-name-pattern="^tunnel-tcp-socket-test-http$" src/lib.test.js

    await runWithAbortController(async ac => {

        console.info('创建socket服务')
        let socketServer = net.createServer((socket) => {
            socket.pipe(new Transform({
                transform(chunk, _, callback) {
                    // console.info('transform chunk', chunk, Uint8Array_toString(chunk))
                    this.push(chunk)
                    callback()
                }
            })).pipe(socket)
            socket.on('error', (err) => {
                console.error(err.message)
            })
        }).listen(9036)
        await sleep(100)

        console.info('创建监听服务')
        let connection1 = createTunnelTcpClientHttp({ signal: ac.signal, serverKey: '2934c57f790f9e99a52a121802df231c', url: 'http://127.0.0.1:9035/tunnel/0f7c5b2c9080eaa9e4d6139126daac04', })
        connection1.listen({ host: '127.0.0.1', port: 9036, tunnelKey: 'b0f5014acad2060d6bd3730a1721c97f', })
        await sleep(100)

        console.info('创建连接服务')
        let connection2 = createTunnelTcpClientHttp({ signal: ac.signal, serverKey: '2934c57f790f9e99a52a121802df231c', url: 'http://127.0.0.1:9035/tunnel/0f7c5b2c9080eaa9e4d6139126daac04', })
        connection2.connect({ port: 9037, tunnelKey: 'b0f5014acad2060d6bd3730a1721c97f', })
        await sleep(100)

        console.info('创建转发服务')
        let app = new Koa()
        let router = new Router()
        createTunnelTcpServerKoaRouter({ signal: ac.signal, serverKey: '2934c57f790f9e99a52a121802df231c', router: router, path: '/tunnel/0f7c5b2c9080eaa9e4d6139126daac04', })
        app.use(router.routes())
        app.use(router.allowedMethods())
        let koaServer = http.createServer(app.callback())
        koaServer.listen(9035)
        ac.signal.addEventListener('abort', () => { koaServer.close() })
        await sleep(1000)

        console.info('tcp透传测试')
        let socket = net.createConnection({ host: '127.0.0.1', port: 9037 })
        socket.on('error', (err) => {
            console.error(err.message)
        })

        let rec = null

        await new Promise((resolve) => {
            socket.on('connect', async () => {
                socket.on('data', (chunk) => {
                    // console.info('receive chunk ', chunk, Uint8Array_toString(chunk))
                    rec = Uint8Array_toString(chunk)
                })
                for (let i = 0; i < 100; i++) {
                    socket.write('qwertyuiop - ' + i)
                    await sleep(10)
                }
                await sleep(100)
                resolve()
            })
        })

        ac.signal.addEventListener('abort', () => {
            socket.destroy()
            socketServer.close()
        })

        strictEqual(rec, 'qwertyuiop - 99')

    })
    console.info('over!')
})