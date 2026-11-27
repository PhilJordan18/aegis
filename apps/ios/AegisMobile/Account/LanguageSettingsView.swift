import SwiftUI

/// Compte > Réglages > Langue (#232): the list the Settings app uses for a
/// choice, a checkmark on the current one. Not a navigation-link `Picker`,
/// whose value in Account is drawn in the system grey: 3.44:1 on the panel,
/// below the 4.5:1 of the other values.
struct LanguageRow: View {
    let language: LanguagePreference

    var body: some View {
        NavigationLink {
            LanguageSettingsView(language: language)
        } label: {
            LabeledContent {
                Text(LanguageSettingsView.name(language.selection)).foregroundStyle(Color.brandMuted)
            } label: {
                Label {
                    Text("Langue")
                } icon: {
                    Image(systemName: "globe").foregroundStyle(Color.brandAccent)
                }
            }
        }
        .accessibilityIdentifier("account.language")
    }
}

struct LanguageSettingsView: View {
    let language: LanguagePreference

    var body: some View {
        List {
            Section {
                ForEach(AppLanguage.allCases) { option in
                    let selected = language.selection == option
                    Button { language.select(option) } label: {
                        HStack {
                            Text(Self.name(option)).foregroundStyle(Color.brandText)
                            Spacer()
                            if selected {
                                Image(systemName: "checkmark")
                                    .fontWeight(.semibold)
                                    .foregroundStyle(Color.brandAccent)
                                    .accessibilityHidden(true)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .accessibilityAddTraits(selected ? .isSelected : [])
                    .accessibilityIdentifier("language.\(option.rawValue)")
                }
            }
            .listRowBackground(Color.brandPanel)

            // Rows rather than a section footer, which does not follow every
            // Dynamic Type size.
            Section {
                Group {
                    if language.appliesAtNextLaunch {
                        Text("La langue choisie s’appliquera au prochain lancement de l’app.")
                            .accessibilityIdentifier("language.pending")
                    } else {
                        Text("« Système » suit la langue de l’iPhone.")
                    }
                }
                .font(.footnote)
                .foregroundStyle(Color.brandMuted)
                .fixedSize(horizontal: false, vertical: true)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
            }
        }
        .scrollContentBackground(.hidden)
        .background(Color.brandTop.ignoresSafeArea())
        .navigationTitle("Langue")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Each language is named in itself, and spoken in it, so it can be found
    /// whatever the current one.
    static func name(_ language: AppLanguage) -> AttributedString {
        switch language {
        case .system: AttributedString(localized: "Système")
        case .french: named("Français", identifier: "fr")
        case .english: named("English", identifier: "en")
        }
    }

    private static func named(_ name: String, identifier: String) -> AttributedString {
        var text = AttributedString(name)
        text.languageIdentifier = identifier
        return text
    }
}
