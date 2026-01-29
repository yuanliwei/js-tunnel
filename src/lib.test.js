import { test } from 'node:test'
import { ok, strictEqual } from 'node:assert'
import { createTunnelTcpClientHttp, createTunnelTcpClientSocket, createTunnelTcpClientWebSocket, createTunnelTcpServerKoaMiddleware, createTunnelTcpServerKoaRouter, createTunnelTcpServerSocket, createTunnelTcpServerWebSocket, formatSize, runWithAbortController, sleep, Uint8Array_toString } from './lib.js'
import net from 'net'
import http from 'http'
import { Readable, Transform } from 'node:stream'
import Koa from 'koa'
import Router from '@koa/router'
import { WebSocketServer } from 'ws'
import log4js from 'log4js'

log4js.configure({
    appenders: { stdout: { type: "stdout", layout: { type: 'pattern', pattern: '[%d{yyyy-MM-dd hh:mm:ss,SSS}] %[%p %m%] %f{2}:%l:%o' } } },
    categories: { default: { appenders: ["stdout"], level: "debug", enableCallStack: true } },
})

/** @type{*} */
const _log4js_ = log4js.getLogger()
_log4js_['table'] = globalThis.console.table
globalThis.console = _log4js_
/** @type{Omit<Console,'log'>} */
const console = _log4js_

test('tunnel-tcp-socket-test', async () => {
    // node --test-name-pattern="^tunnel-tcp-socket-test$" src/lib.test.js

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
        }).listen(9006)
        socketServer.on('error', (e) => { console.error(e.message) })
        await sleep(100)

        console.info('创建监听服务')
        let connection1 = createTunnelTcpClientSocket({ signal: ac.signal, serverKey: '2934c57f790f9e99a52a121802df231c', serverHost: '127.0.0.1', serverPort: 9005, })
        connection1.listen({ host: '127.0.0.1', port: 9006, tunnelKey: 'b0f5014acad2060d6bd3730a1721c97f', })
        await sleep(100)

        console.info('创建连接服务')
        let connection2 = createTunnelTcpClientSocket({ signal: ac.signal, serverKey: '2934c57f790f9e99a52a121802df231c', serverHost: '127.0.0.1', serverPort: 9005, })
        connection2.connect({ port: 9007, tunnelKey: 'b0f5014acad2060d6bd3730a1721c97f', })
        await sleep(100)

        console.info('创建转发服务')
        createTunnelTcpServerSocket({ signal: ac.signal, serverKey: '2934c57f790f9e99a52a121802df231c', port: 9005, })
        await sleep(1000)

        console.info('tcp透传测试')
        let socket = net.createConnection({ host: '127.0.0.1', port: 9007 })
        socket.on('error', (err) => {
            console.error(err.message)
        })

        let rec = ''

        await new Promise((resolve) => {
            socket.on('connect', async () => {
                socket.on('data', (chunk) => {
                    // console.info('receive chunk ', chunk, Uint8Array_toString(chunk))
                    rec = Uint8Array_toString(chunk)
                })
                for (let i = 0; i < 100; i++) {
                    // console.info('send','qwertyuiop - ' + i)
                    socket.write('qwertyuiop - ' + i)
                    // await sleep(10)
                    await sleep(1)
                }
                await sleep(2000)
                resolve()
            })
        })

        ac.signal.addEventListener('abort', () => {
            socket.destroy()
            socketServer.close()
        })

        let from = rec.length - 'qwertyuiop - 99'.length
        strictEqual(rec.substring(from), 'qwertyuiop - 99')

    })
    console.info('over!')
})

