import { createHash } from 'node:crypto'
import net from 'node:net'
import { Readable, Writable } from 'node:stream'
import http from 'node:http'
import https from 'node:https'

/**
 * @import {WebSocketServer} from 'ws'
 * @import Router from 'koa-router'
 */

const DEBUG_TUNNEL_TCP = false
const TUNNEL_TCP_WITH_CRYPTO = true
const TUNNEL_TCP_TIME_BUFFERED = false
// const TUNNEL_TCP_QUEUE_SIZE = 15
// const TUNNEL_TCP_ACK_SIZE = 10

export const md5 = (/**@type{string}*/s) => createHash("md5").update(s).digest('hex')
export const sleep = (/** @type {number} */ timeout) => new Promise((resolve) => setTimeout(resolve, timeout))
export const sha256 = (/**@type{string}*/s) => createHash("sha256").update(s).digest('hex')
export const sha512 = (/**@type{string}*/s) => createHash("sha512").update(s).digest('hex')

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

/**
 * @param {number} size
 */
export function formatSize(size) {
    if (typeof size !== 'number') return ''
    if (size <= 0) { return '0B'.padStart(8, ' ') }
    let companys = 'B KB MB GB TB'.split(' ')
    let cur = size
    while (cur >= 1024) {
        companys.shift()
        cur /= 1024
    }
    return `${formatNumber(cur)}${companys[0]}`.padStart(8, ' ')
}

/**
 * @param {number} num
 */
export function formatNumber(num) {
    return Number(num.toFixed(2))
}

/**
 * @typedef {{
 * promise: Promise<any>;
 * resolve: (value: any | null) => void;
 * reject: (reason: any | null) => void;
 * }} PromiseResolvers
 */

export function Promise_withResolvers() {
    /** @type{(value?:object)=>void} */
    let resolve = null
    /** @type{(reason?:object)=>void} */
    let reject = null
    const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

/**
 * @param {Promise<[CryptoKey,Uint8Array]>} key_iv
 * @returns {TransformStream<Uint8Array, Uint8Array>}
 */
export function createEncodeStream(key_iv) {
    let key = null
    let iv = null
    return new TransformStream({
        async start() {
            [key, iv] = await key_iv
        },
        async transform(chunk, controller) {
            let buffer = await buildBufferData([chunk], key, iv)
            controller.enqueue(buffer)
        }
    })
}

/**
 * @param {Promise<[CryptoKey,Uint8Array]>} key_iv
 * @returns {TransformStream<Uint8Array, Uint8Array>}
 */
export function createDecodeStream(key_iv) {
    let key = null
    let iv = null
    let last = new Uint8Array(0)
    return new TransformStream({
        async start() {
            [key, iv] = await key_iv
        },
        async transform(chunk, controller) {
            let [queueReceive, remain] = await parseBufferData(Uint8Array_concat([last, chunk]), key, iv)
            last = remain
            for (const o of queueReceive) {
                controller.enqueue(o)
            }
        }
    })
}

const HEADER_CHECK = 0xb1f7705f

/**
 * @param {Uint8Array[]} queue
 * @param {CryptoKey} key
 * @param {Uint8Array} iv
 * @returns {Promise<Uint8Array>}
 */
export async function buildBufferData(queue, key, iv) {
    let buffers = []
    for (const data of queue) {
        let offset = 0
        let header = new Uint8Array(8)
        let headerCheck = HEADER_CHECK
        let buffer = await encrypt(data, key, iv)
        writeUInt32LE(header, buffer.length, offset); offset += 4
        writeUInt32LE(header, headerCheck, offset); offset += 4
        buffers.push(header, buffer)
    }
    return Uint8Array_concat(buffers)
}

/**
 * @param {Uint8Array<ArrayBuffer>} buffer
 * @param {CryptoKey} key
 * @param {Uint8Array} iv
 * @returns {Promise<[Uint8Array[],Uint8Array<ArrayBuffer>]>}
 */
export async function parseBufferData(buffer, key, iv) {
    /** @type{Uint8Array[]} */
    let queue = []
    let offset = 0
    let remain = new Uint8Array(0)
    while (offset < buffer.length) {
        if (offset + 8 > buffer.length) {
            remain = buffer.subarray(offset)
            break
        }
        let bufferLength = readUInt32LE(buffer, offset); offset += 4
        let headerCheck = readUInt32LE(buffer, offset); offset += 4
        if (offset + bufferLength > buffer.length) {
            remain = buffer.subarray(offset - 8)
            break
        }
        let check = HEADER_CHECK
        if (check !== headerCheck) {
            remain = new Uint8Array(0)
            console.error('data check error!', bufferLength, check.toString(16), headerCheck.toString(16))
            break
        }
        let data = buffer.subarray(offset, offset + bufferLength); offset += bufferLength
        let buf = await decrypt(data, key, iv)
        if (buf.length > 0) {
            queue.push(buf)
        }
    }
    return [queue, remain]
}


/**
 * @param {Uint8Array} buffer
 * @param {number} offset
 */
export function readUInt32LE(buffer, offset) {
    if (offset < 0 || offset + 4 > buffer.length) throw new RangeError('Reading out of bounds')
    return ((buffer[offset] & 0xff) |
        ((buffer[offset + 1] & 0xff) << 8) |
        ((buffer[offset + 2] & 0xff) << 16) |
        ((buffer[offset + 3] & 0xff) << 24)) >>> 0 // >>> 0 to convert to unsigned
}

/**
 * @param {Uint8Array} buffer
 * @param {number} value
 * @param {number} offset
 */
export function writeUInt32LE(buffer, value, offset) {
    if (offset < 0 || offset + 4 > buffer.length) throw new RangeError('Writing out of bounds')
    buffer[offset] = value & 0xff
    buffer[offset + 1] = (value >> 8) & 0xff
    buffer[offset + 2] = (value >> 16) & 0xff
    buffer[offset + 3] = (value >> 24) & 0xff
}

/**
 * @param {Uint8Array[]} buffers
 */
export function Uint8Array_concat(buffers) {
    const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0)
    const resultBuffer = new Uint8Array(totalLength)
    let offset = 0
    for (const buffer of buffers) {
        resultBuffer.set(buffer, offset)
        offset += buffer.length
    }
    return resultBuffer
}

/**
 * @param {*} array
 * @param {'utf-8'|'hex'|'base64'} [encoding]
 */
