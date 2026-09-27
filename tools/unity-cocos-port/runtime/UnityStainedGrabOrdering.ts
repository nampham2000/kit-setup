/** Native Built-in Stained BumpDistort takes tied legacy particle draws in its GrabPass. */
export function unityPrecedesStainedGrab(priority: number, grabPriority: number, verifiedLegacyParticle: boolean): boolean {
    return priority < grabPriority || (priority === grabPriority && verifiedLegacyParticle);
}
