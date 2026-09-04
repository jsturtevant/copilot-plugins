const MAX_LCS_CELLS = 40_000;

function fallbackDiff(before, after) {
    return [
        ...before.map((text, index) => ({
            type: "removed",
            oldLine: index + 1,
            newLine: null,
            text,
        })),
        ...after.map((text, index) => ({
            type: "added",
            oldLine: null,
            newLine: index + 1,
            text,
        })),
    ];
}

export function buildLineDiff(beforeText, afterText) {
    const before = beforeText.replace(/\r\n?/g, "\n").split("\n");
    const after = afterText.replace(/\r\n?/g, "\n").split("\n");
    if (before.length * after.length > MAX_LCS_CELLS) {
        return fallbackDiff(before, after);
    }

    const lengths = Array.from({ length: before.length + 1 }, () =>
        new Uint16Array(after.length + 1),
    );
    for (let oldIndex = before.length - 1; oldIndex >= 0; oldIndex -= 1) {
        for (let newIndex = after.length - 1; newIndex >= 0; newIndex -= 1) {
            lengths[oldIndex][newIndex] =
                before[oldIndex] === after[newIndex]
                    ? lengths[oldIndex + 1][newIndex + 1] + 1
                    : Math.max(lengths[oldIndex + 1][newIndex], lengths[oldIndex][newIndex + 1]);
        }
    }

    const diff = [];
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < before.length || newIndex < after.length) {
        if (
            oldIndex < before.length &&
            newIndex < after.length &&
            before[oldIndex] === after[newIndex]
        ) {
            diff.push({
                type: "context",
                oldLine: oldIndex + 1,
                newLine: newIndex + 1,
                text: before[oldIndex],
            });
            oldIndex += 1;
            newIndex += 1;
        } else if (
            newIndex < after.length &&
            (oldIndex === before.length ||
                lengths[oldIndex][newIndex + 1] > lengths[oldIndex + 1][newIndex])
        ) {
            diff.push({
                type: "added",
                oldLine: null,
                newLine: newIndex + 1,
                text: after[newIndex],
            });
            newIndex += 1;
        } else {
            diff.push({
                type: "removed",
                oldLine: oldIndex + 1,
                newLine: null,
                text: before[oldIndex],
            });
            oldIndex += 1;
        }
    }
    return diff;
}