export function Uint8Array_from(array, encoding) {
    if (encoding == 'hex') {
        array = new Uint8Array(array.match(/[\da-f]{2}/gi).map((h) => parseInt(h, 16)))
    }
    if (encoding == 'base64') {
        array = Uint8Array.from(atob(array), (o) => o.codePointAt(0))
    }
    if (encoding == 'utf-8') {
        array = new TextEncoder().encode(array)
    }
    if (typeof array === 'string') {
        array = new TextEncoder().encode(array)
    }
    if (Array.isArray(array) || array instanceof Uint8Array) {
        return new Uint8Array(array)
    }
    throw new TypeError('Argument must be an array or Uint8Array')
}

/**
 * @param {Uint8Array} buffer
 * @param {'utf-8' | 'hex' | 'base64'} [encoding]
 */
export function Uint8Array_toString(buffer, encoding = 'utf-8') {
    if (encoding == 'hex') {
        return Array.from(buffer).map((b) => b.toString(16).padStart(2, "0")).join('')
    }
    if (encoding == 'base64') {
        return btoa(String.fromCharCode(...buffer))
    }
    // utf-8
    return new TextDecoder().decode(buffer)
}

/**
 * @param {number} number
 */
function buildBufferNumberUInt32LE(number) {
    let buffer = new Uint8Array(4)
    writeUInt32LE(buffer, number, 0)
    return buffer
}

/**
 * @param {string} string
 */
function buildBufferSizeString(string) {
    let buffer = new TextEncoder().encode(string)
    return Uint8Array_concat([
        buildBufferNumberUInt32LE(buffer.length),
        buffer,
    ])
}

/**
 * @param {Uint8Array} buffer
 * @param {number} offset
 */
function readBufferSizeString(buffer, offset) {
    let size = readUInt32LE(buffer, offset)
    let start = offset + 4
    let end = start + size
    let string = new TextDecoder().decode(buffer.slice(start, end))
    return { size: 4 + size, string }
}

export function guid() {
    let buffer = new Uint8Array(16)
    if (globalThis.crypto) {
        crypto.getRandomValues(buffer)
    } else {
        for (let i = 0; i < buffer.length; i++) {
            buffer[i] = Math.floor(Math.random() * 256)
        }
    }
    return Array.from(buffer).map((o) => o.toString(16).padStart(2, '0')).join('')
}

let tcpTunnelDataRecv = 0
let tcpTunnelDataSend = 0

/**
 * 
 * @param {TCP_TUNNEL_DATA} data 
 */
export function printTcpTunnelData(data) {
    return `id: ${`${data.srcId}:${data.dstId}`.padEnd(10)} channel: ${`${data.srcChannel}:${data.dstChannel}`.padEnd(10)} ${{
        0xa9b398d5: 'TUNNEL_TCP_TYPE_INIT      ',
        0xe41957d3: 'TUNNEL_TCP_TYPE_LISTEN    ',
        0x20993e38: 'TUNNEL_TCP_TYPE_ONLISTEN  ',
        0x11d949f8: 'TUNNEL_TCP_TYPE_CONNECT   ',
        0x377b2181: 'TUNNEL_TCP_TYPE_ONCONNECT ',
        0x48678f39: 'TUNNEL_TCP_TYPE_DATA      ',
        0x8117f762: 'TUNNEL_TCP_TYPE_ERROR     ',
        0x72fd6470: 'TUNNEL_TCP_TYPE_CLOSE     ',
        0x4768e1ba: 'TUNNEL_TCP_TYPE_PING      ',
        0x106f43fb: 'TUNNEL_TCP_TYPE_PONG      ',
        0xc5870539: 'TUNNEL_TCP_TYPE_ACK       ',
    }[data.type]} recv: ${(tcpTunnelDataRecv)} send: ${(tcpTunnelDataSend)} size:${data.buffer.length}`
}

/**
 * 
 * @param {string} password 
 * @param {number} iterations 
 * @returns {Promise<[CryptoKey,Uint8Array]>}
 */
export async function buildKeyIv(password, iterations) {
    if (!TUNNEL_TCP_WITH_CRYPTO) return [null, null]
    if (!password) return [null, null]
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveBits", "deriveKey"],
    )
    const salt = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(password))
    const pbkdf2Params = {
        name: "PBKDF2",
        salt,
        iterations: iterations,
        hash: "SHA-256",
    }
    const key = await crypto.subtle.deriveKey(
        pbkdf2Params,
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"],
    )
    const iv = await crypto.subtle.deriveBits(
        pbkdf2Params,
        keyMaterial,
        256,
    )
    return [key, new Uint8Array(iv)]
}

/**
 * 
 * @param {Uint8Array} data 
 * @param {CryptoKey} key 
 * @param {Uint8Array} iv 
 * @returns 
 */
export async function encrypt(data, key, iv) {
    if (!TUNNEL_TCP_WITH_CRYPTO) return data
    if (!key) return data
    const encryptedData = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv }, key, data
    )
    return new Uint8Array(encryptedData)
}

/**
 * @param {Uint8Array} data 
 * @param {CryptoKey} key 
 * @param {Uint8Array} iv 
 * @returns 
 */
export async function decrypt(data, key, iv) {
    if (!TUNNEL_TCP_WITH_CRYPTO) return data
    if (!key) return data
    try {
        const encryptedArray = data
        const decryptedData = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv }, key, encryptedArray
        )
        return new Uint8Array(decryptedData)
    } catch (error) {
        console.error('decrypt error', error.message)
    }
    return new Uint8Array(0)
}

/**
 * @param {AbortSignal} signal
 * @param {()=> Promise<void>} callback
 */
export async function timeWaitRetryLoop(signal, callback) {
    let waitTime = 300
    while (!signal.aborted) {
        let time = performance.now()
        try {
            await callback()
        } catch (error) {
            console.error('timeWaitRetryLoop', error.message)
        }
        if (performance.now() - time > 10_000) {
            waitTime = 300
        }
        await sleep(waitTime)
        waitTime *= 2
        if (waitTime > 60_000) {
            waitTime = 60_000
        }
    }
}

