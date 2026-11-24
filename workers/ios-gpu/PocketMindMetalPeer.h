#pragma once
#ifdef __cplusplus
extern "C" {
#endif
int pm_gpu_available(void);
// The caller transfers ownership of an authenticated connected socket.
void pm_gpu_serve(int fd);
typedef struct pm_host pm_host;
int pm_host_healthy(void);
pm_host *pm_host_load(const char *file, const char **bridges, int count, void *cancel);
void pm_host_free(pm_host *host);
const char *pm_host_chat(pm_host *, const char **roles, const char **contents, int count,
                        void *cancel, void (*emit)(const char *, int, void *), void *context);
#ifdef __cplusplus
}
#endif
