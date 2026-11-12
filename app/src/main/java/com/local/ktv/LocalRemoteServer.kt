package com.local.ktv

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import java.io.ByteArrayOutputStream
import java.io.BufferedInputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.URI
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Small, dependency-free HTTP server for the mobile song-request web app.
 * 仅面向局域网: 手机连接同一 Wi-Fi/有线局域网后直接扫码使用。
 */
class LocalRemoteServer(private val context: Context) {
    data class ApiResponse(
        val status: Int = 200,
        val body: String = "",
        val contentType: String = "application/json; charset=utf-8",
        val bytes: ByteArray? = null
    )

    interface Callback {
        fun statusJson(): String
        fun catalogJson(): String
        fun queueJson(): String
        fun rankJson(): String
        fun filterJson(type: String?, value: String?): String
        fun favoritesJson(): String
        fun search(query: String?): String
        fun order(query: String?): String
        fun command(action: String?, params: Map<String, String>): String
        fun handle(method: String, path: String, query: Map<String, String>, body: String): ApiResponse =
            ApiResponse(404, "{\"ok\":false,\"code\":\"NOT_FOUND\",\"error\":\"接口不存在\"}")
    }

    private var pool = Executors.newCachedThreadPool()
    @Volatile private var running = false
    @Volatile private var boundAddress: String? = null
    @Volatile private var boundPort = -1
    @Volatile private var lastError: String? = null
    @Volatile private var lastActivityAtMs = 0L
    private var server: ServerSocket? = null
    private var callback: Callback? = null

    @Synchronized
    fun start(address: String?, callback: Callback): Boolean {
        if (running && address == boundAddress) return true
        stop()
        this.callback = callback
        if (!isPrivateIpv4(address)) {
            lastError = "请先连接 Wi-Fi 或有线局域网"
            return false
        }
        if (pool.isShutdown) pool = Executors.newCachedThreadPool()
        var candidate: ServerSocket? = null
        for (port in 8765..8775) {
            try {
                candidate = ServerSocket(port, 32)
                boundPort = port
                break
            } catch (_: Exception) {
            }
        }
        if (candidate == null) {
            lastError = "端口 8765–8775 均被占用"
            return false
        }
        server = candidate
        boundAddress = address
        lastError = null
        running = true
        pool.execute {
            try {
                while (running) {
                    val socket = server?.accept() ?: break
                    pool.execute { handle(socket) }
                }
            } catch (e: Exception) {
                if (running) lastError = e.message ?: "本地服务异常"
            } finally {
                running = false
            }
        }
        return true
    }

    @Synchronized
    fun stop() {
        running = false
        runCatching { server?.close() }
        server = null
        boundPort = -1
        boundAddress = null
        pool.shutdownNow()
    }

    fun isRunning(): Boolean = running
    fun port(): Int = boundPort
    fun address(): String? = boundAddress
    fun error(): String? = lastError

    /** 是否在 [withinMs] 内有手机端请求(扫码点歌页面可见时每秒轮询 state)。 */
    fun hasRecentActivity(withinMs: Long): Boolean {
        val last = lastActivityAtMs
        return last > 0 && System.currentTimeMillis() - last <= withinMs
    }

    fun url(): String? = if (running && boundAddress != null && boundPort > 0) {
        "http://$boundAddress:$boundPort/mobile"
    } else null

    private fun handle(socket: Socket) {
        runCatching {
            socket.soTimeout = 5000
            socket.use { client ->
                val input = BufferedInputStream(client.getInputStream())
                val requestLine = readLine(input) ?: return
                val parts = requestLine.split(' ')
                if (parts.size < 2) {
                    write(client, ApiResponse(400, error("BAD_REQUEST", "请求格式错误")))
                    return
                }
                val method = parts[0].uppercase(Locale.US)
                val target = parts[1]
                val headers = linkedMapOf<String, String>()
                while (true) {
                    val line = readLine(input) ?: break
                    if (line.isEmpty()) break
                    val colon = line.indexOf(':')
                    if (colon > 0) headers[line.substring(0, colon).lowercase(Locale.US)] = line.substring(colon + 1).trim()
                }
                val path = target.substringBefore('?')
                val query = parseQuery(target.substringAfter('?', ""))
                val pageRequest = path == "/" || path == "/mobile" || path == "/mobile/"
                if (!validHost(headers["host"]) || !validOrigin(headers["origin"])) {
                    write(client, ApiResponse(403, error("BAD_ORIGIN", "请求来源无效")))
                    return
                }
                // 本地 API 不支持分块请求体；拒绝不明确或超限的长度，不能静默截断。
                if (!headers["transfer-encoding"].isNullOrBlank()) {
                    write(client, ApiResponse(400, error("BAD_REQUEST", "不支持分块请求体")))
                    return
                }
                val rawLength = headers["content-length"]
                val length = if (rawLength.isNullOrBlank()) 0 else rawLength.toIntOrNull()
                    ?: run {
                        write(client, ApiResponse(400, error("BAD_CONTENT_LENGTH", "请求长度无效")))
                        return
                    }
                if (length < 0) {
                    write(client, ApiResponse(400, error("BAD_CONTENT_LENGTH", "请求长度无效")))
                    return
                }
                if (length > 65536) {
                    write(client, ApiResponse(413, error("BODY_TOO_LARGE", "请求内容超过 64 KB")))
                    return
                }
                val bodyBytes = ByteArray(length)
                var offset = 0
                while (offset < length) {
                    val count = input.read(bodyBytes, offset, length - offset)
                    if (count < 0) {
                        write(client, ApiResponse(400, error("INCOMPLETE_BODY", "请求内容不完整")))
                        return
                    }
                    offset += count
                }
                val body = String(bodyBytes, Charsets.UTF_8)
                // 手机端已成功建立会话并访问页面/接口 → 记录活跃(用于控制二维码显隐)。
                lastActivityAtMs = System.currentTimeMillis()
                val response = when {
                    pageRequest -> asset("mobile/index.html", "text/html; charset=utf-8")
                    path == "/mobile/app.css" -> asset("mobile/app.css", "text/css; charset=utf-8")
                    path == "/mobile/logo.css" -> asset("mobile/logo.css", "text/css; charset=utf-8")
                    path == "/mobile/app.js" -> asset("mobile/app.js", "application/javascript; charset=utf-8")
                    path == "/res/drawable-nodpi/ktv_logo.png" -> logoAsset()
                    path.startsWith("/api/v1/") -> callback?.handle(method, path, query, body)
                        ?: ApiResponse(503, error("NOT_READY", "服务尚未准备完成"))
                    else -> ApiResponse(404, error("NOT_FOUND", "接口不存在"))
                }
                write(client, response)
            }
        }
    }

