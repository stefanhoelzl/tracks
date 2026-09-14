import Darwin
import Foundation
import UIKit

// The spike harness: one UIKit app, linked against one candidate's spike_route. It runs what
// SPIKE_MODE asks for on a background thread, prints one `SPIKE {json}` line per run, writes each
// route's GeoJSON to Documents/out, and exits. Launched with `simctl launch --console-pty`.
//
//   SPIKE_MODE=routes          each route in routes.tsv, twice (cold, then warm)
//   SPIKE_MODE=repeat:<id>:<n> one route n times, with footprint after each run
//   SPIKE_MODE=idle            nothing: the runtime's own footprint
//   SPIKE_ROUTES=<id,id>       limits `routes` to these ids
//   SPIKE_MEMORYCLASS=<n>      RoutingContext.memoryclass (default 128, as brouter.de)

struct Footprint {
  let current: UInt64
  let peak: UInt64

  static func now() -> Footprint {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    guard kr == KERN_SUCCESS else { return Footprint(current: 0, peak: 0) }
    return Footprint(current: info.phys_footprint, peak: UInt64(clamping: info.ledger_phys_footprint_peak))
  }
}

func mb(_ bytes: UInt64) -> Double { (Double(bytes) / 1_048_576 * 10).rounded() / 10 }

/// Samples phys_footprint every few milliseconds on its own thread and keeps the maximum.
final class PeakSampler {
  private let lock = NSLock()
  private var running = true
  private var maxFootprint: UInt64 = 0

  init() {
    let thread = Thread { [self] in
      while true {
        let f = Footprint.now().current
        lock.lock()
        if f > maxFootprint { maxFootprint = f }
        let go = running
        lock.unlock()
        if !go { return }
        usleep(2_000)
      }
    }
    thread.start()
  }

  func stop() -> UInt64 {
    lock.lock()
    running = false
    let m = maxFootprint
    lock.unlock()
    return max(m, Footprint.now().current)
  }
}

func emit(_ object: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  print("SPIKE " + String(data: data, encoding: .utf8)!)
  fflush(stdout)
}

func availableMB() -> Double { mb(UInt64(os_proc_available_memory())) }

struct Paths {
  let resources = Bundle.main.resourcePath!
  var segments: String { resources + "/segments" }
  var profiles: String { resources + "/profiles2" }
  var routes: String { resources + "/routes.tsv" }
  let out: URL = {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let dir = docs.appendingPathComponent("out")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }()
}

func loadRoutes(_ path: String) -> [(id: String, lonlats: String)] {
  let text = try! String(contentsOfFile: path, encoding: .utf8)
  return text.split(separator: "\n").compactMap { line in
    let f = line.split(separator: "\t")
    return f.count == 2 ? (String(f[0]), String(f[1])) : nil
  }
}

/// One timed, sampled route. Writes the GeoJSON when `save` is set.
func runRoute(id: String, lonlats: String, run: Int, memoryclass: Int32, paths: Paths, save: Bool) -> [String: Any] {
  let before = Footprint.now()
  let sampler = PeakSampler()
  let t0 = DispatchTime.now().uptimeNanoseconds
  let raw = spike_route(paths.segments, paths.profiles, "trekking", lonlats, memoryclass)!
  let ms = Double(DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000
  let peak = sampler.stop()
  let result = String(cString: raw)
  spike_free(raw)
  let after = Footprint.now()

  var record: [String: Any] = [
    "route": id, "run": run, "ms": (ms * 10).rounded() / 10,
    "footprintBeforeMB": mb(before.current), "peakDuringMB": mb(peak),
    "footprintAfterMB": mb(after.current), "ledgerPeakMB": mb(after.peak),
    "availableMB": availableMB(),
  ]
  if result.hasPrefix("error: ") {
    record["error"] = result
  } else {
    record["bytes"] = result.utf8.count
    if save {
      try! result.write(to: paths.out.appendingPathComponent(id + ".geojson"), atomically: true, encoding: .utf8)
    }
  }
  return record
}

func runSpike() {
  let env = ProcessInfo.processInfo.environment
  let mode = env["SPIKE_MODE"] ?? "routes"
  let memoryclass = Int32(env["SPIKE_MEMORYCLASS"] ?? "128") ?? 128
  let paths = Paths()

  let launch = Footprint.now()
  let name = String(cString: spike_init())
  emit(["event": "start", "engine": name, "mode": mode, "memoryclass": memoryclass,
        "footprintMB": mb(launch.current), "availableMB": availableMB()])

  let routes = loadRoutes(paths.routes)
  if mode == "routes" {
    let only = env["SPIKE_ROUTES"].map { Set($0.split(separator: ",").map(String.init)) }
    for route in routes where only?.contains(route.id) ?? true {
      for run in 0..<2 {
        var r = runRoute(id: route.id, lonlats: route.lonlats, run: run, memoryclass: memoryclass, paths: paths, save: run == 0)
        r["event"] = "route"
        emit(r)
      }
    }
  } else if mode.hasPrefix("repeat:") {
    let parts = mode.split(separator: ":")
    let id = String(parts[1])
    let n = Int(parts[2])!
    let route = routes.first { $0.id == id }!
    for run in 0..<n {
      var r = runRoute(id: id, lonlats: route.lonlats, run: run, memoryclass: memoryclass, paths: paths, save: false)
      spike_gc()
      usleep(200_000)
      r["footprintSettledMB"] = mb(Footprint.now().current)
      r["event"] = "repeat"
      emit(r)
    }
  }

  emit(["event": "done", "footprintMB": mb(Footprint.now().current), "ledgerPeakMB": mb(Footprint.now().peak)])
  exit(0)
}

final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(_ application: UIApplication,
                   didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    Thread.detachNewThread { runSpike() }
    return true
  }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
