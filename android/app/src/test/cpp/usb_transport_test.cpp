// Exercise the Android socket adapter with Linux abstract sockets and SO_PEERCRED.
#include <cassert>
#include <cstdio>
#include <memory>
#include <string>
#include <sys/socket.h>
#include <unistd.h>

class socket_t;
using socket_ptr = std::shared_ptr<socket_t>;
class socket_t {
public:
    struct impl {
        explicit impl(int fd) : fd(fd) {}
        ~impl() { ::close(fd); }
        int fd;
    };
    explicit socket_t(std::unique_ptr<impl> handle) : pimpl(std::move(handle)) {}
    socket_ptr accept();
    static socket_ptr connect(const char *, int);
    static socket_ptr create_server(const char *, int);
    std::unique_ptr<impl> pimpl;
};
#include "usb-socket.inc"

int main() {
    const std::string host = "pocketmind_host_ci_" + std::to_string(getpid());
    ::setenv("POCKETMIND_HOST_SOCKET", host.c_str(), 1);
    ::setenv("POCKETMIND_USB_SOCKET", "pocketmind_gpu_87654321", 1);
    assert(!socket_t::connect("192.0.2.1", 50052));
    assert(!socket_t::create_server("0.0.0.0", 50052));

    auto donor = socket_t::create_server("127.0.0.1", 50052);
    assert(donor);
    const int listener = ::socket(AF_UNIX, SOCK_STREAM, 0);
    sockaddr_un address {};
    address.sun_family = AF_UNIX;
    std::memcpy(address.sun_path + 1, host.data(), host.size());
    assert(::bind(listener, reinterpret_cast<sockaddr *>(&address),
                  offsetof(sockaddr_un, sun_path) + 1 + host.size()) == 0);
    assert(::listen(listener, 2) == 0);
    auto client = socket_t::connect("127.0.0.1", 50052);
    assert(client);
    int peer = ::accept(listener, nullptr, nullptr);
    assert(peer >= 0);
    assert(::write(client->pimpl->fd, "RPC", 3) == 3);
    char bytes[4] {};
    assert(::read(peer, bytes, 3) == 3 && std::strcmp(bytes, "RPC") == 0);
    ::close(peer);
    ::close(listener);
}
