import Foundation

/// What the guided operation shows for the last operation received (handoff
/// `mobile-parcours` §7.3, `sections.md` §1.4). It only names the state the
/// server sent: no countdown, animation or local clock ever moves it, and
/// only `CONFIRMED` is a success.
struct OperationStep: Equatable, Sendable {
    enum Kind: Equatable, Sendable { case checkout, `return` }

    /// The six phases of the list: Demande, Code du casier, Autorisation,
    /// Commande, Porte, Vérification.
    static let phaseCount = 6

    enum Tone: Equatable, Sendable { case progress, success, failure, neutral }

    /// What ends the guided operation, with its approved action.
    enum Ending: Equatable, Sendable {
        case confirmed
        /// `EXPIRED`: « Recommencer » prepares again if the server offers it.
        case expired
        case failed
        case anomaly
        /// A status this version does not know, stamped terminal by the server:
        /// neither a success nor a failure is claimed.
        case unrecognized
    }

    let title: String
    let instruction: String?
    /// 1 to 6 for the current phase, 7 when every phase is done, 0 when the
    /// status is not one this version knows.
    let phase: Int
    let tone: Tone
    let ending: Ending?
    /// The physical window (`expiresAt`), shown from `AUTHORIZED` on.
    let deadline: Date?
    /// The code is shown on the locker and can be scanned.
    let canScan: Bool
    /// The code is not displayed yet: the scan stays disabled.
    let awaitsDisplay: Bool

    var isFailure: Bool { tone == .failure }

    /// `interrupted`: the last reads failed, so the title says this is the
    /// last state received rather than asserting it (§7.3).
    init(_ operation: LockerOperationView?, kind: Kind, compartment: String, assetName: String,
         interrupted: Bool = false) {
        guard let operation else {
            self.init(title: String(localized: "Patientez."), instruction: nil, phase: 0, tone: .neutral)
            return
        }
        let deadline = operation.status.known.map { $0.isTerminal } == false ? operation.expiresAt : nil
        switch operation.status.known {
        case .requested:
            self.init(state: String(localized: "Demande envoyée"), received: String(localized: "demande envoyée"),
                      instruction: String(localized: "Patientez."), phase: 1, interrupted: interrupted)
        case .awaitingLocalProof where operation.localProofDisplayedAt == nil:
            self.init(state: String(localized: "Le code s’affiche sur le casier"),
                      received: String(localized: "le code s’affiche sur le casier"),
                      instruction: String(localized: "Approchez-vous de l’écran du casier."), phase: 2,
                      interrupted: interrupted, awaitsDisplay: true)
        case .awaitingLocalProof:
            self.init(state: String(localized: "Scannez le code du casier"),
                      received: String(localized: "code du casier affiché"),
                      instruction: String(localized: "Aucune porte n’est ouverte."), phase: 2,
                      interrupted: interrupted, canScan: operation.awaitsLocalProof && !interrupted)
        case .authorized:
            self.init(state: String(localized: "Accès autorisé"), received: String(localized: "accès autorisé"),
                      instruction: String(localized: "Déverrouillage de \(compartment) en préparation. N’ouvrez pas encore."),
                      phase: 3, interrupted: interrupted, deadline: deadline)
        case .commandSent:
            self.init(state: String(localized: "Commande transmise au casier"),
                      received: String(localized: "commande transmise au casier"),
                      instruction: String(localized: "Attendez le signal de la cellule \(compartment)."), phase: 4,
                      interrupted: interrupted, deadline: deadline)
        case .commandAcknowledged:
            let instruction = kind == .checkout
                ? String(localized: "Ouvrez la porte \(compartment) et retirez «\u{00A0}\(assetName)\u{00A0}». Si elle reste fermée, ne forcez pas et attendez le message suivant.")
                : String(localized: "Ouvrez la porte \(compartment) et déposez «\u{00A0}\(assetName)\u{00A0}». Si elle reste fermée, ne forcez pas et attendez le message suivant.")
            self.init(state: String(localized: "Déverrouillage lancé"), received: String(localized: "déverrouillage lancé"),
                      instruction: instruction, phase: 4, interrupted: interrupted, deadline: deadline)
        case .doorOpened:
            let instruction = kind == .checkout
                ? String(localized: "Retirez l’équipement, puis refermez la porte.")
                : String(localized: "Déposez l’équipement, puis refermez la porte.")
            self.init(state: String(localized: "Porte ouverte"), received: String(localized: "porte ouverte"),
                      instruction: instruction, phase: 5, interrupted: interrupted, deadline: deadline)
        case .observationReceived:
            self.init(state: String(localized: "Vérification en cours"),
                      received: String(localized: "vérification en cours"),
                      instruction: String(localized: "Gardez la porte fermée."), phase: 6, interrupted: interrupted,
                      deadline: deadline)
        case .confirmed:
            self.init(title: kind == .checkout ? String(localized: "Retrait confirmé") : String(localized: "Retour confirmé"),
                      instruction: nil, phase: 7, tone: .success, ending: .confirmed)
        case .expired:
            // One French text for both kinds; English names the operation, so
            // the return needs its own key.
            let instruction = kind == .checkout
                ? String(localized: "Aucune porte n’a été ouverte. Recommencez la préparation.")
                : String(localized: "operation.expired.return",
                         defaultValue: "Aucune porte n’a été ouverte. Recommencez la préparation.")
            self.init(title: String(localized: "Délai dépassé"), instruction: instruction,
                      phase: operation.authorizedAt == nil ? 2 : 5, tone: .failure, ending: .expired)
        case .failed:
            // `failureReason` stays generic (C8): no reason is shown.
            self.init(title: String(localized: "Opération arrêtée sans ouverture"),
                      instruction: String(localized: "Vous pouvez recommencer."),
                      phase: operation.authorizedAt == nil ? 2 : 4, tone: .failure, ending: .failed)
        case .anomaly:
            self.init(title: String(localized: "Intervention requise"),
                      instruction: String(localized: "Ne réessayez pas. Un administrateur doit vérifier la cellule \(compartment)."),
                      phase: 6, tone: .failure, ending: .anomaly)
        case nil:
            // §8.5: an unknown status implies no success, authorization or
            // physical action; following goes on until `terminalAt`. Doc 09 §3
            // shows it as an unavailable state, not as a wait that suggests
            // progress, even more so once the server has ended it.
            self.init(title: String(localized: "État indisponible"), instruction: nil, phase: 0, tone: .neutral,
                      ending: operation.isTerminal ? .unrecognized : nil)
        }
    }

    private init(state: String, received: String, instruction: String, phase: Int, interrupted: Bool,
                 deadline: Date? = nil, canScan: Bool = false, awaitsDisplay: Bool = false) {
        self.init(title: interrupted ? String(localized: "Dernier état reçu : \(received)") : state,
                  instruction: instruction, phase: phase, tone: .progress, deadline: deadline, canScan: canScan,
                  awaitsDisplay: awaitsDisplay)
    }

    private init(title: String, instruction: String?, phase: Int, tone: Tone, ending: Ending? = nil,
                 deadline: Date? = nil, canScan: Bool = false, awaitsDisplay: Bool = false) {
        self.title = title
        self.instruction = instruction
        self.phase = phase
        self.tone = tone
        self.ending = ending
        self.deadline = deadline
        self.canScan = canScan
        self.awaitsDisplay = awaitsDisplay
    }

    static var phaseNames: [String] {
        [String(localized: "Demande"), String(localized: "Code du casier"), String(localized: "Autorisation"),
         String(localized: "Commande"), String(localized: "Porte"), String(localized: "Vérification")]
    }
}
