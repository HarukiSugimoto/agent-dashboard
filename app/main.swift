import Cocoa
import WebKit
import UserNotifications

// AGENT OPS — ダッシュボード用の最小 WebView ラッパーアプリ。
// 起動時にコレクタ (server.js) を自動起動し、http://127.0.0.1:4820 を表示する。

// --notify モード: GUI を立てずに通知センターへ通知を出して即終了する。
// server.js がセッションの「待ち」遷移時に
//   AgentOps.app/Contents/MacOS/AgentOps --notify <title> <subtitle> <body>
// として直接起動する。アプリバンドルの名義で送るため、通知には AppIcon が表示される
// （osascript だと送り主がスクリプトエディタになりアイコンを変えられない）。
if CommandLine.arguments.count >= 3, CommandLine.arguments[1] == "--notify" {
    let args = CommandLine.arguments
    // 要コード署名: ad-hoc 署名では許可ダイアログが出ずに拒否される
    // （build.sh が「AgentOps Signing」証明書で署名する）。
    let center = UNUserNotificationCenter.current()
    center.requestAuthorization(options: [.alert, .sound]) { granted, err in
        if !granted {
            // Apple発行でない証明書だと UserNotifications は拒否される。
            // その場合は旧 API (NSUserNotification, deprecated) で送る。
            FileHandle.standardError.write(Data("notify: UserNotifications 拒否、旧APIで送信 \(err.map { String(describing: $0) } ?? "")\n".utf8))
            let n = NSUserNotification()
            n.title = args[2]
            if args.count > 3, !args[3].isEmpty { n.subtitle = args[3] }
            if args.count > 4, !args[4].isEmpty { n.informativeText = args[4] }
            n.soundName = "Glass"
            NSUserNotificationCenter.default.deliver(n)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { exit(0) }
            return
        }
        let content = UNMutableNotificationContent()
        content.title = args[2]
        if args.count > 3, !args[3].isEmpty { content.subtitle = args[3] }
        if args.count > 4, !args[4].isEmpty { content.body = args[4] }
        content.sound = UNNotificationSound(named: UNNotificationSoundName("Glass"))
        let req = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        center.add(req) { _ in
            // 配送完了前にプロセスが死なないよう一拍置いて終了
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { exit(0) }
        }
    }
    // 初回は許可ダイアログへの応答を待つ可能性があるため長めに待つ
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 30))
    exit(0)
}

let DASHBOARD_URL = URL(string: "http://127.0.0.1:4820/")!
let PET_URL = URL(string: "http://127.0.0.1:4820/pet")!

// ============================================================================
// PET — デスクトップ常駐のロボット。枠なし・背景透明・常に最前面の小さなウィンドウ。
// 中身は /pet（ロボット1体＋セッションごとの吹き出し）。
//
// 透明な部分でクリックが止まるとデスクトップが使えなくなるので、
// WebView から「吹き出しとロボットの矩形」を受け取り、カーソルがそこに無い間は
// ignoresMouseEvents = true にして背後のアプリへクリックを通す。
// ============================================================================

final class PetWindow: NSWindow {
    override var canBecomeKey: Bool { true }   // 枠なしウィンドウは既定でキーになれない
}

// ペットの挙動を追うためのログ。~/Library/Logs/AgentOps-pet.log に追記する
// （GUI アプリなので stderr はどこにも出ない）。
let petLogFmt: DateFormatter = {
    let f = DateFormatter(); f.dateFormat = "HH:mm:ss.SSS"; return f
}()
func petLog(_ msg: String) {
    let line = "\(petLogFmt.string(from: Date())) \(msg)\n"
    let path = NSString(string: "~/Library/Logs/AgentOps-pet.log").expandingTildeInPath
    let url = URL(fileURLWithPath: path)
    // 放っておいても膨らまないよう、大きくなったら作り直す
    if let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? Int) ?? nil, size > 200_000 {
        try? FileManager.default.removeItem(at: url)
    }
    if let h = try? FileHandle(forWritingTo: url) {
        h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close()
    } else {
        try? line.write(to: url, atomically: true, encoding: .utf8)
    }
}

final class PetWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }  // 非アクティブでも1クリック目から反応
}