export const TUNNEL_TCP_TYPE_INIT = 0xa9b398d5 // 链接建立后返回id
export const TUNNEL_TCP_TYPE_LISTEN = 0xe41957d3
export const TUNNEL_TCP_TYPE_ONLISTEN = 0x20993e38
export const TUNNEL_TCP_TYPE_CONNECT = 0x11d949f8
export const TUNNEL_TCP_TYPE_ONCONNECT = 0x377b2181
export const TUNNEL_TCP_TYPE_DATA = 0x48678f39
export const TUNNEL_TCP_TYPE_ERROR = 0x8117f762
export const TUNNEL_TCP_TYPE_CLOSE = 0x72fd6470
export const TUNNEL_TCP_TYPE_END = 0xe8b97027
export const TUNNEL_TCP_TYPE_PING = 0x4768e1ba
export const TUNNEL_TCP_TYPE_PONG = 0x106f43fb
export const TUNNEL_TCP_TYPE_ACK = 0xc5870539

/**
 * @typedef {TUNNEL_TCP_TYPE_INIT
 * |TUNNEL_TCP_TYPE_LISTEN
 * |TUNNEL_TCP_TYPE_ONLISTEN
 * |TUNNEL_TCP_TYPE_CONNECT
 * |TUNNEL_TCP_TYPE_ONCONNECT
 * |TUNNEL_TCP_TYPE_DATA
 * |TUNNEL_TCP_TYPE_ERROR
 * |TUNNEL_TCP_TYPE_CLOSE
 * |TUNNEL_TCP_TYPE_END
 * |TUNNEL_TCP_TYPE_PING
 * |TUNNEL_TCP_TYPE_PONG
 * |TUNNEL_TCP_TYPE_ACK} TUNNEL_TCP_TYPE
 */

/**
 * @typedef {{
 * type:TUNNEL_TCP_TYPE;
 * srcId:number;
 * dstId:number;
 * srcChannel:number;
 * dstChannel:number;
 * buffer:Uint8Array;
 * }} TCP_TUNNEL_DATA
 */

/**
 * @typedef {{
 * key:string;
 * }} TUNNEL_TCP_DATA_LISTEN
 */

/**
 * @typedef {{
 * key:string;
 * }} TUNNEL_TCP_DATA_CONNECT
 */

/**
 * @typedef {{
 * time:number;
 * }} TUNNEL_TCP_DATA_PINGPONG
 */

/**
 * @typedef {{
 * id:number;
 * encodeWriter:WritableStreamDefaultWriter<Uint8Array>;
 * }} TUNNEL_TCP_SERVER
 */

/**
 * @typedef {{
 *     readable:ReadableStream<Uint8Array>;
 *     writable:WritableStream<Uint8Array>;
 *     reader:ReadableStreamDefaultReader<Uint8Array>;
 *     writer:WritableStreamDefaultWriter<Uint8Array>;
 *     dstId:number;
 * }} TUNNEL_TCP_SERVER_HELPER
 * @typedef {{
 *     readable:ReadableStream<Uint8Array>;
 *     writable:WritableStream<Uint8Array>;
 *     reader:ReadableStreamDefaultReader<Uint8Array>;
 *     writer:WritableStreamDefaultWriter<Uint8Array>;
 *     listen:(param:{ 
 *          clientKey?:string;
 *          tunnelKey:string;
 *          host?:string;
 *          port:number; 
 *        })=>Promise<void>;
 *     connect:(param:{ 
 *          clientKey?:string;
 *          tunnelKey: string;
 *          port: number;
 *        })=>Promise<void>;
 * }} TUNNEL_TCP_CLIENT_HELPER
 */

/**
 * @param {TCP_TUNNEL_DATA} box
 */
export function buildTcpTunnelData(box) {
    let offset = 0
    let header = new Uint8Array(20)
    writeUInt32LE(header, box.type, offset); offset += 4
    writeUInt32LE(header, box.srcId, offset); offset += 4
    writeUInt32LE(header, box.dstId, offset); offset += 4
    writeUInt32LE(header, box.srcChannel, offset); offset += 4
    writeUInt32LE(header, box.dstChannel, offset); offset += 4
    return Uint8Array_concat([header, box.buffer,])
}

/**
 * @param {Uint8Array} buffer
 */
export function parseTcpTunnelData(buffer) {
    let offset = 0
    /** @type{*} */
    let type = readUInt32LE(buffer, offset); offset += 4
    let src_id = readUInt32LE(buffer, offset); offset += 4
    let dst_id = readUInt32LE(buffer, offset); offset += 4
    let src_channel = readUInt32LE(buffer, offset); offset += 4
    let dst_channel = readUInt32LE(buffer, offset); offset += 4
    let data = buffer.subarray(offset)
    /** @type{TCP_TUNNEL_DATA} */
    let box = { type, srcId: src_id, dstId: dst_id, srcChannel: src_channel, dstChannel: dst_channel, buffer: data }
    return box
}

/**
 * @param {number} bufferTime
 */
export function createTimeBufferedTransformStream(bufferTime) {
    if (!TUNNEL_TCP_TIME_BUFFERED) {
        return new TransformStream()
    }
    let maxloop = Math.floor(Math.max(5_000 / bufferTime, 3))
    /** @type{()=>void} */
    let callback = null
    const runCallback = () => {
        if (callback != null) {
            callback()
            callback = null
        }
        if (loop-- < 0) {
            clean()
        }
    }
    let loop = 0
    let queue = []
    let time = performance.now()
    let timer = null
    let transform = new TransformStream({
        async transform(chunk, controller) {
            if (chunk.length < 100) {
                loop += chunk.length
                if (loop > maxloop) {
                    loop = maxloop
                }
                if (timer == null) {
                    timer = setInterval(runCallback, bufferTime)
                    console.info('create loop timer')
                }
            }
            if (timer == null || chunk.length > 1024) {
                runCallback()
                controller.enqueue(chunk)
                return
            }
            queue.push(chunk)
            callback = () => {
                if (queue.length > 0) {
                    controller.enqueue(Uint8Array_concat(queue))
                    queue = []
                    time = performance.now()
                }
            }
            if (performance.now() - time > bufferTime) {
                runCallback()
            }
        },
        flush() {
            clean()
        }
    })

    const clean = () => {
        if (timer == null) {
            return
        }
        console.info('clean loop timer')
        clearInterval(timer)
        timer = null
        runCallback()
    }

    return transform
}

/**
 * @param {Map<number,SocketChannel>} channelMap
 * @param {number} channelId
 * @param {WritableStreamDefaultWriter<Uint8Array>} encodeWriter
 */
