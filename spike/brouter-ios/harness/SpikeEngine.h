// The one C entry point the Swift harness calls. Each candidate implements it: J2ObjC with an
// Objective-C shim over the translated SpikeRunner, MobiVM with a JNI shim into the framework's
// VM, and the stub with nothing at all (the app-size baseline).
#ifndef SPIKE_ENGINE_H
#define SPIKE_ENGINE_H

#include <stdint.h>

/// Starts the engine's runtime. Returns a short human-readable name for the candidate.
const char *spike_init(void);

/// Routes like brouter.de does and returns GeoJSON, or a string starting with "error: ".
/// The caller frees the result with spike_free.
char *spike_route(const char *segmentDir, const char *profileDir, const char *profile,
                  const char *lonlats, int32_t memoryclass);

void spike_free(char *result);

/// Asks the runtime to collect garbage, where it has a collector. No-op otherwise.
void spike_gc(void);

#endif
