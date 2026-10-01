export interface LiveNumbers {
    /** The values as they are in the scene right now. */
    read (): number[];
    /** Put values into the scene. Called on every keystroke, so it must be cheap and idempotent. */
    write (values: number[]): void;
    /** Called once when editing ends, with the values from before it began and after, if they differ. */
    commit (before: number[], after: number[]): void;
    /** Lower bound for each value, or one bound for all of them. Defaults to none. */
    min?: number | number[];
}

/**
 * Make a row of number inputs update the scene as the user types, not when they leave
 * the field.
 *
 * Every keystroke is applied at once, so a collider or a transform visibly follows the
 * number. That would make one edit into dozens of undo steps, so the history is told
 * only when editing ends, as a single step from the values before the first keystroke
 * to the values after the last.
 *
 * A half-typed value (an empty field, a lone "-" or ".") cannot be parsed, and applying
 * it would snap the scene to nonsense or to zero. That one value is left as it is in
 * the scene until the text becomes a number again.
 */
export function bindLiveNumbers (inputs: HTMLInputElement[], options: LiveNumbers) {
    let start: number[] | null = null;

    const bound = (index: number): number => {
        const min = options.min;
        if (min === undefined) return -Infinity;
        return typeof min === 'number' ? min : (min[index] === undefined ? -Infinity : min[index]);
    };

    const parse = (fallback: number[]): number[] => inputs.map((input, i) => {
        const value = parseFloat(input.value);
        return Math.max(bound(i), isFinite(value) ? value : fallback[i]);
    });

    const begin = () => {
        if (!start) start = options.read();
    };

    for (const input of inputs) {
        input.addEventListener('focus', begin);
        input.addEventListener('input', () => {
            begin();
            options.write(parse(options.read()));
        });
        input.addEventListener('change', () => {
            const before = start || options.read();
            start = null;
            const after = parse(before);
            options.write(after);
            if (before.some((value, i) => Math.abs(value - after[i]) > 1e-9)) options.commit(before, after);
        });
        // `change` fires before `blur`, so by now a finished edit has been committed;
        // clearing here only drops the snapshot of a field that was focused and left alone.
        input.addEventListener('blur', () => { start = null; });
    }
}
