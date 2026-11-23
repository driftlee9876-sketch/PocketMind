#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>
#import <Security/Security.h>
#import <PocketMindMetalPeer/PocketMindMetalPeer.h>
#include <arpa/inet.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <unistd.h>
#include <atomic>
#include <chrono>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

namespace {
constexpr int port = 18790;
bool sameSecret(const std::string &a, const std::string &b) {
  if (a.size() != b.size()) return false;
  unsigned diff = 0;
  for (size_t i = 0; i < a.size(); ++i) diff |= static_cast<unsigned char>(a[i] ^ b[i]);
  return diff == 0;
}
bool writeLine(int fd, const std::string &message) {
  size_t sent = 0;
  while (sent < message.size()) {
    ssize_t count = send(fd, message.data() + sent, message.size() - sent, 0);
    if (count <= 0) return false;
    sent += static_cast<size_t>(count);
  }
  return true;
}
std::string readLine(int fd) {
  std::string line;
  char c;
  while (line.size() < 90 && recv(fd, &c, 1, 0) == 1) {
    if (c == '\n') return line;
    line.push_back(c);
  }
  return {};
}

struct Peer {
  std::atomic<bool> closed{false};
  std::atomic<bool> paired{false};
  std::mutex sockets;
  int listener = -1;
  int active = -1;
  std::string code, token;
  void stop() {
    closed.store(true);
    std::lock_guard<std::mutex> lock(sockets);
    if (active >= 0) shutdown(active, SHUT_RDWR);
  }
  bool open() {
    uint8_t bytes[32];
    if (SecRandomCopyBytes(kSecRandomDefault, sizeof(bytes), bytes) != errSecSuccess) return false;
    const char hex[] = "0123456789abcdef";
    for (auto b : bytes) { token.push_back(hex[b >> 4]); token.push_back(hex[b & 15]); }
    char digits[9]; snprintf(digits, sizeof(digits), "%08u", arc4random_uniform(100000000));
    code = digits;
    listener = socket(AF_INET, SOCK_STREAM, 0);
    if (listener < 0) return false;
    int one = 1;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
    sockaddr_in address{};
    address.sin_len = sizeof(address); address.sin_family = AF_INET;
    address.sin_port = htons(port); address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(listener, reinterpret_cast<sockaddr *>(&address), sizeof(address)) || listen(listener, 4)) {
      close(listener); listener = -1; return false;
    }
    return true;
  }
  void serve() {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::minutes(5);
    int failures = 0;
    while (!closed.load() && failures < 5 && (paired.load() || std::chrono::steady_clock::now() < deadline)) {
      pollfd entry{listener, POLLIN, 0};
      if (poll(&entry, 1, 300) <= 0) continue;
      int fd = accept(listener, nullptr, nullptr);
      if (fd < 0) break;
      {
        std::lock_guard<std::mutex> lock(sockets);
        if (closed.load()) { close(fd); break; }
        active = fd;
      }
      int one = 1;
      setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one));
      setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
      timeval timeout{3, 0};
      setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
      std::string line = readLine(fd);
      if (!closed.load() && !paired.load() && sameSecret(line, "PAIR " + code)) {
        if (writeLine(fd, "OK " + token + "\n")) paired.store(true);
      } else if (!closed.load() && paired.load() && sameSecret(line, "RPC " + token)) {
        timeval unlimited{0, 0};
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &unlimited, sizeof(unlimited));
        if (writeLine(fd, "OK\n")) {
          int owned = dup(fd);
          if (owned >= 0) pm_gpu_serve(owned);
        }
      } else {
        ++failures;
        writeLine(fd, "DENIED\n");
      }
      { std::lock_guard<std::mutex> lock(sockets); active = -1; close(fd); }
    }
    close(listener);
    closed.store(true);
  }
};
}

@interface PocketMindMetalPeerModule : NSObject <RCTBridgeModule>
@end
@implementation PocketMindMetalPeerModule {
  std::shared_ptr<Peer> _peer;
}
RCT_EXPORT_MODULE(PocketMindMetalPeer)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (instancetype)init {
  if ((self = [super init])) {
    NSNotificationCenter *n = NSNotificationCenter.defaultCenter;
    [n addObserver:self selector:@selector(background:) name:UIApplicationWillResignActiveNotification object:nil];
    [n addObserver:self selector:@selector(checkHealth:) name:NSProcessInfoThermalStateDidChangeNotification object:nil];
    [n addObserver:self selector:@selector(checkHealth:) name:UIDeviceBatteryLevelDidChangeNotification object:nil];
  }
  return self;
}
- (void)background:(NSNotification *)notification {
  if (_peer) _peer->stop();
}
- (void)checkHealth:(NSNotification *)notification {
  float level = UIDevice.currentDevice.batteryLevel;
  if (NSProcessInfo.processInfo.thermalState >= NSProcessInfoThermalStateSerious || (level >= 0 && level < 0.20f))
    [self background:notification];
}
- (void)dealloc {
  [NSNotificationCenter.defaultCenter removeObserver:self];
  if (_peer) _peer->stop();
}
RCT_EXPORT_METHOD(startUsbGpuPeer:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (_peer && !_peer->closed.load()) { resolve(@(_peer->code.c_str())); return; }
  UIDevice.currentDevice.batteryMonitoringEnabled = YES;
  float battery = UIDevice.currentDevice.batteryLevel;
  if (UIApplication.sharedApplication.applicationState != UIApplicationStateActive ||
      NSProcessInfo.processInfo.thermalState >= NSProcessInfoThermalStateSerious || battery < 0.20f || !pm_gpu_available()) {
    reject(@"GPU", @"Metal GPU, 배터리 20% 이상, 활성 화면 및 기기 온도를 확인하세요.", nil); return;
  }
  auto peer = std::make_shared<Peer>();
  if (!peer->open()) { reject(@"GPU", @"GPU 연결을 열지 못했어요. 잠시 후 다시 시도하세요.", nil); return; }
  _peer = peer;
  std::thread([peer] { peer->serve(); }).detach();
  resolve(@(peer->code.c_str()));
}
RCT_EXPORT_METHOD(usbGpuPeerStatus:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(_peer && !_peer->closed.load() ? @(_peer->code.c_str()) : @"");
}
RCT_EXPORT_METHOD(stopUsbGpuPeer:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (_peer) _peer->stop();
  resolve(@YES);
}
@end
