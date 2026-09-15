import Darwin
import Foundation
import Shared
import UIKit

// M10's iOS shell: it hosts the converted BRouter and measures it on a real phone. There are no screens. (It is
// main.swift because that is the one file Swift runs top-level code from.) Launched plainly it shows one line
// and does nothing, so opening it by hand never starts a long route.
//
// Launched with TRACKS_MEASURE (by `pymobiledevice3 developer dvt launch --env`), it routes the parity
// routes from the bundled routes.tsv over the tiles in Documents/segments and writes one JSON line per run to
// Documents/out/measure.jsonl, plus each route's GeoJSON for the parity check:
//
//   TRACKS_MEASURE=routes             each route cold then warm, one launch (TRACKS_ROUTES=id,id narrows it)
//   TRACKS_MEASURE=repeat:<id>:<n>    one route n times back to back, collecting garbage between runs

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

/// phys_footprint sampled every 2 ms on its own thread; the maximum is the route's peak.
final class PeakSampler {
  private let lock = NSLock()
  private var running = true
  private var maxFootprint: UInt64 = 0

  init() {
    Thread { [self] in
      while true {
        let f = Footprint.now().current
        lock.lock()
        if f > maxFootprint { maxFootprint = f }
        let go = running
        lock.unlock()
        if !go { return }
        usleep(2_000)
      }
    }.start()
  }

  func stop() -> UInt64 {
    lock.lock()
    running = false
    let m = maxFootprint
    lock.unlock()
    return max(m, Footprint.now().current)
  }
}

struct Paths {
  let bundle = Bundle.main.resourcePath!
  var profiles: String { bundle + "/profiles" }
  var routes: String { bundle + "/routes.tsv" }
  let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
  var segments: String { documents.appendingPathComponent("segments").path }
  var out: URL {
    let dir = documents.appendingPathComponent("out")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }
}

func thermal() -> String {
  switch ProcessInfo.processInfo.thermalState {
  case .nominal: return "nominal"
  case .fair: return "fair"
  case .serious: return "serious"
  case .critical: return "critical"
  @unknown default: return "unknown"
  }
}

func machine() -> String {
  var s = utsname()
  uname(&s)
  return withUnsafeBytes(of: &s.machine) { String(decoding: $0.prefix(while: { $0 != 0 }), as: UTF8.self) }
}

func emit(_ object: [String: Any], paths: Paths) {
  var object = object
  object["thermal"] = thermal()
  object["t"] = Date().timeIntervalSince1970
  let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  let line = String(data: data, encoding: .utf8)! + "\n"
  print(line, terminator: "")
  let url = paths.out.appendingPathComponent("measure.jsonl")
  if let handle = try? FileHandle(forWritingTo: url) {
    handle.seekToEndOfFile()
    handle.write(line.data(using: .utf8)!)
    try? handle.close()
  } else {
    try? line.write(to: url, atomically: true, encoding: .utf8)
  }
}

struct Route {
  let id: String
  let profile: String
  let lonlats: String
}

func loadRoutes(_ path: String) -> [Route] {
  let text = try! String(contentsOfFile: path, encoding: .utf8)
  return text.split(separator: "\n").compactMap { line in
    let f = line.split(separator: "\t", omittingEmptySubsequences: false)
    return f.count == 3 ? Route(id: String(f[0]), profile: String(f[1]), lonlats: String(f[2])) : nil
  }
}

func run(_ route: Route, index: Int, paths: Paths, save: Bool) -> [String: Any] {
  let before = Footprint.now()
  let sampler = PeakSampler()
  let t0 = DispatchTime.now().uptimeNanoseconds
  var record: [String: Any] = ["route": route.id, "run": index]
  do {
    let geojson = try OnDeviceRouter.shared.route(
      segmentDir: paths.segments, profileDir: paths.profiles, profile: route.profile, lonlats: route.lonlats)
    record["bytes"] = geojson.utf8.count
    if save {
      try? geojson.write(to: paths.out.appendingPathComponent(route.id + ".geojson"), atomically: true, encoding: .utf8)
    }
  } catch {
    record["error"] = "\(error)"
  }
  let ms = Double(DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000
  let peak = sampler.stop()
  record["ms"] = (ms * 10).rounded() / 10
  record["footprintBeforeMB"] = mb(before.current)
  record["peakDuringMB"] = mb(peak)
  record["footprintAfterMB"] = mb(Footprint.now().current)
  record["availableMB"] = mb(UInt64(os_proc_available_memory()))
  return record
}

func measure(mode: String, paths: Paths) {
  let env = ProcessInfo.processInfo.environment
  emit([
    "event": "start", "mode": mode, "engine": OnDeviceRouter.shared.engineVersion, "machine": machine(),
    "os": ProcessInfo.processInfo.operatingSystemVersionString,
    "physicalMemoryMB": mb(ProcessInfo.processInfo.physicalMemory),
    "footprintMB": mb(Footprint.now().current), "availableMB": mb(UInt64(os_proc_available_memory())),
  ], paths: paths)

  let routes = loadRoutes(paths.routes)
  if mode == "routes" {
    let only = env["TRACKS_ROUTES"].map { Set($0.split(separator: ",").map(String.init)) }
    for route in routes where only?.contains(route.id) ?? true {
      for index in 0..<2 {
        var r = run(route, index: index, paths: paths, save: index == 0)
        r["event"] = "route"
        emit(r, paths: paths)
      }
    }
  } else if mode.hasPrefix("repeat:") {
    let parts = mode.split(separator: ":")
    let route = routes.first { $0.id == String(parts[1]) }!
    for index in 0..<Int(parts[2])! {
      var r = run(route, index: index, paths: paths, save: false)
      NativeMemory.shared.collect()
      usleep(200_000)
      r["footprintSettledMB"] = mb(Footprint.now().current)
      r["event"] = "repeat"
      emit(r, paths: paths)
    }
  }

  let end = Footprint.now()
  emit(["event": "done", "footprintMB": mb(end.current), "ledgerPeakMB": mb(end.peak)], paths: paths)
  exit(0)
}

final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(
    _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let label = UILabel()
    label.text = "Tracks — BRouter \(OnDeviceRouter.shared.engineVersion)"
    label.textAlignment = .center
    let controller = UIViewController()
    controller.view = label
    controller.view.backgroundColor = .systemBackground
    window = UIWindow(frame: UIScreen.main.bounds)
    window?.rootViewController = controller
    window?.makeKeyAndVisible()

    // Where tiles are pushed to (measure.sh), and where downloaded ones will land (M13). AFC cannot create it.
    try? FileManager.default.createDirectory(atPath: Paths().segments, withIntermediateDirectories: true)

    if let mode = ProcessInfo.processInfo.environment["TRACKS_MEASURE"] {
      label.text = "measuring: \(mode)"
      // A measurement is minutes of back-to-back routing; auto-lock would suspend it.
      application.isIdleTimerDisabled = true
      // Routing never belongs on the main thread. The engine no longer recurses deeply (pass 06), so this is
      // not the 16 MB the spike needed; 2 MB leaves margin over iOS's 512 KB default for secondary threads.
      let thread = Thread { measure(mode: mode, paths: Paths()) }
      thread.stackSize = 2 * 1024 * 1024
      thread.start()
    }
    return true
  }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