    private fun asset(name: String, type: String): ApiResponse = try {
        val text = context.assets.open(name).bufferedReader(Charsets.UTF_8).use { it.readText() }
        ApiResponse(200, text, type)
    } catch (_: Exception) {
        ApiResponse(404, error("ASSET_NOT_FOUND", "页面资源缺失"))
    }

    private fun logoAsset(): ApiResponse = try {
        // ktv_logo 是 VectorDrawable，不是 raw 资源；渲染为 PNG 后再通过局域网接口返回。
        val drawable = context.resources.getDrawable(R.drawable.ktv_logo)
        val width = drawable.intrinsicWidth.coerceAtLeast(1)
        val height = drawable.intrinsicHeight.coerceAtLeast(1)
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        drawable.setBounds(0, 0, canvas.width, canvas.height)
        drawable.draw(canvas)
        val output = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
        bitmap.recycle()
        ApiResponse(200, contentType = "image/png", bytes = output.toByteArray())
    } catch (_: Exception) {
        ApiResponse(404, error("ASSET_NOT_FOUND", "Logo 资源缺失"))
    }

    private fun validHost(host: String?): Boolean {
        if (host.isNullOrBlank()) return false
        val expected = boundAddress ?: return false
        return runCatching {
            val uri = URI("http://$host")
            uri.host == expected && (uri.port == boundPort && uri.userInfo == null)
        }.getOrDefault(false)
    }

    private fun validOrigin(origin: String?): Boolean {
        // GET 等简单请求可能没有 Origin；若浏览器提供 Origin，则必须与本机服务地址完全一致。
        if (origin.isNullOrBlank()) return true
        return runCatching {
            val uri = URI(origin)
            uri.scheme == "http" &&
                uri.host == boundAddress &&
                uri.port == boundPort &&
                uri.userInfo == null
        }.getOrDefault(false)
    }

    private fun readLine(input: BufferedInputStream): String? {
        val bytes = ArrayList<Byte>()
        while (bytes.size < 8192) {
            val b = input.read()
            if (b < 0) return if (bytes.isEmpty()) null else bytes.toByteArray().toString(Charsets.UTF_8)
            if (b == '\n'.code) break
            if (b != '\r'.code) bytes.add(b.toByte())
        }
        if (bytes.size >= 8192) throw java.io.IOException("HTTP 请求行或请求头过长")
        return bytes.toByteArray().toString(Charsets.UTF_8)
    }

    private fun parseQuery(query: String): Map<String, String> = buildMap {
        if (query.isBlank()) return@buildMap
        query.split('&').forEach { part ->
            val key = URLDecoder.decode(part.substringBefore('='), "UTF-8")
            val value = URLDecoder.decode(part.substringAfter('=', ""), "UTF-8")
            put(key, value)
        }
    }

    private fun write(socket: Socket, response: ApiResponse) {
        val bytes = response.bytes ?: response.body.toByteArray(Charsets.UTF_8)
        val reason = when (response.status) {
            200 -> "OK"; 201 -> "Created"; 204 -> "No Content"; 400 -> "Bad Request"
            403 -> "Forbidden"; 404 -> "Not Found"; 409 -> "Conflict"; else -> "Error"
        }
        val output = socket.getOutputStream()
        output.write(("HTTP/1.1 ${response.status} $reason\r\n" +
            "Content-Type: ${response.contentType}\r\n" +
            "Cache-Control: no-store\r\n" +
            "X-Content-Type-Options: nosniff\r\n" +
            "Content-Security-Policy: default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self' https://raw.githubusercontent.com\r\n" +
            "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").toByteArray())
        output.write(bytes)
        output.flush()
    }

    companion object {
        fun isPrivateIpv4(value: String?): Boolean = runCatching {
            val address = InetAddress.getByName(value)
            address is Inet4Address && isPrivateAddress(address)
        }.getOrDefault(false)

        private fun isPrivateAddress(address: InetAddress): Boolean {
            if (address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress) return true
            val b = address.address
            return b.size == 4 && (b[0].toInt() and 0xff) == 100 && (b[1].toInt() and 0xc0) == 64
        }

        private fun error(code: String, message: String): String =
            "{\"ok\":false,\"code\":\"$code\",\"error\":\"$message\"}"
    }
}
