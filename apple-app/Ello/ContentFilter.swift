import Foundation

/// What a profile may see: Kids profiles only get kid-friendly categories (when
/// the provider has any) and never adult content; others can hide adult content.
/// The profile's country choice and hidden categories/channels apply too.
enum ContentFilter {
    static let adult = try! NSRegularExpression(
        pattern: #"\b(xxx|porn\w*|adult|adults only|erotic\w*|hentai|onlyfans|brazzers|vixen|blacked|bangbros|playboy|hustler|naughty ?america|reality ?kings|tushy|18\s*\+|\+\s*18)\b|\[x\]|\(x\)"#,
        options: [.caseInsensitive])
    static let kids = try! NSRegularExpression(
        pattern: #"\b(kids?|children|child|family|famil\w*|cartoons?|animation|animated|anime ?kids|junior|jr|disney|nick(elodeon|jr)?|pixar|dreamworks|cbeebies|baby ?tv|kinder|kinderen|enfants?|ni[ñn]os|bambini|kika|ketnet)\b"#,
        options: [.caseInsensitive])

    static func matches(_ re: NSRegularExpression, _ s: String?) -> Bool {
        guard let s else { return false }
        return re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    static func apply(channels: [Channel], categories: [Category], profile: Profile) -> (channels: [Channel], categories: [Category]) {
        var cats = categories
        var list = channels
        if profile.kids || profile.hideAdult {
            let adultCats = Set(cats.filter { matches(adult, $0.name) }.map(\.id))
            cats.removeAll { adultCats.contains($0.id) }
            list.removeAll { ($0.group.map { adultCats.contains($0) } ?? false) || matches(adult, $0.name) }
            if profile.kids {
                // Per list: live, movies and series each keep only their kid categories, if they have any.
                for kind in [StreamKind.live, .movie, .series] {
                    let kidIds = Set(cats.filter { $0.kind == kind && matches(kids, $0.name) }.map(\.id))
                    guard !kidIds.isEmpty else { continue }
                    cats.removeAll { $0.kind == kind && !kidIds.contains($0.id) }
                    list.removeAll { $0.kind == kind && !($0.group.map { kidIds.contains($0) } ?? false) }
                }
            }
        }
        // Live TV: chosen countries only, minus hidden categories and channels.
        let countries = Set(profile.countries)
        let hiddenCats = Set(profile.hiddenCategories)
        let hiddenChannels = Set(profile.hiddenChannels)
        if !countries.isEmpty || !hiddenCats.isEmpty || !hiddenChannels.isEmpty {
            let catById = Dictionary(cats.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            let keepCat: (Category) -> Bool = { c in
                guard c.kind == .live else { return true }
                if hiddenCats.contains(c.id) { return false }
                if countries.isEmpty { return true }
                return Country.of(category: c.name).map { countries.contains($0) } ?? countries.contains(Country.other)
            }
            cats.removeAll { !keepCat($0) }
            list.removeAll { c in
                guard c.kind == .live else { return false }
                if hiddenChannels.contains(c.id) { return true }
                if let g = c.group, let cat = catById[g] {
                    if !keepCat(cat) { return true }
                    if countries.isEmpty || Country.of(category: cat.name) != nil { return false }
                }
                guard !countries.isEmpty else { return false }
                return !countries.contains(Country.of(channel: c.name) ?? Country.other)
            }
        }
        return (list, cats)
    }
}

/// Countries from the prefixes providers put on categories and channels
/// ("NL | Sport", "UK: BBC One", "|DE| ARD", "FRANCE ▶ TF1").
enum Country {
    static let other = "Other"

    static let names: [String: String] = [
        "NL": "Netherlands", "BE": "Belgium", "UK": "United Kingdom", "US": "United States", "CA": "Canada",
        "DE": "Germany", "FR": "France", "ES": "Spain", "IT": "Italy", "PT": "Portugal", "TR": "Turkey",
        "PL": "Poland", "RO": "Romania", "GR": "Greece", "AL": "Albania", "RS": "Serbia", "HR": "Croatia",
        "BA": "Bosnia", "SI": "Slovenia", "MK": "North Macedonia", "BG": "Bulgaria", "HU": "Hungary",
        "CZ": "Czechia", "SK": "Slovakia", "AT": "Austria", "CH": "Switzerland", "SE": "Sweden", "NO": "Norway",
        "DK": "Denmark", "FI": "Finland", "IE": "Ireland", "IS": "Iceland", "RU": "Russia", "UA": "Ukraine",
        "AR": "Arabic", "MA": "Morocco", "DZ": "Algeria", "TN": "Tunisia", "EG": "Egypt", "IN": "India",
        "PK": "Pakistan", "BD": "Bangladesh", "AF": "Afghanistan", "IR": "Iran", "IL": "Israel", "KU": "Kurdish",
        "AU": "Australia", "NZ": "New Zealand", "BR": "Brazil", "MX": "Mexico", "LA": "Latin America",
        "CO": "Colombia", "CL": "Chile", "PE": "Peru", "CN": "China", "JP": "Japan", "KR": "Korea",
        "PH": "Philippines", "TH": "Thailand", "VN": "Vietnam", "ID": "Indonesia", "MY": "Malaysia",
        "AFR": "Africa", "CAR": "Caribbean", "EX": "Ex-Yugoslavia", "LT": "Lithuania", "LV": "Latvia",
        "EE": "Estonia", "AM": "Armenia", "GE": "Georgia", "AZ": "Azerbaijan", "SO": "Somalia", "NG": "Nigeria"
    ]
    static let aliases: [String: String] = [
        "GB": "UK", "ENG": "UK", "EN": "UK", "USA": "US", "NLD": "NL", "HOL": "NL", "BEL": "BE", "GER": "DE",
        "DEU": "DE", "FRA": "FR", "ESP": "ES", "SP": "ES", "ITA": "IT", "POR": "PT", "PRT": "PT", "TUR": "TR",
        "POL": "PL", "ROM": "RO", "SWE": "SE", "NOR": "NO", "DAN": "DK", "DNK": "DK", "FIN": "FI", "ARB": "AR",
        "ARA": "AR", "IND": "IN", "PAK": "PK", "AUS": "AU", "BRA": "BR", "MEX": "MX", "LAT": "LA", "SUI": "CH",
        "AUT": "AT", "GRE": "GR", "ALB": "AL", "SRB": "RS", "CRO": "HR", "RUS": "RU", "UKR": "UA", "KUR": "KU",
        "BOS": "BA", "BUL": "BG", "HUN": "HU", "CZE": "CZ", "IRL": "IE", "PHI": "PH", "CHN": "CN", "JPN": "JP",
        "KOR": "KR", "AFG": "AF", "IRN": "IR", "ISR": "IL", "BAN": "BD"
    ]
    /// Full country names written out in categories ("NETHERLANDS ▶ Sport").
    private static let byName: [String: String] = {
        var out: [String: String] = [:]
        for (code, name) in names { out[name.lowercased()] = code }
        out["holland"] = "NL"; out["nederland"] = "NL"; out["england"] = "UK"; out["united kingdom"] = "UK"
        out["usa"] = "US"; out["deutschland"] = "DE"; out["arab"] = "AR"; out["arabia"] = "AR"
        out["turkiye"] = "TR"; out["türkiye"] = "TR"; out["belgie"] = "BE"; out["belgië"] = "BE"
        out["espana"] = "ES"; out["españa"] = "ES"; out["italia"] = "IT"; out["latino"] = "LA"
        return out
    }()

    private static let prefix = try! NSRegularExpression(pattern: #"^\s*[\[|(]?\s*([A-Za-z]{2,3})\s*[\]|)]?\s*(?:[-|:•▶►/]|\s{1}|$)"#)
    private static let lead = try! NSRegularExpression(pattern: #"^\s*[\[|(]?\s*([A-Za-z]+(?: [A-Za-z]+)?)"#)

    static func code(_ raw: String) -> String? {
        let up = raw.uppercased()
        let c = aliases[up] ?? up
        return names[c] != nil ? c : nil
    }

    static func of(category name: String) -> String? { detect(name, allowSpace: true) }
    static func of(channel name: String) -> String? { detect(name, allowSpace: false) }

    private static func detect(_ s: String, allowSpace: Bool) -> String? {
        let r = NSRange(s.startIndex..., in: s)
        if let m = prefix.firstMatch(in: s, range: r), let g = Range(m.range(at: 1), in: s) {
            let whole = Range(m.range, in: s).map { String(s[$0]) } ?? ""
            let sepIsSpace = !whole.contains(where: { "-|:•▶►/[]()".contains($0) })
            // "NL Sport" is fine for categories; for channels only "NL: …" style, so "RTL 4" isn't Russia-ish.
            let raw = String(s[g])
            if !sepIsSpace || (allowSpace && raw == raw.uppercased()), let c = code(raw) { return c }
        }
        if allowSpace, let m = lead.firstMatch(in: s, range: r), let g = Range(m.range(at: 1), in: s) {
            let words = s[g].lowercased()
            if let c = byName[words] { return c }
            if let first = words.split(separator: " ").first, let c = byName[String(first)] { return c }
        }
        return nil
    }

    static func flag(_ code: String) -> String {
        let iso = code == "UK" ? "GB" : code
        guard iso.count == 2, names[code] != nil, !["AR", "LA", "EX", "KU"].contains(code) else { return "🌐" }
        return iso.unicodeScalars.compactMap { UnicodeScalar(127397 + $0.value) }.map(String.init).joined()
    }

    static func label(_ code: String) -> String { code == other ? "Other / no country" : names[code] ?? code }
}
