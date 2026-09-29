import UIKit
import Capacitor
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = AppViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// The web app in a native shell (docs/design/ios-app.md).
class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        #if DEBUG
        openForSimulatorTest()
        #endif
    }

    #if DEBUG
    /// Simulator screenshots on the Mac runner only (debug builds against the local test
    /// server, never in TestFlight builds): `-testCookie name=value` signs in with a fake
    /// user's session and `-testPath /gigs` opens that page.
    private func openForSimulatorTest() {
        let defaults = UserDefaults.standard
        guard let webView = bridge?.webView, let server = bridge?.config.serverURL,
              server.host == "localhost" else { return }
        let path = defaults.string(forKey: "testPath") ?? "/"
        let open: () -> Void = {
            guard let url = URL(string: path, relativeTo: server) else { return }
            _ = webView.load(URLRequest(url: url))
        }
        guard let cookie = defaults.string(forKey: "testCookie"),
              let eq = cookie.firstIndex(of: "=") else {
            open()
            return
        }
        let props: [HTTPCookiePropertyKey: Any] = [
            .name: String(cookie[..<eq]),
            .value: String(cookie[cookie.index(after: eq)...]),
            .domain: "localhost",
            .path: "/",
        ]
        guard let c = HTTPCookie(properties: props) else {
            open()
            return
        }
        webView.configuration.websiteDataStore.httpCookieStore.setCookie(c) { open() }
    }
    #endif
}