test('tunnel-tcp-socket-test-websocket', async () => {
    // node --test-name-pattern="^tunnel-tcp-socket-test-websocket$" src/lib.test.js

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
        }).listen(9016)
        socketServer.on('error', (e) => { console.error(e.message) })
        await sleep(100)

        console.info('创建监听服务')
        let connection1 = createTunnelTcpClientWebSocket({ signal: ac.signal, serverKey: '2934c57f790f9e99a52a121802df231c', url: 'ws://127.0.0.1:9015/tunnel/ae145dce31bfa94f0c837749320030bb', })
        connection1.listen({ host: '127.0.0.1', port: 9016, tunnelKey: 'b0f5014acad2060d6bd3730a1721c97f', })
        await sleep(100)

        console.info('创建连接服务')
        let connection2 = createTunnelTcpClientWebSocket({ signal: ac.signal, serverKey: '2934c57f790f9e99a52a121802df231c', url: 'ws://127.0.0.1:9015/tunnel/ae145dce31bfa94f0c837749320030bb', })
        connection2.connect({ port: 9017, tunnelKey: 'b0f5014acad2060d6bd3730a1721c97f', })
        await sleep(100)

        console.info('创建转发服务')
        let server = http.createServer().listen(9015)
        server.on('error', (e) => { console.error(e.message) })
        let wss = new WebSocketServer({ server })
        ac.signal.addEventListener('abort', () => server.close())
        createTunnelTcpServerWebSocket({ signal: ac.signal, serverKey: '2934c57f790f9e99a52a121802df231c', wss, path: '/tunnel/ae145dce31bfa94f0c837749320030bb' })
        await sleep(1000)

        console.info('tcp透传测试')
        let socket = net.createConnection({ host: '127.0.0.1', port: 9017 })
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
        socketServer.on('error', (e) => { console.error(e.message) })
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
        app.onerror = (err) => console.info(err.message)
        let koaServer = http.createServer(app.callback())
        koaServer.listen(9035)
        koaServer.on('error', (e) => { console.error(e.message) })
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

test('tunnel-tcp-socket-test-http-KoaMiddleware', async () => {
    // node --test-name-pattern="^tunnel-tcp-socket-test-http-KoaMiddleware$" src/lib.test.js

    using d = new DisposableStack()
    const ac = new AbortController()
    d.adopt(0, () => ac.abort())
    const { signal } = ac

    // 配置常量
    const PORTS = { server: 9435, target: 9436, proxy: 9437 }
    const KEYS = { server: '2934c57f790f9e99a52a121802df231c', tunnel: 'b0f5014acad2060d6bd3730a1721c97f' }
    const TUNNEL_ID = '0f7c5b2c9080eaa9e4d6139126daac04'
    const TUNNEL_URL = `http://127.0.0.1:${PORTS.server}/tunnel/${TUNNEL_ID}`

    console.info('创建socket服务')
    const socketServer = net.createServer(socket => socket.pipe(socket))
    d.adopt(0, () => socketServer.close())
    await new Promise((resolve, reject) => { socketServer.on('error', reject); socketServer.listen(PORTS.target, () => resolve()) })

    const clientOpts = { signal, serverKey: KEYS.server, url: TUNNEL_URL }

    console.info('创建监听服务')
    const listener = createTunnelTcpClientHttp(clientOpts)
    listener.listen({ host: '127.0.0.1', port: PORTS.target, tunnelKey: KEYS.tunnel })

    console.info('创建连接服务')
    const connector = createTunnelTcpClientHttp(clientOpts)
    connector.connect({ port: PORTS.proxy, tunnelKey: KEYS.tunnel })

    console.info('创建转发服务')
    const app = new Koa()
    app.use(createTunnelTcpServerKoaMiddleware({ signal, serverKey: KEYS.server, path: `/tunnel/${TUNNEL_ID}` }))
    const koaServer = http.createServer(app.callback())
    d.adopt(0, () => koaServer.close())
    await new Promise((resolve, reject) => { koaServer.on('error', reject); koaServer.listen(PORTS.server, () => resolve()) })

    await new Promise(r => setTimeout(r, 1000))

    const socket = net.createConnection({ host: '127.0.0.1', port: PORTS.proxy })
    d.adopt(0, () => socket.destroy())
    await new Promise(resolve => socket.once('connect', resolve))
    let recvChunks = ''
    socket.on('data', chunk => { recvChunks += chunk.toString() })

    let sendChunks = ''
    // 发送数据
    for (let i = 0; i < 100; i++) {
        sendChunks += `qwertyuiop - ${i}`
        socket.write(`qwertyuiop - ${i}`)
    }
    await sleep(100)

    strictEqual(recvChunks, sendChunks)
    console.info('over!')
})

