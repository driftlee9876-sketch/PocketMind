package com.pocketmind

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import java.io.Closeable
import java.io.File
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import org.json.JSONObject

internal class TabletGpu(private val context: ReactApplicationContext, private val peer: UsbGpuPeer) : LifecycleEventListener {
    private var active: TabletCable? = null
    @Volatile private var offer = ""
    @Volatile private var hostToken = ""
    @Volatile private var donor = false
    init { context.addLifecycleEventListener(this) }

    @Synchronized private fun start(donating: Boolean): TabletCable {
        check(active == null) { "기존 GPU 연결을 먼저 종료해 주세요." }
        check(context.lifecycleState == LifecycleState.RESUMED && safe()) { "앱을 화면에 열고 배터리와 기기 온도를 확인하세요." }
        donor = donating
        return TabletCable().also { active = it }
    }
    private fun safe(): Boolean {
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return false
        val scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, 0)
        val hot = Build.VERSION.SDK_INT >= 29 && (context.getSystemService(Context.POWER_SERVICE) as PowerManager).currentThermalStatus >= PowerManager.THERMAL_STATUS_SEVERE
        return !hot && scale > 0 && battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) * 100 >= 20 * scale
    }
    @Synchronized private fun stopIf(session: TabletCable) { if (active === session) stop() }
    @Synchronized fun stop() {
        val old = active
        active = null
        hostToken = ""; offer = ""
        old?.close()
        if (donor) peer.stop()
        donor = false
    }
    fun status() = Arguments.createMap().apply { putString("invitation", offer); putBoolean("hosting", hostToken.isNotEmpty()) }
    private fun monitor(session: TabletCable, link: CableAddress, live: () -> Boolean) {
        thread(isDaemon = true) {
            try {
                while (!session.closed && safe() && link in cableAddresses(context) && live()) Thread.sleep(2000)
            } finally { stopIf(session) }
        }
    }
    fun provide(promise: Promise) = thread(isDaemon = true) {
        var session: TabletCable? = null
        try {
            val link = cableAddresses(context).singleOrNull() ?: error("USB 테더링 또는 유선 이더넷 한 개를 연결한 뒤 다시 눌러 주세요.")
            val code = peer.status()
            check(code.isNotEmpty()) { "GPU를 시작하지 못했어요." }
            val cable = start(true)
            session = cable
            val invitation = cable.provide(link, code)
            synchronized(this) { check(active === cable); offer = invitation }
            monitor(cable, link) { peer.status() == code }
            promise.resolve(invitation)
        } catch (error: Exception) { session?.let(::stopIf); promise.reject("TABLET_GPU", error) }
    }

    private fun process(session: TabletCable, binary: File, bridge: String, args: List<String>): Process {
        val builder = ProcessBuilder(listOf(binary.absolutePath) + args).redirectErrorStream(true)
        builder.environment()["POCKETMIND_HOST_SOCKET"] = bridge
        val proc = builder.start()
        session.own(Closeable { proc.destroyForcibly() })
        return proc
    }
    private fun ready(token: String): Boolean {
        val connection = URL("http://127.0.0.1:18789/v1/models").openConnection(Proxy.NO_PROXY) as HttpURLConnection
        return try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 800; connection.readTimeout = 800
            connection.setRequestProperty("Authorization", "Bearer $token")
            if (connection.responseCode != 200) false else {
                val data = JSONObject(connection.inputStream.bufferedReader().use { it.readText() }).getJSONArray("data")
                (0 until data.length()).any { data.getJSONObject(it).optString("id") == "pocketmind-wired" }
            }
        } catch (_: Exception) { false } finally { connection.disconnect() }
    }

    fun host(invitation: String, filename: String, promise: Promise) = thread(isDaemon = true) {
        var session: TabletCable? = null
        try {
            check(Build.VERSION.SDK_INT >= 28)
            val model = File(context.filesDir, filename).canonicalFile
            require(model.parentFile == context.filesDir.canonicalFile && model.extension.equals("gguf", true) && model.isFile) { "이 태블릿에 GGUF 모델을 먼저 설치해 주세요." }
            val binary = File(context.applicationInfo.nativeLibraryDir, "libpocketmind_tablet_host.so")
            check(binary.canExecute()) { "태블릿 GPU 호스트가 포함된 APK가 필요해요." }
            val cable = start(false)
            session = cable
            val (bridge, link) = cable.join(context, invitation)
            monitor(cable, link) { true }
            val endpoint = "127.0.0.1:50052"
            val rpc = listOf("--rpc", endpoint)
            val probe = process(cable, binary, bridge, rpc + "--list-devices")
            val listing = StringBuffer()
            val reader = thread { probe.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { if (listing.length < 32000) listing.append(it).append('\n') }
            } }
            check(probe.waitFor(30, TimeUnit.SECONDS)) { "보조 GPU가 응답하지 않아요. 연결 정보와 케이블을 확인하세요." }
            reader.join(2000)
            val devices = listing.toString()
            val remote = Regex("(?m)^\\s*(RPC[0-9]+):\\s+127\\.0\\.0\\.1:50052\\s+\\(").find(devices)?.groupValues?.get(1)
            val local = Regex("(?m)^\\s*(Vulkan[0-9]+):").find(devices)?.groupValues?.get(1)
            check(remote != null && local != null) { "두 기기의 Vulkan GPU를 모두 확인하지 못했어요." }
            val token = randomKey()
            val key = File.createTempFile("tablet-gpu-", ".key", context.cacheDir)
            cable.own(Closeable { key.delete() })
            key.writeText(token)
            val proc = process(cable, binary, bridge, rpc + listOf("-lv","4","-m", model.path,"--host","127.0.0.1","--port","18789",
                "--api-key-file",key.path,"--alias","pocketmind-wired","--ctx-size","2048","--n-gpu-layers","99",
                "--device","$local,$remote","--split-mode","layer","--tensor-split","1,1"))
            val allocatedLocal = AtomicBoolean()
            val allocatedRemote = AtomicBoolean()
            val offloaded = AtomicBoolean()
            val allocation = Regex("""(Vulkan\d+|RPC\d+\[127\.0\.0\.1:50052\])\s+model buffer size\s*=\s*([\d.]+)\s+MiB""")
            val offload = Regex("""offloaded\s+[1-9]\d*(?:/\d+)?\s+layers?\s+to GPU""")
            thread(isDaemon = true) {
                try {
                    proc.inputStream.bufferedReader().useLines { lines -> lines.forEach { line ->
                        if (offload.containsMatchIn(line)) offloaded.set(true)
                        val match = allocation.find(line)
                        if (match != null && (match.groupValues[2].toDoubleOrNull() ?: 0.0) > 0) {
                            if (match.groupValues[1] == local) allocatedLocal.set(true) else if (match.groupValues[1].startsWith("RPC")) allocatedRemote.set(true)
                        }
                    } }
                } finally { stopIf(cable) }
            }
            val deadline = android.os.SystemClock.elapsedRealtime() + 240000
            while (!cable.closed && android.os.SystemClock.elapsedRealtime() < deadline) {
                if (offloaded.get() && allocatedLocal.get() && allocatedRemote.get() && ready(token)) break
                Thread.sleep(400)
            }
            check(!cable.closed && offloaded.get() && allocatedLocal.get() && allocatedRemote.get() && ready(token)) { "두 GPU에 모델을 나눠 올리지 못했어요. 작은 GGUF와 유선 연결을 확인하세요." }
            synchronized(this) { check(active === cable); hostToken = token }
            promise.resolve(Arguments.createMap().apply { putString("token", token); putString("model", model.nameWithoutExtension); putString("device", "태블릿 Vulkan + 유선 Vulkan"); putBoolean("tablet", true) })
        } catch (error: Exception) { session?.let(::stopIf); promise.reject("TABLET_GPU", error) }
    }
    override fun onHostResume() {}
    override fun onHostPause() = stop()
    override fun onHostDestroy() = stop()
    fun release() { stop(); context.removeLifecycleEventListener(this) }
}
