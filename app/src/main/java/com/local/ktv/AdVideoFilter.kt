package com.local.ktv

/**
 * 取址链路的统一可信校验。允许任意合法 CDN 主机，但拒绝已知广告特征、
 * 非 HTTP(S) 地址，以及文件名与点歌编号不匹配的 TS 资源。
 */
object AdVideoFilter {
    private val adMarkers = listOf("/ad_files/", "my_ad_video")
    private val adHosts = listOf("gz.ac16.vip", "ac16.vip")
    private val tsBasename = Regex("/([^/?]+)\\.ts(?:\\?|$)", RegexOption.IGNORE_CASE)

    @JvmStatic
    fun isAdVideo(url: String?): Boolean {
        if (url.isNullOrEmpty()) return false
        val lower = url.toLowerCase(java.util.Locale.ROOT)
        if (adMarkers.any { lower.contains(it) }) return true
        val host = hostOf(url) ?: return false
        return adHosts.any { host == it || host.endsWith(".$it") }
    }

    @JvmStatic
    fun isTrustedSongUrl(url: String?, musicno: String?): Boolean {
        if (url.isNullOrEmpty()) return false
        val uri = runCatching { java.net.URI(url) }.getOrNull() ?: return false
        val scheme = uri.scheme?.toLowerCase(java.util.Locale.ROOT)
        if (scheme != "http" && scheme != "https") return false
        if (uri.host.isNullOrBlank() || isAdVideo(url)) return false
        val name = tsBasename.find(url)?.groupValues?.getOrNull(1)
        if (name != null && !musicno.isNullOrEmpty() && name != musicno) return false
        return true
    }

    private fun hostOf(url: String): String? =
        runCatching { java.net.URI(url).host?.toLowerCase(java.util.Locale.ROOT) }.getOrNull()

    @JvmStatic
    fun resolve(url: String?): String? = if (isAdVideo(url)) null else url
}