test('backpressure-socket', async () => {
    // node --test-name-pattern="^backpressure-socket$" src/lib.test.js

    await runWithAbortController(async ac => {

        console.info('创建socket服务')
        let transformSize = 0
        let socketServer = net.createServer((socket) => {
            socket.pipe(new Transform({
                transform(chunk, _, callback) {
                    // console.info('transform chunk', chunk.length)
                    transformSize += chunk.length
                    this.push(chunk)
                    callback()
                }
            })).pipe(socket).on('error', (err) => console.error(err.message))
        }).listen(9036)
        await sleep(100)
        socketServer.on('error', (err) => {
            console.error(err.message)
        })

        console.info('创建转发服务 http')
        let app = new Koa()
        let router = new Router()
        createTunnelTcpServerKoaRouter({
            signal: ac.signal,
            router: router,
            path: '/tunnel/0f7c5b2c9080eaa9e4d6139126daac04',
            serverKey: '2934c57f790f9e99a52a121802df231c',
        })
        app.use(router.routes())
        app.use(router.allowedMethods())
        app.onerror = (err) => console.info(err.message)
        let koaServer = http.createServer(app.callback())
        koaServer.listen(9035)
        koaServer.on('error', (e) => { console.error(e.message) })
        ac.signal.addEventListener('abort', () => { koaServer.close() })
        await sleep(1000)

        console.info('创建监听服务 http')
        let connection1 = createTunnelTcpClientHttp({
            url: 'http://127.0.0.1:9035/tunnel/0f7c5b2c9080eaa9e4d6139126daac04',
            signal: ac.signal,
            serverKey: '2934c57f790f9e99a52a121802df231c',
        })
        connection1.listen({
            clientKey: 'mmm',
            tunnelKey: 'b0f5014acad2060d6bd3730a1721c97f',
            host: '127.0.0.1',
            port: 9036,
        })
        await sleep(100)

        console.info('创建连接服务 http 1')
        let connection2 = createTunnelTcpClientHttp({
            url: 'http://127.0.0.1:9035/tunnel/0f7c5b2c9080eaa9e4d6139126daac04',
            signal: ac.signal,
            serverKey: '2934c57f790f9e99a52a121802df231c',
        })
        connection2.connect({
            clientKey: 'mmm',
            tunnelKey: 'b0f5014acad2060d6bd3730a1721c97f',
            port: 9037,
        })

        await sleep(1000)

        console.info('tcp透传测试 start')
        let socket1 = net.createConnection({ host: '127.0.0.1', port: 9037 })
        socket1.on('error', (err) => { console.error(err.message) })

        let sendWriteSize = 0
        let sendSize = 0
        let receiveSize = 0
        let stop = false
        await new Promise((resolve) => {
            setTimeout(() => {
                stop = true
                resolve()
            }, 5_000)
            socket1.on('connect', async () => {
                socket1.pipe(new Transform({
                    async transform(chunk, _, callback) {
                        receiveSize += chunk.length
                        await sleep(500)
                        callback()
                    }
                })).on('data', (chunk) => {
                    // console.info('1 receive chunk ', chunk, Uint8Array_toString(chunk))
                })
                // let data = new Uint8Array(1024 * 1024)
                let data = new Uint8Array(1024)
                // let data = Uint8Array_from('1234567890')
                let readable = new Readable({
                    read() {
                        if (stop) {
                            this.push(null)
                            readable.destroy()
                            return
                        }
                        // data = Uint8Array_from('1234567890')
                        sendSize += data.length
                        this.push(data)
                        // stop = true
                    }
                })
                readable.on('data', (chunk) => {
                    sendWriteSize += chunk.length
                    if (!socket1.write(chunk)) {
                        readable.pause()
                    }
                })
                socket1.on('drain', () => {
                    readable.resume()
                })
                // readable.pipe(socket1)
            })
        })

        console.info(`${'\n'.repeat(3)}sendSize:${formatSize(sendSize)} sendWriteSize:${formatSize(sendWriteSize)} receiveSize:${formatSize(receiveSize)} transformSize:${formatSize(transformSize)}`)

        console.info('tcp透传测试 finish sendSize:', sendSize)

        ac.signal.addEventListener('abort', () => {
            socketServer.close()
            socket1.destroy()
        })

        console.info(receiveSize, sendSize)
        ok(receiveSize > 65535)
        ok(sendSize < 45000000)

    })
    console.info('over!')
})

// 跳过手动测试
const SKIP_MANAUAL_TEST = true

