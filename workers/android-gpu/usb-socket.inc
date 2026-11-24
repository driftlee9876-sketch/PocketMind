// Compiled only into the opt-in Android GPU peer, with the pinned ggml transport.
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <sys/un.h>
#include <unistd.h>

socket_ptr socket_t::accept() {
    for (;;) {
        int fd = ::accept4(pimpl->fd, nullptr, nullptr, SOCK_CLOEXEC);
        if (fd < 0) return nullptr;
        struct ucred peer {};
        socklen_t length = sizeof(peer);
        // adbd opens the forwarded socket under Android's shell UID on production devices.
        if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &peer, &length) == 0 &&
            (peer.uid == 2000 || peer.uid == 0 || peer.uid == getuid())) {
            return socket_ptr(new socket_t(std::make_unique<impl>(fd)));
        }
        ::close(fd);
    }
}

socket_ptr socket_t::create_server(const char * host, int port) {
    const char * name = std::getenv("POCKETMIND_USB_SOCKET");
    if (!name || std::strncmp(name, "pocketmind_gpu_", 15) != 0 ||
        std::strlen(name) != 23 || std::strspn(name + 15, "0123456789") != 8 ||
        std::strcmp(host, "127.0.0.1") != 0 || port != 50052) return nullptr;
    int fd = ::socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return nullptr;
    sockaddr_un addr {};
    addr.sun_family = AF_UNIX;
    std::memcpy(addr.sun_path + 1, name, std::strlen(name));
    socklen_t size = offsetof(sockaddr_un, sun_path) + 1 + std::strlen(name);
    if (::bind(fd, reinterpret_cast<const sockaddr *>(&addr), size) < 0 || ::listen(fd, 4) < 0) {
        ::close(fd);
        return nullptr;
    }
    std::fputs("POCKETMIND_USB_READY\n", stdout);
    std::fflush(stdout);
    return socket_ptr(new socket_t(std::make_unique<impl>(fd)));
}

// The tablet host calls back into its own app over a private abstract socket.
socket_ptr socket_t::connect(const char * host, int port) {
    if (std::strcmp(host, "127.0.0.1") != 0 || port < 50052 || port >= 50052 + 20) return nullptr;
    char key[40];
    if (port == 50052) std::strcpy(key, "POCKETMIND_HOST_SOCKET");
    else std::snprintf(key, sizeof(key), "POCKETMIND_HOST_SOCKET_%d", port - 50052);
    const char * name = std::getenv(key);
    if (!name || std::strncmp(name, "pocketmind_host_", 16) != 0 || std::strlen(name) > 80) return nullptr;
    int fd = ::socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return nullptr;
    sockaddr_un addr {};
    addr.sun_family = AF_UNIX;
    std::memcpy(addr.sun_path + 1, name, std::strlen(name));
    socklen_t size = offsetof(sockaddr_un, sun_path) + 1 + std::strlen(name);
    struct ucred peer {};
    socklen_t length = sizeof(peer);
    if (::connect(fd, reinterpret_cast<const sockaddr *>(&addr), size) == 0 &&
        getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &peer, &length) == 0 && peer.uid == getuid())
        return socket_ptr(new socket_t(std::make_unique<impl>(fd)));
    ::close(fd);
    return nullptr;
}
