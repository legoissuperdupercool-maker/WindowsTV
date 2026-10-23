import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var editing: Source?
    @State private var adding = RootView.startScreen == "add"
    @State private var editingProfile: Profile?
    @State private var showFilters = false

    var body: some View {
        NavigationStack {
            List {
                Section("Sources") {
                    ForEach(model.sources) { s in
                        Button { editing = s } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(s.name).font(.system(size: 17, weight: .semibold))
                                    Text(s.kind.label).font(.system(size: 13)).foregroundStyle(Theme.dim)
                                }
                                Spacer()
                                if s.id == model.currentSourceId {
                                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.blue)
                                }
                            }
                        }
                        .foregroundStyle(Theme.text)
                    }
                    .onDelete { idx in idx.map { model.sources[$0] }.forEach(model.remove) }
                    Button { adding = true } label: { Label("Add source", systemImage: "plus.circle.fill") }
                }
                Section("Profiles") {
                    ForEach(model.profiles) { p in
                        Button { editingProfile = p } label: {
                            HStack(spacing: 12) {
                                Avatar(profile: p, size: 34)
                                Text(p.name)
                                if p.kids { Text("Kids").font(.system(size: 12, weight: .bold)).foregroundStyle(.yellow) }
                                Spacer()
                                if p.id == model.activeProfileId { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.blue) }
                            }
                        }
                        .foregroundStyle(Theme.text)
                    }
                    Button { editingProfile = Profile(name: "", color: Theme.profileColors[model.profiles.count % Theme.profileColors.count]) } label: {
                        Label("Add profile", systemImage: "person.badge.plus")
                    }
                    Button { dismiss(); model.showProfilePicker = true } label: { Label("Switch profile", systemImage: "person.2") }
                }
                Section {
                    Button { showFilters = true } label: { Label("Filter & hide channels", systemImage: "line.3.horizontal.decrease.circle") }
                } footer: {
                    Text("Only show the countries you watch, hide categories and channels, and sort A–Z. Saved per profile.")
                }
                Section {
                    Button { Task { await model.load(force: true) } } label: { Label("Reload channels, movies & series", systemImage: "arrow.clockwise") }
                        .disabled(model.currentSource == nil)
                }
                Section("VPN") {
                    Text("To hide your IP address, install the Mullvad (or any WireGuard) app from the App Store and switch it on. On iPad a VPN app covers every app, ello included, and Mullvad’s “Lockdown mode” blocks traffic if the VPN drops.")
                        .font(.system(size: 13)).foregroundStyle(Theme.dim)
                }
                Section("About") {
                    LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "–")
                    Text("Your logins stay on this device (passwords in the Keychain). ello only talks to your IPTV provider. Recommendations are worked out on the iPad.")
                        .font(.system(size: 13)).foregroundStyle(Theme.dim)
                    Text("Video playback for MKV and other formats by VLC (MobileVLCKit, LGPL 2.1).")
                        .font(.system(size: 13)).foregroundStyle(Theme.faint)
                }
            }
            .navigationTitle("Settings")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $adding) { SourceForm(source: nil) }
            .sheet(item: $editing) { s in SourceForm(source: s) }
            .sheet(item: $editingProfile) { p in ProfileEditor(profile: p) }
            .sheet(isPresented: $showFilters) { ChannelFilterView() }
        }
        .preferredColorScheme(.dark)
    }
}

struct SourceForm: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let source: Source?

    @State private var kind: Source.Kind = .xtream
    @State private var name = ""
    @State private var server = ""
    @State private var username = ""
    @State private var password = ""
    @State private var testing = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Picker("Type", selection: $kind) {
                    ForEach(Source.Kind.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                TextField("Name (e.g. My IPTV)", text: $name)
                if kind == .xtream {
                    TextField("Server (http://host:port)", text: $server).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password)
                } else {
                    TextField("Playlist URL (http://…/playlist.m3u)", text: $server).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                if let error {
                    Text(error).foregroundStyle(Theme.bad)
                }
                Section {
                    Text("Your password is stored in this device’s Keychain and only sent to your provider.")
                        .font(.system(size: 13)).foregroundStyle(Theme.dim)
                }
            }
            .navigationTitle(source == nil ? "Add source" : "Edit source")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if testing { ProgressView() } else { Button("Save") { Task { await save() } }.disabled(server.isEmpty) }
                }
            }
            .onAppear {
                if let s = source {
                    kind = s.kind
                    name = s.name
                    server = s.server
                    username = s.username
                    password = Keychain.get(s.id) ?? ""
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func save() async {
        var s = source ?? Source(name: "", kind: kind, server: "")
        s.kind = kind
        s.name = name.isEmpty ? (kind == .xtream ? "My IPTV" : "Playlist") : name
        s.server = server
        s.username = username
        testing = true
        error = await model.test(s, password: password)
        testing = false
        if error == nil {
            model.save(s, password: password)
            dismiss()
        }
    }
}
