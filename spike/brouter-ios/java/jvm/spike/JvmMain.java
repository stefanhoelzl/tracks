package spike;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;

/**
 * JVM baseline driver: routes every line of routes.tsv, writes <id>.geojson to the output dir
 * and prints one timing line per route. With a repeat count it routes the first route that many
 * times and prints the heap in use after each run.
 *
 * usage: JvmMain <segmentDir> <profileDir> <routes.tsv> <outDir> [repeat]
 */
public final class JvmMain {
  public static void main(String[] args) throws Exception {
    String segmentDir = args[0];
    String profileDir = args[1];
    List<String> lines = Files.readAllLines(new File(args[2]).toPath(), StandardCharsets.UTF_8);
    File outDir = new File(args[3]);
    outDir.mkdirs();
    int repeat = args.length > 4 ? Integer.parseInt(args[4]) : 0;

    for (String line : lines) {
      if (line.isEmpty()) continue;
      String[] f = line.split("\t");
      long t0 = System.nanoTime();
      String out = SpikeRunner.routeOnBigStack(segmentDir, profileDir, "trekking", f[1], 128);
      long ms = (System.nanoTime() - t0) / 1_000_000;
      if (out.startsWith("error: ")) {
        System.out.println(f[0] + " " + ms + " ms " + out);
        continue;
      }
      Files.write(new File(outDir, f[0] + ".geojson").toPath(), out.getBytes(StandardCharsets.UTF_8));
      System.out.println(f[0] + " " + ms + " ms");
    }

    if (repeat > 0) {
      String[] f = lines.get(0).split("\t");
      Runtime rt = Runtime.getRuntime();
      for (int i = 0; i < repeat; i++) {
        long t0 = System.nanoTime();
        SpikeRunner.routeOnBigStack(segmentDir, profileDir, "trekking", f[1], 128);
        long ms = (System.nanoTime() - t0) / 1_000_000;
        System.gc();
        System.out.println("repeat " + i + " " + ms + " ms heapUsedMB=" + (rt.totalMemory() - rt.freeMemory()) / (1024 * 1024));
      }
    }
  }
}