final class PetController: NSObject, WKScriptMessageHandler {
    // 大きさは高さ1つで決める（横幅は縦横比から算出）。ページ側も rem / vh で追従する。
    static let aspect: CGFloat = 0.6
    static let presets: [(name: String, height: CGFloat)] =
        [("小", 440), ("中", 600), ("大", 760), ("特大", 920)]
    static let minHeight: CGFloat = 320, maxHeight: CGFloat = 1200
    // 別画面へカーソルが移ってから追いかけ始めるまでの待ち。0 にすると境界を跨いだ瞬間に動く。
    static let followDelay: TimeInterval = UserDefaults.standard.object(forKey: "PetFollowDelay") as? Double ?? 0.1

    private var height: CGFloat = 600
    private var size: NSSize { NSSize(width: (height * PetController.aspect).rounded(), height: height) }

    private var window: PetWindow!
    private var web: PetWebView!
    private var rawRects: [NSRect] = []        // ページ座標(左上原点/CSS px)。当たり判定のたびに窓座標へ直す
    private var hitTimer: Timer?
    private var dragMonitors: [Any] = []
    private var dragWindowOrigin = NSPoint.zero
    private var dragMouseOrigin = NSPoint.zero
    private var dragHeight: CGFloat = 0        // ⌥ドラッグ（リサイズ）開始時の高さ。0 = 移動モード
    private var lastCursor = NSPoint(x: -2, y: -2)
    // 既定 OFF。勝手に動くのが煩わしいので、欲しい人だけメニューで有効にする。
    private var followScreen = UserDefaults.standard.object(forKey: "AgentOpsPetFollowScreen") as? Bool ?? false
    private var pendingScreen: NSScreen?        // 追従の候補（すぐには動かさず少し待つ）
    private var pendingSince = Date.distantFuture

    var isFollowingScreen: Bool { followScreen }
    func toggleFollowScreen() {
        followScreen.toggle()
        UserDefaults.standard.set(followScreen, forKey: "AgentOpsPetFollowScreen")
        pendingScreen = nil
    }

    var isVisible: Bool { window?.isVisible ?? false }
    var currentHeight: CGFloat { height }

    override init() {
        super.init()
        let saved = UserDefaults.standard.double(forKey: "AgentOpsPetHeight")
        if saved > 0 { height = min(max(CGFloat(saved), PetController.minHeight), PetController.maxHeight) }
    }

    private func build() {
        let frame = NSRect(origin: .zero, size: size)
        window = PetWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false                       // 影は Web 側（吹き出し/足元）で描く
        window.isReleasedWhenClosed = false
        applyWindowBehavior()

        // Space を切り替えたときに取り残されることがあるので、都度出し直す
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(activeSpaceChanged),
            name: NSWorkspace.activeSpaceDidChangeNotification, object: nil)

        let conf = WKWebViewConfiguration()
        conf.userContentController.add(self, name: "petRects")
        conf.userContentController.add(self, name: "petDrag")
        web = PetWebView(frame: frame, configuration: conf)
        web.autoresizingMask = [.width, .height]
        web.setValue(false, forKey: "drawsBackground")  // WebView の白背景を消して透過させる
        if #available(macOS 12.0, *) { web.underPageBackgroundColor = .clear }
        window.contentView = web

