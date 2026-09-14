// The MobiVM framework starts its VM from a load-time constructor (frameworksupport.m) and
// exports the JNI invocation API, so the bridge is plain JNI: find the VM, attach this thread,
// call spike.SpikeRunner.routeOnBigStack. No cocoatouch bindings are needed.
#include <jni.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../SpikeEngine.h"

static JNIEnv *attach(void) {
  JavaVM *vm = NULL;
  jsize count = 0;
  if (JNI_GetCreatedJavaVMs(&vm, 1, &count) != JNI_OK || count < 1) return NULL;
  JNIEnv *env = NULL;
  if ((*vm)->AttachCurrentThread(vm, (void **)&env, NULL) != JNI_OK) return NULL;
  return env;
}

static char *describe_exception(JNIEnv *env) {
  jthrowable t = (*env)->ExceptionOccurred(env);
  (*env)->ExceptionClear(env);
  jclass object = (*env)->FindClass(env, "java/lang/Object");
  jmethodID toString = (*env)->GetMethodID(env, object, "toString", "()Ljava/lang/String;");
  jstring s = (jstring)(*env)->CallObjectMethod(env, t, toString);
  const char *utf = s ? (*env)->GetStringUTFChars(env, s, NULL) : "unknown";
  size_t n = strlen(utf) + 8;
  char *out = malloc(n);
  snprintf(out, n, "error: %s", utf);
  if (s) (*env)->ReleaseStringUTFChars(env, s, utf);
  return out;
}

const char *spike_init(void) { return attach() ? "mobivm" : "mobivm (no VM)"; }

char *spike_route(const char *segmentDir, const char *profileDir, const char *profile,
                  const char *lonlats, int32_t memoryclass) {
  JNIEnv *env = attach();
  if (!env) return strdup("error: no Java VM");
  if ((*env)->PushLocalFrame(env, 16) != JNI_OK) return strdup("error: PushLocalFrame");

  char *out;
  jclass runner = (*env)->FindClass(env, "spike/SpikeRunner");
  if (!runner) {
    out = describe_exception(env);
  } else {
    jmethodID route = (*env)->GetStaticMethodID(
        env, runner, "routeOnBigStack",
        "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;I)Ljava/lang/String;");
    jstring result = (jstring)(*env)->CallStaticObjectMethod(
        env, runner, route, (*env)->NewStringUTF(env, segmentDir), (*env)->NewStringUTF(env, profileDir),
        (*env)->NewStringUTF(env, profile), (*env)->NewStringUTF(env, lonlats), (jint)memoryclass);
    if ((*env)->ExceptionCheck(env)) {
      out = describe_exception(env);
    } else {
      const char *utf = (*env)->GetStringUTFChars(env, result, NULL);
      out = strdup(utf);
      (*env)->ReleaseStringUTFChars(env, result, utf);
    }
  }
  (*env)->PopLocalFrame(env, NULL);
  return out;
}

void spike_free(char *result) { free(result); }

void spike_gc(void) {
  JNIEnv *env = attach();
  if (!env) return;
  jclass system = (*env)->FindClass(env, "java/lang/System");
  jmethodID gc = (*env)->GetStaticMethodID(env, system, "gc", "()V");
  (*env)->CallStaticVoidMethod(env, system, gc);
  (*env)->DeleteLocalRef(env, system);
}
