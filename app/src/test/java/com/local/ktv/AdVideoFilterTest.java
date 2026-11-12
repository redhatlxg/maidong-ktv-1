package com.local.ktv;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/** 广告地址拦截回归测试：同时锁定真实 CDN URL 不被误杀。 */
public final class AdVideoFilterTest {
    @Test
    public void acceptsRealSourceUrls() {
        assertTrue(AdVideoFilter.isTrustedSongUrl(
            "http://txog.ktvsky.com/264/lvbr/480/E/ts/47.1/202209220333/480p/7303235.ts?token=526e505e",
            "7303235"));
        assertTrue(AdVideoFilter.isTrustedSongUrl(
            "http://download.origjoy.com/264/lvbr/480/E/ts/39.6/202309070206/480p/7445418.ts?token=abc",
            "7445418"));
    }
    @Test
    public void rejectsAdHostEvenWithMatchingName() {
        assertFalse(AdVideoFilter.isTrustedSongUrl("http://gz.ac16.vip/ad/7303235.ts", "7303235"));
        assertFalse(AdVideoFilter.isTrustedSongUrl("http://cdn.ac16.vip/x/7303235.ts", "7303235"));
    }
    @Test
    public void rejectsAdFileName() {
        assertFalse(AdVideoFilter.isTrustedSongUrl("http://example.com/ad_files/my_ad_video.ts", "7303235"));
        assertFalse(AdVideoFilter.isTrustedSongUrl("http://example.com/x/my_ad_video.ts", "7303235"));
    }
    @Test
    public void rejectsMismatchedFileName() {
        assertFalse(AdVideoFilter.isTrustedSongUrl("http://example.com/x/9999999.ts", "7303235"));
        assertFalse(AdVideoFilter.isTrustedSongUrl("http://example.com/x/promo.ts", "7303235"));
    }
    @Test
    public void rejectsNonHttpSchemes() {
        assertFalse(AdVideoFilter.isTrustedSongUrl("file:///sdcard/x/7303235.ts", "7303235"));
        assertFalse(AdVideoFilter.isTrustedSongUrl("ftp://example.com/7303235.ts", "7303235"));
        assertFalse(AdVideoFilter.isTrustedSongUrl("", "7303235"));
        assertFalse(AdVideoFilter.isTrustedSongUrl(null, "7303235"));
    }
    @Test
    public void allowsNonTsUrlWithoutAdMarkers() {
        assertTrue(AdVideoFilter.isTrustedSongUrl("http://cdn.example.com/path/stream?token=abc", "7303235"));
    }

    @Test
    public void doesNotCompareTsFilenameWhenMusicNumberIsUnknown() {
        // song.id 可能是数据库主键；只有 filename 推出的点歌编号才可信。
        assertTrue(AdVideoFilter.isTrustedSongUrl("http://cdn.example.com/x/9999999.ts", null));
    }
}