test('test-server', { skip: SKIP_MANAUAL_TEST }, async () => {
    // node --test-name-pattern="^test-server$" src/lib.test.js
    await runWithAbortController(async ac => {
        console.info('创建转发服务 http')
        let app = new Koa()
        let router = new Router()
        createTunnelTcpServerKoaRouter({
            signal: ac.signal,
            router: router,
            path: '/tunnel/4b34c9275e1089c79327cba18497a37f',
            serverKey: '2934c57f790f9e99a52a121802df231c',
        })
        app.use(router.routes())
        app.use(router.allowedMethods())
        app.onerror = (err) => console.info(err.message)
        let koaServer = http.createServer(app.callback())
        koaServer.listen(9035)
        ac.signal.addEventListener('abort', () => { koaServer.close() })
        await sleep(10000_000)
    })
})
test('test-listen', { skip: SKIP_MANAUAL_TEST }, async () => {
    // node --test-name-pattern="^test-listen$" src/lib.test.js
    await runWithAbortController(async ac => {
        console.info('创建socket服务')
        let transformSize = 0
        let socketServer = net.createServer((socket) => {
            socket.pipe(new Transform({
                transform(chunk, _, callback) {
                    // console.info('transform chunk', chunk.length)
                    transformSize += chunk.length
                    this.push(chunk)
                    callback()
                }
            })).pipe(socket)
        }).listen(9036)
        ac.signal.addEventListener('abort', () => { socketServer.close() })
        await sleep(100)

        console.info('创建监听服务 http')
        let connection = createTunnelTcpClientHttp({
            url: 'http://127.0.0.1:9035/tunnel/4b34c9275e1089c79327cba18497a37f',
            signal: ac.signal,
            serverKey: '2934c57f790f9e99a52a121802df231c',
        })
        connection.listen({
            clientKey: 'mmm',
            tunnelKey: 'b0f5014acad2060d6bd3730a1721c97f',
            host: '127.0.0.1',
            port: 9036,

        })
        await sleep(10000_000)
    })
})
test('test-connect', { skip: SKIP_MANAUAL_TEST }, async () => {
    // node --test-name-pattern="^test-connect$" src/lib.test.js
    await runWithAbortController(async ac => {
        console.info('创建连接服务 http 1')
        let connection = createTunnelTcpClientHttp({
            url: 'http://127.0.0.1:9035/tunnel/4b34c9275e1089c79327cba18497a37f',
            signal: ac.signal,
            serverKey: '2934c57f790f9e99a52a121802df231c',
        })
        connection.connect({
            clientKey: 'mmm',
            tunnelKey: 'b0f5014acad2060d6bd3730a1721c97f',
            port: 9037,
        })
        await sleep(1000)
        console.info('tcp透传测试 start')
        let socket1 = net.createConnection({ host: '127.0.0.1', port: 9037 })

        let rec1 = null

        let sendWriteSize = 0
        let sendSize = 0
        let receiveSize = 0
        let stop = false
        await new Promise((resolve) => {
            // setTimeout(() => {
            //     stop = true
            //     resolve()
            // }, 5_000)
            socket1.on('connect', async () => {
                socket1.pipe(new Transform({
                    async transform(chunk, _, callback) {
                        receiveSize += chunk.length
                        await sleep(500)
                        callback()
                    }
                })).on('data', (chunk) => {
                    console.info('1 receive chunk ', chunk, Uint8Array_toString(chunk))
                    rec1 = Uint8Array_toString(chunk)
                })
                // let data = new Uint8Array(1024 * 1024)
                let data = new Uint8Array(1024)
                // let data = Uint8Array_from('1234567890')
                let readable = new Readable({
                    read() {
                        if (stop) {
                            this.push(null)
                            readable.destroy()
                            return
                        }
                        // data = Uint8Array_from('1234567890')
                        sendSize += data.length
                        this.push(data)
                        // stop = true
                    }
                })
                readable.on('data', (chunk) => {
                    sendWriteSize += chunk.length
                    if (!socket1.write(chunk)) {
                        readable.pause()
                    }
                })
                socket1.on('drain', () => {
                    readable.resume()
                })
                readable.pipe(socket1)
            })
        })

        await sleep(10000_000)
    })
})

