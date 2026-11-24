#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>
#import <React/RCTBridge.h>
#include <vector>
#import <Security/Security.h>
#import <PocketMindMetalPeer/PocketMindMetalPeer.h>
#include <arpa/inet.h>
#include <ifaddrs.h>
#include <net/if.h>
extern "C" char *PMWifi(char *);
extern "C" void PMWifiFree(char *);
static NSDictionary *wifiCall(NSDictionary *request) {
  NSData *encoded = [NSJSONSerialization dataWithJSONObject:request options:0 error:nullptr];
  NSString *json = [[NSString alloc] initWithData:encoded encoding:NSUTF8StringEncoding];
  char *raw = PMWifi((char *)json.UTF8String);
  NSData *data = [NSData dataWithBytes:raw length:strlen(raw)];
  PMWifiFree(raw);
  return [NSJSONSerialization JSONObjectWithData:data options:0 error:nullptr];
}
static NSDictionary *wifiEndpoint(BOOL mesh) {
  struct ifaddrs *list = nullptr;
  if (getifaddrs(&list) != 0) return nil;
  NSDictionary *result = nil;
  for (auto *i = list; i; i = i->ifa_next) {
    if (!i->ifa_addr || !i->ifa_netmask || i->ifa_addr->sa_family != AF_INET ||
        (mesh ? strncmp(i->ifa_name,"utun",4) : strcmp(i->ifa_name, "en0")) || !(i->ifa_flags & IFF_UP)) continue;
    char address[INET_ADDRSTRLEN];
    auto *ip = (struct sockaddr_in *)i->ifa_addr;
    if (mesh && (ntohl(ip->sin_addr.s_addr) >> 22) != 401) continue; // 100.64.0.0/10
    if (!inet_ntop(AF_INET, &ip->sin_addr, address, sizeof(address))) continue;
    uint32_t mask = ntohl(((struct sockaddr_in *)i->ifa_netmask)->sin_addr.s_addr);
    result = @{@"Local":[NSString stringWithUTF8String:address], @"Prefix":@(mesh ? 10 : __builtin_popcount(mask)), @"Mesh":@(mesh)};
    break;
  }
  freeifaddrs(list);
  return result;
}
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

struct HostState {
  std::atomic<bool> stopped{false};
  pm_host *model=nullptr;
  void release() { if (model) { pm_host_free(model); model=nullptr; } }
};
static BOOL validPin(NSString *s) {
  return s.length==43 && [s rangeOfString:@"^[a-zA-Z0-9_-]{43}$" options:NSRegularExpressionSearch].location!=NSNotFound;
}

