#pragma once
#ifdef __cplusplus
extern "C" {
#endif
int pm_gpu_available(void);
// The caller transfers ownership of an authenticated connected socket.
void pm_gpu_serve(int fd);
#ifdef __cplusplus
}
#endif