export function pipeSocketDataWithChannel(channelMap, channelId, encodeWriter) {
    let channel = channelMap.get(channelId)
    let socket = channel.socket
    let signal = Promise_withResolvers()
    signal.resolve()
    let sendPackSize = 0
    let recvPackSize = 0
    channel.notify = (size) => {
        recvPackSize = size
        signal.resolve()
    }
    let [clientKey, clientIv] = channel.key_iv
    let bufferedTransform = createTimeBufferedTransformStream(50)
    Readable.toWeb(socket).pipeThrough(bufferedTransform).pipeTo(new WritableStream({
        async write(chunk) {
            const buffer = await encrypt(chunk, clientKey, clientIv)
            let bufferPackSize = sendPackSize - recvPackSize
            if (bufferPackSize > 10) {
                signal.resolve()
                signal = Promise_withResolvers()
                if (DEBUG_TUNNEL_TCP) {
                    console.info('stop wait signal', ' sendPackSize:', sendPackSize, ' recvPackSize:', recvPackSize, ' bufferPackSize:', bufferPackSize)
                }
            }
            await signal.promise
            await encodeWriter.write(buildTcpTunnelData({
                type: TUNNEL_TCP_TYPE_DATA,
                srcId: channel.srcId,
                srcChannel: channel.srcChannel,
                dstId: channel.dstId,
                dstChannel: channel.dstChannel,
                buffer: buffer,
            })).catch((err) => { console.error('web stream write error', err.message) })
            sendPackSize++
        },
        async close() {
            await encodeWriter.write(buildTcpTunnelData({
                type: TUNNEL_TCP_TYPE_END,
                srcId: channel.srcId,
                srcChannel: channel.srcChannel,
                dstId: channel.dstId,
                dstChannel: channel.dstChannel,
                buffer: new Uint8Array(0),
            })).catch((err) => { console.error('web stream write error', err.message) })
        }
    })).catch((err) => {
        console.error('web stream error', err.message)
    })
    socket.on('close', async() => {
        await signal.promise
        encodeWriter.write(buildTcpTunnelData({
            type: TUNNEL_TCP_TYPE_CLOSE,
            srcId: channel.srcId,
            srcChannel: channel.srcChannel,
            dstId: channel.dstId,
            dstChannel: channel.dstChannel,
            buffer: new Uint8Array(0),
        })).catch((err) => { console.error('web stream write error', err.message) })
        channelMap.delete(channelId)
    })
    socket.on('error', (err) => {
        console.error('pipeSocketDataWithChannel on error ', err.message)
        encodeWriter.write(buildTcpTunnelData({
            type: TUNNEL_TCP_TYPE_ERROR,
            srcId: channel.srcId,
            srcChannel: channel.srcChannel,
            dstId: channel.dstId,
            dstChannel: channel.dstChannel,
            buffer: new Uint8Array(0),
        })).catch((err) => { console.error('web stream write error', err.message) })
        channelMap.delete(channelId)
    })
}

/**
 * @param {TunnelTcpServerHelperParam} param
 * @param {TCP_TUNNEL_DATA} data
 */
function natTunnelData(param, data) {
    // if (data.dstId != param.serverId) {
    //     return
    // }
    // /** @type{Map<number,number>} */
    // let natId = new Map()
    // /** @type{Map<number,number>} */
    // let natChannel = new Map()
    // data.dstId = natId.get(data.dstId)
    // data.dstChannel = natChannel.get(data.dstChannel)
    // data.srcId = natId.get(data.srcId)
    // data.srcChannel = natChannel.get(data.srcChannel)
}

/**
 * @param {TunnelTcpServerHelperParam} param
 * @param {WritableStreamDefaultWriter<Uint8Array<ArrayBufferLike>>} encodeWriter
 * @param {Uint8Array<ArrayBufferLike>} chunk
 */
async function dispatchServerBufferData(param, encodeWriter, chunk) {
    let data = parseTcpTunnelData(chunk)
    if (DEBUG_TUNNEL_TCP) {
        tcpTunnelDataRecv += chunk.length
        console.info('recv', printTcpTunnelData(data))
    }
    natTunnelData(param, data)
    if (data.type == TUNNEL_TCP_TYPE_LISTEN) {
        /** @type{TUNNEL_TCP_DATA_LISTEN} */
        let o = JSON.parse(Uint8Array_toString(data.buffer))
        param.listenMap.set(o.key, data.srcId)
        data.type = TUNNEL_TCP_TYPE_ONLISTEN
        data.dstId = data.srcId
    }

    if (data.type == TUNNEL_TCP_TYPE_CONNECT) {
        /** @type{TUNNEL_TCP_DATA_CONNECT} */
        let o = JSON.parse(Uint8Array_toString(data.buffer))
        let dstId = param.listenMap.get(o.key)
        data.dstId = dstId
        if (!param.dstMap.has(dstId)) {
            param.listenMap.delete(o.key)
        }
    }

    let dstWriter = param.dstMap.get(data.dstId)
    if (!dstWriter) {
        data.type = TUNNEL_TCP_TYPE_CLOSE
        data.dstId = data.srcId
        data.dstChannel = data.srcChannel
        let srcWriter = param.dstMap.get(data.dstId)
        if (srcWriter) {
            await srcWriter.encodeWriter.write(buildTcpTunnelData(data))
        } else {
            await encodeWriter.write(buildTcpTunnelData(data))
        }
    } else {
        await dstWriter.encodeWriter.write(buildTcpTunnelData(data))
    }
}

/**
 * @param {TunnelTcpClientHelperParam} param
 * @param {{ (): Promise<void>; }} setup
 * @param {Map<string,{host:string;port:number;key_iv:[CryptoKey, Uint8Array]}>} listenKeyParamMap
 * @param {Map<number, SocketChannel>} channelMap
 * @param {WritableStreamDefaultWriter<Uint8Array<ArrayBufferLike>>} encodeWriter
 * @param {Uint8Array<ArrayBufferLike>} buffer
 */