@interface PocketMindMetalPeerModule : NSObject <RCTBridgeModule, NSNetServiceDelegate, NSNetServiceBrowserDelegate>
@property(nonatomic,weak) RCTBridge *bridge;
@end
@implementation PocketMindMetalPeerModule {
  std::shared_ptr<Peer> _peer;
  NSNetServiceBrowser *_browser;
  NSMutableDictionary *_resolvers,*_nearby,*_remote;
  dispatch_queue_t _hostQueue;
  std::shared_ptr<HostState> _hostState;
  std::shared_ptr<std::atomic<bool>> _requestCancel;
  NSString *_hostToken,*_requestId;
  NSNetService *_wifiService,*_presence;
  NSString *_presenceTag;
  BOOL _autoGpu,_discoverable;
  NSDictionary *_wifiLink;
  NSString *_wifiError;
  NSString *_meshInvite;
}
RCT_EXPORT_MODULE(PocketMindMetalPeer)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (instancetype)init {
  if ((self = [super init])) {
    _hostQueue=dispatch_queue_create("org.pocketmind.gpu.host",DISPATCH_QUEUE_SERIAL);
    _nearby=[NSMutableDictionary dictionary]; _resolvers=[NSMutableDictionary dictionary];
    _remote=[[[NSUserDefaults standardUserDefaults] dictionaryForKey:@"PocketMindMeshHosts"] mutableCopy] ?: [NSMutableDictionary dictionary];
    NSNotificationCenter *n = NSNotificationCenter.defaultCenter;
    [n addObserver:self selector:@selector(background:) name:UIApplicationWillResignActiveNotification object:nil];
    [n addObserver:self selector:@selector(stopBackground:) name:UIApplicationDidEnterBackgroundNotification object:nil];
    [n addObserver:self selector:@selector(checkHealth:) name:NSProcessInfoThermalStateDidChangeNotification object:nil];
    [n addObserver:self selector:@selector(checkHealth:) name:UIDeviceBatteryLevelDidChangeNotification object:nil];
  }
  return self;
}
- (void)background:(NSNotification *)notification {
  if (!_wifiLink && _peer) _peer->stop();
}
- (void)endPresence {
  _presence.delegate=nil;[_presence stop];_presence=nil;_presenceTag=nil;
}
- (void)refreshPresence {
  NSDictionary *link=wifiEndpoint(NO);
  if (!link){[self endPresence];wifiCall(@{@"Op":@"unpresence"});return;}
  NSDictionary *r=wifiCall(@{@"Op":@"presence",@"Endpoint":link});
  if(!r[@"port"])return;
  NSString *tag=[NSString stringWithFormat:@"%@/%@/%@",link[@"Local"],r[@"port"],r[@"group"]];
  if ([_presenceTag isEqual:tag])return;
  [self endPresence];_presenceTag=tag;
  NSString *group=r[@"group"];
  NSString *name=[NSString stringWithFormat:@"PocketMind iOS %@ %@",[r[@"id"] substringToIndex:5],[group substringToIndex:MIN((NSUInteger)6,group.length)]];
  _presence=[[NSNetService alloc] initWithDomain:@"local." type:@"_pmgpu._tcp." name:name port:[r[@"port"] intValue]];
  NSMutableDictionary *txt=[NSMutableDictionary dictionary];
  NSDictionary *fields=@{@"ip":link[@"Local"],@"id":r[@"id"],@"platform":@"iOS",@"near":@"1",@"group":r[@"group"]};
  for(NSString *k in fields)txt[k]=[fields[k] dataUsingEncoding:NSUTF8StringEncoding];
  [_presence setTXTRecordData:[NSNetService dataFromTXTRecordDictionary:txt]];
  _presence.delegate=self;[_presence publish];
}
- (void)endWifi {
  _discoverable=NO;[self endPresence];wifiCall(@{@"Op":@"unpresence"});
  if(_autoGpu){if(_peer)_peer->stop();_autoGpu=NO;wifiCall(@{@"Op":@"detach"});}
  [self endBrowse];
  if (_hostState) { [self stopHost]; wifiCall(@{@"Op":@"stop"}); }
  if (_wifiLink) {
    _wifiService.delegate = nil; [_wifiService stop]; _wifiService = nil;
    wifiCall(@{@"Op":@"stop"});
    if (_peer) _peer->stop();
  }
  _wifiLink = nil; _meshInvite = nil;
}
- (void)stopBackground:(NSNotification *)notification {
  [self endWifi];
  if (_peer) _peer->stop();
}
- (void)netService:(NSNetService *)sender didNotPublish:(NSDictionary *)errorDict {
  if(sender==_presence){[self endPresence];_wifiError=@"로컬 네트워크 접근을 허용해 주세요.";return;}
  if (sender == _wifiService) {
    _wifiError = @"설정에서 PocketMind의 로컬 네트워크 접근을 허용하고 다시 눌러 주세요.";
    [self endWifi];
  }
}
- (void)checkHealth:(NSNotification *)notification {
  float level = UIDevice.currentDevice.batteryLevel;
  if (NSProcessInfo.processInfo.thermalState >= NSProcessInfoThermalStateSerious || (level >= 0 && level < 0.20f))
    [self stopBackground:notification];
}
- (void)dealloc {
  [NSNotificationCenter.defaultCenter removeObserver:self];
  [self endWifi];
  if (_peer) _peer->stop();
}
- (void)beginBrowse {
  if (_browser) return;
  _browser=[NSNetServiceBrowser new];
  _browser.delegate=self;
  [_browser searchForServicesOfType:@"_pmgpu._tcp." inDomain:@"local."];
}
- (void)endBrowse {
  _browser.delegate=nil; [_browser stop]; _browser=nil;
  for (NSNetService *service in _resolvers.allValues) { service.delegate=nil; [service stop]; }
  [_resolvers removeAllObjects]; [_nearby removeAllObjects];
}
- (void)netServiceBrowser:(NSNetServiceBrowser *)browser didNotSearch:(NSDictionary *)error {
  if (browser==_browser) { [self endBrowse]; _wifiError=@"Wi-Fi 및 설정의 로컬 네트워크 접근 권한을 확인하세요."; }
}
- (void)netServiceBrowser:(NSNetServiceBrowser *)browser didFindService:(NSNetService *)service moreComing:(BOOL)more {
  if (browser!=_browser) return;
  _resolvers[service.name]=service;
  service.delegate=self; [service resolveWithTimeout:8];
}
- (void)netServiceBrowser:(NSNetServiceBrowser *)browser didRemoveService:(NSNetService *)service moreComing:(BOOL)more {
  if (browser!=_browser) return;
  NSNetService *old=_resolvers[service.name]; old.delegate=nil; [old stop];
  [_resolvers removeObjectForKey:service.name]; [_nearby removeObjectForKey:service.name];
}
- (void)netServiceDidResolveAddress:(NSNetService *)service {
  if (_resolvers[service.name]!=service || service.port<1 || service.port>65535) return;
  NSDictionary *txt=[NSNetService dictionaryFromTXTRecordData:service.TXTRecordData ?: [NSData data]];
  NSString *(^field)(NSString *)=^NSString *(NSString *k){ return [[NSString alloc] initWithData:txt[k] ?: [NSData data] encoding:NSUTF8StringEncoding]; };
  NSString *pin=field(@"id");
  if (!validPin(pin)) return;
  NSString *ip=field(@"ip");
  struct in_addr addr;
  if (!ip || inet_pton(AF_INET,ip.UTF8String,&addr)!=1) {
    ip=nil;
    for (NSData *record in service.addresses) {
      if (record.length<sizeof(sockaddr_in)) continue;
      const sockaddr_in *a=(const sockaddr_in *)record.bytes;
      char buf[INET_ADDRSTRLEN];
      if (a->sin_family==AF_INET && inet_ntop(AF_INET,&a->sin_addr,buf,sizeof(buf))) { ip=@(buf); break; }
    }
  }
  if (ip) _nearby[service.name]=@{@"ID":pin,@"IP":ip,@"Port":@(service.port),@"name":service.name,@"Group":field(@"group") ?: @"",@"near":@([field(@"near") isEqual:@"1"]),@"platform":field(@"platform") ?: @"GPU"};
}
- (NSArray *)availablePeers {
  NSMutableArray *peers=[NSMutableArray array];
  NSArray *ordered=[_nearby.allValues sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *a,NSDictionary *b){return [b[@"near"] compare:a[@"near"]];}];
  NSString *own=wifiCall(@{@"Op":@"status"})[@"id"];
  for (NSDictionary *p in [ordered arrayByAddingObjectsFromArray:_remote.allValues]) {
    if([p[@"ID"] isEqual:own] || [[peers valueForKey:@"ID"] containsObject:p[@"ID"]])continue;
    NSDictionary *iface=wifiEndpoint([p[@"Mesh"] boolValue]);
    if (!iface) continue;
    NSMutableDictionary *endpoint=[p mutableCopy]; [endpoint addEntriesFromDictionary:iface];
    [peers addObject:endpoint];
  }
  for (NSDictionary *p in wifiCall(@{@"Op":@"status"})[@"internetPeers"]) {
    if (![[peers valueForKey:@"ID"] containsObject:p[@"ID"]]) [peers addObject:p];
  }
  return peers;
}
- (NSDictionary *)endpoint:(NSString *)pin {
  for (NSDictionary *p in [self availablePeers]) if ([p[@"ID"] isEqual:pin]) return p;
  return nil;
}
- (void)stopHost {
  if (!_hostState) return;
  auto old=_hostState;
  _hostState.reset(); _hostToken=nil; _requestId=nil;
  old->stopped=true;
  if (_requestCancel) _requestCancel->store(true);
  _requestCancel.reset();
  // Keep transports alive during normal model teardown. Commands on the host
  // queue cannot race destruction with a pending load or decode.
  dispatch_async(_hostQueue, ^{ old->release(); });
}
RCT_EXPORT_METHOD(stopTabletGpu:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [self stopHost]; wifiCall(@{@"Op":@"stop"}); resolve(@YES);
}
RCT_EXPORT_METHOD(stopTabletSession:(NSString *)token resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if ([_hostToken isEqual:token]) { [self stopHost]; wifiCall(@{@"Op":@"stop"}); }
  resolve(@YES);
}
RCT_EXPORT_METHOD(tabletGpuStatus:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(@{@"hosting":@(_hostState && _hostToken && pm_host_healthy())});
}
RCT_EXPORT_METHOD(calibratedGpuGroup:(NSArray<NSString *> *)ids filename:(NSString *)filename policy:(NSString *)policy
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (_hostState || _wifiLink || !ids.count || ids.count>20 || ![filename isEqual:filename.lastPathComponent] ||
      ![filename.pathExtension.lowercaseString isEqual:@"gguf"]) { reject(@"GPU",@"모델과 보조 GPU를 다시 선택하세요.",nil); return; }
  NSURL *folder=[[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
  NSString *path=[folder URLByAppendingPathComponent:filename].path;
  if (![[NSFileManager defaultManager] isReadableFileAtPath:path]) {reject(@"GPU",@"이 아이폰에 GGUF 모델을 먼저 설치하세요.",nil);return;}
  NSMutableArray *endpoints=[NSMutableArray array];
  for (NSString *pin in ids) {
    NSDictionary *p=[self endpoint:pin];
    if (!p) {reject(@"GPU",@"선택한 기기의 네트워크 연결을 확인하세요.",nil);return;}
    [endpoints addObject:p];
  }
  NSDictionary *reply=wifiCall(@{@"Op":@"bridges",@"Endpoints":endpoints});
  if (reply[@"error"]) {reject(@"GPU",reply[@"error"],nil);return;}
  NSArray *bridges=reply[@"bridges"];
  auto session=std::make_shared<HostState>(); _hostState=session;
  dispatch_async(_hostQueue,^{
    std::vector<const char *> routes;
    for (NSString *b in bridges) routes.push_back(b.UTF8String);
    session->model=pm_host_load(path.fileSystemRepresentation,routes.data(),(int)routes.size(),&session->stopped);
    dispatch_async(dispatch_get_main_queue(),^{
      if (session!=_hostState || !session->model || session->stopped.load()) {
        if (session==_hostState) { [self stopHost]; wifiCall(@{@"Op":@"stop"}); }
        reject(@"GPU",@"모델을 나눠 올리지 못했어요. 모델 크기와 보조 GPU 연결을 확인하세요.",nil);return;
      }
      _hostToken=NSUUID.UUID.UUIDString;
      resolve(@{@"tablet":@YES,@"wifi":@YES,@"token":_hostToken,@"model":filename,@"device":[[endpoints valueForKey:@"name"] componentsJoinedByString:@", "]});
    });
  });
}
RCT_EXPORT_METHOD(cancelWiredRequest:(NSString *)request) {
  if ([_requestId isEqual:request] && _requestCancel) _requestCancel->store(true);
}
RCT_EXPORT_METHOD(wiredRequest:(NSString *)request action:(NSString *)action token:(NSString *)token body:(NSString *)body
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSDictionary *q=[NSJSONSerialization JSONObjectWithData:[body dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nullptr];
  NSArray *messages=q[@"messages"];
  if (![action isEqual:@"stream"] || ![_hostToken isEqual:token] || !_hostState || _requestId || ![messages isKindOfClass:NSArray.class]) {
    reject(@"GPU",@"연결된 GPU 세션을 확인하세요.",nil); return;
  }
  for (NSDictionary *m in messages) {
    if (![m isKindOfClass:NSDictionary.class] || ![m[@"role"] isKindOfClass:NSString.class] || ![m[@"content"] isKindOfClass:NSString.class]) {
      reject(@"GPU",@"대화 내용을 읽지 못했어요.",nil);return;
    }
  }
  auto session=_hostState; auto cancel=std::make_shared<std::atomic<bool>>(false);
  _requestId=request; _requestCancel=cancel;
  dispatch_async(_hostQueue,^{
    std::vector<const char *> roles,contents;
    for (NSDictionary *m in messages) {roles.push_back([m[@"role"] UTF8String]);contents.push_back([m[@"content"] UTF8String]);}
    __block NSMutableData *bytes=[NSMutableData data];
    void (^emit)(const char *,int)=^(const char *piece,int n){
      [bytes appendBytes:piece length:n];
      NSString *text=[[NSString alloc] initWithData:bytes encoding:NSUTF8StringEncoding];
      if (text) [self.bridge enqueueJSCall:@"RCTDeviceEventEmitter" method:@"emit" args:@[@"PocketMindGpuText",@{@"id":request,@"text":text}] completion:nil];
    };
    const char *e=pm_host_chat(session->model,roles.data(),contents.data(),(int)roles.size(),cancel.get(),
      [](const char *s,int n,void *u){ ((void (^)(const char *,int))(__bridge id)u)(s,n); },(__bridge void *)emit);
    NSString *error=e ? @(e) : nil;
    NSString *text=[[NSString alloc] initWithData:bytes encoding:NSUTF8StringEncoding] ?: @"";
    dispatch_async(dispatch_get_main_queue(),^{
      if ([_requestId isEqual:request]) { _requestId=nil; _requestCancel.reset(); }
      if (error || cancel->load() || !text.length) {reject(@"GPU",error ?: @"답변 생성이 종료됐어요.",nil);return;}
      NSData *data=[NSJSONSerialization dataWithJSONObject:@{@"text":text} options:0 error:nullptr];
      resolve([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]);
    });
  });
}

RCT_EXPORT_METHOD(wifiGpu:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSDictionary *q = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nullptr];
  NSURL *folder = [[NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject URLByAppendingPathComponent:@"wifi-gpu"];
  NSDictionary *r = wifiCall(@{@"Op":@"init", @"Dir":folder.path});
  [folder setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nullptr];
  if (r[@"error"]) {reject(@"WIFI_GPU",r[@"error"],nil); return;}
  NSString *op = q[@"op"];
  if ([op isEqual:@"browse"]) {
    _discoverable=YES;[self beginBrowse];
  } else if ([op isEqual:@"import"] && [q[@"invite"] hasPrefix:@"pmgpu2|"]) {
    r=wifiCall(@{@"Op":@"importInternet",@"Value":q[@"invite"]});
  } else if ([op isEqual:@"import"]) {
    NSArray *parts=[q[@"invite"] componentsSeparatedByString:@"|"];
    struct in_addr ip;
    if (parts.count!=3 || ![parts[0] isEqual:@"pmgpu1"] || !validPin(parts[2]) ||
        inet_pton(AF_INET,[parts[1] UTF8String],&ip)!=1 || (ntohl(ip.s_addr)>>22)!=401 || !wifiEndpoint(YES)) {
      reject(@"GPU",@"Tailscale 연결과 원격 초대를 확인하세요.",nil);return;
    }
    _remote[parts[2]]=@{@"ID":parts[2],@"IP":parts[1],@"Port":@47832,@"Mesh":@YES,@"name":parts[1],@"platform":@"Tailscale"};
    [[NSUserDefaults standardUserDefaults] setObject:_remote forKey:@"PocketMindMeshHosts"];
  } else if ([op isEqual:@"pair"]) {
    NSDictionary *endpoint=[self endpoint:q[@"id"]];
    if (!endpoint) {reject(@"GPU",@"기기를 다시 검색하세요.",nil);return;}
    r=wifiCall(@{@"Op":@"pair",@"Endpoint":endpoint});
  } else if ([op isEqual:@"offer"]) {
    if (_hostState) {reject(@"GPU",@"실행 중인 모델 연결을 먼저 종료하세요.",nil);return;}
    [self endBrowse];
    BOOL remote = [q[@"mesh"] boolValue];
    BOOL internet=[q[@"internet"] boolValue];
    NSDictionary *link = internet ? @{@"Internet":@YES} : wifiEndpoint(remote);
    if (!link || !_peer || _peer->closed.load() || _peer->paired.exchange(true)) {
      reject(@"WIFI_GPU",remote ? @"Tailscale VPN 연결과 GPU 제공 상태를 확인하세요." : @"Wi-Fi에 연결하고 GPU 제공을 다시 시작해 주세요.",nil);return;
    }
    r = wifiCall(@{@"Op":internet ? @"offerInternet" : @"offer",@"Endpoint":link,@"Backend":@"ios",@"Value":@(_peer->token.c_str())});
    if (!r[@"error"]) {
      _wifiError = nil;
      _wifiLink = link;
      if (internet) {
        _meshInvite=nil;
      } else if (remote) {
        _meshInvite = [NSString stringWithFormat:@"pmgpu1|%@|%@",link[@"Local"],r[@"id"]];
      } else {
      _wifiService = [[NSNetService alloc] initWithDomain:@"local." type:@"_pmgpu._tcp." name:@"PocketMind iOS" port:[r[@"port"] intValue]];
      _wifiService.delegate = self;
      [_wifiService setTXTRecordData:[NSNetService dataFromTXTRecordDictionary:@{@"id":[r[@"id"] dataUsingEncoding:NSUTF8StringEncoding],@"platform":[@"iOS" dataUsingEncoding:NSUTF8StringEncoding],@"ip":[link[@"Local"] dataUsingEncoding:NSASCIIStringEncoding]}]];
      [_wifiService publish];
      }
    } else { _peer->stop(); }
  } else if ([op isEqual:@"stop"] || [op isEqual:@"forget"]) {
    [self endWifi]; _wifiError = nil;
    if ([op isEqual:@"forget"]) {[_remote removeAllObjects];[[NSUserDefaults standardUserDefaults] removeObjectForKey:@"PocketMindMeshHosts"];}
    r = wifiCall(@{@"Op":op});
  } else if ([op isEqual:@"attach"]) {
    if (UIApplication.sharedApplication.applicationState!=UIApplicationStateActive || _hostState || !_peer || _peer->closed.load()){reject(@"GPU",@"GPU를 준비하지 못했어요.",nil);return;}
    _peer->paired.store(true);_autoGpu=YES;
    r=wifiCall(@{@"Op":@"attach",@"Backend":@"ios",@"Value":@(_peer->token.c_str())});
  } else if ([op isEqual:@"enter"]) {
    r=wifiCall(@{@"Op":op,@"Challenge":q[@"id"] ?: @"",@"Value":q[@"code"] ?: @""});
  } else if ([op isEqual:@"vote"]) {
    r = wifiCall(@{@"Op":op,@"Challenge":q[@"id"] ?: @"",@"Accept":q[@"accept"] ?: @NO});
  } else if (_wifiLink && (!_peer || _peer->closed.load() || (![_wifiLink[@"Internet"] boolValue] && ![_wifiLink isEqual:wifiEndpoint([_wifiLink[@"Mesh"] boolValue])]))) {
    [self endWifi]; _wifiError=@"Wi-Fi 또는 GPU 연결이 종료됐어요.";
  }
  if (r[@"error"]) {reject(@"WIFI_GPU",r[@"error"],nil);return;}
  if(_discoverable && UIApplication.sharedApplication.applicationState==UIApplicationStateActive){
    [self refreshPresence];[self beginBrowse];
    if(_autoGpu && (!_peer || _peer->closed.load())){_autoGpu=NO;wifiCall(@{@"Op":@"detach"});}
  }
  NSMutableDictionary *state=[wifiCall(@{@"Op":@"status"}) mutableCopy];
  if (_wifiError) state[@"issue"]=_wifiError;
  if (_meshInvite) state[@"invitation"]=_meshInvite;
  if ([_wifiLink[@"Internet"] boolValue]) state[@"invitation"]=state[@"relayInvitation"];
  state[@"meshReady"]=@(wifiEndpoint(YES)!=nil);
  state[@"peers"]=[self availablePeers]; state[@"searching"]=@(_browser!=nil);
  NSData *data=[NSJSONSerialization dataWithJSONObject:state options:0 error:nullptr];
  resolve([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]);
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
