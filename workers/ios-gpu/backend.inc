#include <unistd.h>

static ggml_backend_dev_t pocketmind_metal_device() {
    ggml_backend_load_all();
    for (size_t i = 0; i < ggml_backend_dev_count(); ++i) {
        auto device = ggml_backend_dev_get(i);
        if (ggml_backend_dev_backend_reg(device) == ggml_backend_metal_reg()) return device;
    }
    return nullptr;
}
extern "C" __attribute__((visibility("default"))) int pm_gpu_available() {
    return pocketmind_metal_device() != nullptr;
}
extern "C" __attribute__((visibility("default"))) void pm_gpu_serve(int fd) {
    auto connection = socket_t::adopt_paired(fd);
    auto device = pocketmind_metal_device();
    auto backend = device ? ggml_backend_dev_init(device, nullptr) : nullptr;
    if (!backend) return;
    rpc_serve_client({backend}, nullptr, connection);
    ggml_backend_free(backend);
}
