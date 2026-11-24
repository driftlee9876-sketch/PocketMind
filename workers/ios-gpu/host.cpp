#include "PocketMindMetalPeer.h"
#include "llama.h"
#include "ggml-rpc.h"
#include "ggml-metal.h"
#include <algorithm>
#include <atomic>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

// Host calls are serialized on a private queue. Only cancellation and the
// transport failure flag cross that queue boundary.
extern "C" bool pm_set_route(int, const char *);
static std::atomic<bool> lost{false};
extern "C" void pm_host_rpc_failed() { lost = true; }
extern "C" int pm_host_healthy() { return !lost.load(); }
struct pm_host {
    llama_model *model = nullptr;
    ~pm_host() { if (model) llama_model_free(model); }
};
static bool keep_loading(float, void *user) {
    return !lost && !static_cast<std::atomic<bool> *>(user)->load();
}
extern "C" pm_host *pm_host_load(const char *file, const char **bridges, int count, void *cancel) {
    if (count < 1 || count > 20) return nullptr;
    lost = false;
    llama_backend_init();
    std::vector<ggml_backend_dev_t> devices;
    auto metal = ggml_backend_metal_reg();
    if (!metal || !ggml_backend_reg_dev_count(metal)) return nullptr;
    devices.push_back(ggml_backend_reg_dev_get(metal, 0));
    for (int i = 0; i < count; ++i) {
        if (!keep_loading(0,cancel)) return nullptr;
        if (!pm_set_route(i,bridges[i])) return nullptr;
        auto endpoint = "pm-peer:" + std::to_string(i+1);
        auto remote = ggml_backend_rpc_add_server(endpoint.c_str());
        if (!remote || ggml_backend_reg_dev_count(remote) != 1) return nullptr;
        devices.push_back(ggml_backend_reg_dev_get(remote, 0));
    }
    devices.push_back(nullptr);
    auto p = llama_model_default_params();
    float weights[32];
    std::fill_n(weights,32,1.0f);
    p.devices = devices.data();
    p.n_gpu_layers = 999;
    p.split_mode = LLAMA_SPLIT_MODE_LAYER;
    p.tensor_split = weights;
    p.progress_callback = keep_loading;
    p.progress_callback_user_data = cancel;
    auto host = std::make_unique<pm_host>();
    host->model = llama_model_load_from_file(file,p);
    if (!host->model || llama_model_n_layer(host->model) < count + 1 || !keep_loading(0,cancel)) return nullptr;
    return host.release();
}
extern "C" void pm_host_free(pm_host *host) { delete host; }

extern "C" const char *pm_host_chat(pm_host *host, const char **roles, const char **contents, int count,
                                   void *cancel, void (*emit)(const char *, int, void *), void *context) {
    if (!host || count < 1 || count > 64) return "대화 내용을 확인하세요.";
    auto model = host->model;
    std::vector<llama_chat_message> messages;
    for (int i = 0; i < count; i++) messages.push_back({roles[i], contents[i]});
    auto format = llama_model_chat_template(model, nullptr);
    int n = llama_chat_apply_template(format,messages.data(),count,true,nullptr,0);
    if (n <= 0 || n > 1024*1024) return "이 모델의 대화 형식을 지원하지 않거나 대화가 너무 길어요.";
    std::vector<char> prompt(n+1);
    llama_chat_apply_template(format,messages.data(),count,true,prompt.data(),prompt.size());
    auto vocab = llama_model_get_vocab(model);
    auto settings = llama_context_default_params();
    settings.n_ctx = std::min<uint32_t>(4096,llama_model_n_ctx_train(model));
    settings.n_batch = std::min<uint32_t>(512,settings.n_ctx);
    int length = -llama_tokenize(vocab,prompt.data(),n,nullptr,0,true,true);
    if (length < 1 || length >= (int)settings.n_ctx) return "대화가 모델의 문맥 길이를 넘었어요. 새 대화에서 다시 시도하세요.";
    if (!keep_loading(0,cancel)) return "GPU 연산이 중지됐어요.";
    std::vector<llama_token> tokens(length);
    if (llama_tokenize(vocab,prompt.data(),n,tokens.data(),length,true,true) != length) return "입력을 읽지 못했어요.";
    std::unique_ptr<llama_context,decltype(&llama_free)> ctx(llama_init_from_model(model,settings),llama_free);
    if (!ctx) return "모델 실행에 필요한 메모리가 부족해요.";
    for (int pos = 0; pos < length; ) {
        int batch = std::min<int>(settings.n_batch,length-pos);
        if (!keep_loading(0,cancel) || llama_decode(ctx.get(),llama_batch_get_one(tokens.data()+pos,batch)) != 0)
            return "GPU 연산이 중지됐어요.";
        pos += batch;
    }
    std::unique_ptr<llama_sampler,decltype(&llama_sampler_free)> sampler(llama_sampler_init_greedy(),llama_sampler_free);
    for (int i=length; i<(int)settings.n_ctx && i-length<1024; ++i) {
        if (!keep_loading(0,cancel)) return "GPU 연결 또는 요청이 종료됐어요.";
        auto token=llama_sampler_sample(sampler.get(),ctx.get(),-1);
        if (llama_vocab_is_eog(vocab,token)) break;
        char buf[256];
        int size=llama_token_to_piece(vocab,token,buf,sizeof(buf),0,false);
        if (size<0) {
            std::vector<char> piece(-size);
            size=llama_token_to_piece(vocab,token,piece.data(),piece.size(),0,false);
            if (size>0) emit(piece.data(),size,context);
        } else if (size>0) emit(buf,size,context);
        if (llama_decode(ctx.get(),llama_batch_get_one(&token,1))!=0) return "GPU에서 답변 생성을 계속할 수 없어요.";
    }
    return lost ? "보조 GPU 연결이 끊겼어요." : nullptr;
}
