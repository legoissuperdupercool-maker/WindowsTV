import SwiftUI
import PhotosUI

struct Avatar: View {
    let profile: Profile
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [Color(hex: profile.color), Color(hex: profile.color).opacity(0.6)],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
            if let e = profile.emoji, !e.isEmpty {
                Text(e).font(.system(size: size * 0.5))
            } else {
                Text(profile.name.prefix(1).uppercased()).font(.system(size: size * 0.42, weight: .bold)).foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .overlay(alignment: .bottomTrailing) {
            if profile.kids && size > 60 {
                Text("KIDS").font(.system(size: 11, weight: .heavy)).padding(.horizontal, 7).padding(.vertical, 3)
                    .background(.yellow, in: Capsule()).foregroundStyle(.black)
            }
        }
    }
}

/// "Who's watching?"
struct ProfilePickerView: View {
    @Environment(AppModel.self) private var model
    @State private var editing: Profile?
    @State private var manage = false

    var body: some View {
        ZStack {
            Theme.background
            VStack(spacing: 40) {
                Text("Who’s watching?").font(.system(size: 38, weight: .semibold))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 34) {
                        ForEach(model.profiles) { p in
                            Button {
                                if manage { editing = p } else { model.selectProfile(p.id) }
                            } label: {
                                VStack(spacing: 14) {
                                    Avatar(profile: p, size: 130)
                                        .overlay {
                                            if manage {
                                                Circle().fill(.black.opacity(0.5))
                                                Image(systemName: "pencil").font(.system(size: 34, weight: .semibold))
                                            }
                                        }
                                    Text(p.name).font(.system(size: 19, weight: .medium)).foregroundStyle(Theme.dim)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                        if model.profiles.count < 8 {
                            Button { editing = Profile(name: "", color: Theme.profileColors[model.profiles.count % Theme.profileColors.count]) } label: {
                                VStack(spacing: 14) {
                                    Circle().strokeBorder(Theme.faint, style: StrokeStyle(lineWidth: 2, dash: [6]))
                                        .frame(width: 130, height: 130)
                                        .overlay(Image(systemName: "plus").font(.system(size: 40)).foregroundStyle(Theme.dim))
                                    Text("Add profile").font(.system(size: 19, weight: .medium)).foregroundStyle(Theme.faint)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 40)
                }
                .fixedSize(horizontal: false, vertical: true)
                Button(manage ? "Done" : "Manage profiles") { manage.toggle() }.buttonStyle(PillButtonStyle())
            }
        }
        .sheet(item: $editing) { p in ProfileEditor(profile: p) }
    }
}

struct ProfileEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State var profile: Profile
    @State private var photo: PhotosPickerItem?
    @State private var confirmDelete = false

    private var isNew: Bool { !model.profiles.contains { $0.id == profile.id } }
    private static let emojis = ["", "😀", "😎", "🦊", "🐼", "🐯", "🦄", "🐸", "🚀", "⚽️", "🎮", "🎧", "🌸", "🍕", "👑", "🐶"]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Spacer()
                        Avatar(profile: profile, size: 110)
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                    TextField("Name", text: $profile.name)
                }
                Section("Colour") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(Theme.profileColors, id: \.self) { c in
                                Circle().fill(Color(hex: c)).frame(width: 38, height: 38)
                                    .overlay(Circle().strokeBorder(.white, lineWidth: profile.color == c ? 3 : 0))
                                    .onTapGesture { profile.color = c }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                Section("Icon") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 8), spacing: 10) {
                        ForEach(Self.emojis, id: \.self) { e in
                            Text(e.isEmpty ? "Aa" : e).font(.system(size: e.isEmpty ? 15 : 26, weight: .semibold))
                                .frame(width: 44, height: 44)
                                .background((profile.emoji ?? "") == e ? Theme.blue.opacity(0.4) : Color.white.opacity(0.06), in: Circle())
                                .onTapGesture { profile.emoji = e.isEmpty ? nil : e }
                        }
                    }
                }
                Section("Background") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(Backdrop.presets) { b in
                                b.view.frame(width: 96, height: 60).clipShape(RoundedRectangle(cornerRadius: 10))
                                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.white, lineWidth: profile.background == b.id ? 3 : 0))
                                    .overlay(alignment: .bottomLeading) {
                                        Text(b.name).font(.system(size: 11, weight: .semibold)).padding(6)
                                    }
                                    .onTapGesture { profile.background = b.id }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    PhotosPicker(selection: $photo, matching: .images) {
                        Label(profile.background == "photo" ? "Choose another photo" : "Use a photo", systemImage: "photo")
                    }
                }
                Section {
                    Toggle("Kids profile", isOn: $profile.kids)
                    Toggle("Hide adult content", isOn: $profile.hideAdult).disabled(profile.kids)
                } footer: {
                    Text("Kids profiles only show kids & family categories and never adult content.")
                }
                if !isNew && model.profiles.count > 1 {
                    Section {
                        Button("Delete profile", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .navigationTitle(isNew ? "New profile" : "Edit profile")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        var p = profile
                        p.name = p.name.trimmingCharacters(in: .whitespaces)
                        if p.name.isEmpty { p.name = p.kids ? "Kids" : "Profile \(model.profiles.count + 1)" }
                        model.saveProfile(p)
                        dismiss()
                    }
                }
            }
            .confirmationDialog("Delete \(profile.name)?", isPresented: $confirmDelete) {
                Button("Delete", role: .destructive) {
                    model.deleteProfile(profile.id)
                    dismiss()
                }
            } message: { Text("Their My List, favourites and watch history are removed from this iPad.") }
            .onChange(of: photo) {
                guard let photo else { return }
                Task {
                    if let data = try? await photo.loadTransferable(type: Data.self), Backdrop.savePhoto(data, for: profile.id) {
                        profile.background = "photo"
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

/// Profile backgrounds: calm gradients, or a photo from the library.
struct Backdrop: Identifiable {
    let id: String
    let name: String
    let colors: [UInt32]

    static let presets: [Backdrop] = [
        Backdrop(id: "default", name: "ello", colors: [0x0E1013, 0x0E1013]),
        Backdrop(id: "aurora", name: "Aurora", colors: [0x0B3D3A, 0x1B1446]),
        Backdrop(id: "sunset", name: "Sunset", colors: [0x4A1730, 0x1A1030]),
        Backdrop(id: "ocean", name: "Ocean", colors: [0x0A2A4A, 0x06121F]),
        Backdrop(id: "forest", name: "Forest", colors: [0x13331D, 0x0B140E]),
        Backdrop(id: "ember", name: "Ember", colors: [0x4A2408, 0x140B06]),
        Backdrop(id: "violet", name: "Violet", colors: [0x2E1A52, 0x0F0A1A]),
        Backdrop(id: "slate", name: "Slate", colors: [0x2A2F38, 0x111317])
    ]

    @ViewBuilder var view: some View {
        if id == "default" {
            Theme.background
        } else {
            LinearGradient(colors: colors.map { Color(hex: $0) }, startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }

    static func photoURL(_ profileId: String) -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("background-\(profileId).jpg")
    }

    static func savePhoto(_ data: Data, for profileId: String) -> Bool {
        guard let img = UIImage(data: data) else { return false }
        // Scale down: a background doesn't need 48 megapixels.
        let scale = min(1, 2400 / max(img.size.width, img.size.height))
        let size = CGSize(width: img.size.width * scale, height: img.size.height * scale)
        let small = UIGraphicsImageRenderer(size: size).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        guard let jpg = small.jpegData(compressionQuality: 0.85) else { return false }
        return (try? jpg.write(to: photoURL(profileId))) != nil
    }
}

/// The active profile's background behind every screen.
struct AppBackground: View {
    let profile: Profile

    var body: some View {
        ZStack {
            if profile.background == "photo", let img = UIImage(contentsOfFile: Backdrop.photoURL(profile.id).path) {
                GeometryReader { geo in
                    Image(uiImage: img).resizable().scaledToFill().frame(width: geo.size.width, height: geo.size.height).clipped()
                }
                LinearGradient(colors: [.black.opacity(0.55), .black.opacity(0.85)], startPoint: .top, endPoint: .bottom)
            } else {
                (Backdrop.presets.first { $0.id == profile.background } ?? Backdrop.presets[0]).view
            }
        }
        .ignoresSafeArea()
    }
}
