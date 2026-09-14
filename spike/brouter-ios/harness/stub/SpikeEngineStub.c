#include <stdlib.h>
#include <string.h>

#include "../SpikeEngine.h"

const char *spike_init(void) { return "stub"; }

char *spike_route(const char *segmentDir, const char *profileDir, const char *profile,
                  const char *lonlats, int32_t memoryclass) {
  return strdup("error: stub engine");
}

void spike_free(char *result) { free(result); }

void spike_gc(void) {}
