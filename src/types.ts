import net from 'node:net'
import { WritableStream, ReadableStream, ReadableStreamDefaultReader, WritableStreamDefaultWriter } from "stream/web"


export type PromiseResolvers = {
    promise: Promise<any>
    resolve: (value: any | null) => void
    reject: (reason: any | null) => void
}

export type TUNNEL_TCP_TYPE_INIT = 0xa9b398d5 // 链接建立后返回id
export type TUNNEL_TCP_TYPE_LISTEN = 0xe41957d3
export type TUNNEL_TCP_TYPE_ONLISTEN = 0x20993e38
export type TUNNEL_TCP_TYPE_CONNECT = 0x11d949f8
export type TUNNEL_TCP_TYPE_ONCONNECT = 0x377b2181
export type TUNNEL_TCP_TYPE_DATA = 0x48678f39
export type TUNNEL_TCP_TYPE_ERROR = 0x8117f762
export type TUNNEL_TCP_TYPE_CLOSE = 0x72fd6470
export type TUNNEL_TCP_TYPE_PING = 0x4768e1ba
export type TUNNEL_TCP_TYPE_PONG = 0x106f43fb
export type TUNNEL_TCP_TYPE_ACK = 0xc5870539

export type TUNNEL_TCP_TYPE = TUNNEL_TCP_TYPE_INIT |
    TUNNEL_TCP_TYPE_LISTEN |
    TUNNEL_TCP_TYPE_ONLISTEN |
    TUNNEL_TCP_TYPE_CONNECT |
    TUNNEL_TCP_TYPE_ONCONNECT |
    TUNNEL_TCP_TYPE_DATA |
    TUNNEL_TCP_TYPE_ERROR |
    TUNNEL_TCP_TYPE_CLOSE |
    TUNNEL_TCP_TYPE_PING |
    TUNNEL_TCP_TYPE_PONG |
    TUNNEL_TCP_TYPE_ACK

export type TCP_TUNNEL_DATA = {
    type: TUNNEL_TCP_TYPE
    srcId: number
    dstId: number
    srcChannel: number
    dstChannel: number
    buffer: Uint8Array<ArrayBuffer>
}

export type TUNNEL_TCP_DATA_LISTEN = {
    key: string
}

export type TUNNEL_TCP_DATA_CONNECT = {
    key: string
}

export type TUNNEL_TCP_DATA_PINGPONG = {
    time: number
}

export type TUNNEL_TCP_SERVER = {
    id: number
    encodeWriter: WritableStreamDefaultWriter<Uint8Array>
}

export type ListenParam = {
    clientKey?: string;
    tunnelKey: string;
    host?: string;
    port: number;
}

export type ConnectParam = {
    clientKey?: string;
    tunnelKey: string;
    port: number;
}

export type SocketChannel = {
    writer: WritableStreamDefaultWriter<Uint8Array<ArrayBuffer>>
    socket: net.Socket
    srcId: number
    dstId: number
    srcChannel: number
    dstChannel: number
    recvPackSize: number
    writableNeedDrainCount: number
    key_iv: [CryptoKey, Uint8Array<ArrayBuffer>]
}


export type TunnelTcpServerHelperParam = {
    uniqueId: number
    listenMap: Map<string, number>
    dstMap: Map<number, TUNNEL_TCP_SERVER>
    serverKey?: string
}

export type TunnelTcpClientHelperParam = {
    signal: AbortSignal
    serverKey?: string
    uniqueId: number
    clientDataId: number
}
