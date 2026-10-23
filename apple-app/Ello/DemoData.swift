import Foundation

/// Sample catalogue for screenshots and trying the app without a provider
/// (launch with the `-demo` argument). No artwork URLs: placeholders are drawn locally.
enum DemoData {
    struct Sample {
        let source: Source
        let channels: [Channel]
        let categories: [Category]
        let progress: [String: WatchItem]
    }

    static func make() -> Sample {
        let src = Source(id: "demo", name: "Demo", kind: .xtream, server: "http://demo", username: "demo")
        let liveNames = ["NPO 1", "NPO 2", "RTL 4", "SBS 6", "BBC One", "BBC Two", "ITV1", "Sky News", "CNN", "Eurosport 1",
                         "Discovery", "National Geographic", "Comedy Central", "Nickelodeon", "Disney Channel", "MTV",
                         "Ziggo Sport", "ESPN", "Fox", "HBO"]
        let movieNames = ["EN - The Glass Orchard (2024)", "EN - Northern Lights", "EN - Paper Comets", "EN - Harbor of Echoes",
                          "EN - The Long Night", "EN - Silver Coast", "EN - Midnight Express Line", "EN - A Quiet Storm",
                          "EN - Lanterns", "EN - The Last Summer", "EN - Crossings", "EN - Iron Valley"]
        let seriesNames = ["EN - Harbor Lights", "EN - The Wire Room", "EN - Ozark Falls", "EN - City of Glass",
                           "EN - Northern Stars", "EN - The Crown Jewels", "EN - Undertow", "EN - Homecoming"]
        var channels: [Channel] = []
        for (i, n) in liveNames.enumerated() {
            channels.append(Channel(id: "demo:live:\(i)", sourceId: "demo", kind: .live, providerId: "\(i)", name: n,
                                    group: "demo:live:\(i % 3)", url: "", number: 101 + i))
        }
        for (i, n) in movieNames.enumerated() {
            channels.append(Channel(id: "demo:movie:\(i)", sourceId: "demo", kind: .movie, providerId: "\(i)", name: n,
                                    group: "demo:movie:\(i % 3)", url: "", rating: 6.5 + Double(i % 5) * 0.5,
                                    genre: ["Drama, Mystery", "Action, Thriller", "Comedy, Family"][i % 3],
                                    plot: "When a quiet town is shaken by an unexpected discovery, an unlikely group has one night to piece together the truth.",
                                    year: "\(2018 + i % 7)"))
        }
        for (i, n) in seriesNames.enumerated() {
            channels.append(Channel(id: "demo:series:\(i)", sourceId: "demo", kind: .series, providerId: "\(i)", name: n,
                                    group: "demo:series:\(i % 2)", url: "", rating: 7.8 + Double(i % 3) * 0.4,
                                    genre: "Crime, Drama", plot: "A gripping drama about family, loyalty and the price of secrets.",
                                    year: "\(2015 + i)", cast: "Lena Ortiz, Marcus Hale"))
        }
        let cats = [("News & General", StreamKind.live), ("Sports", .live), ("Kids", .live),
                    ("New releases", .movie), ("Action", .movie), ("Family", .movie),
                    ("Drama series", .series), ("Crime", .series)]
        var categories: [Category] = []
        var counters: [StreamKind: Int] = [:]
        for (name, kind) in cats {
            let n = counters[kind, default: 0]
            counters[kind] = n + 1
            categories.append(Category(id: "demo:\(kind.rawValue):\(n)", name: name, kind: kind))
        }
        let progress: [String: WatchItem] = [
            "demo:movie:0": WatchItem(key: "demo:movie:0", title: "The Glass Orchard", poster: nil, url: "", channelId: "demo:movie:0",
                                      position: 2460, duration: 6060, updatedAt: Date()),
            "demo:ep:h-1-3": WatchItem(key: "demo:ep:h-1-3", title: "Harbor Lights", subtitle: "S1 E3 · Crossings", url: "",
                                       seriesId: "demo:series:0", position: 900, duration: 2600, updatedAt: Date().addingTimeInterval(-60))
        ]
        return Sample(source: src, channels: channels, categories: categories, progress: progress)
    }

    static func episodes(for show: Channel) -> [Episode] {
        let titles = ["Pilot", "The Long Night", "Crossings", "Undertow", "Lanterns", "Homecoming", "Tides", "Ashore"]
        return (1...2).flatMap { season in
            titles.enumerated().map { i, t in
                Episode(id: "\(show.providerId)-\(season)-\(i)", title: t, season: season, episode: i + 1, url: "",
                        plot: "The truth starts to surface.", duration: "00:4\(i):12")
            }
        }
    }
}
