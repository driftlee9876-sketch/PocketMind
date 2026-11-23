package com.pocketmind

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.LocalServerSocket
import android.net.LocalSocket
import android.net.LocalSocketAddress
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.Closeable
import java.io.DataInputStream
import java.net.*
import java.security.*
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Collections
import java.util.concurrent.Semaphore
import javax.net.ssl.*
import kotlin.concurrent.thread

internal data class CableAddress(val ip: Inet4Address, val prefix: Int, val network: android.net.Network?) {
    fun sharesLink(other: InetAddress): Boolean {
        if (other !is Inet4Address || other == ip || other.isMulticastAddress || other.isLoopbackAddress) return false
        return (0 until prefix).all { bit ->
            ((ip.address[bit / 8].toInt() xor other.address[bit / 8].toInt()) and (128 shr (bit % 8))) == 0
        }
    }
}

internal fun cableAddresses(context: Context): List<CableAddress> {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val ethernet = cm.allNetworks.filter { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true }
        .mapNotNull { net -> cm.getLinkProperties(net)?.interfaceName?.let { it to net } }.toMap()
    return Collections.list(NetworkInterface.getNetworkInterfaces()).filter {
        it.isUp && !it.isLoopback && (it.name in ethernet || Regex("(?:rndis|ncm|usb)[0-9]+").matches(it.name))
    }.flatMap { nic -> nic.interfaceAddresses.mapNotNull {
        val ip = it.address as? Inet4Address
        if (ip != null && (ip.isSiteLocalAddress || ip.isLinkLocalAddress) && it.networkPrefixLength.toInt() in 1..30)
            CableAddress(ip, it.networkPrefixLength.toInt(), ethernet[nic.name]) else null
    } }.distinct()
}

internal fun compact(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
internal fun randomKey() = compact(ByteArray(32).also { SecureRandom().nextBytes(it) })

private fun serverIdentity(): Pair<SSLContext, String> {
    val alias = "PocketMindTabletCableV1"
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (!store.containsAlias(alias)) {
        val generator = KeyPairGenerator.getInstance("RSA", "AndroidKeyStore")
        generator.initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
            .setKeySize(2048).setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA384, KeyProperties.DIGEST_SHA512)
            .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1, KeyProperties.SIGNATURE_PADDING_RSA_PSS).build())
        generator.generateKeyPair()
    }
    val cert = store.getCertificate(alias) as X509Certificate
    val key = store.getKey(alias, null) as PrivateKey
    val manager = object : X509ExtendedKeyManager() {
        override fun getPrivateKey(a: String?) = if (a == alias) key else null
        override fun getCertificateChain(a: String?) = if (a == alias) arrayOf(cert) else null
        override fun chooseServerAlias(type: String?, issuers: Array<out Principal>?, socket: Socket?) = if (type == "RSA") alias else null
        override fun getServerAliases(type: String?, issuers: Array<out Principal>?) = if (type == "RSA") arrayOf(alias) else null
        override fun chooseClientAlias(types: Array<out String>?, issuers: Array<out Principal>?, socket: Socket?): String? = null
        override fun getClientAliases(type: String?, issuers: Array<out Principal>?): Array<String>? = null
    }
    return SSLContext.getInstance("TLS").apply { init(arrayOf(manager), null, null) } to compact(MessageDigest.getInstance("SHA-256").digest(cert.encoded))
}

private fun pinnedContext(pin: String): SSLContext {
    val trust = object : X509TrustManager {
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, auth: String?) { throw CertificateException() }
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, auth: String?) {
            val cert = chain?.firstOrNull() ?: throw CertificateException()
            if (compact(MessageDigest.getInstance("SHA-256").digest(cert.encoded)) != pin) throw CertificateException("GPU 인증서가 달라요.")
        }
    }
    return SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), null) }
}