async function dispatchClientBufferData(param, setup, listenKeyParamMap, channelMap, encodeWriter, buffer) {
    let data = parseTcpTunnelData(buffer)
    if (DEBUG_TUNNEL_TCP) {
        tcpTunnelDataRecv += buffer.length
        console.info('recv', printTcpTunnelData(data))
    }
    if (data.type == TUNNEL_TCP_TYPE_INIT) {
        param.clientDataId = data.dstId
        await setup()
    }
    if (data.type == TUNNEL_TCP_TYPE_ONLISTEN) {
    }
    if (data.type == TUNNEL_TCP_TYPE_CONNECT) {
        /** @type{TUNNEL_TCP_DATA_CONNECT} */
        let o = JSON.parse(Uint8Array_toString(data.buffer))
        let { host, port, key_iv } = listenKeyParamMap.get(o.key)
        let connectSocket = net.createConnection({ host: host || '127.0.0.1', port: port })
        let channelId = param.uniqueId++
        /** @type{SocketChannel} */
        let channel = {
            writer: Writable.toWeb(connectSocket).getWriter(),
            socket: connectSocket,
            srcId: data.dstId,
            dstId: data.srcId,
            srcChannel: channelId,
            dstChannel: data.srcChannel,
            recvPackSize: 0,
            key_iv,
            notify: null,
        }
        channelMap.set(channelId, channel)
        connectSocket.on('connect', () => {
            encodeWriter.write(buildTcpTunnelData({
                type: TUNNEL_TCP_TYPE_ONCONNECT,
                srcId: channel.srcId,
                srcChannel: channel.srcChannel,
                dstId: channel.dstId,
                dstChannel: channel.dstChannel,
                buffer: data.buffer
            }))
        })
        pipeSocketDataWithChannel(channelMap, channelId, encodeWriter)
    }
    if (data.type == TUNNEL_TCP_TYPE_ONCONNECT) {
        let channelId = data.dstChannel
        let channel = channelMap.get(channelId)
        if (channel) {
            channel.dstId = data.srcId
            channel.dstChannel = data.srcChannel
            pipeSocketDataWithChannel(channelMap, channelId, encodeWriter)
            /** @type{TUNNEL_TCP_DATA_PINGPONG} */
            let pingData = { time: Date.now() }
            await encodeWriter.write(buildTcpTunnelData({
                type: TUNNEL_TCP_TYPE_PING,
                srcId: channel.srcId,
                srcChannel: channel.srcChannel,
                dstId: channel.dstId,
                dstChannel: channel.dstChannel,
                buffer: Uint8Array_from(JSON.stringify(pingData)),
            }))
        } else {
            await closeRemoteChannel(encodeWriter, data)
        }
    }
    if (data.type == TUNNEL_TCP_TYPE_PING) {
        let channelId = data.dstChannel
        let channel = channelMap.get(channelId)
        if (channel) {
            channel.srcId = data.dstId
            channel.dstId = data.srcId
            await encodeWriter.write(buildTcpTunnelData({
                type: TUNNEL_TCP_TYPE_PONG,
                srcId: channel.srcId,
                srcChannel: channel.srcChannel,
                dstId: channel.dstId,
                dstChannel: channel.dstChannel,
                buffer: data.buffer,
            }))
        } else {
            await closeRemoteChannel(encodeWriter, data)
        }
    }
    if (data.type == TUNNEL_TCP_TYPE_PONG) {
        let channelId = data.dstChannel
        let channel = channelMap.get(channelId)
        if (channel) {
            channel.srcId = data.dstId
            channel.dstId = data.srcId
            /** @type{TUNNEL_TCP_DATA_PINGPONG} */
            let pingData = JSON.parse(Uint8Array_toString(data.buffer))
            console.info('createTunnelTcpClientHelper ', 'ping time', (Date.now() - pingData.time))
        } else {
            await closeRemoteChannel(encodeWriter, data)
        }
    }
    if (data.type == TUNNEL_TCP_TYPE_CLOSE) {
        let channelId = data.dstChannel
        let channel = channelMap.get(channelId)
        if (channel) {
            channelMap.delete(channelId)
            channel.socket.destroy()
        }
    }
    if (data.type == TUNNEL_TCP_TYPE_END) {
        let channelId = data.dstChannel
        let channel = channelMap.get(channelId)
        if (channel) {
            channel.socket.end()
        }
    }
    if (data.type == TUNNEL_TCP_TYPE_ERROR) {
        let channelId = data.dstChannel
        let channel = channelMap.get(channelId)
        if (channel) {
            channelMap.delete(channelId)
            channel.socket.destroy()
        }
    }
    if (data.type == TUNNEL_TCP_TYPE_DATA) {
        let channelId = data.dstChannel
        let channel = channelMap.get(channelId)
        if (channel) {
            channel.srcId = data.dstId
            channel.dstId = data.srcId
            let [clientKey, clientIv] = channel.key_iv
            let buffer = await decrypt(data.buffer, clientKey, clientIv)
            if (buffer.length > 0) {
                await channel.writer.write(buffer)
            }
            channel.recvPackSize++
            await sendAck(encodeWriter, channel)
        } else {
            await closeRemoteChannel(encodeWriter, data)
        }
    }
    if (data.type == TUNNEL_TCP_TYPE_ACK) {
        let channelId = data.dstChannel
        let channel = channelMap.get(channelId)
        if (channel) {
            channel.srcId = data.dstId
            channel.dstId = data.srcId
            let size = readUInt32LE(data.buffer, 0)
            channel.notify(size)
        } else {
            await closeRemoteChannel(encodeWriter, data)
        }
    }
}

/**
 * @param {WritableStreamDefaultWriter<Uint8Array>} encodeWriter
 * @param {SocketChannel} channel
 */
export async function sendAck(encodeWriter, channel) {
    if (channel.recvPackSize % 5 != 0) {
        return
    }
    let sizeBuffer = new Uint8Array(4)
    writeUInt32LE(sizeBuffer, channel.recvPackSize, 0)
    await encodeWriter.write(buildTcpTunnelData({
        type: TUNNEL_TCP_TYPE_ACK,
        srcId: channel.srcId,
        srcChannel: channel.srcChannel,
        dstId: channel.dstId,
        dstChannel: channel.dstChannel,
        buffer: sizeBuffer,
    }))
}

/**
 * @param {WritableStreamDefaultWriter<Uint8Array>} encodeWriter
 * @param {TCP_TUNNEL_DATA} data
 */
export async function closeRemoteChannel(encodeWriter, data) {
    await encodeWriter.write(buildTcpTunnelData({
        type: TUNNEL_TCP_TYPE_CLOSE,
        srcId: data.dstId,
        srcChannel: data.dstChannel,
        dstId: data.srcId,
        dstChannel: data.srcChannel,
        buffer: new Uint8Array(0),
    })).catch((err) => { console.error('closeRemoteChannel stream write error', err.message) })
}

