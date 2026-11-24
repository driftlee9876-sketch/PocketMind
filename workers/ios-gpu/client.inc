// Stable per-session slots keep ggml's device cache bounded. The random
// capability is sent only to this app's loopback transport.
#include <string>
struct Route { std::string key; int port=0; };
static Route routes[20];
static std::mutex route_mutex;
extern "C" bool pm_set_route(int index,const char *bridge) {
    int port=0, end=0;
    if (index<0 || index>=20 || sscanf(bridge,"127.0.0.1:%d/%n",&port,&end)!=1 ||
        !end || port<1 || port>65535 || strlen(bridge+end)!=48 || strspn(bridge+end,"0123456789abcdef")!=48) return false;
    std::lock_guard<std::mutex> lock(route_mutex);
    routes[index]={bridge+end,port};
    return true;
}
socket_ptr socket_t::connect(const char *host, int port) {
    if (strcmp(host,"pm-peer") || port<1 || port>20) return nullptr;
    std::string key;
    {
        std::lock_guard<std::mutex> lock(route_mutex);
        key=routes[port-1].key;
        port=routes[port-1].port;
    }
    if (key.empty()) return nullptr;
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd<0) return nullptr;
    auto client = adopt_paired(fd);
    int one=1;
    setsockopt(fd,SOL_SOCKET,SO_NOSIGPIPE,&one,sizeof(one));
    setsockopt(fd,IPPROTO_TCP,TCP_NODELAY,&one,sizeof(one));
    timeval timeout{45,0};
    setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof(timeout));
    setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof(timeout));
    sockaddr_in addr{};
    addr.sin_family=AF_INET;
    addr.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
    addr.sin_port=htons(port);
    if (::connect(fd,reinterpret_cast<sockaddr*>(&addr),sizeof(addr)) ||
        !client->send_data(key.data(),key.size()) || !client->flush()) return nullptr;
    return client;
}