/** The public side is TLS on the physical cable. The RPC side is an app-UID-only Unix socket. */
internal class TabletCable : Closeable {
    private val owned = mutableSetOf<Closeable>()
    private val capacity = Semaphore(8)
    @Volatile var closed = false
        private set
    @Synchronized fun <T : Closeable> own(item: T): T {
        if (closed) { item.close(); error("유선 연결이 끝났어요.") }
        owned.add(item)
        return item
    }
    @Synchronized private fun drop(item: Closeable) { owned.remove(item); runCatching { item.close() } }
    @Synchronized override fun close() {
        closed = true
        owned.toList().reversed().forEach { runCatching { it.close() } }
        owned.clear()
    }
    private fun pipe(net: SSLSocket, local: LocalSocket) {
        net.soTimeout = 0
        thread(isDaemon = true) {
            try { local.inputStream.copyTo(net.outputStream, 65536) } catch (_: Exception) {} finally { drop(net); drop(local) }
        }
        net.inputStream.copyTo(local.outputStream, 65536)
    }
    private fun serve(accept: () -> Closeable, handle: (Closeable) -> Unit) {
        thread(isDaemon = true) {
            try {
                while (!closed) {
                    val socket = own(accept())
                    if (!capacity.tryAcquire()) { drop(socket); continue }
                    thread(isDaemon = true) {
                        try { handle(socket) } catch (_: Exception) {} finally { drop(socket); capacity.release() }
                    }
                }
            } catch (_: Exception) { close() }
        }
    }
    fun provide(link: CableAddress, gpuCode: String): String {
        require(gpuCode.matches(Regex("[0-9]{8}")))
        val (ctx, pin) = serverIdentity()
        val token = randomKey()
        val listener = own(ctx.serverSocketFactory.createServerSocket(0, 4, link.ip) as SSLServerSocket)
        listener.enabledProtocols = listener.supportedProtocols.filter { it == "TLSv1.2" || it == "TLSv1.3" }.toTypedArray()
        serve({ listener.accept() }) { accepted ->
            val socket = accepted as SSLSocket
            if (!link.sharesLink(socket.inetAddress)) return@serve
            socket.soTimeout = 8000
            socket.startHandshake()
            val provided = ByteArray(43)
            DataInputStream(socket.inputStream).readFully(provided)
            if (!MessageDigest.isEqual(provided, token.toByteArray(Charsets.US_ASCII))) return@serve
            val local = own(LocalSocket())
            try {
                local.connect(LocalSocketAddress("pocketmind_gpu_" + gpuCode, LocalSocketAddress.Namespace.ABSTRACT))
                socket.outputStream.write(1)
                pipe(socket, local)
            } finally { drop(local) }
        }
        return "pmgpu1|${link.ip.hostAddress}|${listener.localPort}|$pin|$token"
    }
    fun join(context: Context, invitation: String): Pair<String, CableAddress> {
        val fields = invitation.trim().split('|')
        require(fields.size == 5 && fields[0] == "pmgpu1" && fields[1].matches(Regex("[0-9]{1,3}(?:\\.[0-9]{1,3}){3}")) &&
            fields.drop(3).all { it.matches(Regex("[A-Za-z0-9_-]{43}")) }) { "보조 기기의 GPU 연결 정보를 복사해 주세요." }
        val octets = fields[1].split('.').map { it.toInt().also { n -> require(n in 0..255) }.toByte() }.toByteArray()
        val address = InetAddress.getByAddress(octets)
        val port = fields[2].toInt().also { require(it in 1..65535) }
        val link = cableAddresses(context).firstOrNull { it.sharesLink(address) } ?: error("두 기기를 같은 USB 테더링 또는 유선 이더넷으로 연결해 주세요.")
        val ctx = pinnedContext(fields[3])
        val name = "pocketmind_host_" + randomKey()
        val listener = LocalServerSocket(name)
        own(Closeable {
            runCatching { android.system.Os.shutdown(listener.fileDescriptor, android.system.OsConstants.SHUT_RDWR) }
            listener.close()
        })
        serve({ listener.accept() }) { accepted ->
            val local = accepted as LocalSocket
            if (local.peerCredentials.uid != android.os.Process.myUid()) return@serve
            val tcp = own(Socket())
            try {
                link.network?.bindSocket(tcp)
                tcp.bind(InetSocketAddress(link.ip, 0))
                tcp.connect(InetSocketAddress(address, port), 8000)
                val tls = own(ctx.socketFactory.createSocket(tcp, fields[1], port, true) as SSLSocket)
                try {
                    tls.soTimeout = 8000
                    tls.startHandshake()
                    tls.outputStream.write(fields[4].toByteArray(Charsets.US_ASCII))
                    check(tls.inputStream.read() == 1)
                    pipe(tls, local)
                } finally { drop(tls) }
            } finally { drop(tcp) }
        }
        return name to link
    }
}
