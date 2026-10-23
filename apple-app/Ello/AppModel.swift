import Foundation
import Observation

/// App state: sources, the current source's catalogue (cached on the device),
/// and watch progress for Continue watching.
@MainActor
@Observable
final class AppModel {
    var sources: [Source] = []
    var currentSourceId: String?
    var live: [Channel] = []
    var movies: [Channel] = []
    var series: [Channel] = []
    var categories: [Category] = []
    var loading = false
    var status: String?
    var error: String?
    var progress: [String: WatchItem] = [:]
    /// Something to play full screen.
    var playing: PlayRequest?

    let demo = ProcessInfo.processInfo.arguments.contains("-demo")

    private let defaults = UserDefaults.standard
    private let cacheMaxAge: TimeInterval = 12 * 3600

    init() {
        if demo {
            let d = DemoData.make()
            sources = [d.source]
            currentSourceId = d.source.id
            apply(d.channels, d.categories)
            progress = d.progress
            return
        }
        if let data = defaults.data(forKey: "sources"), let list = try? JSONDecoder().decode([Source].self, from: data) {
            sources = list
        }
        if let data = defaults.data(forKey: "progress"), let p = try? JSONDecoder().decode([String: WatchItem].self, from: data) {
            progress = p
        }
        currentSourceId = defaults.string(forKey: "currentSource") ?? sources.first?.id
    }

    var currentSource: Source? { sources.first { $0.id == currentSourceId } }

    func categories(_ kind: StreamKind) -> [Category] { categories.filter { $0.kind == kind } }

    func channel(_ id: String) -> Channel? {
        (live.first { $0.id == id }) ?? (movies.first { $0.id == id }) ?? (series.first { $0.id == id })
    }

    // MARK: sources

    func save(_ source: Source, password: String) {
        if let i = sources.firstIndex(where: { $0.id == source.id }) { sources[i] = source } else { sources.append(source) }
        if source.kind == .xtream { Keychain.set(password, for: source.id) }
        persistSources()
        currentSourceId = source.id
        defaults.set(source.id, forKey: "currentSource")
        Task { await load(force: true) }
    }

    func remove(_ source: Source) {
        sources.removeAll { $0.id == source.id }
        Keychain.delete(source.id)
        try? FileManager.default.removeItem(at: cacheURL(source.id))
        persistSources()
        if currentSourceId == source.id {
            currentSourceId = sources.first?.id
            apply([], [])
            Task { await load() }
        }
    }

    func select(_ id: String) {
        currentSourceId = id
        defaults.set(id, forKey: "currentSource")
        Task { await load() }
    }

    private func persistSources() {
        defaults.set(try? JSONEncoder().encode(sources), forKey: "sources")
    }

