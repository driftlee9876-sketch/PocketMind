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
    @Synchronized fun stopToken(token:String) { if (token.isNotEmpty() && hostToken == token) stop() }
    fun status() = Arguments.createMap().apply { putString("invitation", offer); putBoolean("hosting", hostToken.isNotEmpty()) }
    private fun monitor(session: TabletCable, link: CableAddress, wifi: Boolean = false, live: () -> Boolean) {
        thread(isDaemon = true) {
            try {
                while (!session.closed && safe() && (wifi || link in cableAddresses(context)) && live()) Thread.sleep(2000)
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

    private fun process(session: TabletCable, binary: File, bridges: List<String>, args: List<String>): Process {
        val builder = ProcessBuilder(listOf(binary.absolutePath) + args).redirectErrorStream(true)
        bridges.forEachIndexed { index, name ->
            builder.environment()[if (index == 0) "POCKETMIND_HOST_SOCKET" else "POCKETMIND_HOST_SOCKET_$index"] = name
        }
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

    fun host(invitation: String, filename: String, promise: Promise, wifi: List<JSONObject>? = null, policy: String = "memory") = thread(isDaemon = true) {
        var session: TabletCable? = null
        try {
            check(Build.VERSION.SDK_INT >= 28)
            val model = File(context.filesDir, filename).canonicalFile
            require(model.parentFile == context.filesDir.canonicalFile && model.extension.equals("gguf", true) && model.isFile) { "이 태블릿에 GGUF 모델을 먼저 설치해 주세요." }
            val binary = File(context.applicationInfo.nativeLibraryDir, "libpocketmind_tablet_host.so")
            check(binary.canExecute()) { "태블릿 GPU 호스트가 포함된 APK가 필요해요." }
            val cable = start(false)
            session = cable
            val bridges = if (wifi == null) {
                val (bridge, link) = cable.join(context, invitation)
                monitor(cable, link) { true }
                listOf(bridge)
            } else if (wifi.isEmpty()) {
                emptyList()
            } else {
                require(wifi.size in 1..20)
                val networks = wifi.filterNot { it.has("Relay") }.groupBy { it.optBoolean("Mesh") }.map { (mesh, peers) ->
                    val link = gpuNetwork(context,mesh)
                    check(link != null && peers.all { it.getString("Local")==link.ip.hostAddress }) { "기기 네트워크가 바뀌었어요. 다시 연결하세요." }
                    mesh to link
                }
                val names = WifiCore.call("bridges",JSONObject().put("Endpoints",org.json.JSONArray(wifi))).getJSONArray("bridges")
                cable.own(Closeable { WifiCore.call("stop") })
                networks.forEach { (mesh,link) -> monitor(cable,link,true) { gpuNetwork(context,mesh)==link } }
                (0 until names.length()).map(names::getString)
            }
            val endpoints = bridges.indices.map { "127.0.0.1:${50052 + it}" }
            val rpc = if (endpoints.isEmpty()) emptyList() else listOf("--rpc", endpoints.joinToString(","))
            val internetPeers = wifi?.count { it.has("Relay") } ?: 0
            val probe = process(cable, binary, bridges, rpc + "--list-devices")
            val listing = StringBuffer()
            val reader = thread { probe.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { if (listing.length < 32000) listing.append(it).append('\n') }
            } }
            check(probe.waitFor(30L + 5L * bridges.size + 60L * internetPeers, TimeUnit.SECONDS)) { "보조 GPU가 응답하지 않아요. 기기 연결을 확인하세요." }
            reader.join(2000)
            val devices = listing.toString()
            val remote = endpoints.map { endpoint ->
                Regex("""(?m)^\s*(RPC\d+):\s+${Regex.escape(endpoint)}\s+\(""").find(devices)?.groupValues?.get(1)
                    ?: error("보조 GPU ${endpoints.indexOf(endpoint)+1}에 연결할 수 없어요.")
            }
            val local = Regex("""(?m)^\s*(Vulkan\d+):""").find(devices)?.groupValues?.get(1) ?: error("태블릿 Vulkan GPU를 확인할 수 없어요.")
            val selected = listOf(local) + remote
            val weights = selected.map { id ->
                val line = devices.lineSequence().firstOrNull { it.trimStart().startsWith("$id:") }.orEmpty()
                Regex("""(\d+) MiB free""").find(line)?.groupValues?.get(1)?.toLongOrNull() ?: 0L
            }
            val split = if (policy == "memory" && weights.all { it > 0 }) weights else selected.map { 1L }

            val token = randomKey()
            val key = File.createTempFile("tablet-gpu-", ".key", context.cacheDir)
            cable.own(Closeable { key.delete() })
            key.writeText(token)
            val proc = process(cable, binary, bridges, rpc + listOf("-lv","4","-m", model.path,"--host","127.0.0.1","--port","18789",
                "--api-key-file",key.path,"--alias","pocketmind-wired","--ctx-size","2048","--n-gpu-layers","99",
                "--device",selected.joinToString(","),"--split-mode","layer","--tensor-split",split.joinToString(",")))
            val allocatedLocal = AtomicBoolean()
            val allocatedRemote = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
            val offloaded = AtomicBoolean()
            val allocation = Regex("""(Vulkan\d+|RPC\d+\[127\.0\.0\.1:\d+\])\s+model buffer size\s*=\s*([\d.]+)\s+MiB""")
            val offload = Regex("""offloaded\s+[1-9]\d*(?:/\d+)?\s+layers?\s+to GPU""")
            thread(isDaemon = true) {
                try {
                    proc.inputStream.bufferedReader().useLines { lines -> lines.forEach { line ->
                        if (offload.containsMatchIn(line)) offloaded.set(true)
                        val match = allocation.find(line)
                        if (match != null && (match.groupValues[2].toDoubleOrNull() ?: 0.0) > 0) {
                            if (match.groupValues[1] == local) allocatedLocal.set(true) else if (match.groupValues[1].startsWith("RPC")) allocatedRemote.add(match.groupValues[1].substringAfter('[').substringBefore(']'))
                        }
                    } }
                } finally { stopIf(cable) }
            }
            val stallTimeout = 240000L + 30000L * (bridges.size - 1).coerceAtLeast(0)
            var deadline = android.os.SystemClock.elapsedRealtime() + stallTimeout
            var transferred = -1L
            var nextProgressCheck = 0L
            while (!cable.closed && android.os.SystemClock.elapsedRealtime() < deadline) {
                val now = android.os.SystemClock.elapsedRealtime()
                if (internetPeers > 0 && now >= nextProgressCheck) {
                    val bytes = WifiCore.call("status").getLong("relayBytes")
                    if (bytes != transferred) deadline = now + stallTimeout
                    transferred = bytes
                    nextProgressCheck = now + 5000
                }
                if (offloaded.get() && allocatedLocal.get() && allocatedRemote.containsAll(endpoints) && ready(token)) break
                Thread.sleep(400)
            }
            check(!cable.closed && offloaded.get() && allocatedLocal.get() && allocatedRemote.containsAll(endpoints) && ready(token)) { "선택한 모든 GPU에 모델을 배치하지 못했어요. 보조 기기 수를 줄이거나 모델과 연결을 확인하세요." }
            synchronized(this) { check(active === cable); hostToken = token }
            promise.resolve(Arguments.createMap().apply { putString("token", token); putString("model", model.nameWithoutExtension); putString("split",split.joinToString(",")); putString("device", if (bridges.isEmpty()) "태블릿 Vulkan" else if (wifi == null) "태블릿 Vulkan + 유선 Vulkan" else "태블릿 Vulkan + 보조 GPU ${bridges.size}대"); putBoolean("wifi", wifi != null); putBoolean("tablet", true) })
        } catch (error: Exception) { session?.let(::stopIf); promise.reject("TABLET_GPU", error) }
    }
    override fun onHostResume() {}
    override fun onHostPause() = stop()
    override fun onHostDestroy() = stop()
    fun release() { stop(); context.removeLifecycleEventListener(this) }
}