        window.setFrameOrigin(savedOrigin() ?? defaultOrigin())
    }

    // 「常に最前面」「全 Space に表示」の指定。ウィンドウレベルやフレームを触ると
    // 取り消されることがあるので、状態を変えるたびに呼び直す。
    // .stationary は Mission Control で動かさないため、.fullScreenAuxiliary は
    // 他アプリのフルスクリーン上にも重ねるため。
    private func applyWindowBehavior() {
        guard let window = window else { return }
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    }

    // ---- カーソルのある画面へ追従 ----
    // ウィンドウは1枚のディスプレイにしか存在できないので、全 Space 指定だけでは
    // 別モニタで作業しているときに見えない。カーソルが別画面へ移って少し留まったら移す。
    private func followCursorScreen() {
        guard followScreen, dragMonitors.isEmpty, let window = window, window.isVisible else { return }
        let m = NSEvent.mouseLocation
        guard let target = NSScreen.screens.first(where: { $0.frame.contains(m) }) else { return }
        // NSScreen はインスタンスが作り直されることがあるので frame で比べる
        let here = NSScreen.screens.first { $0.frame.contains(NSPoint(x: window.frame.midX, y: window.frame.midY)) } ?? window.screen
        if target.frame == here?.frame { pendingScreen = nil; return }
        if pendingScreen?.frame != target.frame { pendingScreen = target; pendingSince = Date(); return }
        // 通り過ぎただけで動かないよう少しだけ待つ。defaults の PetFollowDelay で調整可
        guard Date().timeIntervalSince(pendingSince) >= PetController.followDelay else { return }
        pendingScreen = nil
        move(from: here?.visibleFrame, to: target)
    }

    // 画面の右下からの距離を保ったまま移す（置いた位置関係を維持する）
    private func move(from: NSRect?, to screen: NSScreen) {
        guard let window = window else { return }
        let f = window.frame
        let from = from ?? screen.visibleFrame
        let vf = screen.visibleFrame
        let x = min(max((vf.maxX - (from.maxX - f.maxX) - f.width).rounded(), vf.minX), vf.maxX - f.width)
        let y = min(max((vf.minY + (f.minY - from.minY)).rounded(), vf.minY), vf.maxY - f.height)
        window.setFrameOrigin(NSPoint(x: x, y: y))
        applyWindowBehavior()
        saveOrigin()
        petLog("画面追従: \(screen.localizedName) へ → \(NSStringFromRect(window.frame))")
    }

    @objc private func activeSpaceChanged() {
        guard let window = window, window.isVisible else { return }
        applyWindowBehavior()
        if !window.isOnActiveSpace { window.orderFrontRegardless() }
        petLog("space変更: onActiveSpace=\(window.isOnActiveSpace) visible=\(window.isVisible) "
             + "behavior=\(window.collectionBehavior.rawValue) level=\(window.level.rawValue) "
             + "frame=\(NSStringFromRect(window.frame))")
    }

    // 既定位置はメイン画面の右下（Dock やメニューバーを避けて少し内側）
    private func defaultOrigin() -> NSPoint {
        guard let vf = NSScreen.main?.visibleFrame else { return NSPoint(x: 100, y: 100) }
        return NSPoint(x: vf.maxX - size.width - 24, y: vf.minY + 24)
    }
    private func savedOrigin() -> NSPoint? {
        guard let s = UserDefaults.standard.string(forKey: "AgentOpsPetOrigin") else { return nil }
        let p = NSPointFromString(s)
        // 画面構成が変わって画面外に消えていたら既定位置に戻す
        let visible = NSScreen.screens.contains { $0.visibleFrame.intersects(NSRect(origin: p, size: size)) }
        return visible ? p : nil
    }
    private func saveOrigin() {
        UserDefaults.standard.set(NSStringFromPoint(window.frame.origin), forKey: "AgentOpsPetOrigin")
    }

    func show() {
        if window == nil { build() }
        if web.url == nil { web.load(URLRequest(url: PET_URL)) }
        applyWindowBehavior()
        window.orderFrontRegardless()
        petLog("show: behavior=\(window.collectionBehavior.rawValue) level=\(window.level.rawValue) "
             + "onActiveSpace=\(window.isOnActiveSpace) policy=\(NSApp.activationPolicy().rawValue)")
        startHitTesting()
    }

    func hide() {
        window?.orderOut(nil)
        hitTimer?.invalidate()
        hitTimer = nil
    }

    func toggle() { isVisible ? hide() : show() }

    func resetPosition() {
        guard window != nil else { return }
        window.setFrameOrigin(defaultOrigin())
        saveOrigin()
    }

    // ---- 大きさ ----
    // 足元（下辺）と左右の中心を固定したまま拡縮する。ロボットの立ち位置が動かないように。
    func setHeight(_ h: CGFloat, save: Bool = true) {
        height = min(max(h, PetController.minHeight), PetController.maxHeight)
        if save { UserDefaults.standard.set(Double(height), forKey: "AgentOpsPetHeight") }
        guard let window = window else { return }
        let old = window.frame
        let s = size
        window.setFrame(NSRect(x: (old.midX - s.width / 2).rounded(), y: old.minY,
                               width: s.width, height: s.height), display: true)
        applyWindowBehavior()
        if save { saveOrigin() }
    }

    // ---- クリック透過の判定 ----
    // カーソル位置を短い周期で見て、当たり判定の矩形内かどうかで切り替える。
    // （マウスイベント監視だけだと、透過中はイベントが自分に届かず戻れなくなる）
    private func startHitTesting() {
        hitTimer?.invalidate()
        hitTimer = Timer.scheduledTimer(withTimeInterval: 0.03, repeats: true) { [weak self] _ in
            self?.updateClickThrough()
            self?.followCursorScreen()
        }
        RunLoop.main.add(hitTimer!, forMode: .common)
    }

    private func updateClickThrough() {
        guard let window = window, window.isVisible, dragMonitors.isEmpty else { return }
        let m = NSEvent.mouseLocation
        let f = window.frame
        // 画面座標 → ページ座標(左上原点)。ウィンドウの高さは変わりうるのでここで変換する
        let p = NSPoint(x: m.x - f.minX, y: f.height - (m.y - f.minY))
        let hot = rawRects.contains { $0.contains(p) }
        if window.ignoresMouseEvents == hot { window.ignoresMouseEvents = !hot }
        pushCursor(p, inside: f.contains(m))
    }

    // クリック透過中のページには本物の mouseover が届かない。
    // ホバー表示（吹き出しの ✕）のためにカーソル位置だけ流し込む。
    private func pushCursor(_ p: NSPoint, inside: Bool) {
        let c = inside ? NSPoint(x: p.x.rounded(), y: p.y.rounded()) : NSPoint(x: -1, y: -1)
        guard c != lastCursor else { return }
        lastCursor = c
        web?.evaluateJavaScript("window.__petCursor&&__petCursor(\(c.x),\(c.y))", completionHandler: nil)
    }

    // ---- WebView からのメッセージ ----
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "petRects":
            // JS は CSS px・左上原点で送ってくる。そのまま持ち、判定時に窓座標へ直す。
            guard let arr = message.body as? [[String: Any]] else { return }
            rawRects = arr.compactMap { d in
                guard let x = d["x"] as? CGFloat, let y = d["y"] as? CGFloat,
                      let w = d["w"] as? CGFloat, let hh = d["h"] as? CGFloat else { return nil }
                return NSRect(x: x, y: y, width: w, height: hh)
            }
            updateClickThrough()
        case "petDrag":
            beginDrag()
        default: break
        }
    }

    // ---- ロボットをつかんでウィンドウを動かす（⌥ を押しながらなら拡大縮小） ----
    private func beginDrag() {
        guard dragMonitors.isEmpty, let window = window else { return }
        dragWindowOrigin = window.frame.origin
        dragMouseOrigin = NSEvent.mouseLocation
        dragHeight = NSEvent.modifierFlags.contains(.option) ? height : 0
        let mask: NSEvent.EventTypeMask = [.leftMouseDragged, .leftMouseUp]
        let handle: (NSEvent) -> Void = { [weak self] ev in
            guard let self = self, let window = self.window else { return }
            if ev.type == .leftMouseUp { self.endDrag(); return }
            let m = NSEvent.mouseLocation
            if self.dragHeight > 0 {
                // 上へドラッグで大きく。下辺を固定したまま拡縮する
                self.setHeight(self.dragHeight + (m.y - self.dragMouseOrigin.y) * 2, save: false)
            } else {
                window.setFrameOrigin(NSPoint(x: self.dragWindowOrigin.x + (m.x - self.dragMouseOrigin.x),
                                              y: self.dragWindowOrigin.y + (m.y - self.dragMouseOrigin.y)))
            }
        }
        if let g = NSEvent.addGlobalMonitorForEvents(matching: mask, handler: handle) { dragMonitors.append(g) }
        if let l = NSEvent.addLocalMonitorForEvents(matching: mask, handler: { ev in handle(ev); return ev }) { dragMonitors.append(l) }
    }

    private func endDrag() {
        dragMonitors.forEach { NSEvent.removeMonitor($0) }
        dragMonitors.removeAll()
        if dragHeight > 0 { UserDefaults.standard.set(Double(height), forKey: "AgentOpsPetHeight") }
        dragHeight = 0
        saveOrigin()
    }
}

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, NSMenuDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    let pet = PetController()
    var statusItem: NSStatusItem?
    var sizeMenu: NSMenu!
    var followItem: NSMenuItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        startCollectorIfNeeded()

        // 通知権限を確保する（server.js が --notify モードで通知を送るのに必要）。
        // 初回起動時のみ許可ダイアログが表示される。
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }

        // --pet: ダッシュボード本体は開かず、デスクトップのロボットだけを常駐させる。
        // Dock アイコンは出さず、メニューバーのアイコンから操作する。
        if CommandLine.arguments.contains("--pet") {
            NSApp.setActivationPolicy(.accessory)
            installStatusItem()
            pet.show()
            return
        }

        let rect = NSRect(x: 0, y: 0, width: 1200, height: 780)
        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false
        )
        window.title = "AGENT OPS"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(red: 0.027, green: 0.035, blue: 0.043, alpha: 1)
        window.minSize = NSSize(width: 260, height: 180)
        window.center()
        window.setFrameAutosaveName("AgentOpsMain")

        webView = WKWebView(frame: rect, configuration: WKWebViewConfiguration())
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        window.contentView = webView

        load()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func load() {
        webView.load(URLRequest(url: DASHBOARD_URL))
    }

    // コレクタ起動完了前に読み込みが失敗したら1秒後にリトライ
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.load() }
    }

    // コレクタが既に応答するなら何もしない。ダッシュボードとペットを同時に立ち上げても
    // Codex アダプタが二重にポーリングしないようにするための確認。
    func startCollectorIfNeeded() {
        var req = URLRequest(url: DASHBOARD_URL)
        req.httpMethod = "HEAD"
        req.timeoutInterval = 0.8
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            guard (resp as? HTTPURLResponse) == nil else { return }   // 応答あり = 起動済み
            DispatchQueue.main.async { self.launchCollector() }
        }.resume()
    }

    // server.js と Codex アダプタを起動する。
    // アプリ終了時にも意図的に殺さない（アプリを閉じてもイベント収集は継続させる）。
    func launchCollector() {
        let candidates = ["/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node"]
        guard let node = candidates.first(where: { FileManager.default.fileExists(atPath: $0) }) else { return }

        // .app はプロジェクトルート直下に置かれる想定: <project>/AgentOps.app
        var projectDir = (Bundle.main.bundlePath as NSString).deletingLastPathComponent
        if !FileManager.default.fileExists(atPath: projectDir + "/server.js") {
            projectDir = NSString(string: "~/Desktop/個人開発/agent-dashboard").expandingTildeInPath
        }

        for script in ["/server.js", "/adapters/codex-adapter.js"] {
            let full = projectDir + script
            guard FileManager.default.fileExists(atPath: full) else { continue }
            let p = Process()
            p.executableURL = URL(fileURLWithPath: node)
            p.arguments = [full]
            p.standardOutput = FileHandle.nullDevice
            p.standardError = FileHandle.nullDevice
            try? p.run()
        }
    }

    // デスクトップのロボットが出ている間は、ダッシュボードを閉じても終了しない
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { !pet.isVisible }

    // ---- メニューバーのアイコン（--pet モード / ロボット表示中） ----
    func installStatusItem() {
        guard statusItem == nil else { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        applyMenuIcon(to: item)
        let menu = NSMenu()
        menu.delegate = self
        menu.addItem(withTitle: "ロボットの表示/非表示", action: #selector(togglePet), keyEquivalent: "").target = self

        // 大きさ（プリセット）。無段階に変えたいときは ⌥ を押しながらロボットをドラッグ
        let sizeItem = NSMenuItem(title: "大きさ", action: nil, keyEquivalent: "")
        sizeMenu = NSMenu()
        for (i, p) in PetController.presets.enumerated() {
            let mi = NSMenuItem(title: "\(p.name)（\(Int(p.height * PetController.aspect))×\(Int(p.height))）",
                                action: #selector(setPetSize(_:)), keyEquivalent: "")
            mi.tag = i
            mi.target = self
            sizeMenu.addItem(mi)
        }
        sizeMenu.addItem(NSMenuItem.separator())
        let hint = NSMenuItem(title: "⌥ + ロボットをドラッグで無段階", action: nil, keyEquivalent: "")
        hint.isEnabled = false
        sizeMenu.addItem(hint)
        sizeItem.submenu = sizeMenu
        menu.addItem(sizeItem)

        followItem = NSMenuItem(title: "カーソルのある画面に追従", action: #selector(toggleFollowScreen), keyEquivalent: "")
        followItem.target = self
        menu.addItem(followItem)
        menu.addItem(withTitle: "位置をリセット", action: #selector(resetPetPosition), keyEquivalent: "").target = self
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "ダッシュボードを開く", action: #selector(openDashboardInBrowser), keyEquivalent: "").target = self
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "終了", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
        statusItem = item
    }

    // メニューバーのアイコン。既定はバンドル同梱の menu-icon.png（app/menu-icon.png を
    // build.sh が Resources へコピーする）。差し替えたいときは下記で上書きできる（要再起動）。
    //   defaults write dev.harusugi.agent-ops MenuIconFile ~/foo.png   画像ファイル
    //   defaults write dev.harusugi.agent-ops MenuIconSymbol cpu       SF Symbols 名
    //   defaults write dev.harusugi.agent-ops MenuIcon 🐧              絵文字・短い文字列
    func applyMenuIcon(to item: NSStatusItem) {
        guard let button = item.button else { return }
        let d = UserDefaults.standard
        let mono = d.object(forKey: "MenuIconTemplate") as? Bool ?? true  // メニューバーに馴染む単色化

        if let path = d.string(forKey: "MenuIconFile"),
           let img = NSImage(contentsOfFile: (path as NSString).expandingTildeInPath) {
            img.size = NSSize(width: 18, height: 18)
            img.isTemplate = mono
            button.image = img
            return
        }
        if let name = d.string(forKey: "MenuIconSymbol"),
           let img = NSImage(systemSymbolName: name, accessibilityDescription: "AGENT OPS") {
            img.isTemplate = mono
            button.image = img
            return
        }
        if let text = d.string(forKey: "MenuIcon") { button.title = text; return }
        // 既定: 同梱アイコン。無ければ絵文字にフォールバック
        if let res = Bundle.main.resourcePath,
           let img = NSImage(contentsOfFile: res + "/menu-icon.png") {
            img.size = NSSize(width: 18, height: 18)
            img.isTemplate = true
            button.image = img
            return
        }
        button.title = "🤖"
    }

    // 現在の大きさにチェックを入れる（無段階でずらしている場合はどれも付かない）
    func menuWillOpen(_ menu: NSMenu) {
        for mi in sizeMenu?.items ?? [] where mi.tag < PetController.presets.count && mi.action != nil {
            mi.state = PetController.presets[mi.tag].height == pet.currentHeight ? .on : .off
        }
        followItem?.state = pet.isFollowingScreen ? .on : .off
    }

    @objc func toggleFollowScreen() { pet.toggleFollowScreen() }

    @objc func setPetSize(_ sender: NSMenuItem) {
        pet.setHeight(PetController.presets[sender.tag].height)
    }

    @objc func togglePet() {
        pet.toggle()
        if pet.isVisible { installStatusItem() }   // 本体ウィンドウから出した場合もメニューバーから操作できるように
    }
    @objc func resetPetPosition() { pet.resetPosition() }
    @objc func openDashboardInBrowser() { NSWorkspace.shared.open(DASHBOARD_URL) }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)

// メニューバー（⌘Q / ⌘W / ⌘R を効かせる最小構成）
let mainMenu = NSMenu()
let appMenuItem = NSMenuItem()
mainMenu.addItem(appMenuItem)
let appMenu = NSMenu()
// デスクトップにロボットだけを常駐させる（本体ウィンドウは閉じてよい）
let petItem = NSMenuItem(title: "デスクトップにロボットを置く", action: #selector(AppDelegate.togglePet), keyEquivalent: "d")
petItem.target = delegate
appMenu.addItem(petItem)
appMenu.addItem(NSMenuItem.separator())
appMenu.addItem(withTitle: "Reload", action: #selector(WKWebView.reload(_:)), keyEquivalent: "r")
appMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
appMenu.addItem(NSMenuItem.separator())
appMenu.addItem(withTitle: "Quit AGENT OPS", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
appMenuItem.submenu = appMenu
app.mainMenu = mainMenu

app.run()
