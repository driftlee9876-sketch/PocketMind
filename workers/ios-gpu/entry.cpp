#include "PocketMindMetalPeer.h"
// Keep the two public entry points when linking static ggml into the private framework.
extern "C" __attribute__((used)) const void * const pocketmind_entry_points[] = {
    reinterpret_cast<const void *>(&pm_gpu_available), reinterpret_cast<const void *>(&pm_gpu_serve)
};
