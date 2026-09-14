// Compiled with ARC; the translated BRouter sources are not (they are J2ObjC's MRC output).
#import <Foundation/Foundation.h>

#include "../SpikeEngine.h"
#import "spike/SpikeRunner.h"

const char *spike_init(void) { return "j2objc"; }

char *spike_route(const char *segmentDir, const char *profileDir, const char *profile,
                  const char *lonlats, int32_t memoryclass) {
  @autoreleasepool {
    NSString *result = [SpikeSpikeRunner routeOnBigStackWithNSString:@(segmentDir)
                                                        withNSString:@(profileDir)
                                                        withNSString:@(profile)
                                                        withNSString:@(lonlats)
                                                             withInt:memoryclass];
    return strdup(result.UTF8String);
  }
}

void spike_free(char *result) { free(result); }

void spike_gc(void) {}
