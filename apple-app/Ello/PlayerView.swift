import SwiftUI
import AVKit

/// Full-screen player: Apple's own (AirPlay, picture-in-picture, subtitles and
/// audio tracks built in). Resumes movies/episodes where you left off.
struct PlayerView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let request: PlayRequest

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let url = URL(string: request.url), !request.url.isEmpty {
                PlayerController(url: url, start: request.isLive ? nil : model.resumePosition(request.key)) { pos, dur in
                    model.saveProgress(request, position: pos, duration: dur)
                } onFailed: { message in
                    failure = message
                }
                .ignoresSafeArea()
            }
            if let failure = failure ?? (request.url.isEmpty ? "This is a demo title with no video." : nil) {
                VStack(spacing: 14) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 36)).foregroundStyle(Theme.bad)
                    Text("Couldn’t play this").font(.system(size: 22, weight: .semibold))
                    Text(failure).foregroundStyle(Theme.dim).multilineTextAlignment(.center).frame(maxWidth: 520)
                    Button("Back") { dismiss() }.buttonStyle(PillButtonStyle(primary: true))
                }
                .padding(30)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24))
            }
        }
        .overlay(alignment: .topLeading) {
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 17, weight: .bold)).frame(width: 44, height: 44)
                    .background(.black.opacity(0.5), in: Circle())
            }
            .foregroundStyle(.white).padding(20)
        }
        .statusBarHidden()
    }

    @State private var failure: String?
}

private struct PlayerController: UIViewControllerRepresentable {
    let url: URL
    let start: Double?
    let onProgress: (Double, Double) -> Void
    let onFailed: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onProgress: onProgress, onFailed: onFailed) }

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        let item = AVPlayerItem(asset: AVURLAsset(url: url, options: [
            "AVURLAssetHTTPHeaderFieldsKey": ["User-Agent": "VLC/3.0.20 LibVLC/3.0.20"]
        ]))
        let player = AVPlayer(playerItem: item)
        vc.player = player
        vc.allowsPictureInPicturePlayback = true
        vc.canStartPictureInPictureAutomaticallyFromInline = true
        context.coordinator.attach(player, item: item, start: start)
        player.play()
        return vc
    }

    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) {}

    static func dismantleUIViewController(_ vc: AVPlayerViewController, coordinator: Coordinator) {
        coordinator.save()
        vc.player?.pause()
        coordinator.detach()
    }

    final class Coordinator: NSObject {
        let onProgress: (Double, Double) -> Void
        let onFailed: (String) -> Void
        private weak var player: AVPlayer?
        private var timeObserver: Any?
        private var statusObservation: NSKeyValueObservation?

        init(onProgress: @escaping (Double, Double) -> Void, onFailed: @escaping (String) -> Void) {
            self.onProgress = onProgress
            self.onFailed = onFailed
        }

        func attach(_ player: AVPlayer, item: AVPlayerItem, start: Double?) {
            self.player = player
            if let start, start > 0 {
                player.seek(to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .positiveInfinity)
            }
            // Save the position every 10 seconds.
            timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 10, preferredTimescale: 1), queue: .main) { [weak self] _ in
                self?.save()
            }
            statusObservation = item.observe(\.status) { [weak self] item, _ in
                guard item.status == .failed else { return }
                let reason = item.error?.localizedDescription ?? "The stream couldn’t be opened."
                DispatchQueue.main.async {
                    self?.onFailed("\(reason)\n\nApple’s player can’t play every format your provider uses (for example MKV files).")
                }
            }
        }

        func save() {
            guard let player, let item = player.currentItem else { return }
            let pos = player.currentTime().seconds
            let dur = item.duration.seconds
            if pos.isFinite, dur.isFinite { onProgress(pos, dur) }
        }

        func detach() {
            if let timeObserver { player?.removeTimeObserver(timeObserver) }
            timeObserver = nil
            statusObservation = nil
        }
    }
}
