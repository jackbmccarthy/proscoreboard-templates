// Mechanically extracted from the public static scoreboard contract. No server runtime imports.
const previewDefaults                         = {};

for (const side of ["A", "B"]) {
    for (const player of [`player${side}`, `player${side}2`]) {
        for (const suffix of ["", "FirstInitialLastName", "FirstNameLastInitial", "NameWithRating"]) {
            previewDefaults[`${player}${suffix}`] = `Player ${side}`;
        }
    }
    for (const prefix of ["combined", "courtSideCombined"]) {
        for (const suffix of ["Name", "FirstInitialLastName", "FirstNameLastInitial", "NameWithRating"]) {
            previewDefaults[`${prefix}${side}${suffix}`] = `Player ${side}`;
        }
    }
    for (const metadata of ["gender", "rating", "ranking"]) {
        previewDefaults[`${metadata}${side}`] = "";
        previewDefaults[`${metadata}${side}2`] = "";
    }
    previewDefaults[`team${side}Name`] = `Team ${side}`;
}

Object.assign(previewDefaults, {
    eventName: "Event Name",
    matchRound: "Round",
    courtName: "Court",
    matchFormatLabel: "",
});

const numericFields = new Set        (["timeOutTimer", "timeOutTimerA", "timeOutTimerB"]);
for (const side of ["A", "B"]) {
    numericFields.add(`team${side}Score`);
    for (const prefix of ["current", "courtSide"]) {
        numericFields.add(`${prefix}${side}GameScore`);
        numericFields.add(`${prefix}${side}MatchScore`);
    }
    for (let game = 1; game <= 9; game++) numericFields.add(`game${game}${side}Score`);
}
for (const field of numericFields) previewDefaults[field] = "0";

// This allowlist deliberately excludes conditional, image, color and layout fields.
export const SCOREBOARD_TEXT_FIELDS           = Object.keys(previewDefaults);

export function scoreboardTextDefault(field        , mode                    )                     {
    if (!Object.prototype.hasOwnProperty.call(previewDefaults, field)) return undefined;
    if (numericFields.has(field)) return "0";
    return mode === "preview" ? previewDefaults[field] : "";
}
