import AppIntents
import Foundation

// App Intents (docs/design/home-first.md §7 step 8): Siri, the Shortcuts app and the Action
// button run the intents below. Each opens the app on the screen that does the work (the chat,
// the Inbox capture), so sign-in, checks and confirm cards stay where they already are. The
// path is handed over through the app's own defaults (`pendingPath`); the home reads it once
// it is up (apps/mobile/src/intents.ts). Added to the Xcode project by plugins/with-app-intents.js.

private func query(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+?#"))) ?? ""
}

private func open(_ path: String) {
    UserDefaults.standard.set(path, forKey: "pendingPath")
}

/// "Ask Gigspree…": a question, or something to save ("I paid Rahul ₹5,000 for Sunburn").
/// It opens the chat with the message filled in; the person taps Send (a phrase alone never
/// makes the assistant act), and money and deletes still wait for a tap on their card.
struct AskGigspreeIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask Gigspree"
    static var description = IntentDescription(
        "Ask the Gigspree assistant something, or tell it something to save.")
    static var openAppWhenRun = true

    @Parameter(title: "Message", requestValueDialog: "What should I tell Gigspree?")
    var message: String

    @MainActor
    func perform() async throws -> some IntentResult {
        open("/chat?ask=\(query(message))")
        return .result()
    }
}

/// "Add to Gigspree": text from Siri, the clipboard or another app's share sheet (through a
/// shortcut), captured into the Inbox; the assistant says where it goes.
struct AddToGigspreeIntent: AppIntent {
    static var title: LocalizedStringResource = "Add to Gigspree"
    static var description = IntentDescription(
        "Hand some text to Gigspree (a WhatsApp message, a note, a receipt) and let the assistant file it.")
    static var openAppWhenRun = true

    @Parameter(title: "Text", requestValueDialog: "What should I add?")
    var text: String

    @MainActor
    func perform() async throws -> some IntentResult {
        open("/capture?text=\(query(text))")
        return .result()
    }
}

/// "Show [list]": opens the chat on one of the person's lists or cards, by name.
struct ShowGigspreeViewIntent: AppIntent {
    static var title: LocalizedStringResource = "Show a Gigspree list"
    static var description = IntentDescription("Open one of your lists or cards by name.")
    static var openAppWhenRun = true

    @Parameter(title: "List name", requestValueDialog: "Which list?")
    var name: String

    @MainActor
    func perform() async throws -> some IntentResult {
        open("/chat?ask=\(query("Show me " + name))")
        return .result()
    }
}

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
            phrases: ["Show my \(.applicationName) list", "Open a \(.applicationName) list"],
            shortTitle: "Show a list",
            systemImageName: "list.bullet.rectangle")
    }
}
