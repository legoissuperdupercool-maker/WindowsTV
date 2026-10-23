import SwiftUI
import AVFoundation

@main
struct ElloApp: App {
    @State private var model = AppModel()

    init() {
        // Keep playing with the silent switch on, like any video app.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
                .task { await model.load() }
        }
    }
}

enum Tab: String, CaseIterable, Identifiable {
    case home = "Home", live = "Live TV", movies = "Movies", series = "Series"
    var id: String { rawValue }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var tab: Tab = RootView.startTab
    @State private var showSettings = RootView.startScreen == "settings"

    /// Screenshot runs pick the first screen with `-tab movies` etc.
    static var startTab: Tab {
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-tab"), i + 1 < args.count, let t = Tab.allCases.first(where: { $0.rawValue.lowercased().hasPrefix(args[i + 1]) }) {
            return t
        }
        return .home
    }
    static var startScreen: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-screen"), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    var body: some View {
        @Bindable var model = model
        ZStack {
            Theme.background
            VStack(spacing: 0) {
                TopBar(tab: $tab, showSettings: $showSettings)
                if model.sources.isEmpty {
                    WelcomeView(showSettings: $showSettings)
                } else if model.loading {
                    LoadingView(text: model.status ?? "Loading…")
                } else if let error = model.error, model.live.isEmpty, model.movies.isEmpty {
                    ErrorView(text: error)
                } else {
                    switch tab {
                    case .home: HomeView(tab: $tab)
                    case .live: LiveView()
                    case .movies: LibraryView(kind: .movie)
                    case .series: LibraryView(kind: .series)
                    }
                }
            }
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
        .fullScreenCover(item: $model.playing) { req in PlayerView(request: req) }
    }
}

struct TopBar: View {
    @Environment(AppModel.self) private var model
    @Binding var tab: Tab
    @Binding var showSettings: Bool

    var body: some View {
        HStack(spacing: 6) {
            HStack(spacing: 0) {
                Text("ello").font(.system(size: 22, weight: .bold))
                Text(".").font(.system(size: 22, weight: .bold)).foregroundStyle(Theme.blue)
                Text(" smartTV").font(.system(size: 22)).foregroundStyle(Theme.dim)
            }
            .padding(.trailing, 18)
            ForEach(Tab.allCases) { t in
                Button(t.rawValue) { tab = t }
                    .font(.system(size: 16, weight: .medium))
                    .padding(.horizontal, 16)
                    .frame(height: 38)
                    .foregroundStyle(tab == t ? Color.black : Theme.dim)
                    .background(tab == t ? Theme.text : Color.clear, in: Capsule())
            }
            Spacer()
            if model.sources.count > 1 {
                Menu {
                    ForEach(model.sources) { s in
                        Button(s.name) { model.select(s.id) }
                    }
                } label: {
                    Label(model.currentSource?.name ?? "Source", systemImage: "antenna.radiowaves.left.and.right")
                        .font(.system(size: 15, weight: .medium))
                }
                .tint(Theme.text)
            }
            Button { showSettings = true } label: {
                Image(systemName: "gearshape.fill").font(.system(size: 20)).frame(width: 44, height: 44)
            }
            .foregroundStyle(Theme.dim)
        }
        .padding(.horizontal, 28)
        .padding(.top, 8)
        .padding(.bottom, 6)
    }
}

struct WelcomeView: View {
    @Binding var showSettings: Bool
    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            Image("Logo").resizable().frame(width: 96, height: 96).clipShape(RoundedRectangle(cornerRadius: 22))
            Text("Welcome to ello smartTV").font(.system(size: 32, weight: .semibold))
            Text("Add your IPTV provider to get started: an Xtream Codes login or an M3U playlist.")
                .font(.system(size: 17)).foregroundStyle(Theme.dim).multilineTextAlignment(.center).frame(maxWidth: 520)
            Button("Add a source") { showSettings = true }.buttonStyle(PillButtonStyle(primary: true)).padding(.top, 8)
            Spacer()
        }
        .padding()
    }
}

struct LoadingView: View {
    let text: String
    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            ProgressView().controlSize(.large).tint(Theme.blue)
            Text(text).foregroundStyle(Theme.dim)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

struct ErrorView: View {
    @Environment(AppModel.self) private var model
    let text: String
    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 40)).foregroundStyle(Theme.bad)
            Text("Couldn’t load your source").font(.system(size: 22, weight: .semibold))
            Text(text).foregroundStyle(Theme.dim).multilineTextAlignment(.center).frame(maxWidth: 520)
            Button("Try again") { Task { await model.load(force: true) } }.buttonStyle(PillButtonStyle(primary: true))
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding()
    }
}