/**
 * @typedef {{
 * writer:WritableStreamDefaultWriter<Uint8Array>;
 * socket:net.Socket;
 * srcId:number;
 * dstId:number;
 * srcChannel:number;
 * dstChannel:number;
 * notify:(size:number)=>void;
 * recvPackSize:number;
 * key_iv:[CryptoKey, Uint8Array];
 * }} SocketChannel
 */


/**
 * @typedef {{
 * uniqueId:number;
 * listenMap:Map<string,number>;
 * dstMap:Map<number,TUNNEL_TCP_SERVER>;
 * serverKey?:string;
 * }} TunnelTcpServerHelperParam
 */

/**
 * @typedef {{
 * signal:AbortSignal;
 * serverKey?:string;
 * uniqueId:number;
 * clientDataId:number;
 * }} TunnelTcpClientHelperParam 
 */

/**
 * @param {TunnelTcpServerHelperParam} param 
 */
export function createTunnelTcpServerHelper(param) {
    let server_key_iv = buildKeyIv(param.serverKey, 10)
    let encode = createEncodeStream(server_key_iv)
    let decode = createDecodeStream(server_key_iv)
    let encodeWriter = encode.writable.getWriter()

    if (DEBUG_TUNNEL_TCP) {
        let writer = encodeWriter
        encodeWriter = new WritableStream({
            async write(chunk) {
                tcpTunnelDataSend += chunk.length
                let data = parseTcpTunnelData(chunk)
                console.info('send', printTcpTunnelData(data))
                writer.write(chunk)
            }
        }).getWriter()
    }

    decode.readable.pipeTo(new WritableStream({
        async write(chunk) {
            try {
                await dispatchServerBufferData(param, encodeWriter, chunk)
            } catch (error) {
                console.error('decode.readable.pipeTo.write', error.message)
            }
        }
    }))

    let id = param.uniqueId++
    param.dstMap.set(id, { id, encodeWriter: encodeWriter })
    encodeWriter.write(buildTcpTunnelData({
        type: TUNNEL_TCP_TYPE_INIT,
        srcId: 0,
        srcChannel: 0,
        dstId: id,
        dstChannel: 0,
        buffer: new Uint8Array(0),
    }))

    /** @type{TUNNEL_TCP_SERVER_HELPER} */
    let helper = { readable: encode.readable, writable: decode.writable, reader: null, writer: null, dstId: id, }
    return helper
}

/**
 * @param {TunnelTcpClientHelperParam} param 
 */
export function createTunnelTcpClientHelper(param) {
    /** @type{Map<number,SocketChannel>} */
    let channelMap = new Map()

    /** @type{Map<string,{host:string;port:number;key_iv:[CryptoKey, Uint8Array]}>} */
    let listenKeyParamMap = new Map()

    let server_key_iv = buildKeyIv(param.serverKey, 10)

    param.signal.addEventListener('abort', () => {
        channelMap.values().forEach(o => {
            o.socket.destroy()
        })
    })

    let encode = createEncodeStream(server_key_iv)
    let decode = createDecodeStream(server_key_iv)
    let encodeWriter = encode.writable.getWriter()
    if (DEBUG_TUNNEL_TCP) {
        let writer = encodeWriter
        encodeWriter = new WritableStream({
            async write(chunk) {
                tcpTunnelDataSend += chunk.length
                let data = parseTcpTunnelData(chunk)
                console.info('send', printTcpTunnelData(data))
                writer.write(chunk)
            }
        }).getWriter()
    }

    decode.readable.pipeTo(new WritableStream({
        async write(buffer) {
            try {
                await dispatchClientBufferData(param, setup, listenKeyParamMap, channelMap, encodeWriter, buffer)
            } catch (error) {
                console.error('decode.readable.pipeTo.write', error.message)
            }
        }
    }))

    let outParam = param
    let listenParams = new Set()

    async function setup() {
        channelMap.forEach((channel) => {
            channel.srcId = param.clientDataId
            /** @type{TUNNEL_TCP_DATA_PINGPONG} */
            let pingData = { time: Date.now() }
            encodeWriter.write(buildTcpTunnelData({
                type: TUNNEL_TCP_TYPE_PING,
                srcId: channel.srcId,
                srcChannel: channel.srcChannel,
                dstId: channel.dstId,
                dstChannel: channel.dstChannel,
                buffer: Uint8Array_from(JSON.stringify(pingData)),
            }))
        })
        for (const param of listenParams) {
            await listen(param)
        }
    }

    /**
     * @param {{ 
     * clientKey?:string;
     * tunnelKey:string;
     * host?:string;
     * port:number; 
     * }} param
     */
    async function listen(param) {
        listenParams.add(param)
        console.info('listenParams size', listenParams.size)
        if (outParam.clientDataId < 1) {
            console.info('skip send listen dataId == 0')
            return
        }
        let key = sha512(param.tunnelKey)
        let key_iv = await buildKeyIv(param.clientKey, 10)
        listenKeyParamMap.set(key, { host: param.host, port: param.port, key_iv })
        /** @type{TUNNEL_TCP_DATA_LISTEN} */
        let listenData = { key: key }
        await encodeWriter.write(buildTcpTunnelData({
            type: TUNNEL_TCP_TYPE_LISTEN,
            srcId: outParam.clientDataId,
            srcChannel: 0,
            dstId: 0,
            dstChannel: 0,
            buffer: Uint8Array_from(JSON.stringify(listenData)),
        }))
    }

    /**
     * @param {{ 
     * clientKey?:string;
     * tunnelKey: string;
     * port: number;
     * }} param
     */
    async function connect(param) {
        let key_iv = await buildKeyIv(param.clientKey, 10)
        let server = net.createServer((socket) => {
            let channelId = outParam.uniqueId++
            socket.on('error', (err) => {
                console.error('createTunnelTcpClientHelper on socket error', err.message)
                channelMap.delete(channelId)
            })
            /** @type{TUNNEL_TCP_DATA_CONNECT} */
            let connectData = { key: sha512(param.tunnelKey) }
            /** @type{SocketChannel} */
            let channel = {
                writer: Writable.toWeb(socket).getWriter(),
                socket,
                srcId: outParam.clientDataId,
                srcChannel: channelId,
                dstId: 0,
                dstChannel: 0,
                recvPackSize: 0,
                key_iv,
                notify: null,
            }
            channelMap.set(channelId, channel)
            encodeWriter.write(buildTcpTunnelData({
                type: TUNNEL_TCP_TYPE_CONNECT,
                srcId: channel.srcId,
                srcChannel: channel.srcChannel,
                dstId: channel.dstId,
                dstChannel: channel.dstChannel,
                buffer: Uint8Array_from(JSON.stringify(connectData)),
            }))
        }).listen(param.port)
        server.on('error', (err) => {
            console.error('createTunnelTcpClientHelper connect on server error', err.message)
        })
        outParam.signal.addEventListener('abort', () => { server.close() })
    }

    /** @type{TUNNEL_TCP_CLIENT_HELPER} */
    let helper = { readable: encode.readable, writable: decode.writable, reader: null, writer: null, listen, connect }
    return helper

}


