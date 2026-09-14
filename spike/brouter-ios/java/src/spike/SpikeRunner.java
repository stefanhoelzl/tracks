package spike;

import java.io.File;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import btools.router.FormatJson;
import btools.router.OsmNodeNamed;
import btools.router.OsmTrack;
import btools.router.RoutingContext;
import btools.router.RoutingEngine;
import btools.router.RoutingParamCollector;

/**
 * The one entry point every candidate calls: the JVM baseline, J2ObjC from Swift and MobiVM
 * from Swift. It routes the way brouter.de's RouteServer does for the request the web app
 * sends (lonlats, profile, alternativeidx=0, format=geojson), so its output is comparable
 * byte for byte with the server's.
 */
public final class SpikeRunner {
  /** Thread stack for the routing thread; iOS secondary threads default to 512 KB. */
  public static final long STACK_BYTES = 16L * 1024 * 1024;

  private SpikeRunner() {
  }

  /** Routes on the calling thread. Returns GeoJSON, or a line starting with "error: ". */
  public static String route(String segmentDir, String profileDir, String profile, String lonlats, int memoryclass) {
    try {
      System.setProperty("profileBaseDir", profileDir);

      RoutingContext rc = new RoutingContext();
      rc.memoryclass = memoryclass;
      rc.localFunction = profile;

      RoutingParamCollector collector = new RoutingParamCollector();
      List<OsmNodeNamed> waypoints = collector.getWayPointList(lonlats);
      Map<String, String> params = new HashMap<>();
      params.put("lonlats", lonlats);
      params.put("alternativeidx", "0");
      params.put("format", "geojson");
      collector.setParams(rc, waypoints, params);

      RoutingEngine engine = new RoutingEngine(null, null, new File(segmentDir), waypoints, rc, 0);
      engine.quite = true;
      engine.doRun(0);
      if (engine.getErrorMessage() != null) {
        return "error: " + engine.getErrorMessage();
      }
      OsmTrack track = engine.getFoundTrack();
      if (track == null) {
        return "error: no track";
      }
      // ServerHandler.getTrackName: brouter_<profile>_<alternativeidx>
      track.name = "brouter_" + profile + "_0";
      return new FormatJson(rc).format(track);
    } catch (Throwable t) {
      return "error: " + t;
    }
  }

  /** Routes on a fresh thread with a STACK_BYTES stack and waits for it. */
  public static String routeOnBigStack(final String segmentDir, final String profileDir, final String profile,
                                       final String lonlats, final int memoryclass) {
    final String[] result = new String[1];
    Thread thread = new Thread(null, new Runnable() {
      @Override
      public void run() {
        result[0] = route(segmentDir, profileDir, profile, lonlats, memoryclass);
      }
    }, "brouter", STACK_BYTES);
    thread.start();
    try {
      thread.join();
    } catch (InterruptedException e) {
      return "error: interrupted";
    }
    return result[0];
  }
}
