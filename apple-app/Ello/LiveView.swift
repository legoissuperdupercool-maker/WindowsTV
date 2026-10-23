import SwiftUI

struct LiveView: View {
    @Environment(AppModel.self) private var model
    @State private var category: String? = nil
    @State private var query = ""

    private var shown: [Channel] {
        model.live.filter { c in
            (category == nil || c.group == category) && (query.isEmpty || c.name.localizedCaseInsensitiveContains(query))
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    CategoryRow(name: "All channels", count: model.live.count, selected: category == nil) { category = nil }
                    ForEach(model.categories(.live)) { cat in
                        CategoryRow(name: cat.name, count: nil, selected: category == cat.id) { category = cat.id }
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 8)
            }
            .frame(width: 260)

            VStack(spacing: 14) {
                SearchField(text: $query, prompt: "Search channels")
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 16)], spacing: 16) {
                        ForEach(shown) { c in ChannelCard(channel: c) { model.play(c) } }
                    }
                    .padding(.bottom, 30)
                }
            }
            .padding(.trailing, 28)
        }
    }
}

struct CategoryRow: View {
    let name: String
    let count: Int?
    let selected: Bool
    let tap: () -> Void
    var body: some View {
        Button(action: tap) {
            HStack {
                Text(name).lineLimit(1)
                Spacer()
                if let count { Text("\(count)").foregroundStyle(Theme.faint) }
            }
            .font(.system(size: 15, weight: selected ? .semibold : .regular))
            .padding(.horizontal, 14).frame(height: 40)
            .foregroundStyle(selected ? Color.black : Theme.dim)
            .background(selected ? Theme.text : Color.clear, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}

struct SearchField: View {
    @Binding var text: String
    let prompt: String
    var body: some View {
        HStack {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.faint)
            TextField(prompt, text: $text).textInputAutocapitalization(.never).autocorrectionDisabled()
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.faint) }
            }
        }
        .padding(.horizontal, 16).frame(height: 46)
        .background(Theme.surface, in: Capsule())
    }
}
