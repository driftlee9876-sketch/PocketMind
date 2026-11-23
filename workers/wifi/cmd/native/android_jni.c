//go:build android

#include <jni.h>
#include "_cgo_export.h"

JNIEXPORT jstring JNICALL Java_com_pocketmind_WifiCore_command(JNIEnv *env, jobject self, jstring input) {
    const char *utf = (*env)->GetStringUTFChars(env, input, 0);
    if (!utf) return NULL;
    char *json = PMWifi((char *)utf);
    (*env)->ReleaseStringUTFChars(env,input,utf);
    jstring result = (*env)->NewStringUTF(env,json);
    PMWifiFree(json);
    return result;
}