/**
 * @param {{
 * signal:AbortSignal;
 * serverKey:string;
 * port:number
 * }} param 
 */
export function createTunnelTcpServerSocket(param) {
    /** @type{TunnelTcpServerHelperParam} */
    let helperParam = {
        serverKey: param.serverKey,
        uniqueId: 1,
        listenMap: new Map(),
        dstMap: new Map(),
    }
    let server = net.createServer(async (socket) => {
        let helper = createTunnelTcpServerHelper(helperParam)
        helper.readable.pipeTo(Writable.toWeb(socket)).catch((err) => {
            console.error('web stream error', err.message)
        })
        Readable.toWeb(socket).pipeTo(helper.writable).catch((err) => {
            console.error('web stream error', err.message)
        })
        socket.on('end', () => {
            console.info('createTunnelTcpServerSocket socket on end')
            helperParam.dstMap.delete(helper.dstId)
        })
        socket.on('close', () => {
            console.info('createTunnelTcpServerSocket socket on close')
            helperParam.dstMap.delete(helper.dstId)
        })
        socket.on('error', (err) => {
            console.error('createTunnelTcpServerSocket socket on error', err.message)
            helperParam.dstMap.delete(helper.dstId)
        })
    }).listen(param.port)
    param.signal.addEventListener('abort', () => {
        server.close()
    })
    return server
}

/**
 * @param {{
 * signal:AbortSignal;
 * serverKey?:string;
 * serverHost:string;
 * serverPort:number;
 * }} param 
 */
export function createTunnelTcpClientSocket(param) {
    let helper = createTunnelTcpClientHelper({
        serverKey: param.serverKey,
        uniqueId: 1,
        clientDataId: 0,
        signal: param.signal,
    })
    helper.writer = helper.writable.getWriter()
    let signal = Promise_withResolvers()
    /** @type{WritableStreamDefaultWriter<Uint8Array>} */
    let socketWriter = null
    helper.readable.pipeTo(new WritableStream({
        async write(chunk) {
            while (!param.signal.aborted && socketWriter == null) {
                await signal.promise
            }
            if (!param.signal.aborted) {
                await socketWriter.write(chunk)
            }
        }
    }))
    async function connectSocket() {
        let promise = Promise_withResolvers()
        let socket = net.createConnection({
            host: param.serverHost,
            port: param.serverPort,
        })
        socket.once('connect', () => {
            socketWriter = Writable.toWeb(socket).getWriter()
            Readable.toWeb(socket).pipeTo(new WritableStream({
                async write(chunk) {
                    await helper.writer.write(chunk)
                }
            })).catch((err) => { console.error('web stream error', err.message) })
            signal.resolve()
        })
        socket.on('error', (err) => {
            console.error('createTunnelTcpClientSocket on error', err.message)
            promise.resolve()
        })
        socket.on('close', (err) => {
            console.info('createTunnelTcpClientSocket on close')
            promise.resolve()
        })
        const listenerAC = () => { socket.destroy() }
        param.signal.addEventListener('abort', listenerAC)
        await promise.promise
        param.signal.removeEventListener('abort', listenerAC)
        socketWriter = null
        signal.resolve()
        signal = Promise_withResolvers()
    }
    timeWaitRetryLoop(param.signal, async () => {
        console.info('createTunnelTcpClientSocket timeWaitRetryLoop', 'connectSocket')
        await connectSocket()
    })

    return helper
}


/**
 * @param {{
 * path:string;
 * wss:WebSocketServer;
 * signal:AbortSignal;
 * serverKey:string;
 * }} param 
 */
export function createTunnelTcpServerWebSocket(param) {
    /** @type{TunnelTcpServerHelperParam} */
    let helperParam = {
        serverKey: param.serverKey,
        uniqueId: 1,
        listenMap: new Map(),
        dstMap: new Map(),
    }
    const wss = param.wss
    wss.on('connection', (ws, req) => {
        if (req.url !== param.path) {
            console.error('valid path error', req.url)
            ws.close()
            return
        }
        let helper = createTunnelTcpServerHelper(helperParam)
        helper.writer = helper.writable.getWriter()
        helper.readable.pipeTo(new WritableStream({
            async write(chunk) {
                await new Promise((resolve) => {
                    ws.send(chunk, resolve)
                })
            }
        }))

        ws.on('message', async (/**@type{*}*/buffer) => {
            if (helper.writer.desiredSize <= 0) {
                ws.pause()
            }
            await helper.writer.write(buffer)
            ws.resume()
        })
        ws.on('end', () => {
            console.info('createTunnelTcpServerWebSocket connection ws on end')
            helperParam.dstMap.delete(helper.dstId)
        })
        ws.on('close', (code) => {
            console.info('createTunnelTcpServerWebSocket connection ws on close', code)
            helperParam.dstMap.delete(helper.dstId)
        })
        ws.on('error', (err) => {
            console.error('createTunnelTcpServerWebSocket connection ws on error', err.message)
            helperParam.dstMap.delete(helper.dstId)
        })
    })
}

/**
 * @param {{
 * signal:AbortSignal;
 * serverKey:string;
 * url:string;
 * }} param 
 */
