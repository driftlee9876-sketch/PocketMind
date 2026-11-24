package com.pocketmind

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.Inet4Address
import java.net.InetAddress
import java.util.ArrayDeque

internal object WifiCore {
    init { System.loadLibrary("pmwifi") }
    private external fun command(input: String): String
    fun call(op: String, fields: JSONObject = JSONObject()): JSONObject {
        val result = JSONObject(command(fields.put("Op", op).toString()))
        check(!result.has("error")) { result.optString("error") }
        return result
    }
}

internal fun wifiAddress(context: Context): CableAddress? {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    return manager.allNetworks.filter { manager.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true }
        .flatMap { network -> manager.getLinkProperties(network)?.linkAddresses.orEmpty().mapNotNull {
            val ip = it.address as? Inet4Address
            if (ip != null && (ip.isSiteLocalAddress || ip.isLinkLocalAddress) && it.prefixLength in 1..30)
                CableAddress(ip, it.prefixLength, network) else null
        }}.distinct().singleOrNull()
}

internal fun gpuNetwork(context: Context, mesh: Boolean): CableAddress? {
    if (!mesh) return wifiAddress(context)
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    return manager.allNetworks.filter { manager.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true }
        .flatMap { network -> manager.getLinkProperties(network)?.linkAddresses.orEmpty().mapNotNull {
            val ip = it.address as? Inet4Address
            if (ip != null && ip.address[0].toInt()==100 && (ip.address[1].toInt() and 255) in 64..127)
                CableAddress(ip,10,network) else null
        }}.distinct().singleOrNull()
}

