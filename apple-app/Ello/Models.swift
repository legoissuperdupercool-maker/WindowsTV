import Foundation

enum StreamKind: String, Codable, Hashable {
    case live, movie, series
}

/// An IPTV provider: an Xtream Codes login or an M3U playlist URL.
/// The password is kept in the Keychain, not here.
struct Source: Codable, Identifiable, Hashable {
    enum Kind: String, Codable, CaseIterable, Identifiable {
        case xtream, m3u
        var id: String { rawValue }
        var label: String { self == .xtream ? "Xtream Codes" : "M3U playlist" }
    }

    var id: String = UUID().uuidString
    var name: String
    var kind: Kind
    /// Xtream: server address (http://host:port). M3U: playlist URL.
    var server: String
    var username: String = ""
}

struct Category: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let kind: StreamKind
}

struct Channel: Codable, Identifiable, Hashable {
    /// "\(sourceId):\(kind):\(providerId)", same scheme as the Windows app.
    let id: String
    let sourceId: String
    let kind: StreamKind
    let providerId: String
    let name: String
    var logo: String?
    var group: String?
    /// Playable URL (empty for series: episodes have their own).
    var url: String
    var number: Int?
    var rating: Double?
    var genre: String?
    var plot: String?
    var year: String?
    var cast: String?
    var added: Double?

    /// Title without provider prefixes like "EN - ".
    var cleanName: String {
        name.replacingOccurrences(of: #"^\s*\[?[A-Z]{2,3}\]?\s*[-|:•]\s*"#, with: "", options: .regularExpression)
    }
}

struct Episode: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let season: Int
    let episode: Int
    let url: String
    var thumb: String?
    var plot: String?
    var duration: String?
}

/// How far a movie or episode was watched (for Continue watching / resume).
struct WatchItem: Codable, Identifiable, Hashable {
    var id: String { key }
    let key: String
    let title: String
    var subtitle: String?
    var poster: String?
    let url: String
    var channelId: String?
    var seriesId: String?
    var position: Double
    var duration: Double
    var updatedAt: Date
    var finished: Bool { duration > 0 && position / duration >= 0.95 }
}