test('terminal-server', async () => {
    // node --test-name-pattern="^terminal-server$" src/lib.test.js
    using stack = new DisposableStack()
    const ac = new AbortController()
    stack.adopt(ac, () => { ac.abort() })
    let transformSize = 0

    async function createEchoServer() {
        console.info('创建socket服务')
        let socketServer = net.createServer((socket) => {
            socket.pipe(new Transform({
                transform(chunk, _, callback) {
                    // console.info('transform chunk', chunk.length)
                    transformSize += chunk.length
                    this.push("echo::::")
                    this.push(chunk)
                    callback()
                }
            })).pipe(socket).on('error', (err) => console.error(err.message))
        }).listen(9036)
        await sleep(100)
        socketServer.on('error', (err) => {
            console.error(err.message)
        })
        ac.signal.addEventListener('abort', () => {
            socketServer.close()
        })
    }

    /**
     * 
     * @param {AbortController} ac 
     */
    async function createDispatchServer(ac) {
        console.info('创建转发服务 http')
        let app = new Koa()
        let router = new Router()
        createTunnelTcpServerKoaRouter({
            signal: ac.signal,
            router: router,
            path: '/tunnel/0f7c5b2c9080eaa9e4d6139126daac04',
            serverKey: '2934c57f790f9e99a52a121802df231c',
        })
        app.use(router.routes())
        app.use(router.allowedMethods())
        app.onerror = (err) => console.info(err.message)
        let koaServer = http.createServer(app.callback())
        koaServer.listen(9035)
        koaServer.on('error', (e) => { console.error(e.message) })
        ac.signal.addEventListener('abort', () => {
            console.info('close koa server')
            koaServer.close((err) => {
                console.info('on server close result ', err)
            })
            koaServer.closeAllConnections()
        })
        await sleep(1000)
    }

    async function createListenClient() {
        console.info('创建监听服务 http')
        let connection1 = createTunnelTcpClientHttp({
            url: 'http://127.0.0.1:9035/tunnel/0f7c5b2c9080eaa9e4d6139126daac04',
            signal: ac.signal,
            serverKey: '2934c57f790f9e99a52a121802df231c',
        })
        connection1.listen({
            clientKey: 'mmm',
            tunnelKey: 'b0f5014acad2060d6bd3730a1721c97f',
            host: '127.0.0.1',
            port: 9036,
        })
        await sleep(100)
    }

    async function createConnectClient() {
        console.info('创建连接服务 http 1')
        let connection2 = createTunnelTcpClientHttp({
            url: 'http://127.0.0.1:9035/tunnel/0f7c5b2c9080eaa9e4d6139126daac04',
            signal: ac.signal,
            serverKey: '2934c57f790f9e99a52a121802df231c',
        })
        connection2.connect({
            clientKey: 'mmm',
            tunnelKey: 'b0f5014acad2060d6bd3730a1721c97f',
            port: 9037,
        })

        await sleep(1000)
    }

    let socketCreateCount = 0
    let recvCount = 0
    async function startSendRecvTest() {
        socketCreateCount++
        console.info('tcp透传测试 start')
        let socket1 = net.createConnection({ host: '127.0.0.1', port: 9037 })
        socket1.on('error', (err) => { console.error(err.message) })
        ac.signal.addEventListener('abort', () => { socket1.destroy() })
        socket1.on('connect', async () => {
            socket1.on('data', (chunk) => {
                console.info('receive chunk ', Uint8Array_toString(chunk))
                recvCount++
            })
            while (!ac.signal.aborted && !socket1.closed) {
                await sleep(1000)
                socket1.write(`iiiiiii>>>>>>> ${new Date().toLocaleString()}`)
            }
            console.info('finished socket.')
            setTimeout(() => {
                startSendRecvTest()
            }, 1)
        })
    }

    await createEchoServer()
    let ac2 = new AbortController()
    stack.adopt(0, () => ac2.abort())
    await createDispatchServer(ac2)
    await createListenClient()
    await createConnectClient()
    await startSendRecvTest()

    await sleep(5000)
    ac2.abort()
    console.info('stop dispatch server')
    await sleep(5_000)
    ac2 = new AbortController()
    stack.adopt(0, () => ac2.abort())
    console.info('recreate dispatch server')
    await createDispatchServer(ac2)

    await sleep(20_000)

    strictEqual(socketCreateCount, 1)
    strictEqual(recvCount, 25)

    console.info('over!')
})