/** NSD is a directory only. Adverts are never used as proof of device identity. */
@Suppress("DEPRECATION")
internal class WifiLan(private val context: ReactApplicationContext, private val gpu: UsbGpuPeer) : LifecycleEventListener {
    private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val main = Handler(Looper.getMainLooper())
    private val type = "_pmgpu._tcp."
    private val found = linkedMapOf<String, JSONObject>()
    private val queue = ArrayDeque<NsdServiceInfo>()
    private val live = mutableSetOf<String>()
    private var browsing: NsdManager.DiscoveryListener? = null
    private var registration: NsdManager.RegistrationListener? = null
    private var resolving = false
    private var enabled = false
    private var ownGpu = false
    private var offeredOn: CableAddress? = null
    private var scannedOn: CableAddress? = null
    private var issue = ""
    private var meshOffer = false
    private var invitation = ""
    private val invites = context.getSharedPreferences("wifi-mesh-peers",Context.MODE_PRIVATE)
    private fun addInvite(input: String) {
        val fields = input.trim().split('|')
        require(fields.size == 3 && fields[0] == "pmgpu1" && fields[2].matches(Regex("[A-Za-z0-9_-]{43}"))) { "보조 기기에서 복사한 초대를 붙여넣으세요." }
        val parts = fields[1].split('.')
        require(parts.size == 4 && parts.all { it.toIntOrNull()?.let { n -> n in 0..255 && n.toString()==it } == true } &&
            parts[0]=="100" && parts[1].toInt() in 64..127) { "Tailscale IPv4 주소를 확인하세요." }
        check(fields[2] != WifiCore.call("status").getString("id")) { "다른 기기의 초대를 입력하세요." }
        check(invites.contains(fields[2]) || invites.all.size < 20) { "원격 기기는 최대 20대까지 저장할 수 있어요." }
        invites.edit().putString(fields[2],fields[1]).apply()
    }
    private fun available(): List<JSONObject> {
        val local = found.values.toList()
        if (gpuNetwork(context,true)==null) return local
        val remote = invites.all.map { (id,ip) -> JSONObject().put("ID",id).put("IP",ip).put("Port",47832)
            .put("Mesh",true).put("name","원격 GPU · $ip").put("platform","Tailscale") }
        return (local + remote).distinctBy { it.getString("ID") }
    }
    init { context.addLifecycleEventListener(this) }
    private fun boot() = WifiCore.call("init", JSONObject().put("Dir", File(context.noBackupFilesDir, "wifi-gpu").path))
    private fun next() {
        val scan = browsing ?: return
        if (resolving || queue.isEmpty()) return
        val info = queue.removeFirst()
        resolving = true
        val callback = object : NsdManager.ResolveListener {
            override fun onResolveFailed(service: NsdServiceInfo, code: Int) { main.post { if (browsing === scan) {resolving = false; next()} } }
            override fun onServiceResolved(service: NsdServiceInfo) { main.post {
                if (browsing !== scan) return@post
                resolving = false
                val link = wifiAddress(context)
                val resolved = if (Build.VERSION.SDK_INT >= 34) service.hostAddresses else listOfNotNull(service.host)
                // Older resolvers can return only the IPv6 result of a dual-stack Bonjour service.
                // Parse the announced IPv4 literal locally and still require the subnet and TLS pin.
                val literal = service.attributes["ip"]?.toString(Charsets.US_ASCII)?.split('.')
                val octets = literal?.mapNotNull { part ->
                    part.takeIf { it.length in 1..3 && it.all { c -> c in '0'..'9' } }?.toIntOrNull()?.takeIf { it in 0..255 }?.toByte()
                }
                val advertised = if (literal?.size == 4 && octets?.size == 4) InetAddress.getByAddress(octets.toByteArray()) else null
                val addr = (resolved + listOfNotNull(advertised)).filterIsInstance<Inet4Address>().firstOrNull { link?.sharesLink(it) == true }
                val id = service.attributes["id"]?.toString(Charsets.US_ASCII).orEmpty()
                if (info.serviceName in live && addr != null &&
                    id.matches(Regex("[A-Za-z0-9_-]{43}")) && service.port in 1..65535) {
                    val platform = service.attributes["platform"]?.toString(Charsets.UTF_8)
                    found[info.serviceName] = JSONObject().put("ID",id).put("IP",addr.hostAddress).put("Port",service.port)
                        .put("name", info.serviceName.take(64)).put("platform",platform?.take(16))
                }
                next()
            } }
        }
        try { nsd.resolveService(info,callback) } catch (_: Exception) { resolving = false; main.post { next() } }
    }
    private fun discover(link: CableAddress) {
        if (browsing != null) return
        val cb = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(t: String) {}
            override fun onDiscoveryStopped(t: String) {}
            override fun onStopDiscoveryFailed(t: String,c: Int) {}
            override fun onStartDiscoveryFailed(t: String,c: Int) {main.post {if (browsing === this) {endBrowse(); issue="Wi-Fi 기기 검색을 시작하지 못했어요 ($c)."}}}
            override fun onServiceFound(s: NsdServiceInfo) { main.post {
                if (browsing === this && s.serviceType.trimEnd('.') == type.trimEnd('.') && live.size < 64 && live.add(s.serviceName)) {queue.add(s); next()}
            } }
            override fun onServiceLost(s: NsdServiceInfo) { main.post {if (browsing === this) {live.remove(s.serviceName);found.remove(s.serviceName)}} }
        }
        browsing = cb; scannedOn = link
        try { nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, cb) } catch (e: Exception) {endBrowse();throw e}
    }
    private fun endBrowse() {
        val old = browsing; browsing = null; scannedOn = null
        if (old != null) runCatching { nsd.stopServiceDiscovery(old) }
        found.clear();live.clear();queue.clear();resolving=false
    }
    private fun endpoint(id: String): JSONObject {
        val peer = available().firstOrNull { it.optString("ID")==id } ?: error("기기를 다시 검색해 주세요.")
        val link = gpuNetwork(context,peer.optBoolean("Mesh")) ?: error("기기 네트워크에 연결해 주세요.")
        return JSONObject(peer.toString()).put("Local",link.ip.hostAddress).put("Prefix",link.prefix)
    }
    fun selected(id: String): JSONObject {
        // Called before host startup on the native module queue; use the same UI-thread snapshot as discovery.
        check(Looper.myLooper() == Looper.getMainLooper())
        return endpoint(id)
    }
    fun call(raw: String,promise: Promise) = main.post {
        try {
            val q = JSONObject(raw)
            boot()
            when (q.getString("op")) {
                "browse" -> { enabled=true; issue=""; wifiAddress(context)?.let(::discover) }
                "status" -> {
                    val link=wifiAddress(context)
                    if (ownGpu && (offeredOn!=gpuNetwork(context,meshOffer) || gpu.status().isEmpty())) stopOffer()
                    if (enabled && scannedOn!=link) {endBrowse();link?.let(::discover)}
                }
                "offer" -> {
                    check(context.lifecycleState==LifecycleState.RESUMED && !ownGpu)
                    meshOffer=q.optBoolean("mesh")
                    val link=gpuNetwork(context,meshOffer) ?: error(if (meshOffer) "Tailscale VPN을 먼저 연결하세요." else "Wi-Fi에 연결해 주세요.")
                    val code=gpu.status()
                    check(code.isNotEmpty()) { "GPU 제공을 먼저 시작해 주세요." }
                    ownGpu=true;offeredOn=link
                    try {
                        val r=WifiCore.call("offer",JSONObject().put("Backend","android").put("Value",code)
                            .put("Endpoint",JSONObject().put("Local",link.ip.hostAddress).put("Prefix",link.prefix).put("Mesh",meshOffer)))
                        if (meshOffer) {
                            invitation="pmgpu1|${link.ip.hostAddress}|${r.getString("id")}"
                        } else {
                        val service=NsdServiceInfo().apply {
                            serviceName="PocketMind "+Build.MODEL.take(30);serviceType=type;port=r.getInt("port")
                            setAttribute("id",r.getString("id"));setAttribute("platform","Android");setAttribute("ip",link.ip.hostAddress)
                            if (Build.VERSION.SDK_INT>=33) network=link.network
                        }
                        val cb=object:NsdManager.RegistrationListener{
                            override fun onServiceRegistered(s:NsdServiceInfo){}
                            override fun onServiceUnregistered(s:NsdServiceInfo){}
                            override fun onUnregistrationFailed(s:NsdServiceInfo,c:Int){}
                            override fun onRegistrationFailed(s:NsdServiceInfo,c:Int){main.post{if(registration===this){stopOffer();issue="Wi-Fi 제공을 알리지 못했어요 ($c)."}}}
                        }
                        registration=cb;nsd.registerService(service,NsdManager.PROTOCOL_DNS_SD,cb)
                        }
                    } catch(e:Exception){stopOffer();throw e}
                }
                "import" -> addInvite(q.getString("invite"))
                "pair" -> WifiCore.call("pair",JSONObject().put("Endpoint",endpoint(q.getString("id"))))
                "vote" -> WifiCore.call("vote",JSONObject().put("Challenge",q.getString("id")).put("Accept",q.getBoolean("accept")))
                "stop" -> {enabled=false;endBrowse();stopOffer();WifiCore.call("stop");issue=""}
                "forget" -> {stopOffer();WifiCore.call("forget");invites.edit().clear().apply();issue=""}
                else -> error("지원하지 않는 작업이에요.")
            }
            val result=WifiCore.call("status").put("peers",JSONArray(available()))
                .put("searching", browsing != null).put("invitation",invitation).put("meshReady",gpuNetwork(context,true)!=null)
            if(issue.isNotEmpty())result.put("issue",issue)
            promise.resolve(result.toString())
        } catch(e:Throwable){promise.reject("WIFI_GPU",e.message ?: "Wi-Fi GPU를 사용할 수 없어요.",e)}
    }
    private fun stopOffer(){
        val old=registration; registration=null
        if(old!=null)runCatching{nsd.unregisterService(old)}
        if(ownGpu){WifiCore.call("stop");gpu.stop()}
        ownGpu=false;offeredOn=null;meshOffer=false;invitation=""
    }
    override fun onHostPause(){main.post{enabled=false;endBrowse();stopOffer();runCatching{WifiCore.call("stop")}}}
    override fun onHostResume(){}
    override fun onHostDestroy()=onHostPause()
    fun release(){onHostPause();context.removeLifecycleEventListener(this)}
}