export function createTunnelTcpClientWebSocket(param) {
    let helper = createTunnelTcpClientHelper({
        serverKey: param.serverKey,
        uniqueId: 1,
        clientDataId: 0,
        signal: param.signal,
    })
    helper.writer = helper.writable.getWriter()
    let signal = Promise_withResolvers()
    /** @type{WritableStreamDefaultWriter<Uint8Array>} */
    let socketWriter = null
    helper.readable.pipeTo(new WritableStream({
        async write(chunk) {
            while (!param.signal.aborted && socketWriter == null) {
                await signal.promise
            }
            if (!param.signal.aborted) {
                await socketWriter.write(chunk)
            }
        }
    }))

    async function connectWebSocket() {
        let promise = Promise_withResolvers()
        const ws = new WebSocket(param.url)
        ws.addEventListener('open', () => {
            socketWriter = new WritableStream({
                async write(chunk) {
                    ws.send(chunk)
                }
            }).getWriter()
            ws.addEventListener('message', async (ev) => {
                let buffer = await ev.data.arrayBuffer()
                await helper.writer.write(new Uint8Array(buffer))
            })
            signal.resolve()
        })
        ws.addEventListener('error', (ev) => {
            console.error('createTunnelTcpClientWebSocket connectWebSocket on error')
            promise.resolve()
        })
        ws.addEventListener('close', (ev) => {
            console.info('createTunnelTcpClientWebSocket connectWebSocket on close')
            promise.resolve()
        })
        const listenerAC = () => { ws.close() }
        param.signal.addEventListener('abort', listenerAC)
        await promise.promise
        param.signal.removeEventListener('abort', listenerAC)
        socketWriter = null
        signal.resolve()
        signal = Promise_withResolvers()
    }

    timeWaitRetryLoop(param.signal, async () => {
        console.info('createTunnelTcpClientWebSocket timeWaitRetryLoop', 'connectWebSocket')
        await connectWebSocket()
    })

    return helper
}

/**
 * @param {{
 * path:string;
 * router:Router<any, {}>;
 * signal:AbortSignal;
 * serverKey?:string;
 * }} param 
 */
export function createTunnelTcpServerKoaRouter(param) {
    /** @type{TunnelTcpServerHelperParam} */
    let helperParam = {
        serverKey: param.serverKey,
        uniqueId: 1,
        listenMap: new Map(),
        dstMap: new Map(),
    }

    param.router.post(param.path, async (ctx) => {
        console.info('clientId:', 'createTunnelTcpServerKoaRouter on post ' + param.path)
        let helper = createTunnelTcpServerHelper(helperParam)
        helper.writer = helper.writable.getWriter()
        helper.reader = helper.readable.getReader()
        ctx.req.on('error', (e) => { console.error('createTunnelTcpServerKoaRouter in req error', e.message) })
        Readable.toWeb(ctx.req).pipeTo(new WritableStream({
            async write(chunk) {
                await helper.writer.write(chunk)
            }
        })).catch((err) => { console.error('web stream error', err.message) })

        ctx.status = 200
        ctx.response.set({
            'Cache-Control': 'no-cache',
            'Content-Type': 'application/octet-stream'
        })
        ctx.body = Readable.fromWeb(new ReadableStream({
            async pull(controller) {
                let o = await helper.reader.read()
                controller.enqueue(o.value)
            },
            cancel() {
                helperParam.dstMap.delete(helper.dstId)
            }
        })).on('error', (err) => { console.error('web stream error', err.message) })
    })
}

/**
 * @param {string} url 
 * @returns {http}
 */
export function getHttpx(url) {
    /** @type{*} */
    let httpx = http
    if (url.startsWith('https:')) {
        httpx = https
    }
    return httpx
}

/**
 * @param {{
 * signal:AbortSignal;
 * serverKey?:string;
 * url:string;
 * timeout?:number;
 * oncreateoutconnect?:()=>{};
 * headersFn?:()=>Promise<object>;
 * }} param 
 */
export function createTunnelTcpClientHttp(param) {
    let helper = createTunnelTcpClientHelper({
        serverKey: param.serverKey,
        signal: param.signal,
        uniqueId: 1,
        clientDataId: 0,
    })
    helper.writer = helper.writable.getWriter()
    let signal = Promise_withResolvers()
    /** @type{WritableStreamDefaultWriter<Uint8Array>} */
    let socketWriter = null
    let bufferedTransform = createTimeBufferedTransformStream(50)
    helper.readable.pipeThrough(bufferedTransform).pipeTo(new WritableStream({
        async write(chunk) {
            while (!param.signal.aborted && socketWriter == null) {
                await signal.promise
            }
            if (!param.signal.aborted) {
                await socketWriter.write(chunk)
            }
        }
    })).catch((err) => { console.error('web stream error', err.message) })

    /** @type{Set<()=>void>} */
    const abortListenerSet = new Set()
    param.signal.addEventListener('abort', () => {
        abortListenerSet.forEach(o => o())
    })
    async function createConnectionHttpx() {
        console.info('createTunnelTcpClientHttpV2 createConnectionHttpx')
        let addHeaders = {}
        if (param.headersFn) {
            addHeaders = await param.headersFn()
        }
        const ac = new AbortController()
        const listenerAC = () => { ac.abort() }
        let promise = Promise_withResolvers()
        let transform = new TransformStream()
        socketWriter = transform.writable.getWriter()
        signal.resolve()
        abortListenerSet.add(listenerAC)
        let httpx = getHttpx(param.url)
        let req = httpx.request(param.url, {
            method: 'POST',
            signal: ac.signal,
            timeout: param.timeout ?? 24 * 3600 * 1000,
            headers: {
                'Content-Type': 'application/octet-stream',
                ...addHeaders,
            },
        }, (res) => {
            param.oncreateoutconnect && param.oncreateoutconnect()
            Readable.toWeb(res).pipeTo(new WritableStream({
                async write(chunk) {
                    await helper.writer.write(chunk)
                }
            })).catch((err) => {
                console.error('web stream error', err.message)
            })
            res.on('error', (e) => {
                console.error('createConnectionHttpx res error ', e.message)
                promise.resolve()
            })
            res.on('close', () => {
                console.error('createConnectionHttpx res close ')
                promise.resolve()
            })
        })
        Readable.fromWeb(transform.readable).pipe(req)
        req.flushHeaders()
        req.on('error', (e) => {
            console.error('createConnectionHttpx', e.message)
            promise.resolve()
        })
        req.on('close', () => {
            console.error('createConnectionHttpx req close')
            promise.resolve()
        })
        await promise.promise
        abortListenerSet.delete(listenerAC)
        socketWriter = null
        signal.resolve()
        signal = Promise_withResolvers()
    }

    timeWaitRetryLoop(param.signal, async () => {
        await createConnectionHttpx()
    })

    return helper
}