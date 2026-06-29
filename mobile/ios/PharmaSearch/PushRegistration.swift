import Foundation
import UIKit
import UserNotifications

extension Notification.Name {
    static let didRegisterRemotePushToken = Notification.Name("PharmaSearchDidRegisterRemotePushToken")
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        NotificationCenter.default.post(name: .didRegisterRemotePushToken, object: token)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("Remote push registration failed: \(error.localizedDescription)")
    }
}

@MainActor
func requestRemoteNotifications() async {
    do {
        let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
        if granted {
            UIApplication.shared.registerForRemoteNotifications()
        }
    } catch {
        print("Notification authorization failed: \(error.localizedDescription)")
    }
}
