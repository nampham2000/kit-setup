import { ModelRenderer, Node } from 'cc';

/**
 * Hide / solo for the scene view.
 *
 * Caveat worth knowing: Cocos culls per *layer*, not per object per camera
 * (see scene-culling: a model is drawn when `(visibility & node.layer) === node.layer`
 * or `visibility & model.visFlags`). There is no per-object, per-camera switch, so
 * hiding cannot be confined to the scene viewport — it disables the renderer, and
 * the game view loses the object too.
 *
 * Renderers are disabled rather than nodes deactivated on purpose: this stops the
 * drawing without stopping scripts, physics, or children, so gameplay keeps running
 * while you look at it.
 */
export class VisibilityController {
    private _hidden = new Set<Node>();
    private _saved = new Map<ModelRenderer, boolean>();
    private _solo: Node = null;

    public get soloTarget (): Node | null { return this._solo; }

    public isHidden (node: Node): boolean { return this._hidden.has(node); }

    public isSolo (node: Node): boolean { return this._solo === node; }

    public toggleHidden (node: Node) {
        if (this._hidden.has(node)) {
            this._hidden.delete(node);
            this._restoreSubtree(node);
        } else {
            this._hidden.add(node);
            this._disableSubtree(node);
        }
    }

    /** Solo shows only this subtree. Calling it on the current target clears solo. */
    public toggleSolo (node: Node, sceneRoot: Node) {
        if (this._solo === node) {
            this._solo = null;
            this._restoreSubtree(sceneRoot);
            // Explicit hides survive leaving solo.
            for (const hidden of this._hidden) this._disableSubtree(hidden);
            return;
        }

        this._solo = node;
        this._restoreSubtree(sceneRoot);
        this._disableExcept(sceneRoot, node);
    }

    /** Put every renderer back the way it was found. */
    public restoreAll () {
        for (const [renderer, enabled] of this._saved) {
            if (renderer.isValid) renderer.enabled = enabled;
        }
        this._saved.clear();
        this._hidden.clear();
        this._solo = null;
    }

    private _disableSubtree (node: Node) {
        if (!node || !node.isValid) return;
        const renderers = node.getComponentsInChildren(ModelRenderer);
        for (let i = 0; i < renderers.length; i++) this._disable(renderers[i]);
    }

    private _disableExcept (root: Node, keep: Node) {
        if (!root || !root.isValid || root === keep) return;

        const own = root.getComponent(ModelRenderer);
        if (own) this._disable(own);

        const children = root.children;
        for (let i = 0; i < children.length; i++) this._disableExcept(children[i], keep);
    }

    private _disable (renderer: ModelRenderer) {
        if (!renderer || !renderer.isValid) return;
        if (!this._saved.has(renderer)) this._saved.set(renderer, renderer.enabled);
        renderer.enabled = false;
    }

    private _restoreSubtree (node: Node) {
        if (!node || !node.isValid) return;
        const renderers = node.getComponentsInChildren(ModelRenderer);
        for (let i = 0; i < renderers.length; i++) {
            const renderer = renderers[i];
            if (!this._saved.has(renderer)) continue;
            if (renderer.isValid) renderer.enabled = this._saved.get(renderer);
            this._saved.delete(renderer);
        }
    }
}
