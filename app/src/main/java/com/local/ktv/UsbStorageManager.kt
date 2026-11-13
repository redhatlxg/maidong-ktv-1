package com.local.ktv

import android.os.Environment
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.util.Locale

/**
 * Removable-storage discovery for operator TV boxes.
 *
 * Never formats, partitions, or recursively deletes removable media. A volume is selected
 * only after Android reports it mounted and a real create/write/fsync/delete probe succeeds.
 * NTFS is supported when the device firmware exposes it as a writable mounted filesystem.
 */
object UsbStorageManager {
    private const val TAG = "UsbStorage"
    private const val SONG_DIR = "MaidongKTV/video/cloud-song"
    private const val INTERNAL_DIR = "video/cloud-song"
    private const val MIN_FREE_BYTES = 10L * 1024L * 1024L * 1024L

    data class Volume(
        val root: File,
        val fileSystem: String,
        val freeBytes: Long,
        val writable: Boolean,
    )

    private fun mountTypes(): Map<String, String> = runCatching {
        File("/proc/mounts").readLines().mapNotNull { line ->
            val parts = line.split(Regex("\\s+"))
            if (parts.size < 3) null else {
                val mountPoint = parts[1].replace("\\040", " ")
                mountPoint to parts[2].lowercase(Locale.ROOT)
            }
        }.toMap()
    }.getOrDefault(emptyMap())

    private fun isRemovableRoot(dir: File): Boolean {
         // Preserve the visible mount path; canonicalPath may resolve to /mnt/media_rw.
        val path = dir.absolutePath
        if (!path.startsWith("/storage/")) return false
        val name = dir.name.lowercase(Locale.ROOT)
        return name != "emulated" && name != "self" && dir.isDirectory
    }

    private fun writeProbe(dir: File): Boolean {
        val probe = File(dir, ".maidong_usb_probe")
        return runCatching {
            FileOutputStream(probe).use { out ->
                out.write(byteArrayOf(0x4b, 0x54, 0x56))
                out.flush()
                out.fd.sync()
            }
            probe.delete()
        }.getOrDefault(false).also { runCatching { probe.delete() } }
    }

    /** Returns only mounted removable volumes that pass an actual write test. */
    fun writableVolumes(): List<Volume> {
        val types = mountTypes()
        return runCatching { File("/storage").listFiles().orEmpty() }
            .getOrDefault(emptyArray())
            .filter(::isRemovableRoot)
            .mapNotNull { root ->
                val state = runCatching { Environment.getExternalStorageState(root) }.getOrNull()
                if (state != Environment.MEDIA_MOUNTED) return@mapNotNull null
                val canonical = runCatching { root.canonicalPath }.getOrNull()
                val fs = types.entries
                    .filter { (mount, _) -> root.absolutePath == mount || root.absolutePath.startsWith(mount + "/") || canonical == mount || (canonical != null && canonical.startsWith(mount + "/")) }
                    .maxByOrNull { it.key.length }?.value ?: "unknown"
                val writable = writeProbe(root)
                if (!writable) return@mapNotNull null
                Volume(root, fs, runCatching { root.usableSpace }.getOrDefault(0L), true)
            }
    }

    /** Prefer writable USB when internal storage is low; otherwise keep downloads internal. */
    fun downloadDirectory(): File {
        val internal = File(AppPaths.videoDir, "cloud-song")
        val internalFree = runCatching { AppPaths.root.usableSpace }.getOrDefault(0L)
        if (internalFree >= MIN_FREE_BYTES) return internal

        val usb = writableVolumes()
            .filter { it.freeBytes > MIN_FREE_BYTES }
            .maxByOrNull { it.freeBytes }
        if (usb != null) {
            val dir = File(usb.root, SONG_DIR)
            if (runCatching { dir.isDirectory || dir.mkdirs() }.getOrDefault(false) && dir.canWrite()) {
                Log.i(TAG, "Using USB song cache: ${dir.absolutePath}, fs=${usb.fileSystem}")
                return dir
            }
        }
        Log.w(TAG, "USB cache unavailable; using internal storage")
        return internal
    }

    /** Locate a previously downloaded song on either internal storage or a mounted USB volume. */
    fun findExistingSong(fileName: String): File? {
        val safeName = File(fileName).name
        val internal = File(File(AppPaths.videoDir, "cloud-song"), safeName)
        if (internal.isFile) return internal
        writableVolumes().forEach { volume ->
            val candidate = File(File(volume.root, SONG_DIR), safeName)
            if (candidate.isFile) return candidate
        }
        return null
    }

    fun describe(): String {
        val volumes = writableVolumes()
        if (volumes.isEmpty()) return "USB: no writable mounted volume"
        return volumes.joinToString("; ") {
            "path=${it.root.absolutePath} fs=${it.fileSystem} free=${it.freeBytes / 1024 / 1024}MB writable=${it.writable}"
        }
    }
}
