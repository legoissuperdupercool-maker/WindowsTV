import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var editing: Source?
    @State private var adding = RootView.startScreen == "add"

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
                Section {
                    Button { Task { await model.load(force: true) } } label: { Label("Reload channels, movies & series", systemImage: "arrow.clockwise") }
                        .disabled(model.currentSource == nil)
                }
                Section("About") {
                    LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "–")
                    Text("Your logins stay on this device (passwords in the Keychain). ello only talks to your IPTV provider.")
                        .font(.system(size: 13)).foregroundStyle(Theme.dim)
                }
            }
            .navigationTitle("Settings")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $adding) { SourceForm(source: nil) }
            .sheet(item: $editing) { s in SourceForm(source: s) }
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