    /// Check a login before saving it.
    func test(_ source: Source, password: String) async -> String? {
        do {
            if source.kind == .xtream {
                try await XtreamClient(source: source, password: password).authenticate()
            } else {
                _ = try await M3UParser.load(source)
            }
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    // MARK: catalogue

    private struct Cache: Codable {
        let channels: [Channel]
        let categories: [Category]
        let fetchedAt: Date
    }

    private func cacheURL(_ id: String) -> URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("catalog-\(id).json")
    }

    private func apply(_ channels: [Channel], _ cats: [Category]) {
        live = channels.filter { $0.kind == .live }
        movies = channels.filter { $0.kind == .movie }
        series = channels.filter { $0.kind == .series }
        categories = cats
    }

    /// Show the cached catalogue at once; download it only when it's missing,
    /// older than 12 hours, or `force` is set.
    func load(force: Bool = false) async {
        guard !demo, let source = currentSource else { return }
        let url = cacheURL(source.id)
        var cachedAt: Date?
        if let data = try? Data(contentsOf: url), let cache = try? JSONDecoder().decode(Cache.self, from: data) {
            apply(cache.channels, cache.categories)
            cachedAt = cache.fetchedAt
        }
        if !force, let cachedAt, Date().timeIntervalSince(cachedAt) < cacheMaxAge { return }

        loading = cachedAt == nil
        error = nil
        status = cachedAt == nil ? "Loading channels, movies & series…" : nil
        do {
            let (channels, cats) = try await download(source)
            apply(channels, cats)
            let cache = Cache(channels: channels, categories: cats, fetchedAt: Date())
            try? JSONEncoder().encode(cache).write(to: url)
        } catch {
            if cachedAt == nil { self.error = error.localizedDescription }
        }
        loading = false
        status = nil
    }

    private func download(_ source: Source) async throws -> ([Channel], [Category]) {
        if source.kind == .m3u { return try await M3UParser.load(source) }
        let client = XtreamClient(source: source, password: Keychain.get(source.id) ?? "")
        try await client.authenticate()
        let cats = try await client.categories()
        // One list at a time: providers often allow only 1–2 connections.
        let l = (try? await client.live()) ?? []
        let m = (try? await client.movies()) ?? []
        let s = (try? await client.series()) ?? []
        if l.isEmpty && m.isEmpty && s.isEmpty { throw ProviderError.empty }
        return (l + m + s, cats)
    }

    func episodes(for show: Channel) async throws -> [Episode] {
        if demo { return DemoData.episodes(for: show) }
        guard let source = sources.first(where: { $0.id == show.sourceId }), source.kind == .xtream else { return [] }
        return try await XtreamClient(source: source, password: Keychain.get(source.id) ?? "").episodes(seriesId: show.providerId)
    }

    // MARK: playback & progress

    func play(_ channel: Channel) {
        playing = PlayRequest(
            key: channel.id, title: channel.cleanName, url: channel.url, poster: channel.logo,
            channelId: channel.id, isLive: channel.kind == .live
        )
    }

    func play(_ episode: Episode, of show: Channel) {
        playing = PlayRequest(
            key: "\(show.sourceId):ep:\(episode.id)", title: show.cleanName,
            subtitle: "S\(episode.season) E\(episode.episode) · \(episode.title)",
            url: episode.url, poster: episode.thumb ?? show.logo, seriesId: show.id, isLive: false
        )
    }

    func resume(_ item: WatchItem) {
        playing = PlayRequest(
            key: item.key, title: item.title, subtitle: item.subtitle, url: item.url, poster: item.poster,
            channelId: item.channelId, seriesId: item.seriesId, isLive: false
        )
    }

    func resumePosition(_ key: String) -> Double? {
        guard let p = progress[key], !p.finished, p.position > 30 else { return nil }
        return max(0, p.position - 3)
    }

    func saveProgress(_ req: PlayRequest, position: Double, duration: Double) {
        guard !req.isLive, duration > 0, position > 0 else { return }
        progress[req.key] = WatchItem(
            key: req.key, title: req.title, subtitle: req.subtitle, poster: req.poster, url: req.url,
            channelId: req.channelId, seriesId: req.seriesId, position: position, duration: duration, updatedAt: Date()
        )
        if progress.count > 300 {
            for old in progress.values.sorted(by: { $0.updatedAt < $1.updatedAt }).prefix(progress.count - 300) {
                progress[old.key] = nil
            }
        }
        defaults.set(try? JSONEncoder().encode(progress), forKey: "progress")
    }

    var continueWatching: [WatchItem] {
        progress.values
            .filter { !$0.finished && $0.position > 30 && ($0.key.hasPrefix(currentSourceId ?? "\u{0}")) }
            .sorted { $0.updatedAt > $1.updatedAt }
    }
}

struct PlayRequest: Identifiable, Hashable {
    var id: String { key }
    let key: String
    let title: String
    var subtitle: String?
    let url: String
    var poster: String?
    var channelId: String?
    var seriesId: String?
    let isLive: Bool
}
