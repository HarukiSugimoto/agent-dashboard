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

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        startCollectorIfNeeded()

        // 通知権限を確保する（server.js が --notify モードで通知を送るのに必要）。
        // 初回起動時のみ許可ダイアログが表示される。
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }

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

    // server.js を起動する。既に動いていれば子プロセスは EADDRINUSE で
    // すぐ終了するだけなので、二重起動チェックは不要。
    // アプリ終了時にも意図的に殺さない（アプリを閉じてもイベント収集は継続させる）。
    func startCollectorIfNeeded() {
        let candidates = ["/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node"]
        guard let node = candidates.first(where: { FileManager.default.fileExists(atPath: $0) }) else { return }

        // .app はプロジェクトルート直下に置かれる想定: <project>/AgentOps.app
        var projectDir = (Bundle.main.bundlePath as NSString).deletingLastPathComponent
        if !FileManager.default.fileExists(atPath: projectDir + "/server.js") {
            projectDir = NSString(string: "~/Desktop/個人開発/agent-dashboard").expandingTildeInPath
        }

        // コレクタと Codex アダプタを起動する。多重起動しても実害は無い
        // （コレクタは EADDRINUSE で即終了、アダプタはポーリングが重複するだけ）。
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

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
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
appMenu.addItem(withTitle: "Reload", action: #selector(WKWebView.reload(_:)), keyEquivalent: "r")
appMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
appMenu.addItem(NSMenuItem.separator())
appMenu.addItem(withTitle: "Quit AGENT OPS", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
appMenuItem.submenu = appMenu
app.mainMenu = mainMenu

app.run()
