import AppIntents
import Foundation

/// Opens a path of the web app inside the app (docs/design/ios-app.md, stage 3). Siri, the
/// Shortcuts app and the Action button run the intents below; each opens the app on the page
/// that does the work, so sign-in, checks and confirm cards stay where they already are.
final class AppRoute {
    static let shared = AppRoute()
    static let openPath = Notification.Name("GigspreeOpenPath")

    /// A path asked for before the web view was ready; opened once it is.
    private(set) var pending: String?

    func open(_ path: String) {
        pending = path
        NotificationCenter.default.post(name: AppRoute.openPath, object: nil)
    }

    /// The pending path, once (the web view calls this when it can navigate).
    func take() -> String? {
        defer { pending = nil }
        return pending
    }
}

private func query(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+?#"))) ?? ""
}

/// "Ask Gigspree…": a question, or something to save ("I paid Rahul ₹5,000 for Sunburn").
/// The assistant works out what it is; money and deletes still wait for a tap on their card.
@available(iOS 16.0, *)
struct AskGigspreeIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask Gigspree"
    static var description = IntentDescription(
        "Ask the Gigspree assistant something, or tell it something to save.")
    static var openAppWhenRun = true

    @Parameter(title: "Message", requestValueDialog: "What should I tell Gigspree?")
    var message: String

    @MainActor
    func perform() async throws -> some IntentResult {
        AppRoute.shared.open("/?ask=\(query(message))&send=1")
        return .result()
    }
}

/// "Add to Gigspree": text from Siri, the clipboard or another app's share sheet (through a
/// shortcut), handed to the assistant to file in the right place.
@available(iOS 16.0, *)
struct AddToGigspreeIntent: AppIntent {
    static var title: LocalizedStringResource = "Add to Gigspree"
    static var description = IntentDescription(
        "Hand some text to Gigspree (a WhatsApp message, a note) and let the assistant file it.")
    static var openAppWhenRun = true

    @Parameter(title: "Text", requestValueDialog: "What should I add?")
    var text: String

    @MainActor
    func perform() async throws -> some IntentResult {
        AppRoute.shared.open("/?ask=\(query(text))&send=1")
        return .result()
    }
}

/// "Show [view]": opens a saved view by its name.
@available(iOS 16.0, *)
struct ShowGigspreeViewIntent: AppIntent {
    static var title: LocalizedStringResource = "Show a Gigspree view"
    static var description = IntentDescription("Open one of your saved views by name.")
    static var openAppWhenRun = true

    @Parameter(title: "View name", requestValueDialog: "Which view?")
    var name: String

    @MainActor
    func perform() async throws -> some IntentResult {
        AppRoute.shared.open("/open-view?name=\(query(name))")
        return .result()
    }
}

@available(iOS 16.0, *)
struct GigspreeShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AskGigspreeIntent(),
            phrases: ["Ask \(.applicationName)", "Tell \(.applicationName)"],
            shortTitle: "Ask Gigspree",
            systemImageName: "bubble.left.and.text.bubble.right")
        AppShortcut(
            intent: AddToGigspreeIntent(),
            phrases: ["Add to \(.applicationName)", "Save in \(.applicationName)"],
            shortTitle: "Add to Gigspree",
            systemImageName: "square.and.arrow.down")
        AppShortcut(
            intent: ShowGigspreeViewIntent(),
            phrases: ["Show my \(.applicationName) view", "Open a \(.applicationName) view"],
            shortTitle: "Show a view",
            systemImageName: "list.bullet.rectangle")
    }
}
